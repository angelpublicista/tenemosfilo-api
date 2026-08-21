import { Prisma, type PayoutRole } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import type {
  CreatePayoutInput,
  ListEarningsQuery,
  ListPayoutsQuery,
} from './payouts.schemas.js';

export type Saldo = {
  companyId: string;
  companyName: string;
  role: PayoutRole;
  /** Devengado por reservas ya cobradas. */
  accrued: number;
  /** Ya transferido. */
  paid: number;
  /** Lo que falta por dispersar. */
  pending: number;
};

// Solo cuentan las reservas efectivamente cobradas: es dinero que FILO ya
// tiene. Una cancelada no genera deuda aunque figure como pagada.
const CONDICION_COBRADA = Prisma.sql`"paymentStatus" = 'PAID' AND "status" <> 'CANCELLED'`;

/** Suma un campo del JSON de pricing. Prisma no agrega dentro de JSON. */
function sumaPricing(campo: string) {
  return Prisma.sql`COALESCE(SUM((pricing ->> ${campo})::numeric), 0)`;
}

/**
 * Nucleo del calculo, compartido por el panel de FILO y por el de cada
 * empresa. Vive en un solo sitio a proposito: si el anfitrion y el admin
 * sumaran distinto, uno de los dos estaria viendo mal su dinero.
 *
 * Con `companyId` se limita a esa empresa; sin el, agrega la plataforma.
 */
async function calcularSaldos(companyId?: string): Promise<{ items: Saldo[]; filoRetained: number }> {
  const soloEmpresaHost = companyId
    ? Prisma.sql`AND r."companyId" = ${companyId}`
    : Prisma.empty;
  const soloEmpresaReseller = companyId
    ? Prisma.sql`AND r."resellerCompanyId" = ${companyId}`
    : Prisma.empty;

  const [comoHost, comoReseller, dispersado, retenido] = await Promise.all([
    prisma.$queryRaw<{ companyId: string; companyName: string; total: number }[]>`
        SELECT r."companyId"          AS "companyId",
               c."companyName"        AS "companyName",
               ${sumaPricing('hostEarnings')} AS total
        FROM "Reservation" r
        JOIN "Company" c ON c.id = r."companyId"
        WHERE ${CONDICION_COBRADA} ${soloEmpresaHost}
        GROUP BY r."companyId", c."companyName"
      `,
    prisma.$queryRaw<{ companyId: string; companyName: string; total: number }[]>`
        SELECT r."resellerCompanyId"  AS "companyId",
               c."companyName"        AS "companyName",
               ${sumaPricing('resellerCommission')} AS total
        FROM "Reservation" r
        JOIN "Company" c ON c.id = r."resellerCompanyId"
        WHERE ${CONDICION_COBRADA} AND r."resellerCompanyId" IS NOT NULL ${soloEmpresaReseller}
        GROUP BY r."resellerCompanyId", c."companyName"
      `,
    prisma.payout.groupBy({
      by: ['companyId', 'role'],
      _sum: { amount: true },
      ...(companyId ? { where: { companyId } } : {}),
    }),
    prisma.$queryRaw<{ total: number }[]>`
        SELECT ${sumaPricing('filoCommission')} AS total
        FROM "Reservation" r
        WHERE ${CONDICION_COBRADA} ${soloEmpresaHost}
      `,
  ]);

  const pagadoPor = new Map(
    dispersado.map((d) => [`${d.companyId}:${d.role}`, Number(d._sum.amount ?? 0)]),
  );

  const construir = (
    filas: { companyId: string; companyName: string; total: number }[],
    role: PayoutRole,
  ): Saldo[] =>
    filas.map((f) => {
      const accrued = Number(f.total);
      const paid = pagadoPor.get(`${f.companyId}:${role}`) ?? 0;
      return {
        companyId: f.companyId,
        companyName: f.companyName,
        role,
        accrued,
        paid,
        pending: accrued - paid,
      };
    });

  const items = [...construir(comoHost, 'HOST'), ...construir(comoReseller, 'RESELLER')]
    // Las que ya no deben nada y nunca cobraron no aportan informacion.
    .filter((s) => s.accrued > 0 || s.paid > 0)
    .sort((a, b) => b.pending - a.pending);

  return { items, filoRetained: Number(retenido[0]?.total ?? 0) };
}

