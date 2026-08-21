import { prisma } from '../../config/prisma.js';
import { Forbidden } from '../../lib/errors.js';

function startOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 1);
}
function endOfCurrentMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() + 1, 0, 23, 59, 59, 999);
}
function startOfPrevMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth() - 1, 1);
}
function endOfPrevMonth(): Date {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), 0, 23, 59, 59, 999);
}

function pricingTotal(pricing: unknown): number {
  if (pricing && typeof pricing === 'object' && 'total' in pricing) {
    const t = (pricing as { total: unknown }).total;
    return typeof t === 'number' ? t : Number(t) || 0;
  }
  return 0;
}

/**
 * Devuelve la company sobre la que se calculan las metricas.
 *
 * Para el ADMIN puede devolver `undefined`, que significa "toda la
 * plataforma": los `where` de Prisma ignoran las claves undefined, asi que
 * el filtro por empresa simplemente no se aplica. El admin tambien puede
 * pedir una empresa concreta con ?companyId=.
 */
function resolveCompanyId(
  requesterCompanyId: string | null | undefined,
  paramCompanyId?: string,
  opts?: { isAdmin?: boolean },
): string | undefined {
  // Para el admin, requesterCompanyId es la empresa que eligio en el selector
  // (la puso applyActingCompany desde la cabecera) o null si esta en modo
  // plataforma. Sin este ?? , actuar como una empresa seguia dando el
  // agregado global.
  if (opts?.isAdmin) return paramCompanyId ?? requesterCompanyId ?? undefined;

  const target = paramCompanyId ?? requesterCompanyId;
  if (!target) throw Forbidden('No tienes una company asociada');
  if (paramCompanyId && requesterCompanyId && paramCompanyId !== requesterCompanyId) {
    throw Forbidden('No tienes acceso a stats de otra company');
  }
  return target;
}

export const dashboardService = {
  async stats(
    requesterCompanyId: string | null | undefined,
    paramCompanyId?: string,
    opts?: { isAdmin?: boolean },
  ) {
    const companyId = resolveCompanyId(requesterCompanyId, paramCompanyId, opts);
    // Modo plataforma: el admin sin ?companyId ve el agregado de todo.
    const global = companyId === undefined;

    const [activeExperiences, pendingReservations, currentRows, prevRows] = await Promise.all([
      prisma.experience.count({
        where: { companyId, deletedAt: null, status: 'ACTIVE' },
      }),
      prisma.reservation.count({
        where: { companyId, status: 'PENDING' },
      }),
      prisma.reservation.findMany({
        where: {
          companyId,
          reservationDate: { gte: startOfCurrentMonth(), lte: endOfCurrentMonth() },
          status: { in: ['CONFIRMED', 'COMPLETED'] },
        },
        select: { pricing: true },
      }),
      prisma.reservation.findMany({
        where: {
          companyId,
          reservationDate: { gte: startOfPrevMonth(), lte: endOfPrevMonth() },
          status: { in: ['CONFIRMED', 'COMPLETED'] },
        },
        select: { pricing: true },
      }),
    ]);

    const monthlyRevenue = currentRows.reduce((acc, r) => acc + pricingTotal(r.pricing), 0);
    const lastMonthRevenue = prevRows.reduce((acc, r) => acc + pricingTotal(r.pricing), 0);

    let growth = 0;
    if (lastMonthRevenue > 0) {
      growth = ((monthlyRevenue - lastMonthRevenue) / lastMonthRevenue) * 100;
    } else if (monthlyRevenue > 0) {
      growth = 100;
    }

    // Solo en modo plataforma: totales que al admin le sirven de portada y
    // que a un host no le significan nada.
    const platform = global
      ? {
          totalCompanies: await prisma.company.count({ where: { deletedAt: null } }),
          totalUsers: await prisma.user.count({ where: { deletedAt: null } }),
        }
      : {};

    return {
      activeExperiences,
      pendingReservations,
      monthlyRevenue,
      growth: Math.round(growth * 10) / 10,
      ...platform,
    };
  },

  async recentActivities(
    requesterCompanyId: string | null | undefined,
    paramCompanyId: string | undefined,
    limit: number,
    opts?: { isAdmin?: boolean },
  ) {
    const companyId = resolveCompanyId(requesterCompanyId, paramCompanyId, opts);

    const [experiences, reservations, payments] = await Promise.all([
      prisma.experience.findMany({
        where: { companyId, deletedAt: null },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: { id: true, title: true, createdAt: true },
      }),
      prisma.reservation.findMany({
        where: { companyId },
        orderBy: { createdAt: 'desc' },
        take: 3,
        select: {
          id: true,
          reservationNumber: true,
          client: true,
          participants: true,
          createdAt: true,
        },
      }),
      prisma.reservation.findMany({
        where: { companyId, paymentStatus: 'PAID' },
        orderBy: { updatedAt: 'desc' },
        take: 3,
        select: {
          id: true,
          reservationNumber: true,
          pricing: true,
          updatedAt: true,
        },
      }),
    ]);

    type Activity = {
      id: string;
      type: 'experience' | 'reservation' | 'payment';
      title: string;
      description: string;
      timestamp: string;
    };
    // El id lleva el tipo delante porque una misma reserva genera dos
    // actividades — la reserva y su pago — y el front las usa como key de
    // lista. Con el id pelado React ve dos hijos con la misma clave.
    const items: Activity[] = [];

    for (const e of experiences) {
      items.push({
        id: `experience:${e.id}`,
        type: 'experience',
        title: 'Nueva experiencia creada',
        description: e.title,
        timestamp: e.createdAt.toISOString(),
      });
    }
    for (const r of reservations) {
      const clientName =
        r.client && typeof r.client === 'object' && 'name' in r.client
          ? String((r.client as { name: unknown }).name ?? 'Cliente')
          : 'Cliente';
      items.push({
        id: `reservation:${r.id}`,
        type: 'reservation',
        title: 'Nueva reserva recibida',
        description: `${clientName} reservo para ${r.participants} personas`,
        timestamp: r.createdAt.toISOString(),
      });
    }
    for (const p of payments) {
      items.push({
        id: `payment:${p.id}`,
        type: 'payment',
        title: 'Pago procesado',
        // En pesos no hay centavos y sin separador de miles "600000.00" no
        // se lee de un vistazo.
        description: `Reserva #${p.reservationNumber} - $${pricingTotal(p.pricing).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`,
        timestamp: p.updatedAt.toISOString(),
      });
    }

    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return items.slice(0, limit);
  },
};
