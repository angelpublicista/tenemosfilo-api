import { Prisma, ReservationStatus, PaymentStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import {
  calcularDesglose,
  getPlatformSettings,
  resolverComisiones,
} from '../../lib/commissions.js';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
import { construirCheckout } from '../payments/payments.service.js';
import {
  avisarCambioDeEstado,
  avisarNuevaReserva,
  avisarPago,
  datosDeReserva,
} from '../../lib/notify.js';
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
  company: { select: { id: true, companyName: true, companyEmail: true, companyPhone: true, logo: true } },
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
 * Ajustes de operacion de la empresa. No son preferencias decorativas: de
 * ellos depende si una reserva entra y con que estado nace.
 */
async function ajustesDeOperacion(companyId: string) {
  const c = await prisma.company.findUnique({
    where: { id: companyId },
    select: { autoConfirmReservations: true, blockWhenFull: true },
  });
  return {
    autoConfirmar: c?.autoConfirmReservations ?? false,
    bloquearLleno: c?.blockWhenFull ?? true,
  };
}

/**
 * Rechaza la reserva si pasa del aforo, cuando la empresa lo pide.
 *
 * Las canceladas y los no-show no ocupan sitio; una pendiente si, porque
 * puede pagarse en cualquier momento y vender su lugar a otro seria peor
 * que rechazar esta.
 */
async function verificarAforo(
  experienceId: string,
  fecha: Date,
  participantes: number,
  bloquearLleno: boolean,
) {
  if (!bloquearLleno) return;

  const exp = await prisma.experience.findUnique({
    where: { id: experienceId },
    select: { capacity: true },
  });
  const aforo = exp?.capacity ?? 0;
  // Sin aforo definido no hay nada contra que comparar.
  if (aforo <= 0) return;

  const inicio = new Date(fecha);
  inicio.setHours(0, 0, 0, 0);
  const fin = new Date(inicio);
  fin.setDate(fin.getDate() + 1);

  const agregado = await prisma.reservation.aggregate({
    where: {
      experienceId,
      status: { notIn: ['CANCELLED', 'NO_SHOW'] },
      reservationDate: { gte: inicio, lt: fin },
    },
    _sum: { participants: true },
  });

  const libres = aforo - (agregado._sum?.participants ?? 0);
  if (participantes > libres) {
    throw BadRequest(
      libres > 0
        ? `Solo quedan ${libres} ${libres === 1 ? 'lugar' : 'lugares'} para esa fecha.`
        : 'No quedan lugares disponibles para esa fecha.',
    );
  }
}

/**
 * Empresa revendedora que trae la venta, o null si es venta directa.
 *
 * Devuelve null en vez de fallar cuando el identificador no corresponde a
 * ninguna empresa: un enlace de referido viejo o mal copiado debe seguir
 * dejando reservar, simplemente sin atribuir la comision a nadie.
 */
async function resolverRevendedor(
  identificador: string | undefined,
  companyIdDelAnfitrion: string,
): Promise<string | null> {
  if (!identificador) return null;

  const empresa = await prisma.company.findFirst({
    where: {
      deletedAt: null,
      isActive: true,
      OR: [{ slug: identificador }, { previousSlugs: { has: identificador } }, { id: identificador }],
    },
    select: { id: true },
  });
  if (!empresa) return null;

  // Un anfitrion no se revende a si mismo: seria cobrarse una comision por
  // su propia venta y descontarsela de lo que recibe.
  if (empresa.id === companyIdDelAnfitrion) return null;

  return empresa.id;
}

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

/** El mapeo vive en notify.ts: lo comparte con el webhook de la pasarela. */
const paraAvisos = datosDeReserva;

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

    // Tambien aqui: una venta de revendedor o una reserva cargada a mano no
    // deberian poder pasarse del aforo si la empresa lo tiene bloqueado.
    const { bloquearLleno } = await ajustesDeOperacion(companyId);
    await verificarAforo(
      input.experience,
      new Date(input.reservationDate),
      input.participants,
      bloquearLleno,
    );

    const creada = await prisma.reservation.create({
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

    void avisarNuevaReserva(paraAvisos(creada));
    return creada;
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

    // Si quien reserva ya tiene cuenta, la reserva queda vinculada a ella.
    // Sin esto un comensal registrado no puede ver en su panel lo que
    // acaba de reservar: la reserva solo guarda su email suelto.
    const cliente = input.client as { email?: string } | undefined;
    const cuenta = cliente?.email
      ? await prisma.user.findFirst({
          where: { email: cliente.email, deletedAt: null, isActive: true },
          select: { id: true },
        })
      : null;

    // Atribucion. El enlace del catalogo de un revendedor manda su `slug`;
    // el del propio anfitrion no manda nada y la venta es directa.
    //
    // Solo se cobra comision de revendedor cuando hay uno de verdad: sin
    // esto se le descontaba al anfitrion un porcentaje que despues no le
    // tocaba a nadie en las dispersiones.
    const revendedor = await resolverRevendedor(input.reseller, companyId);

    const pricing = await conComisiones(
      input.experience,
      precio as unknown as CreateReservationInput['pricing'],
      revendedor !== null,
    );

    // Los ajustes de la empresa mandan sobre como entra la reserva.
    const fecha = new Date(input.reservationDate);
    const { autoConfirmar, bloquearLleno } = await ajustesDeOperacion(companyId);
    await verificarAforo(input.experience, fecha, input.participants, bloquearLleno);

    const creada = await prisma.reservation.create({
      data: {
        reservationNumber: input.reservationNumber ?? generateReservationNumber(),
        experience: { connect: { id: input.experience } },
        company: { connect: { id: companyId } },
        ...(revendedor ? { resellerCompany: { connect: { id: revendedor } } } : {}),
        client: input.client as Prisma.InputJsonValue,
        ...(cuenta ? { user: { connect: { id: cuenta.id } }, clientType: 'REGISTERED' as const } : { clientType: 'GUEST' as const }),
        source: 'BOOKING_ENGINE',
        reservationDate: fecha,
        duration: input.duration ?? null,
        participants: input.participants,
        // Confirmada de entrada solo si la empresa lo pidio; el aforo ya se
        // comprobo arriba, asi que no se autoconfirma nada sin sitio.
        status: autoConfirmar ? 'CONFIRMED' : 'PENDING',
        paymentStatus: 'PENDING',
        pricing,
        ...(input.location ? { location: { connect: { id: input.location } } } : {}),
        isVirtual: input.isVirtual ?? false,
        specialRequirements: input.specialRequirements ?? null,
        notes: input.notes ?? null,
      },
      select: { reservationNumber: true },
    });

    // El aviso necesita mas campos de los que devuelve el alta; se relee
    // una vez en vez de inflar el select del create. Va el include completo
    // porque el correo al comensal lleva el nombre del anfitrion y el lugar,
    // y esta es la via por la que entran las reservas del publico.
    const completa = await prisma.reservation.findUnique({
      where: { reservationNumber: creada.reservationNumber },
      include: fullInclude,
    });
    if (completa) void avisarNuevaReserva(paraAvisos(completa));

    // Si la pasarela esta activa, devolvemos ya los datos firmados para
    // cobrar. Asi el cliente paga sin un endpoint publico adicional, que
    // seria una via para enumerar reservas ajenas.
    const payment = await construirCheckout(creada.reservationNumber);
    return { ...creada, payment };
  },

  /**
   * Las reservas de quien llama, como cliente.
   *
   * Busca por cuenta vinculada y tambien por email: las reservas hechas
   * antes de registrarse no tienen `userId`, pero son suyas igual y no
   * tendria sentido esconderselas.
   */
  async mias(userId: string, email: string) {
    return prisma.reservation.findMany({
      where: {
        OR: [{ userId }, { client: { path: ['email'], equals: email } }],
      },
      select: {
        id: true,
        reservationNumber: true,
        reservationDate: true,
        participants: true,
        status: true,
        paymentStatus: true,
        pricing: true,
        isVirtual: true,
        specialRequirements: true,
        experience: { select: { id: true, title: true, duration: true, featuredImage: true } },
        // Con quien va a cenar y como contactarlo. Nada de finanzas del
        // anfitrion: al cliente le toca su reserva, no el negocio ajeno.
        company: { select: { companyName: true, companyEmail: true, companyPhone: true } },
        location: { select: { name: true, address: true } },
      },
      orderBy: { reservationDate: 'desc' },
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
    const actualizada = await prisma.reservation.update({
      where: { id },
      data: { status },
      include: fullInclude,
    });
    // Sin await: el cliente que confirma no tiene que esperar a que se
    // escriba el aviso, y si falla no debe romperse la confirmacion.
    void avisarCambioDeEstado(paraAvisos(actualizada), status);
    return actualizada;
  },

  async updatePaymentStatus(
    id: string,
    requesterCompanyId: string | null | undefined,
    paymentStatus: PaymentStatus,
  ) {
    await assertCanManage(id, requesterCompanyId);
    const actualizada = await prisma.reservation.update({
      where: { id },
      data: { paymentStatus },
      include: fullInclude,
    });
    if (paymentStatus === 'PAID') void avisarPago(paraAvisos(actualizada));
    return actualizada;
  },

  async cancel(id: string, requesterCompanyId: string | null | undefined, input: CancelInput) {
    await assertCanManage(id, requesterCompanyId);
    const cancelada = await prisma.reservation.update({
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
    void avisarCambioDeEstado(paraAvisos(cancelada), 'CANCELLED', input.reason);
    return cancelada;
  },

  async reschedule(
    id: string,
    requesterCompanyId: string | null | undefined,
    input: RescheduleInput,
  ) {
    const existing = await assertCanManage(id, requesterCompanyId);
    const reprogramada = await prisma.reservation.update({
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
    void avisarCambioDeEstado(paraAvisos(reprogramada), 'RESCHEDULED', input.reason);
    return reprogramada;
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
