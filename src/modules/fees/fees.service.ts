// Lo que los anfitriones le deben a FILO por cobrar con su propia pasarela.
//
// Con cobro propio el dinero de la venta entra a la cuenta del anfitrion, asi
// que FILO no puede descontar su comision del pago. Se junta por mes: FILO
// factura por fuera y aqui se deja constancia de lo que ya se pago.
//
// Lo devengado no se guarda, sale de las reservas, igual que los saldos de
// las dispersiones: si se guardara, una reserva cancelada despues dejaria el
// balance mintiendo.
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import type { RegistrarPagoInput } from './fees.schemas.js';

const ZONA = 'America/Bogota';

/**
 * En curso: el mes todavia no termino y la cifra puede cambiar, asi que no se
 * cobra. Lo demas depende de cuanto se ha pagado de lo devengado.
 */
export type EstadoDelMes = 'EN_CURSO' | 'PENDIENTE' | 'PARCIAL' | 'PAGADO';

export type PagoDeComision = {
  id: string;
  amount: number;
  reference: string | null;
  paidAt: Date;
};

export type BalanceMensual = {
  companyId: string;
  companyName: string;
  /** "2026-10" */
  period: string;
  reservas: number;
  /** Comision de FILO sobre las reservas del mes que el anfitrion cobro. */
  accrued: number;
  paid: number;
  pending: number;
  estado: EstadoDelMes;
  pagos: PagoDeComision[];
};

/** El mes en que estamos, en hora de Bogota: es el de las reservas. */
export function periodoActual(ahora: Date = new Date()): string {
  const partes = new Intl.DateTimeFormat('en-CA', {
    timeZone: ZONA,
    year: 'numeric',
    month: '2-digit',
  }).formatToParts(ahora);
  const y = partes.find((p) => p.type === 'year')?.value;
  const m = partes.find((p) => p.type === 'month')?.value;
  return `${y}-${m}`;
}

