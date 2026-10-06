// Catalogo digital publico.
//
// Es la pagina que un anfitrion comparte con sus clientes, asi que NO lleva
// autenticacion: quien reserva no tiene cuenta. Por eso la proyeccion es
// explicita — se enumera lo que sale, en vez de excluir lo que no debe —
// para que añadir un campo interno al modelo no lo publique sin querer.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { validate } from '../../middleware/validate.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import { prisma } from '../../config/prisma.js';
import { getPlatformSettings } from '../../lib/commissions.js';
import { dondeEstaElCatalogo } from '../companies/companies.service.js';
import { empresasQuePuedenCobrar, pasarelaDe } from '../../lib/pasarela.js';
import { enlaceService } from '../opportunities/opportunities.enlace.js';
import { recalcularNotaDeExperiencia } from '../../lib/calificacion.js';

export const publicRouter = Router();

const paramsSchema = z.object({ slug: z.string().min(1) });

/** Lo que necesita el motor de reservas para funcionar de principio a fin. */
const experienciaPublica = {
  company: { select: { id: true, companyName: true } },
  locations: {
    where: { deletedAt: null },
    // El comensal necesita saber donde queda: el mapa del catalogo se pinta
    // con esto. La capacidad y el resto de la operacion no salen.
    // Las fotos y el video son material comercial: existen justamente para
    // que el comensal vea el sitio antes de reservar.
    select: {
      id: true,
      name: true,
      isMain: true,
      address: true,
      latitude: true,
      longitude: true,
      photos: true,
      videoUrl: true,
    },
  },
  // La carta. Solo los menus vivos: uno desactivado o borrado no debe
  // seguir enseñandose a quien mira el catalogo.
  menus: {
    where: { deletedAt: null, isActive: true },
    select: { id: true, name: true, description: true, sections: true },
  },
  // Las condiciones de cada sede: la misma experiencia puede estar en el local
  // del centro como abierta —cupos que se compran sueltos— y en la finca como
  // privada, con otro aforo, otro precio y otra anticipacion. Sin esto el
  // motor de reservas ofreceria en las dos las condiciones de la primera.
  //
  // `notes` NO sale: son apuntes internos del anfitrion —"la cocina de esta
  // sede no tiene horno"— y no material comercial.
  locationListings: {
    where: { deletedAt: null, isPublished: true },
    select: {
      locationId: true,
      kind: true,
      minCapacity: true,
      basePrice: true,
      prepTime: true,
      cleanupTime: true,
      minimumNotice: true,
    },
  },
  // Sin esto el paso de fecha y hora no tiene horarios que ofrecer y el
  // cliente no puede completar la reserva.
  availabilities: {
    where: { deletedAt: null, isActive: true },
    select: {
      id: true,
      name: true,
      weeklySchedule: true,

      blockedDates: true,
      locationId: true,
      // TR-35. Hasta cuando se repite este horario. Sin esto el catalogo
      // ofreceria sabados de 2031 que nadie decidio abrir.
      validFrom: true,
      validUntil: true,
    },
  },
} as const;

/**
 * Quita del catalogo las sedes donde la experiencia no se esta ofreciendo.
 *
 * Retirar una experiencia de una sede sin borrar sus condiciones ni tocar las
 * otras es justo para lo que esta `isPublished`, y si la sede siguiera
 * saliendo en el catalogo no habria servido de nada: el comensal la elegiria y
 * la reserva se crearia igual.
 *
 * Se filtra aqui y no en la consulta porque la condicion mira la ficha del par
 * experiencia-sede, y el `include` de las sedes no sabe de que experiencia
 * cuelga.
 */
async function soloSedesOfrecidas<T extends { id: string; locations: { id: string }[] }>(
  experiences: T[],
): Promise<T[]> {
  if (experiences.length === 0) return experiences;

  const retiradas = await prisma.locationListing.findMany({
    where: {
      deletedAt: null,
      isPublished: false,
      experienceId: { in: experiences.map((e) => e.id) },
    },
    select: { experienceId: true, locationId: true },
  });
  if (retiradas.length === 0) return experiences;

  const fuera = new Set(retiradas.map((r) => `${r.experienceId}:${r.locationId}`));
  return experiences.map((e) => ({
    ...e,
    locations: e.locations.filter((l) => !fuera.has(`${e.id}:${l.id}`)),
  }));
}

/**
 * TR-21. La agenda propia del anfitrion, para el catalogo.
 *
 * Vale para las experiencias que no tienen horario propio ni sede: un cocinero
 * que va a casa del cliente no tiene donde colgar su calendario, y sin esto su
 * catalogo ofrecia las horas por defecto —de ocho a ocho, todos los dias—, que
 * no son las suyas.
 */
const agendaPropia = {
  where: { deletedAt: null, isActive: true, locationId: null, experiences: { none: {} } },
  select: {
    id: true,
    name: true,
    weeklySchedule: true,

    blockedDates: true,
    locationId: true,
    validFrom: true,
    validUntil: true,
  },
} as const;

