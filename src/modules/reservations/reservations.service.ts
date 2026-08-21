import { Prisma, ReservationStatus, PaymentStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import {
  calcularDesglose,
  getPlatformSettings,
  resolverComisiones,
} from '../../lib/commissions.js';
import { Forbidden, NotFound } from '../../lib/errors.js';
import { construirCheckout } from '../payments/payments.service.js';
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

/**
 * Devuelve el pricing con las comisiones calculadas EN EL SERVIDOR.
 *
 * Lo que manda el cliente en `commission` y `hostEarnings` se descarta a
 * proposito: son dinero, y quien reserva no puede decidir cuanto se lleva
 * la plataforma. El resto del desglose (precios, descuentos) si viene del
 * cliente, que es quien conoce la seleccion.
 */
async function conComisiones(
  experienceId: string,
  pricing: CreateReservationInput['pricing'],
  esDeReseller: boolean,
): Promise<Prisma.InputJsonValue> {
  const [experiencia, ajustes] = await Promise.all([
    prisma.experience.findUnique({
      where: { id: experienceId },
      select: {
        filoCommissionType: true,
        filoCommissionValue: true,
        resellerCommissionType: true,
        resellerCommissionValue: true,
      },
    }),
    getPlatformSettings(),
  ]);

  const desglose = calcularDesglose(
    Number(pricing.total) || 0,
    resolverComisiones(experiencia, ajustes),
    { esDeReseller },
  );

  return {
    ...pricing,
    // Desglosadas ademas de sumadas: sin esto no se puede saber cuanto le
    // toca a cada parte una vez guardada la reserva.
    filoCommission: desglose.filo,
    resellerCommission: desglose.reseller,
    commission: desglose.total,
    hostEarnings: desglose.hostEarnings,
  } as Prisma.InputJsonValue;
}

type AddonExperiencia = { name?: string; price?: number; priceType?: string };
type AddonElegido = { name?: string; quantity?: number };

/**
 * Precio de una reserva calculado DESDE LA EXPERIENCIA.
 *
 * En el catalogo publico quien reserva no tiene sesion y el precio no puede
 * venir del cliente: enviaria el que quisiera. Se toma el basePrice de la
 * experiencia y se cobran los adicionales segun su definicion; del cliente
 * solo se acepta *que* eligio, no *cuanto* cuesta.
 */
async function precioDesdeExperiencia(
  experienceId: string,
  participants: number,
  elegidos: AddonElegido[] | undefined,
) {
  const exp = await prisma.experience.findFirst({
    where: { id: experienceId, deletedAt: null },
    select: { basePrice: true, addons: true },
  });
  if (!exp) throw NotFound('Experiencia no disponible');

  const basePrice = Number(exp.basePrice ?? 0);
  const subtotal = basePrice * participants;

  const definidos = (Array.isArray(exp.addons) ? exp.addons : []) as AddonExperiencia[];
  const addons: Array<{ name: string; price: number; quantity: number }> = [];
  let addonsTotal = 0;

  for (const elegido of elegidos ?? []) {
    const def = definidos.find((d) => d.name === elegido.name);
    // Un adicional que no existe en la experiencia se ignora: no vamos a
    // cobrar por algo que el anfitrion no ofrece.
    if (!def || typeof def.price !== 'number') continue;

    const cantidad = Math.max(1, Math.trunc(Number(elegido.quantity ?? 1)));
    const unidades = def.priceType === 'per_person' ? cantidad * participants : cantidad;
    const importe = def.price * unidades;

    addons.push({ name: def.name ?? '', price: def.price, quantity: cantidad });
    addonsTotal += importe;
  }

  const total = subtotal + addonsTotal;
  return { basePrice, subtotal, addons, addonsTotal, discount: 0, tax: 0, total };
}

export const reservationsService = {
  async create(
    requesterCompanyId: string | null | undefined,
    input: CreateReservationInput,
    opts?: { asReseller?: boolean },
  ) {
    const asReseller = opts?.asReseller === true;

    // Si vende un revendedor, su empresa es la que llama (viene de la API
    // key). Hay que guardarla antes de que companyId pase a ser la del
    // anfitrion, o se pierde a quien hay que pagarle la comision.
    const resellerCompanyId = asReseller ? (requesterCompanyId ?? null) : null;

    // Resolver companyId de la experiencia. Para resellers exigimos ACTIVE.
    let companyId = input.company;
    if (!companyId || asReseller) {
      const exp = await prisma.experience.findFirst({
        where: {
          id: input.experience,
          deletedAt: null,
          ...(asReseller ? { status: 'ACTIVE' } : {}),
        },
        select: { companyId: true },
      });
      if (!exp) throw NotFound('Experiencia no encontrada');
      companyId = exp.companyId;
    }

    // Hosts: bloqueamos crear reservas en companies que no son suyas.
    // Resellers: permitido en cualquier company (su companyId no aplica).
    if (!asReseller && requesterCompanyId && companyId !== requesterCompanyId) {
      throw Forbidden('No puedes crear reservas en otra company');
    }

    const pricing = await conComisiones(input.experience, input.pricing, asReseller);

    return prisma.reservation.create({
      data: {
        reservationNumber: input.reservationNumber ?? generateReservationNumber(),
        experience: { connect: { id: input.experience } },
        company: { connect: { id: companyId } },
        ...(resellerCompanyId
          ? { resellerCompany: { connect: { id: resellerCompanyId } } }
          : {}),
        client: input.client as Prisma.InputJsonValue,
        clientType: input.clientType ?? 'GUEST',
        ...(input.user ? { user: { connect: { id: input.user } } } : {}),
        source: input.source ?? (asReseller ? 'BOOKING_ENGINE' : 'MANUAL'),
        reservationDate: new Date(input.reservationDate),
        duration: input.duration ?? null,
        participants: input.participants,
        status: input.status ?? 'PENDING',
        paymentStatus: input.paymentStatus ?? 'PENDING',
        pricing,
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
    // El precio lo pone el servidor, no el cliente: en el catalogo publico
    // cualquiera podria enviar total = 1 y pagar eso.
    const precio = await precioDesdeExperiencia(
      input.experience,
      input.participants,
      input.pricing?.addons as AddonElegido[] | undefined,
    );

    // Sin comision de revendedor: el enlace publico es el que comparte el
    // propio anfitrion y aqui no se conecta ninguna `resellerCompany`.
    // Cobrarla igual le descontaba al anfitrion un porcentaje que despues
    // no le tocaba a nadie en las dispersiones.
    //
    // Cuando exista atribucion (un enlace de referido que identifique al
    // revendedor) hay que conectar `resellerCompany` y pasar true aqui.
    const pricing = await conComisiones(
      input.experience,
      precio as unknown as CreateReservationInput['pricing'],
      false,
    );

    const creada = await prisma.reservation.create({
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
        pricing,
        ...(input.location ? { location: { connect: { id: input.location } } } : {}),
        isVirtual: input.isVirtual ?? false,
        specialRequirements: input.specialRequirements ?? null,
        notes: input.notes ?? null,
      },
      select: { reservationNumber: true },
    });

    // Si la pasarela esta activa, devolvemos ya los datos firmados para
    // cobrar. Asi el cliente paga sin un endpoint publico adicional, que
    // seria una via para enumerar reservas ajenas.
    const payment = await construirCheckout(creada.reservationNumber);
    return { ...creada, payment };
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
