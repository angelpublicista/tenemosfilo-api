import { randomUUID } from 'node:crypto';
import {
  Prisma,
  ReservationStatus,
  PaymentStatus,
  UserRole,
  type CollectedBy,
  type SalesChannel,
} from '@prisma/client';
import { pasarelaDe } from '../../lib/pasarela.js';
import { prisma } from '../../config/prisma.js';
import { conCupoApartado } from '../../lib/cupos.js';
import { comprobarSedeActiva, comprobarSimultaneidad } from '../../lib/agenda-del-anfitrion.js';
import { vincularCompradorAlCrm } from '../../lib/comprador-al-crm.js';
import { comprobarCorte } from '../../lib/corte-de-reservas.js';
import { condicionesDe } from '../../lib/sede-de-la-experiencia.js';
import { cambio, type Actor, type CambioDeReserva } from '../../lib/historial-de-reserva.js';
import {
  estadoDePagoTrasReembolso,
  nuevoReembolso,
  totalReembolsado,
} from '../../lib/reembolsos.js';
import {
  calcularDesglose,
  getPlatformSettings,
  resolverComisiones,
} from '../../lib/commissions.js';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
import { generarCodigoDeConfirmacion, normalizarCodigo } from '../../lib/codigo-de-confirmacion.js';
import { construirCheckout } from '../payments/payments.service.js';
import {
  avisarBajaParcial,
  avisarCambioDeEstado,
  avisarCambioEnLaReserva,
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
  // TR-26. El contacto del CRM al que corresponde el comprador. Se devuelve
  // para poder llegar a su ficha desde la reserva: ahi esta su historial, y
  // es la mitad util de haberlo vinculado.
  contact: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.ReservationInclude;

/**
 * Quien puede tocar esta reserva.
 *
 * El anfitrion, siempre: es suya. Y desde TR-27 tambien el canal que la
 * vendio, pero solo en modo canal y solo sobre lo que vendio el: su cliente le
 * cancela a EL, y si no puede reflejarlo aqui, el anfitrion guarda una mesa
 * para gente que ya no viene.
 */
async function assertCanManage(
  id: string,
  requesterCompanyId: string | null | undefined,
  opts?: { comoCanal?: boolean },
) {
  const r = await prisma.reservation.findUnique({
    where: { id },
    select: {
      id: true,
      companyId: true,
      resellerCompanyId: true,
      reservationDate: true,
      pricing: true,
    },
  });
  if (!r) throw NotFound('Reserva no encontrada');

  const esDeSuCanal = opts?.comoCanal === true && r.resellerCompanyId === requesterCompanyId;
  const esDelAnfitrion = r.companyId === requesterCompanyId;

  if (!requesterCompanyId || !(esDelAnfitrion || esDeSuCanal))
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
/**
 * TR-04. El canal por el que entra una venta.
 *
 * Se decide aqui, en un solo sitio, y se guarda en la reserva. Antes se
 * deducia en cada lectura de `source` mas "tiene revendedor", dos campos que
 * hablan de otra cosa: el dia que cambiara como se crea una reserva, cambiaria
 * sin querer a quien se le cobra comision.
 *
 * El orden importa: un revendedor manda sobre todo lo demas, porque la venta
 * es suya aunque se haya cerrado en el checkout.
 */
export function canalDeVenta(opts: {
  source?: string | null;
  esDeReseller: boolean;
  deOportunidad: boolean;
}): SalesChannel {
  if (opts.esDeReseller) return 'RESELLER';
  if (opts.source !== 'BOOKING_ENGINE') return 'MANUAL';
  return opts.deOportunidad ? 'CRM' : 'CHECKOUT';
}

/**
 * Si esta venta le debe comision a FILO.
 *
 * TR-04 y TR-13: lo decide el CANAL y nada mas. Las que entraron por el
 * checkout de FILO —propio, de un revendedor o por el enlace de una
 * oportunidad— generan fee; lo que el anfitrion carga a mano, no: no paso por
 * FILO y cobrarselo seria cobrarle por nada.
 */
export function generaFeeDeFilo(canal: SalesChannel): boolean {
  return canal !== 'MANUAL';
}

export async function conComisiones(
  experienceId: string,
  pricing: CreateReservationInput['pricing'],
  esDeReseller: boolean,
  quienCobra: CollectedBy,
  canal: SalesChannel,
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
    {
      esDeReseller,
      cobraElAnfitrion: quienCobra === 'HOST',
      generaFee: generaFeeDeFilo(canal),
    },
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
export async function ajustesDeOperacion(companyId: string) {
  const [c, plataforma] = await Promise.all([
    prisma.company.findUnique({
      where: { id: companyId },
      select: { autoConfirmReservations: true, blockWhenFull: true, requirePayment: true },
    }),
    getPlatformSettings(),
  ]);

  // La empresa manda; si no dice nada, el valor por defecto de la plataforma.
  // null y false no son lo mismo: sin esa distincion, cambiar el defecto no
  // alcanzaria a las empresas ya creadas.
  const exigePago = c?.requirePayment ?? plataforma.requirePaymentDefault ?? false;

  // Exigir pago sin pasarela dejaria el catalogo sin forma de reservar: el
  // ajuste solo surte efecto si de verdad se puede cobrar. Y "se puede cobrar"
  // ya no es solo la de la plataforma: puede ser la propia del anfitrion.
  const sePuedeCobrar = (await pasarelaDe(companyId)) !== null;

  return {
    autoConfirmar: c?.autoConfirmReservations ?? false,
    bloquearLleno: c?.blockWhenFull ?? true,
    exigePago: exigePago && sePuedeCobrar,
  };
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
 *
 * El precio es el de LA SEDE donde se reserva: la misma experiencia puede
 * valer una cosa en el local del centro y otra en la finca. Sin esto el
 * catalogo enseñaba el precio de la finca y se cobraba el del centro.
 */
async function precioDesdeExperiencia(
  experienceId: string,
  participants: number,
  elegidos: AddonElegido[] | undefined,
  locationId?: string | null,
) {
  const exp = await prisma.experience.findFirst({
    where: { id: experienceId, deletedAt: null },
    select: { addons: true },
  });
  if (!exp) throw NotFound('Experiencia no disponible');

  const { basePrice: deLaSede } = await condicionesDe(experienceId, locationId);
  const basePrice = Number(deLaSede ?? 0);
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

/**
 * TR-26. Cuelga el comprador del CRM del anfitrion y lo ata a la reserva.
 *
 * Aparte y sin await porque no es parte de la venta: es su consecuencia. Un
 * CRM que no se actualiza es un problema; una reserva que no se crea porque
 * el CRM fallo es otro mucho peor.
 */
async function colgarDelCrm(
  reservationId: string,
  companyId: string,
  cliente: unknown,
  source: string | null | undefined,
  resellerCompanyId: string | null,
): Promise<void> {
  try {
    const c = (cliente ?? {}) as { name?: string; email?: string; phone?: string };

    // De donde vino el cliente, en palabras que el anfitrion reconozca al
    // verlas en la ficha meses despues.
    let origen = 'Reserva directa';
    if (resellerCompanyId) {
      const rev = await prisma.company.findUnique({
        where: { id: resellerCompanyId },
        select: { companyName: true },
      });
      origen = rev?.companyName ? `Canal: ${rev.companyName}` : 'Canal de venta';
    } else if (source === 'BOOKING_ENGINE') {
      origen = 'Catálogo público';
    }

    const contactId = await vincularCompradorAlCrm(companyId, c, origen);
    if (contactId) {
      await prisma.reservation.update({ where: { id: reservationId }, data: { contactId } });
    }
  } catch (e) {
    console.error('[contacto del comprador] no se pudo vincular', e);
  }
}

/**
 * La duracion que se guarda en la reserva (TR-36).
 *
 * Se copia de la ficha al vender y no se lee de ella despues: los cambios en
 * la experiencia aplican hacia adelante. Si manaña el anfitrion alarga la cena
 * de dos a tres horas, las reservas de la semana que viene siguen siendo de
 * dos: es lo que se les vendio y lo que esa gente tiene en su calendario.
 */
async function duracionAlVender(
  experienceId: string,
  duracionPedida: number | null | undefined,
): Promise<number | null> {
  if (duracionPedida !== undefined && duracionPedida !== null) return duracionPedida;
  const exp = await prisma.experience.findUnique({
    where: { id: experienceId },
    select: { duration: true },
  });
  return exp?.duration ?? null;
}

/** Una fecha y hora en palabras, para contarsela a quien reservo. */
function cuandoEnPalabras(d: Date): string {
  return d.toLocaleString('es-CO', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * TR-48. Que cambios de una edicion se le cuentan al comensal.
 *
 * Solo los que le obligan a hacer algo distinto: ir otro dia, ir a otro
 * sitio, o venir con mas o menos gente. Todo lo demas —notas internas,
 * metodo de pago, requerimientos— se guarda sin avisar a nadie.
 */
function cambiosQueSeAvisan(
  antes: {
    reservationDate: Date;
    participants: number;
    locationId: string | null;
    location: { name: string } | null;
  } | null,
  despues: {
    reservationDate: Date;
    participants: number;
    locationId: string | null;
    location: { name: string } | null;
  },
): string[] {
  if (!antes) return [];
  const cambios: string[] = [];

  if (antes.reservationDate.getTime() !== despues.reservationDate.getTime()) {
    cambios.push(
      `La fecha pasa del ${cuandoEnPalabras(antes.reservationDate)} al ${cuandoEnPalabras(
        despues.reservationDate,
      )}`,
    );
  }

  if (antes.participants !== despues.participants) {
    cambios.push(`Las personas pasan de ${antes.participants} a ${despues.participants}`);
  }

  if (antes.locationId !== despues.locationId) {
    const de = antes.location?.name ?? 'sin sede asignada';
    const a = despues.location?.name ?? 'sin sede asignada';
    cambios.push(`El lugar pasa de ${de} a ${a}`);
  }

  return cambios;
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

    // Quien va a cobrar esto se decide AHORA y queda escrito en la reserva.
    // De ello depende la comision, asi que las dos cosas tienen que salir de
    // la misma lectura: si se resolviera otra vez al pagar, un anfitrion que
    // conecte su pasarela entre medias dejaria reservas con comision
    // descontada cobrandose en su cuenta.
    const quienCobra = (await pasarelaDe(companyId))?.quienCobra ?? 'PLATFORM';
    // El precio lo pone quien vende, tambien por debajo del de lista: la base
    // del fee es el valor efectivamente vendido al comprador (§4.4 del
    // documento transversal, con su ejemplo de los $40.000 sobre $45.000).
    const source = input.source ?? (asReseller ? 'BOOKING_ENGINE' : 'MANUAL');
    // TR-04. El canal se decide aqui y se guarda: de el depende el fee.
    const canal = canalDeVenta({ source, esDeReseller: asReseller, deOportunidad: false });
    const pricing = await conComisiones(
      input.experience,
      input.pricing,
      asReseller,
      quienCobra,
      canal,
    );

    // Tambien aqui: una venta de revendedor o una reserva cargada a mano no
    // deberian poder pasarse del aforo si la empresa lo tiene bloqueado.
    const ajustes = await ajustesDeOperacion(companyId);

    // TR-36. La duracion se congela al vender: lo que la ficha diga mañana no
    // cambia lo que esta gente tiene en su calendario.
    const duracionCongelada = await duracionAlVender(input.experience, input.duration);

    // TR-37. Una sede inactiva no admite reservas nuevas, ni a mano: si el
    // anfitrion la apago, no es sitio donde mandar gente.
    await comprobarSedeActiva(input.location);

    // TR-06. El corte de anticipacion vale para lo que entra por un canal o
    // por el checkout. Lo que el anfitrion carga a mano no pasa por aqui: si
    // le llaman a las seis y decide aceptar, ya sabe lo que hay en su cocina.
    if (source !== 'MANUAL') {
      await comprobarCorte(
        input.experience,
        new Date(input.reservationDate),
        input.location ?? null,
      );
    }

    // TR-42. Que el anfitrion no acabe con dos cosas a la vez en el mismo
    // sitio. En sedes distintas solo se avisa, y quien programa decide.
    await comprobarSimultaneidad(
      {
        companyId,
        experienceId: input.experience,
        locationId: input.location ?? null,
        fecha: new Date(input.reservationDate),
        duracionMin: input.duration ?? null,
      },
      { permitirSolape: input.permitirSolape === true },
    );

    const { reserva: creada, reutilizada } = await conCupoApartado(
      input.experience,
      new Date(input.reservationDate),
      input.participants,
      ajustes,
      async (tx) => {
        // TR-43. Dentro del cerrojo: dos reintentos de la misma venta llevan
        // la misma experiencia y el mismo dia, asi que el segundo espera y
        // encuentra la reserva que creo el primero. Fuera del cerrojo podrian
        // mirar los dos a la vez y crear dos.
        const ya = input.idempotencyKey
          ? await tx.reservation.findUnique({
              where: { idempotencyKey: input.idempotencyKey },
              include: fullInclude,
            })
          : null;
        if (ya) return { reserva: ya, reutilizada: true };

        const nueva = await tx.reservation.create({
      data: {
        idempotencyKey: input.idempotencyKey ?? null,
        reservationNumber: input.reservationNumber ?? generateReservationNumber(),
        // Todas lo llevan, no solo las de canal: si solo lo tuvieran unas, el
        // anfitrion tendria dos formas de recibir a la gente en la puerta.
        confirmationCode: generarCodigoDeConfirmacion(),
        experience: { connect: { id: input.experience } },
        company: { connect: { id: companyId } },
        ...(resellerCompanyId
          ? { resellerCompany: { connect: { id: resellerCompanyId } } }
          : {}),
        client: input.client as Prisma.InputJsonValue,
        clientType: input.clientType ?? 'GUEST',
        ...(input.user ? { user: { connect: { id: input.user } } } : {}),
        source,
        channel: canal,
        reservationDate: new Date(input.reservationDate),
        duration: duracionCongelada,
        participants: input.participants,
        status: input.status ?? 'PENDING',
        paymentStatus: input.paymentStatus ?? 'PENDING',
        collectedBy: quienCobra,
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
        return { reserva: nueva, reutilizada: false };
      },
      null,
      // El aforo se cuenta por sede: dos sedes son dos inventarios.
      input.location ?? null,
    );

    // Un reintento no vuelve a avisar: el anfitrion recibiria dos veces el
    // mismo aviso de una sola venta.
    if (!reutilizada) void avisarNuevaReserva(paraAvisos(creada));

    // TR-26. El comprador queda como contacto del anfitrion. Sin await: si
    // falla, la venta ya esta hecha y perder el contacto es molesto, perder
    // la reserva es inaceptable.
    if (!reutilizada) void colgarDelCrm(creada.id, companyId, input.client, source, resellerCompanyId);

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
      input.location ?? null,
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

    // CRM-33. Si viene del enlace de una oportunidad, la reserva se cuelga de
    // ella. Sin esto el comercial no ve en su oportunidad la reserva que su
    // propio enlace acaba de generar, y la cierra a mano creyendo que el
    // cliente nunca reservo.
    //
    // Se comprueba que la oportunidad sea de esta misma empresa y siga
    // abierta: un token viejo no debe reabrir una venta ya cerrada.
    const deOportunidad = input.solicitudToken
      ? await prisma.opportunity.findFirst({
          where: {
            bookingToken: input.solicitudToken,
            hostCompanyId: companyId,
            status: 'OPEN',
            deletedAt: null,
          },
          select: { id: true },
        })
      : null;

    const quienCobra = (await pasarelaDe(companyId))?.quienCobra ?? 'PLATFORM';
    // TR-04. Tres canales posibles aqui: el catalogo de un revendedor, el
    // enlace de una oportunidad del CRM, o el catalogo propio del anfitrion.
    const canal = canalDeVenta({
      source: 'BOOKING_ENGINE',
      esDeReseller: revendedor !== null,
      deOportunidad: deOportunidad !== null,
    });
    const pricing = await conComisiones(
      input.experience,
      precio as unknown as CreateReservationInput['pricing'],
      revendedor !== null,
      quienCobra,
      canal,
    );

    // Los ajustes de la empresa mandan sobre como entra la reserva.
    const fecha = new Date(input.reservationDate);
    const ajustes = await ajustesDeOperacion(companyId);
    const { autoConfirmar } = ajustes;

    const duracionCongelada = await duracionAlVender(input.experience, input.duration);

    await comprobarSedeActiva(input.location);

    // TR-06. El corte tambien vale cuando se liberan cupos: un lugar que
    // alguien cancela dos horas antes no vuelve al catalogo, porque el
    // anfitrion ya compro contando con la gente que tenia.
    await comprobarCorte(input.experience, fecha, input.location ?? null);

    // TR-42, en el checkout publico: solo el bloqueo de la misma sede. El
    // aviso de sedes distintas es una decision del anfitrion, y quien reserva
    // desde el catalogo no puede tomarla ni sabe de que se le hablaria; si se
    // le preguntara, lo unico que pasaria es que se perderia la venta.
    await comprobarSimultaneidad(
      {
        companyId,
        experienceId: input.experience,
        locationId: input.location ?? null,
        fecha,
        duracionMin: input.duration ?? null,
      },
      { permitirSolape: true },
    );

    const { reserva: creada, reutilizada } = await conCupoApartado(
      input.experience,
      fecha,
      input.participants,
      ajustes,
      async (tx) => {
        // TR-43, igual que en create(): un reintento del checkout devuelve la
        // reserva que ya existe en vez de vender el cupo otra vez.
        const ya = input.idempotencyKey
          ? await tx.reservation.findUnique({
              where: { idempotencyKey: input.idempotencyKey },
              select: { reservationNumber: true, confirmationCode: true },
            })
          : null;
        if (ya) return { reserva: ya, reutilizada: true };

        const nueva = await tx.reservation.create({
      data: {
        idempotencyKey: input.idempotencyKey ?? null,
        reservationNumber: input.reservationNumber ?? generateReservationNumber(),
        // Todas lo llevan, no solo las de canal: si solo lo tuvieran unas, el
        // anfitrion tendria dos formas de recibir a la gente en la puerta.
        confirmationCode: generarCodigoDeConfirmacion(),
        experience: { connect: { id: input.experience } },
        company: { connect: { id: companyId } },
        ...(revendedor ? { resellerCompany: { connect: { id: revendedor } } } : {}),
        client: input.client as Prisma.InputJsonValue,
        ...(cuenta ? { user: { connect: { id: cuenta.id } }, clientType: 'REGISTERED' as const } : { clientType: 'GUEST' as const }),
        source: 'BOOKING_ENGINE',
        channel: canal,
        ...(deOportunidad ? { opportunity: { connect: { id: deOportunidad.id } } } : {}),
        reservationDate: fecha,
        duration: duracionCongelada,
        participants: input.participants,
        // Confirmada de entrada solo si la empresa lo pidio; el aforo ya se
        // comprobo arriba, asi que no se autoconfirma nada sin sitio.
        status: autoConfirmar ? 'CONFIRMED' : 'PENDING',
        paymentStatus: 'PENDING',
        collectedBy: quienCobra,
        pricing,
        ...(input.location ? { location: { connect: { id: input.location } } } : {}),
        isVirtual: input.isVirtual ?? false,
        specialRequirements: input.specialRequirements ?? null,
        notes: input.notes ?? null,
      },
      // El codigo sale aqui porque es lo que la pantalla de confirmacion le
      // enseña al cliente: sin el, lo unico que se lleva es el numero de
      // reserva, que no es lo que le van a pedir en la puerta.
      select: { reservationNumber: true, confirmationCode: true },
        });
        return { reserva: nueva, reutilizada: false };
      },
      null,
      // El aforo se cuenta por sede: dos sedes son dos inventarios.
      input.location ?? null,
    );

    // El aviso necesita mas campos de los que devuelve el alta; se relee
    // una vez en vez de inflar el select del create. Va el include completo
    // porque el correo al comensal lleva el nombre del anfitrion y el lugar,
    // y esta es la via por la que entran las reservas del publico.
    const completa = reutilizada
      ? null
      : await prisma.reservation.findUnique({
          where: { reservationNumber: creada.reservationNumber },
          include: fullInclude,
        });
    if (completa) void avisarNuevaReserva(paraAvisos(completa));

    // TR-26, igual que en create(): la venta le deja al anfitrion el cliente.
    if (completa) void colgarDelCrm(completa.id, companyId, input.client, 'BOOKING_ENGINE', revendedor);

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

  /**
   * Una reserva, si quien pregunta tiene algo que ver con ella.
   *
   * Antes no comprobaba nada: bastaba tener cuenta de anfitrion y acertar el
   * id para leer la reserva de cualquier otra empresa, con el nombre, el
   * correo y el telefono del cliente dentro.
   *
   * Quien puede verla no es lo mismo que quien puede tocarla, y por eso esto
   * no reutiliza `assertCanManage`: el revendedor que vendio la reserva
   * necesita poder abrirla —se le avisa de esa venta por correo y por la
   * campana, y avisar de algo que no se puede abrir no tiene sentido— pero no
   * es quien la gestiona. La condicion de a quien pertenece una reserva segun
   * su papel es la misma que ya usa el modulo de pagos.
   *
   * ADMIN pasa siempre: es la plataforma mirando su propia operacion, y sin
   * eso el soporte no podria atender un problema con una reserva concreta.
   */
  async getById(id: string, solicitante: { companyId?: string | null; role: UserRole }) {
    const r = await prisma.reservation.findUnique({ where: { id }, include: fullInclude });
    if (!r) throw NotFound('Reserva no encontrada');

    if (solicitante.role === 'ADMIN') return r;

    const suya =
      solicitante.role === 'RESELLER'
        ? r.resellerCompanyId === solicitante.companyId
        : r.companyId === solicitante.companyId;

    // Sin empresa activa no hay nada que pueda ser suyo. Se comprueba aparte
    // porque `null === null` seria cierto y dejaria pasar a una reserva sin
    // revendedor a cualquiera que no tenga empresa.
    if (!solicitante.companyId || !suya) {
      throw Forbidden('No tienes permiso sobre esta reserva');
    }

    return r;
  },

  /**
   * Validar en la puerta el codigo que trae el cliente.
   *
   * Es el control que hace que una venta de canal no pueda quedarse fuera de
   * FILO: quien vendio por su cuenta y no registro la reserva no tiene codigo
   * que dar, y el anfitrion lo descubre cuando el cliente llega en vez de
   * nunca. Por eso el "no existe" es una respuesta util y no un error a
   * esconder: es justo la señal que hay que ver.
   *
   * Marca la llegada en el mismo paso. Separarlo en buscar y luego confirmar
   * obligaria a dos toques con gente esperando en la entrada.
   */
  async validarCodigo(
    codigo: string,
    solicitante: { companyId?: string | null; role: UserRole; id: string },
  ) {
    const normalizado = normalizarCodigo(codigo);
    const r = await prisma.reservation.findUnique({
      where: { confirmationCode: normalizado },
      include: {
        ...fullInclude,
        resellerCompany: { select: { id: true, companyName: true } },
      },
    });

    // Mismo mensaje para "no existe" y "es de otra empresa": si fueran
    // distintos, cualquiera con un anfitrion podria ir probando codigos para
    // averiguar cuales existen.
    const suya = solicitante.role === 'ADMIN' || r?.companyId === solicitante.companyId;
    if (!r || !suya) {
      throw NotFound(
        'Ese código no corresponde a ninguna reserva tuya. Si el cliente insiste en que ya pagó, ' +
          'pídele por dónde compró: puede ser una venta que no entró por FILO.',
      );
    }

    if (r.status === 'CANCELLED') {
      throw BadRequest('Esa reserva está cancelada.');
    }

    // Ya validada: no se vuelve a escribir la hora de llegada. El codigo de
    // una reserva para cuatro no deberia servir para entrar dos veces, y el
    // anfitrion necesita ver que esto ya paso.
    if (r.checkedInAt) {
      return { reserva: r, yaHabiaLlegado: true };
    }

    const actualizada = await prisma.reservation.update({
      where: { id: r.id },
      data: { checkedInAt: new Date(), checkedInById: solicitante.id },
      include: {
        ...fullInclude,
        resellerCompany: { select: { id: true, companyName: true } },
      },
    });
    return { reserva: actualizada, yaHabiaLlegado: false };
  },

  /**
   * Lo que vendio un canal, con la asistencia de cada reserva (TR-25).
   *
   * El revendedor no puede ver el listado de reservas del anfitrion —no son
   * suyas— pero si las que vendio el, y necesita saber quien aparecio: es lo
   * que le permite contarselo a su cliente corporativo y cuadrar su propia
   * facturacion.
   *
   * Va aparte de "Mis ingresos" a proposito: eso es dinero y solo cuenta lo
   * cobrado. Esto es operacion, e incluye lo que todavia no se ha pagado.
   */
  async deMiCanal(
    resellerCompanyId: string | null | undefined,
    query: { page: number; pageSize: number; dateFrom?: string; dateTo?: string },
  ) {
    if (!resellerCompanyId) throw Forbidden('No tienes una company asociada');

    const where: Prisma.ReservationWhereInput = {
      resellerCompanyId,
      ...(query.dateFrom || query.dateTo
        ? {
            reservationDate: {
              ...(query.dateFrom ? { gte: new Date(query.dateFrom) } : {}),
              ...(query.dateTo ? { lte: new Date(query.dateTo) } : {}),
            },
          }
        : {}),
    };

    const [items, total] = await Promise.all([
      prisma.reservation.findMany({
        where,
        orderBy: { reservationDate: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          reservationNumber: true,
          confirmationCode: true,
          reservationDate: true,
          participants: true,
          attendedCount: true,
          status: true,
          paymentStatus: true,
          client: true,
          pricing: true,
          experience: { select: { id: true, title: true } },
          company: { select: { id: true, companyName: true } },
        },
      }),
      prisma.reservation.count({ where }),
    ]);

    const filas = items.map((r) => {
      const p = (r.pricing ?? {}) as Record<string, unknown>;
      const c = (r.client ?? {}) as { name?: string };
      return {
        id: r.id,
        reservationNumber: r.reservationNumber,
        confirmationCode: r.confirmationCode,
        reservationDate: r.reservationDate,
        experienceTitle: r.experience?.title ?? null,
        hostCompanyName: r.company?.companyName ?? null,
        clienteNombre: c.name ?? null,
        participants: r.participants,
        // null hasta que el anfitrion cierre la experiencia. No se presume que
        // vinieron todos: decirlo sin saberlo es peor que no decir nada.
        attendedCount: r.attendedCount,
        status: r.status,
        paymentStatus: r.paymentStatus,
        total: Number(p.total ?? 0),
        resellerCommission: Number(p.resellerCommission ?? 0),
      };
    });

    // El resumen del periodo: es lo primero que se mira al reportarle a un
    // cliente, y sumarlo en la pantalla obligaria a traerse todas las paginas.
    const agregado = await prisma.reservation.aggregate({
      where,
      _sum: { participants: true, attendedCount: true },
    });
    const cerradas = await prisma.reservation.count({
      where: { ...where, attendedCount: { not: null } },
    });

    return {
      items: filas,
      total,
      resumen: {
        vendidas: total,
        personasVendidas: agregado._sum?.participants ?? 0,
        personasAsistieron: agregado._sum?.attendedCount ?? 0,
        conAsistenciaRegistrada: cerradas,
      },
    };
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

  /**
   * Editar una reserva.
   *
   * TR-48. Lo que el comensal tiene que saber se le cuenta; lo demas no. El
   * documento acota la lista: fecha, hora, ubicacion y cantidad de personas
   * si; notas internas y datos administrativos no. La mitad importante de esa
   * regla es la segunda: si cada correccion de una nota le llegara por correo,
   * dejaria de leerlos, y el dia que cambie la fecha de verdad tampoco lo
   * leeria.
   */
  async update(
    id: string,
    requesterCompanyId: string | null | undefined,
    input: UpdateReservationInput,
    actor?: Actor,
    opts?: { comoCanal?: boolean },
  ) {
    await assertCanManage(id, requesterCompanyId, opts);

    // Lo de antes, para poder decir que cambio y no solo que cambio algo.
    const antes = await prisma.reservation.findUnique({
      where: { id },
      select: {
        reservationDate: true,
        participants: true,
        locationId: true,
        status: true,
        paymentStatus: true,
        duration: true,
        changes: true,
        location: { select: { name: true } },
      },
    });

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

    // TR-39. El historial. Se escribe junto con el cambio, no despues: si
    // fuera otra escritura, un fallo entre las dos dejaria la reserva movida
    // sin constancia de quien la movio.
    if (antes) {
      const nuevos: CambioDeReserva[] = [];
      const anota = (campo: string, viejo: unknown, nuevo: unknown) => {
        const a = viejo instanceof Date ? viejo.getTime() : viejo;
        const b = nuevo instanceof Date ? nuevo.getTime() : nuevo;
        if (nuevo !== undefined && a !== b) nuevos.push(cambio(campo, viejo, nuevo, actor));
      };
      if (input.reservationDate !== undefined)
        anota('fecha', antes.reservationDate, new Date(input.reservationDate));
      if (input.participants !== undefined)
        anota('personas', antes.participants, input.participants);
      if (input.location !== undefined) anota('sede', antes.locationId, input.location);
      if (input.status !== undefined) anota('estado', antes.status, input.status);
      if (input.paymentStatus !== undefined)
        anota('estado de pago', antes.paymentStatus, input.paymentStatus);
      if (input.duration !== undefined) anota('duracion', antes.duration, input.duration);

      if (nuevos.length > 0) {
        data.changes = [
          ...(antes.changes as Prisma.InputJsonValue[]),
          ...(nuevos as unknown as Prisma.InputJsonValue[]),
        ];
      }
    }

    const actualizada = await prisma.reservation.update({
      where: { id },
      data,
      include: fullInclude,
    });

    const cambios = cambiosQueSeAvisan(antes, actualizada);
    // Sin await: el aviso no puede hacer esperar —ni tumbar— una edicion que
    // ya esta guardada.
    //
    // TR-27. Si lo cambio el canal, al anfitrion tambien se le cuenta: es el
    // quien tiene que replanear, y nadie mas se lo iba a decir.
    if (cambios.length > 0) {
      void (async () => {
        const quien = opts?.comoCanal
          ? (
              await prisma.company.findUnique({
                where: { id: requesterCompanyId! },
                select: { companyName: true },
              })
            )?.companyName ?? 'Un canal de venta'
          : null;
        await avisarCambioEnLaReserva(paraAvisos(actualizada), cambios, { quienLoCambio: quien });
      })();
    }

    return actualizada;
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

  /**
   * Cancelar una reserva, entera o en parte (TR-07).
   *
   * Lo que decide casi todo es quien cancela. Si cancela el anfitrion, el
   * comensal no ha hecho nada mal y le corresponde lo que pago: el reembolso
   * sale por defecto de `paidAmount` y no hay que acordarse de mandarlo. Si
   * cancela el comensal, lo que se devuelve depende de los terminos del
   * anfitrion, y eso no lo puede adivinar el servidor: va a cero salvo que
   * quien cancela diga otra cosa.
   *
   * Una baja parcial no cancela nada: la reserva sigue viva con menos gente.
   * Los cupos de los que se cayeron quedan libres en el acto, porque el aforo
   * se cuenta sobre `participants`. El importe baja en proporcion y las
   * comisiones se recalculan sobre la nueva base: cobrarle al anfitrion el
   * fee de diez personas cuando vinieron ocho seria cobrarle de mas.
   */
  async cancel(
    id: string,
    requesterCompanyId: string | null | undefined,
    input: CancelInput,
    opts?: { comoCanal?: boolean },
  ) {
    const actual = await prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        companyId: true,
        resellerCompanyId: true,
        experienceId: true,
        participants: true,
        paidAmount: true,
        pricing: true,
        status: true,
        source: true,
        channel: true,
        collectedBy: true,
        partialCancellations: true,
        refunds: true,
      },
    });
    if (!actual) throw NotFound('Reserva no encontrada');
    // TR-27. El canal puede cancelar lo que vendio el: su cliente le cancela a
    // EL, y sin esto el anfitrion guarda una mesa para gente que ya no viene.
    const esDeSuCanal =
      opts?.comoCanal === true && actual.resellerCompanyId === requesterCompanyId;
    if (!requesterCompanyId || !(actual.companyId === requesterCompanyId || esDeSuCanal))
      throw Forbidden('No tienes permiso sobre esta reserva');
    if (actual.status === 'CANCELLED') throw BadRequest('Esta reserva ya está cancelada');

    const pagado = Number(actual.paidAmount) || 0;
    const sePierden = input.participants ?? actual.participants;
    if (sePierden > actual.participants) {
      throw BadRequest(
        `Esta reserva es de ${actual.participants} ${
          actual.participants === 1 ? 'persona' : 'personas'
        }: no se pueden dar de baja ${sePierden}.`,
      );
    }

    // ── Baja parcial: la reserva sigue, con menos gente ──
    if (sePierden < actual.participants) {
      const quedan = actual.participants - sePierden;
      const precio = (actual.pricing ?? {}) as Record<string, unknown>;
      const totalViejo = Number(precio.total) || 0;
      // Proporcional: es la unica reparticion defendible cuando el total se
      // negocio y no sale de multiplicar el precio de lista.
      const totalNuevo = Math.round((totalViejo * quedan) / actual.participants);

      const reembolso =
        input.refundAmount ??
        (input.cancelledBy === 'host'
          ? Math.min(pagado, Math.round((pagado * sePierden) / actual.participants))
          : 0);

      const pricing = await conComisiones(
        actual.experienceId,
        { ...precio, total: totalNuevo } as CreateReservationInput['pricing'],
        actual.resellerCompanyId !== null,
        actual.collectedBy,
        // El canal de la venta, que no cambia porque se devuelva dinero.
        actual.channel,
      );

      const parcial = {
        fecha: new Date().toISOString(),
        personas: sePierden,
        canceladaPor: input.cancelledBy,
        motivo: input.reason,
        reembolso,
        estadoDelReembolso: reembolso > 0 ? 'pendiente' : null,
      };

      const reducida = await prisma.reservation.update({
        where: { id },
        data: {
          participants: quedan,
          pricing,
          // TR-30. El reembolso tambien al registro unico: es el sitio donde
          // se pregunta cuanto se le ha devuelto a esta reserva.
          ...(reembolso > 0
            ? {
                refunds: [
                  ...(actual.refunds as Prisma.InputJsonValue[]),
                  nuevoReembolso(reembolso, input.reason, 'BAJA_PARCIAL') as unknown as Prisma.InputJsonValue,
                ],
              }
            : {}),
          partialCancellations: [
            ...(actual.partialCancellations as Prisma.InputJsonValue[]),
            parcial as Prisma.InputJsonValue,
          ],
        },
        include: fullInclude,
      });

      void avisarBajaParcial(paraAvisos(reducida), sePierden, input.reason, reembolso);
      return reducida;
    }

    // ── Baja total ──
    const reembolso = input.refundAmount ?? (input.cancelledBy === 'host' ? pagado : 0);

    const cancelada = await prisma.reservation.update({
      where: { id },
      data: {
        status: 'CANCELLED',
        // El pricing NO se toca al cancelar entero: una cancelada ya sale de
        // lo que se le debe a cada empresa, y bajarlo ademas lo contaria dos
        // veces.
        ...(reembolso > 0
          ? {
              refunds: [
                ...(actual.refunds as Prisma.InputJsonValue[]),
                nuevoReembolso(reembolso, input.reason, 'CANCELACION') as unknown as Prisma.InputJsonValue,
              ],
            }
          : {}),
        cancellation: {
          cancelledAt: new Date().toISOString(),
          cancelledBy: input.cancelledBy,
          cancellationReason: input.reason,
          refundAmount: reembolso,
          refundStatus: reembolso > 0 ? 'pending' : null,
        } as Prisma.InputJsonValue,
      },
      include: fullInclude,
    });
    void avisarCambioDeEstado(paraAvisos(cancelada), 'CANCELLED', input.reason);
    return cancelada;
  },

  /**
   * Devolver dinero de una reserva que sigue en pie (TR-30).
   *
   * El caso que faltaba: la experiencia se dio, pero hubo que devolver algo
   * —un plato que no salio, una hora menos de lo prometido—. No es una
   * cancelacion y no cambia el estado de la reserva.
   *
   * Lo importante es que ajusta la venta y, con ella, la base del fee: si solo
   * se apuntara, FILO seguiria cobrando comision sobre un dinero devuelto y al
   * anfitrion se le seguiria dispersando por una venta que ya no vale eso.
   *
   * Si la transferencia del periodo ya salio, el saldo queda en negativo y se
   * descuenta de la siguiente. No hay nada que reabrir: lo que se debe se
   * calcula como devengado menos transferido.
   */
  async registrarReembolso(
    id: string,
    requesterCompanyId: string | null | undefined,
    input: { amount: number; reason: string },
  ) {
    const actual = await prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        companyId: true,
        experienceId: true,
        paidAmount: true,
        pricing: true,
        status: true,
        source: true,
        channel: true,
        resellerCompanyId: true,
        collectedBy: true,
        refunds: true,
      },
    });
    if (!actual) throw NotFound('Reserva no encontrada');
    if (!requesterCompanyId || actual.companyId !== requesterCompanyId)
      throw Forbidden('No tienes permiso sobre esta reserva');
    if (actual.status === 'CANCELLED') {
      throw BadRequest(
        'Esta reserva está cancelada: su reembolso se registró al cancelarla.',
      );
    }

    const pagado = Number(actual.paidAmount) || 0;
    if (input.amount > pagado) {
      throw BadRequest(
        pagado > 0
          ? `Solo se han cobrado ${pagado.toLocaleString('es-CO')}: no se puede devolver más de eso.`
          : 'Esta reserva no tiene dinero cobrado que devolver.',
      );
    }

    const precio = (actual.pricing ?? {}) as Record<string, unknown>;
    const totalViejo = Number(precio.total) || 0;
    const totalNuevo = Math.max(0, totalViejo - input.amount);
    const pagadoNuevo = pagado - input.amount;

    const pricing = await conComisiones(
      actual.experienceId,
      { ...precio, total: totalNuevo } as CreateReservationInput['pricing'],
      actual.resellerCompanyId !== null,
      actual.collectedBy,
      actual.channel,
    );

    const reembolso = nuevoReembolso(input.amount, input.reason, 'AJUSTE');

    return prisma.reservation.update({
      where: { id },
      data: {
        pricing,
        paidAmount: pagadoNuevo,
        paymentStatus: estadoDePagoTrasReembolso(pagadoNuevo, totalNuevo),
        refunds: [
          ...(actual.refunds as Prisma.InputJsonValue[]),
          reembolso as unknown as Prisma.InputJsonValue,
        ],
      },
      include: fullInclude,
    });
  },

  /**
   * Un cargo adicional acordado despues de vender (TR-12).
   *
   * El requisito pide dos cosas que parecen contrarias: que el valor vendido
   * se conserve —un cambio de fecha o de cantidad NO recalcula el dinero por
   * su cuenta— y que se puedan registrar cobros adicionales. Se resuelven
   * juntas asi: el precio original no se toca nunca, y lo que se acuerde
   * cobrar de mas se apunta aparte y suma al total.
   *
   * Suma a la base del fee, como el precio: es dinero que el comprador pago
   * por esta venta, y la comision se calcula sobre lo vendido.
   */
  async registrarCargoAdicional(
    id: string,
    requesterCompanyId: string | null | undefined,
    input: { amount: number; concept: string },
    actor?: Actor,
  ) {
    const actual = await prisma.reservation.findUnique({
      where: { id },
      select: {
        id: true,
        companyId: true,
        experienceId: true,
        pricing: true,
        status: true,
        source: true,
        channel: true,
        resellerCompanyId: true,
        collectedBy: true,
        extraCharges: true,
        changes: true,
      },
    });
    if (!actual) throw NotFound('Reserva no encontrada');
    if (!requesterCompanyId || actual.companyId !== requesterCompanyId)
      throw Forbidden('No tienes permiso sobre esta reserva');
    if (actual.status === 'CANCELLED')
      throw BadRequest('Esta reserva está cancelada: no se le puede cobrar más.');

    const precio = (actual.pricing ?? {}) as Record<string, unknown>;
    const totalViejo = Number(precio.total) || 0;
    const totalNuevo = totalViejo + input.amount;

    const pricing = await conComisiones(
      actual.experienceId,
      { ...precio, total: totalNuevo } as CreateReservationInput['pricing'],
      actual.resellerCompanyId !== null,
      actual.collectedBy,
      actual.channel,
    );

    const cargo = {
      id: randomUUID(),
      fecha: new Date().toISOString(),
      importe: input.amount,
      concepto: input.concept,
      // Pendiente de cobro: apuntarlo no es haberlo cobrado, y confundir las
      // dos cosas deja al anfitrion creyendo que ya le entro ese dinero.
      estado: 'pendiente',
    };

    return prisma.reservation.update({
      where: { id },
      data: {
        pricing,
        extraCharges: [
          ...(actual.extraCharges as Prisma.InputJsonValue[]),
          cargo as unknown as Prisma.InputJsonValue,
        ],
        changes: [
          ...(actual.changes as Prisma.InputJsonValue[]),
          cambio(
            'cargo adicional',
            totalViejo,
            totalNuevo,
            actor,
            input.concept,
          ) as unknown as Prisma.InputJsonValue,
        ],
      },
      include: fullInclude,
    });
  },

  /** El historial de una reserva, para la pantalla (TR-39). */
  async historialDe(id: string, requesterCompanyId: string | null | undefined) {
    const r = await prisma.reservation.findUnique({
      where: { id },
      select: {
        companyId: true,
        changes: true,
        extraCharges: true,
        refunds: true,
        partialCancellations: true,
        rescheduling: true,
        cancellation: true,
        createdAt: true,
      },
    });
    if (!r) throw NotFound('Reserva no encontrada');
    if (!requesterCompanyId || r.companyId !== requesterCompanyId)
      throw Forbidden('No tienes permiso sobre esta reserva');

    return {
      creada: r.createdAt,
      cambios: r.changes,
      cargosAdicionales: r.extraCharges,
      reembolsos: r.refunds,
      bajasParciales: r.partialCancellations,
      reprogramacion: r.rescheduling,
      cancelacion: r.cancellation,
    };
  },

  /** Marcar un reembolso como pagado: el dinero salio de verdad. */
  async marcarReembolsoPagado(
    id: string,
    requesterCompanyId: string | null | undefined,
    refundId: string,
  ) {
    const actual = await prisma.reservation.findUnique({
      where: { id },
      select: { id: true, companyId: true, refunds: true },
    });
    if (!actual) throw NotFound('Reserva no encontrada');
    if (!requesterCompanyId || actual.companyId !== requesterCompanyId)
      throw Forbidden('No tienes permiso sobre esta reserva');

    const lista = actual.refunds as unknown as Array<Record<string, unknown>>;
    const i = lista.findIndex((r) => r?.id === refundId);
    if (i < 0) throw NotFound('Ese reembolso no existe en esta reserva');
    if (lista[i]?.estado === 'pagado') throw BadRequest('Ese reembolso ya está marcado como pagado');

    const actualizados = lista.map((r, n) =>
      n === i ? { ...r, estado: 'pagado', pagadoEl: new Date().toISOString() } : r,
    );

    return prisma.reservation.update({
      where: { id },
      data: { refunds: actualizados as unknown as Prisma.InputJsonValue[] },
      include: fullInclude,
    });
  },

  /** Lo devuelto de una reserva, para no tener que sumarlo en la pantalla. */
  async reembolsosDe(id: string, requesterCompanyId: string | null | undefined) {
    const r = await prisma.reservation.findUnique({
      where: { id },
      select: { companyId: true, refunds: true, paidAmount: true, pricing: true },
    });
    if (!r) throw NotFound('Reserva no encontrada');
    if (!requesterCompanyId || r.companyId !== requesterCompanyId)
      throw Forbidden('No tienes permiso sobre esta reserva');

    return {
      reembolsos: r.refunds,
      totalReembolsado: totalReembolsado(r.refunds),
      cobrado: Number(r.paidAmount) || 0,
      vendido: Number((r.pricing as Record<string, unknown>)?.total ?? 0),
    };
  },

  /**
   * Mover una reserva de fecha.
   *
   * TR-39. La fecha nueva se comprueba contra el aforo de ESE dia: mover una
   * reserva es ocupar un sitio nuevo, y hasta ahora se podia mover a un
   * sabado lleno sin que nada avisara. La fecha vieja se libera sola, porque
   * el aforo se cuenta sobre `reservationDate` y no hay contadores que
   * actualizar: la reserva ya no esta en ese dia.
   *
   * TR-08. El estado no se toca: una reserva movida sigue siendo la misma y
   * sigue igual de viva. Lo que cambia es la fecha, y que queda constancia de
   * la mudanza en `rescheduling`, en el historial y en el aviso al comensal.
   */
  async reschedule(
    id: string,
    requesterCompanyId: string | null | undefined,
    input: RescheduleInput,
    actor?: Actor,
    opts?: { comoCanal?: boolean },
  ) {
    const existing = await assertCanManage(id, requesterCompanyId, opts);

    const datos = await prisma.reservation.findUnique({
      where: { id },
      select: {
        companyId: true,
        experienceId: true,
        participants: true,
        locationId: true,
        duration: true,
        changes: true,
      },
    });
    if (!datos) throw NotFound('Reserva no encontrada');

    const nuevaFecha = new Date(input.newDate);
    const ajustes = await ajustesDeOperacion(datos.companyId);

    // TR-42. Y que no choque con otra cosa en la misma sede a esa hora. En
    // sedes distintas solo se avisa, y quien reagenda decide con
    // `permitirSolape`, igual que al crear.
    await comprobarSimultaneidad(
      {
        companyId: datos.companyId,
        experienceId: datos.experienceId,
        locationId: datos.locationId,
        fecha: nuevaFecha,
        duracionMin: datos.duration,
      },
      { permitirSolape: input.permitirSolape === true },
    );

    const reprogramada = await conCupoApartado(
      datos.experienceId,
      nuevaFecha,
      datos.participants,
      ajustes,
      (tx) =>
        tx.reservation.update({
          where: { id },
          data: {
            reservationDate: nuevaFecha,
            rescheduling: {
              originalDate: existing.reservationDate.toISOString(),
              newDate: input.newDate,
              reason: input.reason,
              requestedBy: input.requestedBy,
            } as Prisma.InputJsonValue,
            changes: [
              ...(datos.changes as Prisma.InputJsonValue[]),
              cambio(
                'fecha',
                existing.reservationDate,
                nuevaFecha,
                actor,
                input.reason,
              ) as unknown as Prisma.InputJsonValue,
            ],
          },
          include: fullInclude,
        }),
      // La reserva que se mueve no cuenta contra si misma: dentro del mismo
      // dia, sus plazas estarian contadas dos veces.
      id,
      datos.locationId,
    );

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

      completed: items.filter((r) => r.status === 'COMPLETED').length,
      cancelled: items.filter((r) => r.status === 'CANCELLED').length,
      noShow: items.filter((r) => r.status === 'NO_SHOW').length,

      totalRevenue,
      totalParticipants,
      averageParticipants: items.length ? totalParticipants / items.length : 0,
      pendingPayments: items.filter((r) => r.paymentStatus === 'PENDING').length,
      paidReservations: items.filter((r) => r.paymentStatus === 'PAID').length,
    };
  },
};
