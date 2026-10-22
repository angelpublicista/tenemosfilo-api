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
import type { NotificationType, CompanyContactType, ReservationStatus } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { logger } from './logger.js';
import { sendEmail } from './email.js';
import {
  correoCanceladaAnfitrion,
  correoCanceladaComensal,
  correoConfirmadaComensal,
  correoPagoAnfitrion,
  correoReservaAdmin,
  correoReservaAnfitrion,
  type DatosCorreoReserva,
  correoBajaParcialComensal,
  correoBajaParcialAnfitrion,
  correoCambioEnLaReserva,
  correoCalificacionComensal,
} from './email-reservas.js';
import { nombreDeIdioma } from './idiomas.js';

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

type Envio = { to: string; subject: string; html: string; fromName?: string; replyTo?: string };

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
 *
 * Devuelve a quien le llego, para que quien reclamo la clave de un envio sepa
 * si tiene que soltarla.
 */
async function despachar(envios: Envio[]): Promise<string[]> {
  const vistos = new Set<string>();
  const unicos = envios.filter((e) => {
    const dir = e.to?.trim().toLowerCase();
    if (!dir || !dir.includes('@') || vistos.has(dir)) return false;
    vistos.add(dir);
    return true;
  });
  if (unicos.length === 0) return [];

  const llegaron = await Promise.all(
    unicos.map(async (e) => {
      try {
        return (await sendEmail(e)) ? e.to : null;
      } catch (err) {
        logger.error({ err, to: e.to }, 'no se pudo enviar el correo de reserva');
        return null;
      }
    }),
  );
  return llegaron.filter((a): a is string => a !== null);
}

/**
 * Quien origino un hecho. Es lo que decide a quien se le avisa: al anfitrion
 * no se le cuenta lo que hizo el, y al comensal lo que hizo el anfitrion se le
 * dice distinto de lo que pidio el.
 */
export type ActorType = 'customer' | 'host_user' | 'system' | 'reseller';

/** De `cancelledBy` —lo que declara quien cancela— al actor del hecho. */
function actorDeCancelacion(c?: { cancelledBy?: QuienCancela; comoCanal?: boolean }): ActorType {
  if (c?.comoCanal) return 'reseller';
  if (c?.cancelledBy === 'client') return 'customer';
  if (c?.cancelledBy === 'system') return 'system';
  // Host, o sin dato: lo que llega sin `cancelledBy` sale del panel.
  return 'host_user';
}

/**
 * Deja constancia de un correo que no se mando porque no habia a quien
 * escribirle. La operacion sigue: una reserva no se bloquea por no tener
 * email, pero tiene que quedar dicho que el aviso no salio.
 */
async function registrarOmitido(
  clave: string,
  plantilla: string,
  reservationId: string,
  actor?: ActorType,
): Promise<void> {
  try {
    await prisma.communicationLog.create({
      data: { key: clave, templateId: plantilla, reservationId, skippedReason: 'no_email', actorType: actor },
    });
  } catch (err) {
    if ((err as { code?: string }).code !== 'P2002') {
      logger.error({ err, clave }, 'no se pudo registrar el correo omitido');
    }
  }
}

/** Una direccion que sirva para escribir, o null. */
function correoValido(correo: string | null | undefined): string | null {
  const c = correo?.trim();
  return c && c.includes('@') ? c : null;
}

/**
 * A quien se le escribe en la empresa por una reserva: su contacto de reservas.
 *
 * Si la empresa no ha declarado uno, el correo de la empresa y el del titular:
 * un aviso que no le llega a nadie es peor que uno que le llega a quien no
 * hacia falta.
 */
async function correosDeReservas(companyId: string | null | undefined): Promise<string[]> {
  if (!companyId) return [];
  try {
    const contactos = await prisma.companyContact.findMany({
      where: { companyId, type: 'RESERVAS' },
      select: { email: true },
    });
    const declarados = contactos.map((c) => c.email).filter(Boolean);
    if (declarados.length > 0) return declarados;

    const empresa = await prisma.company.findUnique({
      where: { id: companyId },
      select: { companyEmail: true, owner: { select: { email: true } } },
    });
    return [empresa?.companyEmail ?? '', empresa?.owner?.email ?? ''].filter(Boolean);
  } catch (err) {
    logger.error({ err, companyId }, 'no se pudo resolver el contacto de reservas');
    return [];
  }
}

