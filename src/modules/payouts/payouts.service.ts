import { Prisma, type PayoutRole } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import type { CreatePayoutInput, ListPayoutsQuery } from './payouts.schemas.js';

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

export const payoutsService = {
  /**
   * Lo que FILO le debe a cada empresa, separado por rol: como anfitriona
   * (sus ingresos) y como revendedora (sus comisiones).
   */
  async balances(): Promise<{ items: Saldo[]; filoRetained: number }> {
    const [comoHost, comoReseller, dispersado, retenido] = await Promise.all([
      prisma.$queryRaw<{ companyId: string; companyName: string; total: number }[]>`
        SELECT r."companyId"          AS "companyId",
               c."companyName"        AS "companyName",
               ${sumaPricing('hostEarnings')} AS total
        FROM "Reservation" r
        JOIN "Company" c ON c.id = r."companyId"
        WHERE ${CONDICION_COBRADA}
        GROUP BY r."companyId", c."companyName"
      `,
      prisma.$queryRaw<{ companyId: string; companyName: string; total: number }[]>`
        SELECT r."resellerCompanyId"  AS "companyId",
               c."companyName"        AS "companyName",
               ${sumaPricing('resellerCommission')} AS total
        FROM "Reservation" r
        JOIN "Company" c ON c.id = r."resellerCompanyId"
        WHERE ${CONDICION_COBRADA} AND r."resellerCompanyId" IS NOT NULL
        GROUP BY r."resellerCompanyId", c."companyName"
      `,
      prisma.payout.groupBy({ by: ['companyId', 'role'], _sum: { amount: true } }),
      prisma.$queryRaw<{ total: number }[]>`
        SELECT ${sumaPricing('filoCommission')} AS total
        FROM "Reservation" r
        WHERE ${CONDICION_COBRADA}
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