/** Rango de un mes en UTC. Bogota no tiene horario de verano: es UTC-5 fijo. */
function rangoDelPeriodo(periodo: string): { desde: Date; hasta: Date } {
  const [y, m] = periodo.split('-').map(Number) as [number, number];
  const siguiente = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, '0')}`;
  return {
    desde: new Date(`${periodo}-01T00:00:00-05:00`),
    hasta: new Date(`${siguiente}-01T00:00:00-05:00`),
  };
}

type FilaDevengada = {
  companyId: string;
  companyName: string;
  period: string;
  reservas: number;
  total: Prisma.Decimal | number;
};

export const feesService = {
  /**
   * Un renglon por anfitrion y mes. Los meses sin reservas cobradas por el
   * anfitrion no aparecen: no hay nada que decir de ellos.
   */
  async balances(opts: { companyId?: string } = {}): Promise<BalanceMensual[]> {
    const soloEmpresa = opts.companyId
      ? Prisma.sql`AND r."companyId" = ${opts.companyId}`
      : Prisma.empty;

    const [devengado, pagos] = await Promise.all([
      prisma.$queryRaw<FilaDevengada[]>`
        SELECT r."companyId"   AS "companyId",
               c."companyName" AS "companyName",
               to_char((r."reservationDate" AT TIME ZONE 'UTC') AT TIME ZONE 'America/Bogota', 'YYYY-MM') AS period,
               COUNT(*)::int   AS reservas,
               COALESCE(SUM((r.pricing ->> 'filoCommission')::numeric), 0) AS total
        FROM "Reservation" r
        JOIN "Company" c ON c.id = r."companyId"
        WHERE r."paymentStatus" = 'PAID'
          AND r."status" <> 'CANCELLED'
          AND r."collectedBy" = 'HOST'
          AND COALESCE((r.pricing ->> 'filoCommission')::numeric, 0) > 0
          ${soloEmpresa}
        GROUP BY r."companyId", c."companyName", period
      `,
      prisma.feePayment.findMany({
        where: opts.companyId ? { companyId: opts.companyId } : undefined,
        orderBy: { paidAt: 'asc' },
        include: { company: { select: { companyName: true } } },
      }),
    ]);

    const actual = periodoActual();
    const filas = new Map<string, BalanceMensual>();
    const clave = (companyId: string, period: string) => `${companyId}:${period}`;

    for (const d of devengado) {
      filas.set(clave(d.companyId, d.period), {
        companyId: d.companyId,
        companyName: d.companyName,
        period: d.period,
        reservas: Number(d.reservas),
        accrued: Math.round(Number(d.total)),
        paid: 0,
        pending: 0,
        estado: 'PENDIENTE',
        pagos: [],
      });
    }

    for (const p of pagos) {
      // Un pago de un mes que despues quedo sin devengado (se cancelaron las
      // reservas) tambien se muestra: es dinero que FILO recibio.
      const k = clave(p.companyId, p.period);
      const fila =
        filas.get(k) ??
        ({
          companyId: p.companyId,
          companyName: p.company.companyName,
          period: p.period,
          reservas: 0,
          accrued: 0,
          paid: 0,
          pending: 0,
          estado: 'PENDIENTE',
          pagos: [],
        } satisfies BalanceMensual);
      fila.paid += Number(p.amount);
      fila.pagos.push({
        id: p.id,
        amount: Number(p.amount),
        reference: p.reference,
        paidAt: p.paidAt,
      });
      filas.set(k, fila);
    }

    for (const f of filas.values()) {
      f.pending = f.accrued - f.paid;
      f.estado =
        f.period === actual
          ? 'EN_CURSO'
          : f.pending <= 0
            ? 'PAGADO'
            : f.paid > 0
              ? 'PARCIAL'
              : 'PENDIENTE';
    }

    return [...filas.values()].sort(
      (a, b) => b.period.localeCompare(a.period) || b.pending - a.pending,
    );
  },

  /**
   * Las reservas que componen la cifra de un mes, para que el balance se
   * pueda cuadrar —y facturar— contra reservas concretas.
   */
  async detalle(companyId: string, period: string) {
    const { desde, hasta } = rangoDelPeriodo(period);
    const reservas = await prisma.reservation.findMany({
      where: {
        companyId,
        collectedBy: 'HOST',
        paymentStatus: 'PAID',
        status: { not: 'CANCELLED' },
        reservationDate: { gte: desde, lt: hasta },
      },
      orderBy: { reservationDate: 'asc' },
      select: {
        id: true,
        reservationNumber: true,
        reservationDate: true,
        participants: true,
        pricing: true,
        experience: { select: { title: true } },
      },
    });

    return reservas
      .map((r) => {
        const p = (r.pricing ?? {}) as Record<string, unknown>;
        return {
          id: r.id,
          reservationNumber: r.reservationNumber,
          reservationDate: r.reservationDate,
          participants: r.participants,
          experienceTitle: r.experience?.title ?? null,
          total: Number(p.total ?? 0),
          filoCommission: Number(p.filoCommission ?? 0),
        };
      })
      .filter((r) => r.filoCommission > 0);
  },

  /**
   * Deja constancia de que un anfitrion pago su comision de un mes.
   *
   * Solo de meses terminados: la cifra de uno en curso todavia se mueve. Y
   * nunca mas de lo pendiente, que seria dinero de nadie.
   */
  async registrarPago(input: RegistrarPagoInput, actor: { id: string; email: string }) {
    const empresa = await prisma.company.findFirst({
      where: { id: input.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!empresa) throw NotFound('La empresa indicada no existe');

    if (input.period >= periodoActual()) {
      throw BadRequest('Ese mes todavía no termina: la comisión se cobra cuando cierre.');
    }

    const [fila] = (await this.balances({ companyId: input.companyId })).filter(
      (b) => b.period === input.period,
    );
    const pendiente = fila?.pending ?? 0;
    if (pendiente <= 0) throw BadRequest('Ese mes no tiene comisión pendiente.');

    const monto = input.amount ?? pendiente;
    if (monto > pendiente) {
      throw BadRequest(
        `El importe supera lo pendiente de ese mes (${pendiente.toLocaleString('es-CO')}).`,
      );
    }

    return prisma.feePayment.create({
      data: {
        companyId: input.companyId,
        period: input.period,
        amount: monto,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        createdById: actor.id,
        createdByEmail: actor.email,
        ...(input.paidAt ? { paidAt: new Date(input.paidAt) } : {}),
      },
    });
  },

  /** Para corregir un pago marcado por error. */
  async deshacerPago(id: string) {
    const pago = await prisma.feePayment.findUnique({ where: { id }, select: { id: true } });
    if (!pago) throw NotFound('El pago no existe');
    await prisma.feePayment.delete({ where: { id } });
  },
};