/**
 * Manda los correos de UN hecho una sola vez.
 *
 * La clave nombra el hecho ("reservation:<id>:confirmed"), no el intento. Se
 * reclama antes de enviar: dos procesos que llegan a la vez con el mismo
 * evento —el webhook de la pasarela y el anfitrion guardando el estado— no
 * pueden pasar los dos. Si no salio ningun correo se suelta, porque un fallo
 * del proveedor no puede dejar el hecho marcado como avisado.
 */
async function despacharUnaVez(
  clave: string,
  plantilla: string,
  reservationId: string,
  envios: Envio[],
  actor?: ActorType,
): Promise<void> {
  try {
    await prisma.communicationLog.create({
      data: { key: clave, templateId: plantilla, reservationId, actorType: actor },
    });
  } catch (err) {
    // P2002: la clave ya existe, o sea que este hecho ya se aviso.
    if ((err as { code?: string }).code === 'P2002') {
      logger.info({ clave }, 'correo ya enviado para este hecho: no se repite');
      return;
    }
    // Un fallo de la base no puede costar el correo de una reserva.
    logger.error({ err, clave }, 'no se pudo reclamar el envio; se manda sin registro');
    await despachar(envios);
    return;
  }

  const llegaron = await despachar(envios);
  try {
    if (llegaron.length === 0) {
      await prisma.communicationLog.delete({ where: { key: clave } });
    } else {
      await prisma.communicationLog.update({
        where: { key: clave },
        data: { sentAt: new Date(), recipients: llegaron },
      });
    }
  } catch (err) {
    logger.error({ err, clave }, 'no se pudo actualizar el registro del envio');
  }
}

/**
 * Como se presenta un correo al comensal: de parte del anfitrion, y con sus
 * respuestas yendo al anfitrion y no a un buzon de la plataforma que nadie lee.
 *
 * El Reply-To es el contacto de reservas de la empresa; si no tiene, el correo
 * de la empresa.
 */
