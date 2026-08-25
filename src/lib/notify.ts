// Emision de notificaciones.
//
// Vive aparte del modulo de notificaciones porque quien las CREA no es
// quien las LEE: las genera el flujo de reservas, y la bandeja solo las
// consulta.
//
// Regla que gobierna todo este archivo: notificar nunca puede tumbar la
// operacion que la origina. Si falla el aviso de "nueva reserva", la
// reserva ya esta hecha y cobrada; perder el aviso es molesto, perder la
// venta es inaceptable. Por eso todo va envuelto en un catch.
import type { NotificationType } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { logger } from './logger.js';
import { sendEmail } from './email.js';
import {
  correoCanceladaAnfitrion,
  correoCanceladaComensal,
  correoConfirmadaComensal,
  correoPagoAnfitrion,
  correoPagoComensal,
  correoReprogramadaComensal,
  correoReservaAdmin,
  correoReservaAnfitrion,
  correoReservaComensal,
  type DatosCorreoReserva,
} from './email-reservas.js';

type Aviso = {
  userId: string;
  type: NotificationType;
  title: string;
  message: string;
  data?: Record<string, unknown>;
};

/** Crea varios avisos de golpe, sin dejar caer la operacion que los dispara. */
export async function notificar(avisos: Aviso[]): Promise<void> {
  const validos = avisos.filter((a) => a.userId);
  if (validos.length === 0) return;

  try {
    await prisma.notification.createMany({
      data: validos.map((a) => ({
        userId: a.userId,
        type: a.type,
        title: a.title,
        message: a.message,
        data: (a.data ?? undefined) as never,
      })),
    });
  } catch (err) {
    logger.error({ err, cuantos: validos.length }, 'no se pudieron crear notificaciones');
  }
}

/** Los dueños de una empresa y quienes trabajan en ella. */
export async function personasDeLaEmpresa(companyId: string | null | undefined): Promise<string[]> {
  if (!companyId) return [];
  try {
    const [empresa, miembros] = await Promise.all([
      prisma.company.findUnique({ where: { id: companyId }, select: { ownerId: true } }),
      prisma.user.findMany({
        where: { companyId, deletedAt: null, isActive: true },
        select: { id: true },
      }),
    ]);
    const ids = new Set<string>(miembros.map((m) => m.id));
    // El titular puede estar trabajando en otra de sus empresas y no salir
    // como miembro de esta; aun asi hay que avisarle.
    if (empresa?.ownerId) ids.add(empresa.ownerId);
    return [...ids];
  } catch (err) {
    logger.error({ err, companyId }, 'no se pudieron resolver los destinatarios');
    return [];
  }
}

// ---------------------------------------------------------------------------
// Correo
// ---------------------------------------------------------------------------

type Envio = { to: string; subject: string; html: string };

/**
 * Manda los correos y se traga cualquier fallo.
 *
 * Deduplica por direccion: si el anfitrion tambien es admin, o reservo en su
 * propia experiencia, recibiria dos correos del mismo hecho. Gana el primero
 * de la lista, por eso el orden en que se arman importa —comensal primero,
 * que es el que menos contexto tiene—.
 *
 * Los envios van en paralelo pero sin bloquear a quien llama: si el proveedor tarda
 * dos segundos, la reserva ya se guardo y respondio hace rato.
 */
async function despachar(envios: Envio[]): Promise<void> {
  const vistos = new Set<string>();
  const unicos = envios.filter((e) => {
    const dir = e.to?.trim().toLowerCase();
    if (!dir || !dir.includes('@') || vistos.has(dir)) return false;
    vistos.add(dir);
    return true;
  });
  if (unicos.length === 0) return;

  await Promise.all(
    unicos.map(async (e) => {
      try {
        await sendEmail(e);
      } catch (err) {
        logger.error({ err, to: e.to }, 'no se pudo enviar el correo de reserva');
      }
    }),
  );
}

/**
 * A que direcciones se le escribe a una empresa.
 *
 * Va el correo de contacto de la empresa —el que suele mirar alguien en
 * servicio— ademas del de las personas con cuenta. Un anfitrion que puso su
 * correo de negocio espera que le llegue ahi, no solo a la cuenta con la que
 * entra al panel.
 */