/** Solo lo que necesita pintar el catalogo. Nada de documentos ni finanzas. */
const companiaPublica = {
  id: true,
  companyName: true,
  slug: true,
  logo: true,
  tagline: true,
  // El catalogo se pinta con los colores del anfitrion: sin esto la pagina
  // publica seguiria saliendo con los de la plataforma.
  brandPrimary: true,
  brandSecondary: true,
  coverType: true,
  coverImages: true,
  coverVideo: true,
  description: true,
  companyEmail: true,
  companyPhone: true,
  website: true,
  // Se lee para resolver si hay que pagar, pero no sale en la respuesta: su
  // null significa "hereda de la plataforma", y publicarlo tal cual invita a
  // leerlo como un "no".
  requirePayment: true,
  // TR-21. Su agenda propia, para las experiencias que no tienen horario ni
  // sede. Sin esto el catalogo de un cocinero a domicilio ofrecia las horas
  // por defecto, que no son las suyas.
  ownAvailabilities: agendaPropia,
} as const;

/**
 * Politica de insercion en iframe. La consulta el proxy del front en cada
 * carga de /book/*, asi que devuelve lo minimo y nada mas.
 */
publicRouter.get(
  '/embed-policy/:slug',
  validate(paramsSchema, 'params'),
  async (req: Request, res: Response) => {
    const { slug } = req.params as unknown as z.infer<typeof paramsSchema>;
    const company = await prisma.company.findFirst({
      where: dondeEstaElCatalogo(slug),
      select: { embedDomains: true },
    });
    // Empresa inexistente: sin politica. La pagina ya devuelve su propio
    // error, aqui no hace falta distinguir.
    res.json({ data: { domains: company?.embedDomains ?? [] } });
  },
);

/**
 * Catalogo de un revendedor.
 *
 * A diferencia del catalogo de un anfitrion, aqui salen las experiencias
 * ACTIVAS de toda la plataforma: el revendedor no publica las suyas, vende
 * las de otros. Las reservas que entren por aqui llevan su atribucion y le
 * generan comision.
 */
publicRouter.get(
  '/reseller/:slug',
  validate(paramsSchema, 'params'),
  async (req: Request, res: Response) => {
    const { slug } = req.params as unknown as z.infer<typeof paramsSchema>;

    const reseller = await prisma.company.findFirst({
      where: dondeEstaElCatalogo(slug),
      select: companiaPublica,
    });
    if (!reseller) throw NotFound('Catálogo no encontrado');

    const experiences = await prisma.experience.findMany({
      // Sin filtro de empresa: es el catalogo de todo lo vendible.
      where: { deletedAt: null, status: 'ACTIVE', company: { deletedAt: null, isActive: true } },
      include: experienciaPublica,
      orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
    }).then(soloSedesOfrecidas);

    // Aqui salen experiencias de varias empresas, y desde que cada anfitrion
    // puede cobrar con su pasarela la respuesta ya no es una sola para todas.
    // Solo se promete cobro en linea si se puede cobrar de TODAS: decirle al
    // comensal "pagas ahora" y despues no cobrarle es peor que no prometerlo.
    const puedenCobrar = await empresasQuePuedenCobrar([
      ...new Set(experiences.map((e) => e.companyId)),
    ]);
    const paymentsEnabled =
      experiences.length > 0 && experiences.every((e) => puedenCobrar.has(e.companyId));

    res.json({ data: { company: reseller, experiences, paymentsEnabled, esReseller: true } });
  },
);

publicRouter.get(
  '/catalog/:slug',
  validate(paramsSchema, 'params'),
  async (req: Request, res: Response) => {
    const { slug } = req.params as unknown as z.infer<typeof paramsSchema>;

    // Acepta el slug actual, cualquiera que la empresa tuvo antes, o su id:
    // todos esos formatos estan circulando en enlaces ya compartidos.
    const company = await prisma.company.findFirst({
      where: dondeEstaElCatalogo(slug),
      select: companiaPublica,
    });
    if (!company) throw NotFound('Catálogo no encontrado');

    const experiences = await prisma.experience.findMany({
      // Solo las publicadas: un borrador no debe verse desde fuera.
      where: { companyId: company.id, deletedAt: null, status: 'ACTIVE' },
      include: experienciaPublica,
      orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
    }).then(soloSedesOfrecidas);

    // Solo si se cobra en linea. El resumen previo a confirmar cambia el
    // texto segun esto: prometer "pagas ahora" con la pasarela apagada deja
    // al cliente esperando un cobro que nunca llega.
    //
    // Puede ser la pasarela propia del anfitrion o la de la plataforma; al
    // comensal le da igual cual sea, solo necesita saber si va a pagar ahora.
    const ajustes = await getPlatformSettings();
    const paymentsEnabled = (await pasarelaDe(company.id)) !== null;

    // Si hay que pagar para que la reserva valga. Lo decide la empresa; si no
    // dice nada, el valor por defecto de la plataforma. Sin pasarela activa
    // no puede exigirse: dejaria el catalogo sin forma de reservar.
    const { requirePayment, ...empresaPublica } = company;
    const paymentRequired =
      paymentsEnabled && (requirePayment ?? ajustes.requirePaymentDefault ?? false);

    res.json({
      data: { company: empresaPublica, experiences, paymentsEnabled, paymentRequired },
    });
  },
);