export const payoutsService = {
  /**
   * Lo que FILO le debe a cada empresa, separado por rol: como anfitriona
   * (sus ingresos) y como revendedora (sus comisiones).
   */
  async balances(): Promise<{ items: Saldo[]; filoRetained: number }> {
    return calcularSaldos();
  },

  /**
   * Lo que ve una empresa de si misma: sus saldos y las transferencias que
   * ya recibio. Nunca acepta un companyId del cliente — se resuelve desde
   * la sesion — para que nadie consulte las cuentas de otro.
   */
  async resumenEmpresa(companyId: string) {
    const [{ items }, payouts] = await Promise.all([
      calcularSaldos(companyId),
      prisma.payout.findMany({
        where: { companyId },
        orderBy: { paidAt: 'desc' },
        take: 50,
        // Sin `createdById` ni `createdByEmail`: quien de FILO registro la
        // transferencia es asunto interno.
        select: { id: true, role: true, amount: true, reference: true, paidAt: true },
      }),
    ]);

    const suma = (campo: 'accrued' | 'paid' | 'pending') =>
      items.reduce((acc, s) => acc + s[campo], 0);

    return {
      balances: items,
      payouts,
      totals: { accrued: suma('accrued'), paid: suma('paid'), pending: suma('pending') },
    };
  },

  /**
   * Las reservas que componen lo devengado, para que el anfitrion pueda
   * cuadrar el total con reservas concretas en vez de creerse una cifra.
   */
  async ingresosEmpresa(companyId: string, query: ListEarningsQuery) {
    const { page, pageSize, role } = query;

    const where: Prisma.ReservationWhereInput = {
      paymentStatus: 'PAID',
      status: { not: 'CANCELLED' },
      ...(role === 'RESELLER' ? { resellerCompanyId: companyId } : { companyId }),
    };

    const [items, total] = await Promise.all([
      prisma.reservation.findMany({
        where,
        orderBy: { reservationDate: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        select: {
          id: true,
          reservationNumber: true,
          reservationDate: true,
          participants: true,
          status: true,
          pricing: true,
          experience: { select: { id: true, title: true } },
          company: { select: { id: true, companyName: true } },
        },
      }),
      prisma.reservation.count({ where }),
    ]);

    // El desglose se aplana aqui para no obligar a cada pantalla a saber
    // como esta guardado el JSON de pricing.
    const filas = items.map((r) => {
      const p = (r.pricing ?? {}) as Record<string, unknown>;
      const num = (campo: string) => Number(p[campo] ?? 0);
      return {
        id: r.id,
        reservationNumber: r.reservationNumber,
        reservationDate: r.reservationDate,
        participants: r.participants,
        status: r.status,
        experienceTitle: r.experience?.title ?? null,
        companyName: r.company?.companyName ?? null,
        total: num('total'),
        filoCommission: num('filoCommission'),
        resellerCommission: num('resellerCommission'),
        // Segun en calidad de que se mira la reserva: lo que gana el
        // anfitrion o la comision que le queda al revendedor.
        earnings: role === 'RESELLER' ? num('resellerCommission') : num('hostEarnings'),
      };
    });

    return { items: filas, total };
  },

  /** Registra una transferencia ya realizada. */
  async create(input: CreatePayoutInput, actor: { id: string; email: string }) {
    const company = await prisma.company.findFirst({
      where: { id: input.companyId, deletedAt: null },
      select: { id: true },
    });
    if (!company) throw NotFound('La empresa indicada no existe');
    if (input.amount <= 0) throw BadRequest('El importe debe ser mayor que cero');

    // No dejamos dispersar mas de lo que se debe: seria dinero que FILO no
    // ha cobrado.
    const { items } = await this.balances();
    const saldo = items.find((s) => s.companyId === input.companyId && s.role === input.role);
    const pendiente = saldo?.pending ?? 0;
    if (input.amount > pendiente) {
      throw BadRequest(
        `El importe supera el saldo pendiente (${pendiente.toLocaleString('es-CO')}).`,
      );
    }

    return prisma.payout.create({
      data: {
        companyId: input.companyId,
        role: input.role,
        amount: input.amount,
        reference: input.reference ?? null,
        notes: input.notes ?? null,
        createdById: actor.id,
        createdByEmail: actor.email,
        ...(input.paidAt ? { paidAt: new Date(input.paidAt) } : {}),
      },
    });
  },

  async list(query: ListPayoutsQuery) {
    const { page, pageSize, companyId, role } = query;
    const where: Prisma.PayoutWhereInput = {
      ...(companyId && { companyId }),
      ...(role && { role }),
    };

    const [items, total] = await Promise.all([
      prisma.payout.findMany({
        where,
        include: { company: { select: { id: true, companyName: true } } },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { paidAt: 'desc' },
      }),
      prisma.payout.count({ where }),
    ]);

    return { items, total };
  },
};