export async function correosDeLaEmpresa(companyId: string | null | undefined): Promise<string[]> {
  if (!companyId) return [];
  try {
    const [empresa, miembros] = await Promise.all([
      prisma.company.findUnique({
        where: { id: companyId },
        select: { companyEmail: true, owner: { select: { email: true } } },
      }),
      prisma.user.findMany({
        where: { companyId, deletedAt: null, isActive: true },
        select: { email: true },
      }),
    ]);
    return [
      empresa?.companyEmail ?? '',
      empresa?.owner?.email ?? '',
      ...miembros.map((m) => m.email),
    ].filter(Boolean);
  } catch (err) {
    logger.error({ err, companyId }, 'no se pudieron resolver los correos de la empresa');
    return [];
  }
}

/** Los administradores de la plataforma, para el pulso de ventas. */
export async function correosDeAdmins(): Promise<string[]> {
  try {
    const admins = await prisma.user.findMany({
      where: { role: 'ADMIN', deletedAt: null, isActive: true },
      select: { email: true },
    });
    return admins.map((a) => a.email).filter(Boolean);
  } catch (err) {
    logger.error({ err }, 'no se pudieron resolver los correos de admin');
    return [];
  }
}

const dinero = (n: number) =>
  `$${Number(n || 0).toLocaleString('es-CO', { maximumFractionDigits: 0 })}`;

const cuando = (fecha: Date) =>
  fecha.toLocaleDateString('es-CO', { day: 'numeric', month: 'long', year: 'numeric' });

type DatosReserva = {
  id: string;
  reservationNumber: string;
  reservationDate: Date;
  participants: number;
  companyId: string;
  resellerCompanyId?: string | null;
  userId?: string | null;
  experienceTitle: string;
  clienteNombre: string;
  total?: number;
  // Lo que sigue solo lo usa el correo. El comensal sin cuenta no tiene
  // bandeja pero si dejo un email al reservar: por ahi si se le alcanza.
  clienteEmail?: string | null;
  clienteTelefono?: string | null;
  empresaNombre?: string | null;
  lugar?: string | null;
  peticiones?: string | null;
};

/** Reserva tal como sale de la base con sus relaciones. */
type ReservaCruda = {
  id: string;
  reservationNumber: string;
  reservationDate: Date;
  participants: number;
  companyId: string;
  resellerCompanyId?: string | null;
  userId?: string | null;
  pricing?: unknown;
  client?: unknown;
  experience?: { title?: string } | null;
  company?: { companyName?: string | null } | null;
  location?: { name?: string | null; address?: unknown } | null;
  user?: { email?: string | null } | null;
  specialRequirements?: string | null;
  isVirtual?: boolean;
};

/**
 * La direccion como se le dice a alguien que va llegando.
 *
 * address es un Json { street, city, ... }; al correo solo van la calle y la
 * ciudad. El pais y el codigo postal no ayudan a nadie a encontrar la mesa.
 */
function direccionLegible(address: unknown): string {
  const a = (address ?? {}) as { street?: unknown; city?: unknown };
  return [a.street, a.city]
    .filter((p): p is string => typeof p === 'string' && p.trim() !== '')
    .join(', ');
}

/**
 * Traduce una reserva guardada a lo que necesitan los avisos.
 *
 * Vive aqui y no en el modulo de reservas porque tambien lo usa el webhook
 * de la pasarela: si cada uno armara lo suyo, el correo del pago en linea
 * acabaria diciendo algo distinto al del pago marcado a mano.
 */
export function datosDeReserva(r: ReservaCruda): DatosReserva {
  const cliente = (r.client ?? {}) as { name?: string; email?: string; phone?: string };
  const precio = (r.pricing ?? {}) as { total?: number };

  const lugar = r.isVirtual
    ? 'En línea'
    : [r.location?.name, direccionLegible(r.location?.address)].filter(Boolean).join(' · ') || null;

  return {
    id: r.id,
    reservationNumber: r.reservationNumber,
    reservationDate: r.reservationDate,
    participants: r.participants,
    companyId: r.companyId,
    resellerCompanyId: r.resellerCompanyId ?? null,
    userId: r.userId ?? null,
    experienceTitle: r.experience?.title ?? 'una experiencia',
    clienteNombre: cliente.name ?? 'Un cliente',
    total: Number(precio.total ?? 0),
    // El correo que dejo al reservar manda sobre el de la cuenta: es donde
    // pidio que le escribieran, y muchas reservas no tienen cuenta detras.
    clienteEmail: cliente.email ?? r.user?.email ?? null,
    clienteTelefono: cliente.phone ?? null,
    empresaNombre: r.company?.companyName ?? null,
    lugar,
    peticiones: r.specialRequirements ?? null,
  };
}

