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

function resolveCompanyId(
  requesterCompanyId: string | null | undefined,
  paramCompanyId?: string,
): string {
  const target = paramCompanyId ?? requesterCompanyId;
  if (!target) throw Forbidden('No tienes una company asociada');
  if (paramCompanyId && requesterCompanyId && paramCompanyId !== requesterCompanyId) {
    throw Forbidden('No tienes acceso a stats de otra company');
  }
  return target;
}

export const dashboardService = {
  async stats(requesterCompanyId: string | null | undefined, paramCompanyId?: string) {
    const companyId = resolveCompanyId(requesterCompanyId, paramCompanyId);

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

    return {
      activeExperiences,
      pendingReservations,
      monthlyRevenue,
      growth: Math.round(growth * 10) / 10,
    };
  },

  async recentActivities(
    requesterCompanyId: string | null | undefined,
    paramCompanyId: string | undefined,
    limit: number,
  ) {
    const companyId = resolveCompanyId(requesterCompanyId, paramCompanyId);

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
    const items: Activity[] = [];

    for (const e of experiences) {
      items.push({
        id: e.id,
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
        id: r.id,
        type: 'reservation',
        title: 'Nueva reserva recibida',
        description: `${clientName} reservo para ${r.participants} personas`,
        timestamp: r.createdAt.toISOString(),
      });
    }
    for (const p of payments) {
      items.push({
        id: p.id,
        type: 'payment',
        title: 'Pago procesado',
        description: `Reserva #${p.reservationNumber} - $${pricingTotal(p.pricing).toFixed(2)}`,
        timestamp: p.updatedAt.toISOString(),
      });
    }

    items.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
    return items.slice(0, limit);
  },
};
