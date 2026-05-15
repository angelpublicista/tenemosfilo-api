import { Prisma, ReservationStatus, PaymentStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { Forbidden, NotFound } from '../../lib/errors.js';
import type {
  CancelInput,
  CreateReservationInput,
  ListReservationsQuery,
  RescheduleInput,
  UpdateReservationInput,
} from './reservations.schemas.js';

function generateReservationNumber(): string {
  const ts = Date.now().toString().slice(-6);
  const rand = Math.random().toString(36).substring(2, 5).toUpperCase();
  return `RES-${ts}-${rand}`;
}

const fullInclude = {
  experience: { select: { id: true, title: true, duration: true, capacity: true } },
  company: { select: { id: true, companyName: true, companyEmail: true, companyPhone: true } },
  user: { select: { id: true, name: true, email: true, phone: true } },
  location: { select: { id: true, name: true, address: true } },
} satisfies Prisma.ReservationInclude;

async function assertCanManage(id: string, requesterCompanyId: string | null | undefined) {
  const r = await prisma.reservation.findUnique({
    where: { id },
    select: { id: true, companyId: true, reservationDate: true, pricing: true },
  });
  if (!r) throw NotFound('Reserva no encontrada');
  if (!requesterCompanyId || r.companyId !== requesterCompanyId)
    throw Forbidden('No tienes permiso sobre esta reserva');
  return r;
}

export const reservationsService = {
  async create(requesterCompanyId: string | null | undefined, input: CreateReservationInput) {
    // Si no viene company, lo derivamos del experience
    let companyId = input.company;
    if (!companyId) {
      const exp = await prisma.experience.findFirst({
        where: { id: input.experience, deletedAt: null },
        select: { companyId: true },
      });
      if (!exp) throw NotFound('Experiencia no encontrada');
      companyId = exp.companyId;
    }
    if (requesterCompanyId && companyId !== requesterCompanyId) {
      throw Forbidden('No puedes crear reservas en otra company');
    }

    return prisma.reservation.create({
      data: {
        reservationNumber: input.reservationNumber ?? generateReservationNumber(),
        experience: { connect: { id: input.experience } },
        company: { connect: { id: companyId } },
        client: input.client as Prisma.InputJsonValue,
        clientType: input.clientType ?? 'GUEST',
        ...(input.user ? { user: { connect: { id: input.user } } } : {}),
        source: input.source ?? 'MANUAL',
        reservationDate: new Date(input.reservationDate),
        duration: input.duration ?? null,
        participants: input.participants,
        status: input.status ?? 'PENDING',
        paymentStatus: input.paymentStatus ?? 'PENDING',
        pricing: input.pricing as Prisma.InputJsonValue,
        paymentMethod: input.paymentMethod ?? null,
        paymentDetails: (input.paymentDetails as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
        ...(input.location ? { location: { connect: { id: input.location } } } : {}),
        isVirtual: input.isVirtual ?? false,
        virtualDetails: input.virtualDetails ? JSON.stringify(input.virtualDetails) : null,
        specialRequirements: input.specialRequirements ?? null,
        notes: input.notes ?? null,
      },
      include: fullInclude,
    });
  },

  async createPublic(input: CreateReservationInput) {
    // Igual que create() pero sin checks de ownership; usado por el booking engine.
    let companyId = input.company;
    if (!companyId) {
      const exp = await prisma.experience.findFirst({
        where: { id: input.experience, deletedAt: null, status: 'ACTIVE' },
        select: { companyId: true },
      });
      if (!exp) throw NotFound('Experiencia no disponible');
      companyId = exp.companyId;
    }
    return prisma.reservation.create({
      data: {
        reservationNumber: input.reservationNumber ?? generateReservationNumber(),
        experience: { connect: { id: input.experience } },
        company: { connect: { id: companyId } },
        client: input.client as Prisma.InputJsonValue,
        clientType: 'GUEST',
        source: 'BOOKING_ENGINE',
        reservationDate: new Date(input.reservationDate),
        duration: input.duration ?? null,
        participants: input.participants,
        status: 'PENDING',
        paymentStatus: 'PENDING',
        pricing: input.pricing as Prisma.InputJsonValue,
        ...(input.location ? { location: { connect: { id: input.location } } } : {}),
        isVirtual: input.isVirtual ?? false,
        specialRequirements: input.specialRequirements ?? null,
        notes: input.notes ?? null,
      },
      select: { reservationNumber: true },
    });
  },

  async getById(id: string) {
    const r = await prisma.reservation.findUnique({ where: { id }, include: fullInclude });
    if (!r) throw NotFound('Reserva no encontrada');
    return r;
  },

  async list(requesterCompanyId: string | null | undefined, query: ListReservationsQuery) {
    const targetCompanyId = query.companyId ?? requesterCompanyId;
    if (query.companyId && requesterCompanyId && query.companyId !== requesterCompanyId) {
      throw Forbidden('No tienes acceso a las reservas de otra company');
    }

    const where: Prisma.ReservationWhereInput = {
      ...(targetCompanyId ? { companyId: targetCompanyId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.paymentStatus ? { paymentStatus: query.paymentStatus } : {}),
      ...(query.experienceId ? { experienceId: query.experienceId } : {}),
      ...(query.isVirtual !== undefined ? { isVirtual: query.isVirtual } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            reservationDate: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
      ...(query.search
        ? {
            OR: [
              { reservationNumber: { contains: query.search, mode: 'insensitive' } },
              { notes: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const orderBy: Prisma.ReservationOrderByWithRelationInput =
      query.sortBy === 'total'
        ? { pricing: query.sortOrder } // pricing es Json; Prisma no ordena por sub-key, fallback a sortBy
        : { [query.sortBy]: query.sortOrder };

    const [items, total] = await Promise.all([
      prisma.reservation.findMany({
        where,
        include: fullInclude,
        orderBy,
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      prisma.reservation.count({ where }),
    ]);

    return { items, total };
  },

  async update(id: string, requesterCompanyId: string | null | undefined, input: UpdateReservationInput) {
    await assertCanManage(id, requesterCompanyId);

    const data: Prisma.ReservationUpdateInput = {};
    if (input.client !== undefined) data.client = input.client as Prisma.InputJsonValue;
    if (input.clientType !== undefined) data.clientType = input.clientType;
    if (input.source !== undefined) data.source = input.source;
    if (input.reservationDate !== undefined) data.reservationDate = new Date(input.reservationDate);
    if (input.duration !== undefined) data.duration = input.duration;
    if (input.participants !== undefined) data.participants = input.participants;
    if (input.status !== undefined) data.status = input.status;
    if (input.paymentStatus !== undefined) data.paymentStatus = input.paymentStatus;
    if (input.pricing !== undefined) data.pricing = input.pricing as Prisma.InputJsonValue;
    if (input.paymentMethod !== undefined) data.paymentMethod = input.paymentMethod ?? null;
    if (input.paymentDetails !== undefined)
      data.paymentDetails = (input.paymentDetails as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    if (input.isVirtual !== undefined) data.isVirtual = input.isVirtual;
    if (input.virtualDetails !== undefined)
      data.virtualDetails = input.virtualDetails ? JSON.stringify(input.virtualDetails) : null;
    if (input.specialRequirements !== undefined) data.specialRequirements = input.specialRequirements ?? null;
    if (input.notes !== undefined) data.notes = input.notes ?? null;
    if (input.location !== undefined && input.location !== null)
      data.location = { connect: { id: input.location } };
    if (input.user !== undefined && input.user !== null)
      data.user = { connect: { id: input.user } };

    return prisma.reservation.update({ where: { id }, data, include: fullInclude });
  },

  async updateStatus(id: string, requesterCompanyId: string | null | undefined, status: ReservationStatus) {
    await assertCanManage(id, requesterCompanyId);
    return prisma.reservation.update({ where: { id }, data: { status }, include: fullInclude });
  },

  async updatePaymentStatus(
    id: string,
    requesterCompanyId: string | null | undefined,
    paymentStatus: PaymentStatus,
  ) {
    await assertCanManage(id, requesterCompanyId);
    return prisma.reservation.update({
      where: { id },
      data: { paymentStatus },
      include: fullInclude,
    });
  },

  async cancel(id: string, requesterCompanyId: string | null | undefined, input: CancelInput) {
    await assertCanManage(id, requesterCompanyId);
    return prisma.reservation.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        cancellation: {
          cancelledAt: new Date().toISOString(),
          cancelledBy: input.cancelledBy,
          cancellationReason: input.reason,
          refundAmount: input.refundAmount ?? 0,
          refundStatus: input.refundAmount ? 'pending' : null,
        } as Prisma.InputJsonValue,
      },
      include: fullInclude,
    });
  },

  async reschedule(
    id: string,
    requesterCompanyId: string | null | undefined,
    input: RescheduleInput,
  ) {
    const existing = await assertCanManage(id, requesterCompanyId);
    return prisma.reservation.update({
      where: { id },
      data: {
        status: 'RESCHEDULED',
        reservationDate: new Date(input.newDate),
        rescheduling: {
          originalDate: existing.reservationDate.toISOString(),
          newDate: input.newDate,
          reason: input.reason,
          requestedBy: input.requestedBy,
        } as Prisma.InputJsonValue,
      },
      include: fullInclude,
    });
  },

  async remove(id: string, requesterCompanyId: string | null | undefined) {
    await assertCanManage(id, requesterCompanyId);
    await prisma.reservation.delete({ where: { id } });
  },

  async statsByCompany(requesterCompanyId: string | null | undefined, companyId: string) {
    if (!requesterCompanyId || requesterCompanyId !== companyId) {
      throw Forbidden('No tienes acceso a las stats de otra company');
    }
    const items = await prisma.reservation.findMany({
      where: { companyId },
      select: { status: true, paymentStatus: true, pricing: true, participants: true },
    });
    const totalRevenue = items.reduce((acc, r) => {
      const total =
        typeof r.pricing === 'object' && r.pricing && 'total' in (r.pricing as object)
          ? Number((r.pricing as { total: unknown }).total ?? 0)
          : 0;
      return acc + total;
    }, 0);
    const totalParticipants = items.reduce((acc, r) => acc + r.participants, 0);
    return {
      total: items.length,
      pending: items.filter((r) => r.status === 'PENDING').length,
      confirmed: items.filter((r) => r.status === 'CONFIRMED').length,
      inProgress: items.filter((r) => r.status === 'IN_PROGRESS').length,
      completed: items.filter((r) => r.status === 'COMPLETED').length,
      cancelled: items.filter((r) => r.status === 'CANCELLED').length,
      noShow: items.filter((r) => r.status === 'NO_SHOW').length,
      rescheduled: items.filter((r) => r.status === 'RESCHEDULED').length,
      totalRevenue,
      totalParticipants,
      averageParticipants: items.length ? totalParticipants / items.length : 0,
      pendingPayments: items.filter((r) => r.paymentStatus === 'PENDING').length,
      paidReservations: items.filter((r) => r.paymentStatus === 'PAID').length,
    };
  },
};