/** Igual, pero leyendo de la base: para quien solo tiene el id. */
export async function cargarDatosDeReserva(id: string): Promise<DatosReserva | null> {
  try {
    const r = await prisma.reservation.findUnique({
      where: { id },
      include: {
        experience: { select: { title: true } },
        company: { select: { companyName: true } },
        location: { select: { name: true, address: true } },
        user: { select: { email: true } },
      },
    });
    return r ? datosDeReserva(r) : null;
  } catch (err) {
    logger.error({ err, id }, 'no se pudieron cargar los datos de la reserva para avisar');
    return null;
  }
}

/** Lo que las plantillas necesitan, a partir de los datos del aviso. */
function paraCorreo(r: DatosReserva): DatosCorreoReserva {
  return {
    reservationNumber: r.reservationNumber,
    experienceTitle: r.experienceTitle,
    empresaNombre: r.empresaNombre ?? 'Tenemos Filo',
    reservationDate: r.reservationDate,
    participants: r.participants,
    clienteNombre: r.clienteNombre,
    clienteEmail: r.clienteEmail,
    clienteTelefono: r.clienteTelefono,
    lugar: r.lugar,
    peticiones: r.peticiones,
    total: r.total,
  };
}

/**
 * Reserva nueva.
 *
 * Al anfitrion le llega como venta que atender; al revendedor, como venta
 * suya; al cliente, como confirmacion de que su solicitud entro.
 */
export async function avisarNuevaReserva(r: DatosReserva): Promise<void> {
  const anfitriones = await personasDeLaEmpresa(r.companyId);
  const revendedores = r.resellerCompanyId
    ? await personasDeLaEmpresa(r.resellerCompanyId)
    : [];

  const avisos: Aviso[] = [
    ...anfitriones.map((userId) => ({
      userId,
      type: 'NEW_RESERVATION' as const,
      title: 'Nueva reserva',
      message: `${r.clienteNombre} reservó ${r.experienceTitle} para ${r.participants} ${
        r.participants === 1 ? 'persona' : 'personas'
      } el ${cuando(r.reservationDate)}.`,
      data: { reservationId: r.id, reservationNumber: r.reservationNumber },
    })),
    ...revendedores.map((userId) => ({
      userId,
      type: 'NEW_RESERVATION' as const,
      title: 'Venta de tu canal',
      message: `Se reservó ${r.experienceTitle} desde tu catálogo${
        r.total ? ` por ${dinero(r.total)}` : ''
      }.`,
      data: { reservationId: r.id, reservationNumber: r.reservationNumber },
    })),
  ];

  // Al cliente solo si tiene cuenta: si no, no hay bandeja donde dejarlo.
  if (r.userId) {
    avisos.push({
      userId: r.userId,
      type: 'NEW_RESERVATION',
      title: 'Reserva creada',
      message: `Tu reserva de ${r.experienceTitle} para el ${cuando(
        r.reservationDate,
      )} quedó registrada con el número ${r.reservationNumber}.`,
      data: { reservationId: r.id, reservationNumber: r.reservationNumber },
    });
  }

  await notificar(avisos);

  // Correo. Los tres publicos que se pidieron: comensal, anfitrion y admin.
  const d = paraCorreo(r);
  const [correosAnfitrion, correosAdmin] = await Promise.all([
    correosDeLaEmpresa(r.companyId),
    correosDeAdmins(),
  ]);

  await despachar([
    // El comensal primero: si su direccion coincide con la del anfitrion
    // —reservo en su propia experiencia— recibe la version del comensal,
    // que es la que espera como cliente.
    ...(r.clienteEmail ? [{ to: r.clienteEmail, ...correoReservaComensal(d) }] : []),
    ...correosAnfitrion.map((to) => ({ to, ...correoReservaAnfitrion(d) })),
    ...correosAdmin.map((to) => ({ to, ...correoReservaAdmin(d) })),
  ]);
}

const TITULO_ESTADO: Record<string, { anfitrion: string; cliente: string }> = {
  CONFIRMED: { anfitrion: 'Reserva confirmada', cliente: 'Tu reserva fue confirmada' },
  CANCELLED: { anfitrion: 'Reserva cancelada', cliente: 'Tu reserva fue cancelada' },
  RESCHEDULED: { anfitrion: 'Reserva reprogramada', cliente: 'Cambió la fecha de tu reserva' },
  COMPLETED: { anfitrion: 'Experiencia completada', cliente: '¿Qué tal estuvo?' },
};