/**
 * Estado de una reserva, para la pagina a la que vuelve el cliente desde la
 * pasarela.
 *
 * Publico porque quien paga no tiene cuenta: llega de vuelta de Wompi con
 * su numero de reserva y nada mas.
 *
 * Devuelve SOLO el estado: ni cliente, ni importe, ni que reservo. El numero
 * de reserva no es un secreto fuerte —tres caracteres al azar sobre una
 * marca de tiempo— asi que lo que cuelgue de el tiene que ser lo minimo
 * imprescindible para no mentirle a quien acaba de pagar. El limite de
 * peticiones del catalogo publico aplica igual: /public va detras de el.
 */
publicRouter.get(
  '/reservations/:reservationNumber/status',
  validate(z.object({ reservationNumber: z.string().min(1) }), 'params'),
  async (req: Request, res: Response) => {
    const { reservationNumber } = req.params as { reservationNumber: string };

    const reserva = await prisma.reservation.findUnique({
      where: { reservationNumber },
      select: { reservationNumber: true, status: true, paymentStatus: true },
    });
    if (!reserva) throw NotFound('Reserva no encontrada');

    res.json({ data: reserva });
  },
);

/**
 * CRM-33. Lo que ya sabemos de quien abre su enlace de reserva.
 *
 * Publico y sin sesion, como el resto del catalogo: lo abre el cliente desde
 * un WhatsApp. Lo que protege estos datos es el token —24 bytes al azar— y no
 * un login, y por eso la respuesta se limita a lo que esa misma persona
 * escribiria en el formulario: su nombre, su correo y su telefono. Nada del
 * negocio del anfitrion.
 *
 * El servicio devuelve 404 si la oportunidad ya se cerro: un enlace viejo
 * reenviado no puede seguir revelando datos de nadie.
 */
publicRouter.get(
  '/solicitud/:token',
  validate(z.object({ token: z.string().min(16).max(64) }), 'params'),
  async (req: Request, res: Response) => {
    const { token } = req.params as { token: string };
    res.json({ data: await enlaceService.datosDelEnlace(token) });
  },
);

// ─── TR-24. Calificar, sin cuenta ─────────────────────────────────────────
//
// Quien cena no tiene por que registrarse para decir si le gusto. El enlace
// llega por correo con un token opaco y solo se puede usar una vez: si se
// reenvia a un grupo, el segundo que entre ya no puede cambiar la nota del
// primero.

const estrellaSchema = z.number().int().min(1).max(5);

const calificarSchema = z.object({
  general: estrellaSchema,
  servicio: estrellaSchema,
  ubicacion: estrellaSchema,
  comida: estrellaSchema,
});

/** Que es lo que se va a calificar. Lo minimo para pintar la pagina. */
publicRouter.get(
  '/calificar/:token',
  validate(z.object({ token: z.string().min(16).max(80) }), 'params'),
  async (req: Request, res: Response) => {
    const { token } = req.params as { token: string };
    const r = await prisma.reservation.findUnique({
      where: { ratingToken: token },
      select: {
        reservationNumber: true,
        reservationDate: true,
        ratings: true,
        experience: { select: { title: true } },
        company: { select: { companyName: true, logo: true, brandPrimary: true } },
      },
    });
    if (!r) throw NotFound('Ese enlace no es válido');

    res.json({
      data: {
        experiencia: r.experience?.title ?? null,
        fecha: r.reservationDate,
        empresa: r.company?.companyName ?? null,
        logo: r.company?.logo ?? null,
        colorMarca: r.company?.brandPrimary ?? null,
        // Si ya califico, la pagina lo enseña en vez de pedirlo otra vez.
        yaCalificada: r.ratings !== null,
      },
    });
  },
);

publicRouter.post(
  '/calificar/:token',
  validate(z.object({ token: z.string().min(16).max(80) }), 'params'),
  validate(calificarSchema),
  async (req: Request, res: Response) => {
    const { token } = req.params as { token: string };
    const notas = req.body as z.infer<typeof calificarSchema>;

    const r = await prisma.reservation.findUnique({
      where: { ratingToken: token },
      select: { id: true, experienceId: true, ratings: true },
    });
    if (!r) throw NotFound('Ese enlace no es válido');
    if (r.ratings !== null) {
      throw BadRequest('Esta experiencia ya fue calificada. Gracias.');
    }

    await prisma.reservation.update({
      where: { id: r.id },
      data: {
        ratings: { ...notas, fecha: new Date().toISOString() },
        // El token se gasta: el enlace vale una vez.
        ratingToken: null,
      },
    });

    await recalcularNotaDeExperiencia(r.experienceId);
    res.json({ data: { gracias: true } });
  },
);