async function remitenteDelComensal(
  r: DatosReserva,
): Promise<{ fromName?: string; replyTo?: string }> {
  const nombre = r.empresaNombre?.replace(/[\r\n"<>]/g, ' ').trim();
  const fromName = nombre ? `${nombre} vía FILO` : undefined;
  try {
    const [contacto, empresa] = await Promise.all([
      prisma.companyContact.findFirst({
        where: { companyId: r.companyId, type: 'RESERVAS' },
        select: { email: true },
        orderBy: { createdAt: 'asc' },
      }),
      prisma.company.findUnique({ where: { id: r.companyId }, select: { companyEmail: true } }),
    ]);
    const replyTo = contacto?.email || empresa?.companyEmail || undefined;
    return { fromName, replyTo };
  } catch (err) {
    logger.error({ err, companyId: r.companyId }, 'no se pudo resolver el Reply-To de la empresa');
    return { fromName };
  }
}

/**
 * A que direcciones se le escribe a una empresa.
 *
 * Va el correo de contacto de la empresa —el que suele mirar alguien en
 * servicio— ademas del de las personas con cuenta. Un anfitrion que puso su
 * correo de negocio espera que le llegue ahi, no solo a la cuenta con la que
 * entra al panel.
 */
export async function correosDeLaEmpresa(
  companyId: string | null | undefined,
  /**
   * Contacto que ademas debe enterarse de ESTE asunto.
   *
   * La empresa declara a quien escribir para cada cosa: reservas o
   * contabilidad. Se suma a los de siempre, no los sustituye —quitarle el
   * aviso a quien hoy lo recibe seria romperle la operacion a alguien por un
   * campo que acaba de aparecer—. `despachar` ya deduplica por direccion, asi
   * que si el contacto es el propio titular recibe un solo correo.
   */
  asunto?: CompanyContactType,
): Promise<string[]> {
  if (!companyId) return [];
  try {
    const [empresa, miembros, contactos] = await Promise.all([
      prisma.company.findUnique({
        where: { id: companyId },
        select: { companyEmail: true, owner: { select: { email: true } } },
      }),
      prisma.user.findMany({
        where: { companyId, deletedAt: null, isActive: true },
        select: { email: true },
      }),
      asunto
        ? prisma.companyContact.findMany({
            where: { companyId, type: asunto },
            select: { email: true },
          })
        : Promise.resolve([]),
    ]);
    return [
      empresa?.companyEmail ?? '',
      empresa?.owner?.email ?? '',
      ...miembros.map((m) => m.email),
      ...contactos.map((c) => c.email),
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
  /** El codigo de la puerta. Falta en las reservas anteriores a el. */
  confirmationCode: string | null;
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
  logoEmpresa?: string | null;
  colorMarca?: string | null;
  lugar?: string | null;
  idioma?: string | null;
  peticiones?: string | null;
  /** Estado en que esta la reserva al avisar. */
  estado?: ReservationStatus;
  /** Lo que lleva pagado; 0 si nada. */
  pagado?: number;
};

/** Reserva tal como sale de la base con sus relaciones. */
type ReservaCruda = {
  id: string;
  reservationNumber: string;
  confirmationCode?: string | null;
  reservationDate: Date;
  participants: number;
  companyId: string;
  resellerCompanyId?: string | null;
  userId?: string | null;
  pricing?: unknown;
  status?: ReservationStatus;
  paidAmount?: unknown;
  client?: unknown;
  experience?: { title?: string } | null;
  company?: {
    companyName?: string | null;
    logo?: string | null;
    brandPrimary?: string | null;
  } | null;
  location?: { name?: string | null; address?: unknown } | null;
  user?: { email?: string | null } | null;
  specialRequirements?: string | null;
  serviceAddress?: string | null;
  language?: string | null;
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

  // A domicilio, el lugar es la direccion que dio quien reserva: mandarle el
  // nombre de una sede a la que no va a ir seria peor que no decir nada.
  const lugar =
    r.serviceAddress?.trim() ||
    [r.location?.name, direccionLegible(r.location?.address)].filter(Boolean).join(' · ') ||
    null;

  return {
    id: r.id,
    reservationNumber: r.reservationNumber,
    confirmationCode: r.confirmationCode ?? null,
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
    clienteEmail: correoValido(cliente.email) ?? correoValido(r.user?.email),
    clienteTelefono: cliente.phone ?? null,
    empresaNombre: r.company?.companyName ?? null,
    // El logo sale de la empresa dueña de la experiencia reservada: es el
    // anfitrion que presta el servicio, no la plataforma que manda el correo.
    logoEmpresa: r.company?.logo ?? null,
    // Del mismo sitio que el logo y por el mismo motivo: el correo lo manda
    // Filo, pero quien presta el servicio es el anfitrion.
    colorMarca: r.company?.brandPrimary ?? null,
    lugar,
    // En nombre y no en codigo: en un correo, "en" no se entiende.
    idioma: r.language ? nombreDeIdioma(r.language) : null,
    peticiones: r.specialRequirements ?? null,
    estado: r.status,
    pagado: Number(r.paidAmount ?? 0) || 0,
  };
}

/** Igual, pero leyendo de la base: para quien solo tiene el id. */
export async function cargarDatosDeReserva(id: string): Promise<DatosReserva | null> {
  try {
    const r = await prisma.reservation.findUnique({
      where: { id },
      include: {
        experience: { select: { title: true } },
        company: { select: { companyName: true, logo: true, brandPrimary: true } },
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
    confirmationCode: r.confirmationCode,
    experienceTitle: r.experienceTitle,
    empresaNombre: r.empresaNombre ?? 'Tenemos Filo',
    logoEmpresa: r.logoEmpresa ?? null,
    colorMarca: r.colorMarca ?? null,
    reservationDate: r.reservationDate,
    participants: r.participants,
    clienteNombre: r.clienteNombre,
    clienteEmail: r.clienteEmail,
    clienteTelefono: r.clienteTelefono,
    lugar: r.lugar,
    idioma: r.idioma,
    peticiones: r.peticiones,
    total: r.total,
    pagado: r.pagado,
  };
}

/**
 * Reserva nueva.
 *
 * Al anfitrion le llega como venta que atender; al revendedor, como venta
 * suya; al cliente, como confirmacion de que su solicitud entro.
 */
export async function avisarNuevaReserva(
  r: DatosReserva,
  opts?: {
    /**
     * false cuando la reserva la acaba de cargar un usuario del propio
     * anfitrion: sabe lo que hizo y no necesita un correo que se lo cuente.
     * Sigue la bandeja de la app y el aviso a la plataforma.
     */
    correoAlAnfitrion?: boolean;
    /** Quien creo la reserva; por defecto, el propio comensal. */
    actor?: ActorType;
  },
): Promise<void> {
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

  // Correo.
  const d = paraCorreo(r);
  const actor = opts?.actor ?? 'customer';
  const [correosAnfitrion, correosAdmin] = await Promise.all([
    correosDeReservas(r.companyId),
    correosDeAdmins(),
  ]);

  // Al comensal NO se le escribe por una reserva pendiente: el unico correo
  // que recibe es el de confirmada, cuando lo esta. Solo si la reserva ya nace
  // confirmada —la empresa pidio autoconfirmar— ese es el momento.
  if (r.estado === 'CONFIRMED') {
    if (r.clienteEmail) {
      await despacharUnaVez(
        `reservation:${r.id}:confirmed`,
        'CLI-01',
        r.id,
        [{ to: r.clienteEmail, ...(await remitenteDelComensal(r)), ...(await correoConfirmadaComensal(d)) }],
        actor,
      );
    } else {
      await registrarOmitido(`reservation:${r.id}:confirmed:skipped`, 'CLI-01', r.id, actor);
    }
  }

  // Una reserva, un aviso al anfitrion y a la plataforma, aunque el mismo
  // alta llegue dos veces.
  const [paraAnfitrion, paraAdmin] = await Promise.all([
    correoReservaAnfitrion(d),
    correoReservaAdmin(d),
  ]);
  await despacharUnaVez(
    `reservation:${r.id}:host_new_booking`,
    'HOST-01',
    r.id,
    [
      ...(opts?.correoAlAnfitrion === false
        ? []
        : correosAnfitrion.map((to) => ({ to, ...paraAnfitrion }))),
      ...correosAdmin.map((to) => ({ to, ...paraAdmin })),
    ],
    actor,
  );
}

/**
 * Lo que le pasa a una reserva y hay que contar.
 *
 * No todos son estados: desde TR-08, reagendar es un hecho que le ocurre a una
 * reserva que sigue viva. Para quien recibe el aviso es lo mismo —algo cambio
 * en su reserva— asi que viajan por el mismo sitio, pero no se confunden con
 * el estado que tiene guardado.
 */
export type SucesoDeReserva = ReservationStatus | 'RESCHEDULED';

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
 * Algo le paso a una reserva y hay que contarlo.
 *
 * Lo importante aqui es el cliente: es quien tiene que enterarse de que le
 * confirmaron, le cancelaron o le movieron la fecha, y quien no esta mirando
 * el panel.
 */
export type QuienCancela = 'client' | 'host' | 'system';

/** Quien origino la cancelacion y que se devuelve; de ello salen los correos. */
export type DatosDeCancelacion = {
  cancelledBy?: QuienCancela;
  reembolso?: number;
  /** La cancelo el canal que vendio la reserva, en nombre de su cliente. */
  comoCanal?: boolean;
};

export async function avisarCambioDeEstado(
  r: DatosReserva,
  estado: SucesoDeReserva,
  motivo?: string,
  cancelacion?: DatosDeCancelacion,
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
  const remitente = r.clienteEmail ? await remitenteDelComensal(r) : {};

  // La confirmacion va aparte, con clave: entra a Confirmada una sola vez
  // aunque el estado se guarde dos veces o el webhook se reintente.
  if (estado === 'CONFIRMED') {
    if (r.clienteEmail) {
      await despacharUnaVez(`reservation:${r.id}:confirmed`, 'CLI-01', r.id, [
        { to: r.clienteEmail, ...remitente, ...(await correoConfirmadaComensal(d)) },
      ]);
    } else {
      await registrarOmitido(`reservation:${r.id}:confirmed:skipped`, 'CLI-01', r.id);
    }
  }

  // Sin `cancelledBy` la cancelacion salio de guardar el estado desde el panel,
  // o sea que la hizo el anfitrion: es lo unico que pasa por ahi.
  const actor = actorDeCancelacion(cancelacion);
  const porAnfitrion = actor === 'host_user';
  const pago = { reembolso: cancelacion?.reembolso, porAnfitrion };

  if (estado === 'CANCELLED') {
    if (r.clienteEmail) {
      envios.push({ to: r.clienteEmail, ...remitente, ...(await correoCanceladaComensal(d, motivo, pago)) });
    } else {
      await registrarOmitido(
        `reservation:${r.id}:cancelled:skipped`,
        porAnfitrion ? 'CLI-04' : 'CLI-03A',
        r.id,
        actor,
      );
    }
  }

  // La cancelacion tambien al anfitrion, pero solo si la origino otro: le
  // libera cupo y le quita ingreso, y enterarse mañana entrando al panel es
  // tarde para revender esa mesa. Si la cancelo el, ya lo sabe.
  if (estado === 'CANCELLED' && !porAnfitrion) {
    // Tambien a reservas: una cancelacion libera un cupo, y quien lo gestiona
    // es justamente quien puede revenderlo.
    const correos = await correosDeReservas(r.companyId);
    const paraAnfitrion = await correoCanceladaAnfitrion(d, motivo, pago);
    envios.push(...correos.map((to) => ({ to, ...paraAnfitrion })));
  }

  await despachar(envios);
}

/**
 * Se cayo parte de un grupo (TR-07).
 *
 * Va aparte del aviso de cancelacion porque no es lo mismo: la reserva sigue
 * viva y lo que cambia es con cuanta gente. Al anfitrion le importa porque
 * esos cupos vuelven a estar libres y puede revenderlos.
 */
export async function avisarBajaParcial(
  r: DatosReserva,
  personasQueSeCaen: number,
  motivo?: string,
  reembolso?: number,
  cancelledBy?: QuienCancela,
  comoCanal?: boolean,
): Promise<void> {
  const avisos: Aviso[] = [];
  const cuantas = `${personasQueSeCaen} ${personasQueSeCaen === 1 ? 'persona' : 'personas'}`;

  if (r.userId) {
    avisos.push({
      userId: r.userId,
      type: 'RESERVATION_CANCELLED',
      title: 'Tu reserva queda con menos personas',
      message:
        `${r.experienceTitle} · ${cuando(r.reservationDate)}. Se dieron de baja ${cuantas}` +
        (motivo ? `. Motivo: ${motivo}` : '.'),
      data: { reservationId: r.id, reservationNumber: r.reservationNumber },
    });
  }

  const anfitriones = await personasDeLaEmpresa(r.companyId);
  avisos.push(
    ...anfitriones.map((userId) => ({
      userId,
      type: 'RESERVATION_CANCELLED' as const,
      title: 'Baja parcial en una reserva',
      message: `${r.reservationNumber} · ${r.experienceTitle}. Se cayeron ${cuantas}, esos cupos quedan libres`,
      data: { reservationId: r.id, reservationNumber: r.reservationNumber },
    })),
  );

  await notificar(avisos);

  const d = paraCorreo(r);
  // Al anfitrion solo si la baja no la hizo el: si la cargo el, ya lo sabe.
  const actor = actorDeCancelacion({ cancelledBy, comoCanal });
  const porAnfitrion = actor === 'host_user';
  const correos = porAnfitrion ? [] : await correosDeReservas(r.companyId);
  const remitente = r.clienteEmail ? await remitenteDelComensal(r) : {};
  if (!r.clienteEmail) {
    await registrarOmitido(
      `reservation:${r.id}:partial_cancel:skipped:${Date.now()}`,
      'CLI-03B',
      r.id,
      actor,
    );
  }
  const paraAnfitrion =
    correos.length > 0 ? await correoBajaParcialAnfitrion(d, personasQueSeCaen, motivo) : null;
  await despachar([
    ...(r.clienteEmail
      ? [
          {
            to: r.clienteEmail,
            ...remitente,
            ...(await correoBajaParcialComensal(d, personasQueSeCaen, motivo, { reembolso, porAnfitrion })),
          },
        ]
      : []),
    ...(paraAnfitrion ? correos.map((to) => ({ to, ...paraAnfitrion })) : []),
  ]);
}

/**
 * Cambio en la reserva que el comensal tiene que saber (TR-48).
 *
 * El documento acota cuales son: fecha, hora, ubicacion, cantidad de personas
 * y reagendamiento. Las notas internas y lo administrativo no se avisan, y
 * esa es la mitad importante de la regla: si cada vez que el anfitrion
 * corrige una nota le llegara un correo al comensal, dejaria de leerlos y el
 * dia que cambie la fecha de verdad tampoco lo leeria.
 *
 * `cambios` son frases ya escritas, en el orden en que se mostraran. Se
 * componen donde se detecta el cambio, que es el unico sitio que sabe que
 * habia antes.
 */
export async function avisarCambioEnLaReserva(
  r: DatosReserva,
  cambios: string[],
  opts?: { quienLoCambio?: string | null },
): Promise<void> {
  if (cambios.length === 0) return;

  const resumen = cambios.join('. ');
  const avisos: Aviso[] = [];

  if (r.userId) {
    avisos.push({
      userId: r.userId,
      type: 'RESERVATION_RESCHEDULED',
      title: 'Cambió algo en tu reserva',
      message: `${r.experienceTitle} · ${resumen}`,
      data: { reservationId: r.id, reservationNumber: r.reservationNumber },
    });
  }

  // TR-27. Si el cambio lo hizo el canal que vendio, el anfitrion tiene que
  // enterarse: es el quien tiene que replanear la mesa, y nadie se lo iba a
  // contar. Cuando lo cambia el propio anfitrion no se le avisa a si mismo.
  if (opts?.quienLoCambio) {
    const anfitriones = await personasDeLaEmpresa(r.companyId);
    avisos.push(
      ...anfitriones.map((userId) => ({
        userId,
        type: 'RESERVATION_RESCHEDULED' as const,
        title: `${opts.quienLoCambio} cambió una reserva`,
        message: `${r.reservationNumber} · ${r.experienceTitle} · ${resumen}`,
        data: { reservationId: r.id, reservationNumber: r.reservationNumber },
      })),
    );
  }

  await notificar(avisos);

  if (r.clienteEmail) {
    await despachar([
      {
        to: r.clienteEmail,
        ...(await remitenteDelComensal(r)),
        ...(await correoCambioEnLaReserva(paraCorreo(r), cambios)),
      },
    ]);
  } else {
    await registrarOmitido(
      `reservation:${r.id}:update:skipped:${Date.now()}`,
      'CLI-02',
      r.id,
      opts?.quienLoCambio ? 'reseller' : 'host_user',
    );
  }
}

/**
 * Pedirle al comensal que califique (TR-24).
 *
 * Solo por correo: es alguien que ya se fue y puede no tener cuenta. Una
 * notificacion en una campana que no va a abrir no pide nada.
 */
export async function pedirCalificacion(r: DatosReserva, token: string): Promise<void> {
  if (!r.clienteEmail) {
    await registrarOmitido(`reservation:${r.id}:rating:skipped`, 'CLI-05', r.id, 'host_user');
    return;
  }
  const enlace = `${env.APP_URL}/calificar/${token}`;
  await despacharUnaVez(`reservation:${r.id}:rating`, 'CLI-05', r.id, [
    {
      to: r.clienteEmail,
      ...(await remitenteDelComensal(r)),
      ...(await correoCalificacionComensal(paraCorreo(r), enlace)),
    },
  ]);
}

/**
 * Pago confirmado: al anfitrion le entra dinero, al cliente le queda pagado.
 *
 * Por correo, solo al anfitrion. El comensal no recibe un "recibimos tu pago"
 * aparte: el correo de reserva confirmada lleva lo pagado y le sirve de
 * comprobante, y con dos o tres correos seguidos acaba sin leer ninguno.
 */
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
  const correos = await correosDeLaEmpresa(r.companyId, 'CONTABILIDAD');
  const correo = correos.length > 0 ? await correoPagoAnfitrion(d) : null;
  await despachar(correo ? correos.map((to) => ({ to, ...correo })) : []);
}