const TIPO_ESTADO: Record<string, NotificationType> = {
  CONFIRMED: 'RESERVATION_CONFIRMED',
  CANCELLED: 'RESERVATION_CANCELLED',
  RESCHEDULED: 'RESERVATION_RESCHEDULED',
};

/**
 * Cambio de estado de una reserva.
 *
 * Lo importante aqui es el cliente: es quien tiene que enterarse de que le
 * confirmaron o le cancelaron, y quien no esta mirando el panel.
 */
export async function avisarCambioDeEstado(
  r: DatosReserva,
  estado: string,
  motivo?: string,
): Promise<void> {
  const textos = TITULO_ESTADO[estado];
  const tipo = TIPO_ESTADO[estado];
  // Un estado sin mensaje propio no se notifica: mas vale callar que
  // mandar un aviso vacio.
  if (!textos || !tipo) return;

  const avisos: Aviso[] = [];

  if (r.userId) {
    avisos.push({
      userId: r.userId,
      type: tipo,
      title: textos.cliente,
      message:
        `${r.experienceTitle} · ${cuando(r.reservationDate)}` +
        (motivo ? `. Motivo: ${motivo}` : '.'),
      data: { reservationId: r.id, reservationNumber: r.reservationNumber },
    });
  }

  // Al anfitrion solo si lo cancelo otro: si fue el, ya lo sabe.
  if (estado === 'CANCELLED') {
    const anfitriones = await personasDeLaEmpresa(r.companyId);
    avisos.push(
      ...anfitriones.map((userId) => ({
        userId,
        type: tipo,
        title: textos.anfitrion,
        message: `${r.reservationNumber} · ${r.experienceTitle} del ${cuando(r.reservationDate)}${
          motivo ? `. Motivo: ${motivo}` : ''
        }`,
        data: { reservationId: r.id, reservationNumber: r.reservationNumber },
      })),
    );
  }

  await notificar(avisos);

  const d = paraCorreo(r);
  const envios: Envio[] = [];

  if (r.clienteEmail) {
    if (estado === 'CONFIRMED') envios.push({ to: r.clienteEmail, ...correoConfirmadaComensal(d) });
    if (estado === 'CANCELLED')
      envios.push({ to: r.clienteEmail, ...correoCanceladaComensal(d, motivo) });
    if (estado === 'RESCHEDULED')
      envios.push({ to: r.clienteEmail, ...correoReprogramadaComensal(d, motivo) });
  }

  // La cancelacion tambien al anfitrion: le libera cupo y le quita ingreso,
  // y enterarse mañana entrando al panel es tarde para revender esa mesa.
  if (estado === 'CANCELLED') {
    const correos = await correosDeLaEmpresa(r.companyId);
    envios.push(...correos.map((to) => ({ to, ...correoCanceladaAnfitrion(d, motivo) })));
  }

  await despachar(envios);
}

/** Pago confirmado: al anfitrion le entra dinero, al cliente le queda pagado. */
export async function avisarPago(r: DatosReserva): Promise<void> {
  const anfitriones = await personasDeLaEmpresa(r.companyId);
  const avisos: Aviso[] = anfitriones.map((userId) => ({
    userId,
    type: 'PAYMENT_RECEIVED' as const,
    title: 'Pago recibido',
    message: `${r.reservationNumber} · ${r.experienceTitle}${
      r.total ? ` · ${dinero(r.total)}` : ''
    }`,
    data: { reservationId: r.id, reservationNumber: r.reservationNumber },
  }));

  if (r.userId) {
    avisos.push({
      userId: r.userId,
      type: 'PAYMENT_RECEIVED',
      title: 'Pago confirmado',
      message: `Recibimos tu pago de ${r.experienceTitle}. Tu reserva ${r.reservationNumber} está lista.`,
      data: { reservationId: r.id, reservationNumber: r.reservationNumber },
    });
  }

  await notificar(avisos);

  const d = paraCorreo(r);
  const correos = await correosDeLaEmpresa(r.companyId);
  await despachar([
    ...(r.clienteEmail ? [{ to: r.clienteEmail, ...correoPagoComensal(d) }] : []),
    ...correos.map((to) => ({ to, ...correoPagoAnfitrion(d) })),
  ]);
}
