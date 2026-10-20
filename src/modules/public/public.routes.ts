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
import { env } from '../../config/env.js';
import { limiteChatPublico } from '../../middleware/rate-limit.js';
import { agenteService, CANAL_WEB } from '../agente/agente.service.js';

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
      // La URL propia de la publicacion: el revendedor arma con ella los
      // enlaces que comparte.
      slug: true,
      kind: true,
      minCapacity: true,
      basePrice: true,
      prepTime: true,
      cleanupTime: true,
      minimumNotice: true,
      // Las ciudades donde presta una publicacion a domicilio.
      cities: true,
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

      dateOverrides: true,
      locationId: true,
      // TR-35. Hasta cuando se repite este horario. Sin esto el catalogo
      // ofreceria sabados de 2031 que nadie decidio abrir.
      validFrom: true,
      validUntil: true,
    },
  },
} as const;

/**
 * Deja fuera del catalogo lo que esta en pausa.
 *
 * Pausar es de la PUBLICACION: la misma pieza puede seguir vendiendose en el
 * local mientras la finca descansa. Asi que primero se quitan las sedes
 * pausadas, y despues la experiencia entera si no le queda ninguna viva —o si
 * es a domicilio y su publicacion, la que no tiene sede, esta pausada—.
 *
 * Sin lo segundo, una experiencia con todas sus sedes en pausa seguia saliendo
 * en el catalogo sin sedes que elegir, y el motor de reservas la dejaba
 * comprar igual porque no habia sede que exigir.
 *
 * Se filtra aqui y no en la consulta porque la condicion mira la ficha del par
 * experiencia-sede, y el `include` de las sedes no sabe de que experiencia
 * cuelga.
 */
async function soloLoQueSeOfrece<
  T extends {
    id: string;
    atHome: boolean;
    locations: { id: string }[];
    locationListings: Array<{ locationId: string | null; cities: string[] }>;
  },
>(experiences: T[]): Promise<T[]> {
  if (experiences.length === 0) return experiences;

  const pausadas = await prisma.locationListing.findMany({
    where: {
      deletedAt: null,
      isPublished: false,
      experienceId: { in: experiences.map((e) => e.id) },
    },
    select: { experienceId: true, locationId: true },
  });

  const fuera = new Set(
    pausadas.filter((r) => r.locationId).map((r) => `${r.experienceId}:${r.locationId}`),
  );
  const domicilioEnPausa = new Set(
    pausadas.filter((r) => !r.locationId).map((r) => r.experienceId),
  );

  return experiences
    .map((e) => ({
      ...e,
      // Si tenia sedes antes de filtrar: una experiencia de lugar propio
      // —`presentialLocation`, sin sede registrada— nunca tuvo ninguna, y
      // dejarla fuera por eso la borraria del catalogo sin que nadie la
      // hubiera pausado.
      teniaSedes: e.locations.length > 0,
      locations: e.locations.filter((l) => !fuera.has(`${e.id}:${l.id}`)),
    }))
    .filter((e) => (e.teniaSedes ? e.locations.length > 0 : !domicilioEnPausa.has(e.id)))
    // A domicilio sin ciudades no se vende: no hay zona que atender, y la
    // ficha tampoco se deja activar asi. Esto cubre lo que quedara en pie si
    // alguien borra las zonas de una pieza que ya estaba activa.
    .filter(
      (e) =>
        !e.atHome ||
        e.locationListings.some((l) => l.locationId === null && l.cities.length > 0),
    )
    .map(({ teniaSedes: _, ...e }) => e as unknown as T);
}

/**
 * Suma los horarios de sede a lo que ve el motor de reservas.
 *
 * El API acepta una reserva segun la cascada de `horariosQueAplican`, que
 * incluye el horario DE LA SEDE —el que no es de ninguna experiencia—. El
 * catalogo solo mandaba los atados a la experiencia, asi que quien tenia su
 * calendario en la sede veia las horas por defecto y el checkout rechazaba lo
 * que el motor ofrecia.
 *
 * Solo se añaden para las sedes donde la experiencia no tiene horario propio
 * —ni de esa sede ni sin sede—, que es cuando la cascada llega a ese nivel.
 */
async function conHorariosDeSede<
  T extends {
    id: string;
    locations: { id: string }[];
    availabilities: Array<{ locationId: string | null }>;
  },
>(experiences: T[]): Promise<T[]> {
  const sedes = [...new Set(experiences.flatMap((e) => e.locations.map((l) => l.id)))];
  if (sedes.length === 0) return experiences;

  const hoy = new Date();
  hoy.setHours(0, 0, 0, 0);
  const deSede = await prisma.availability.findMany({
    where: {
      deletedAt: null,
      isActive: true,
      locationId: { in: sedes },
      experiences: { none: {} },
      OR: [{ validUntil: null }, { validUntil: { gte: hoy } }],
    },
    select: {
      id: true,
      name: true,
      weeklySchedule: true,
      dateOverrides: true,
      locationId: true,
      validFrom: true,
      validUntil: true,
    },
  });
  if (deSede.length === 0) return experiences;

  return experiences.map((e) => {
    if (e.availabilities.some((a) => a.locationId === null)) return e;
    const propias = new Set(e.availabilities.map((a) => a.locationId));
    const extra = deSede.filter(
      (h) => h.locationId && !propias.has(h.locationId) && e.locations.some((l) => l.id === h.locationId),
    );
    return extra.length > 0 ? { ...e, availabilities: [...e.availabilities, ...extra] } : e;
  });
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

    dateOverrides: true,
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
    }).then(soloLoQueSeOfrece).then(conHorariosDeSede);

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
    }).then(soloLoQueSeOfrece).then(conHorariosDeSede);

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
      data: {
        company: empresaPublica,
        experiences,
        paymentsEnabled,
        paymentRequired,
        // Solo el nombre: el catalogo necesita saber si ofrece el chat y con
        // quien se habla, nada de la configuracion del agente.
        agente: await agenteDelChat(company.id),
      },
    });
  },
);

// ─── Una publicacion con su propia URL ──────────────────────────────────────
//
// /book/<empresa>/<publicacion> y /r/<revendedor>/<publicacion>. Una
// publicacion es una experiencia en una sede (o a domicilio); la pagina enseña
// solo esa, ya con la sede puesta, para compartirla suelta por redes o por
// WhatsApp sin arrastrar el resto del catalogo.

const paramsPublicacion = z.object({
  slug: z.string().min(1),
  pub: z.string().min(1).max(160),
});

/**
 * La experiencia de una publicacion, lista para el motor de reservas.
 *
 * Solo sale si se puede vender ahora: publicacion viva y no pausada, experiencia
 * activa y empresa en pie. Una pausada responde 404 como si no existiera, que
 * es lo que ve quien abre un enlace viejo.
 *
 * `companyId` fija el anfitrion en su catalogo; en el de un revendedor va nulo,
 * porque ahi la publicacion puede ser de cualquiera.
 */
async function experienciaDeLaPublicacion(pub: string, companyId: string | null) {
  const fila = await prisma.locationListing.findFirst({
    where: {
      slug: pub,
      deletedAt: null,
      isPublished: true,
      experience: {
        deletedAt: null,
        status: 'ACTIVE',
        ...(companyId ? { companyId } : {}),
        company: { deletedAt: null, isActive: true },
      },
    },
    select: { slug: true, experienceId: true, locationId: true },
  });
  if (!fila) throw NotFound('Esta publicación no está disponible');

  const [experiencia] = await prisma.experience
    .findMany({ where: { id: fila.experienceId }, include: experienciaPublica })
    .then(soloLoQueSeOfrece)
    .then(conHorariosDeSede);
  if (!experiencia) throw NotFound('Esta publicación no está disponible');

  // Solo su sede: con las demas a la vista la pagina volveria a preguntar en
  // cual, que es justo lo que el enlace ya respondio.
  const soloEsta = fila.locationId
    ? {
        ...experiencia,
        locations: experiencia.locations.filter((l) => l.id === fila.locationId),
        locationListings: experiencia.locationListings.filter(
          (l) => l.locationId === fila.locationId,
        ),
      }
    : experiencia;

  return {
    experiencia: soloEsta,
    publicacion: { slug: fila.slug, locationId: fila.locationId, experienceId: fila.experienceId },
  };
}

publicRouter.get(
  '/catalog/:slug/publicacion/:pub',
  validate(paramsPublicacion, 'params'),
  async (req: Request, res: Response) => {
    const { slug, pub } = req.params as unknown as z.infer<typeof paramsPublicacion>;

    const company = await prisma.company.findFirst({
      where: dondeEstaElCatalogo(slug),
      select: companiaPublica,
    });
    if (!company) throw NotFound('Catálogo no encontrado');

    const { experiencia, publicacion } = await experienciaDeLaPublicacion(pub, company.id);

    // Lo mismo que el catalogo completo: si se cobra en linea y si es obligado.
    const ajustes = await getPlatformSettings();
    const paymentsEnabled = (await pasarelaDe(company.id)) !== null;
    const { requirePayment, ...empresaPublica } = company;
    const paymentRequired =
      paymentsEnabled && (requirePayment ?? ajustes.requirePaymentDefault ?? false);

    res.json({
      data: {
        company: empresaPublica,
        experiences: [experiencia],
        paymentsEnabled,
        paymentRequired,
        agente: await agenteDelChat(company.id),
        publicacion,
      },
    });
  },
);

publicRouter.get(
  '/reseller/:slug/publicacion/:pub',
  validate(paramsPublicacion, 'params'),
  async (req: Request, res: Response) => {
    const { slug, pub } = req.params as unknown as z.infer<typeof paramsPublicacion>;

    const reseller = await prisma.company.findFirst({
      where: dondeEstaElCatalogo(slug),
      select: companiaPublica,
    });
    if (!reseller) throw NotFound('Catálogo no encontrado');

    const { experiencia, publicacion } = await experienciaDeLaPublicacion(pub, null);

    // El cobro lo decide el anfitrion dueño de la experiencia, no el revendedor.
    const puedenCobrar = await empresasQuePuedenCobrar([experiencia.companyId]);
    const paymentsEnabled = puedenCobrar.has(experiencia.companyId);

    res.json({
      data: {
        company: reseller,
        experiences: [experiencia],
        paymentsEnabled,
        esReseller: true,
        publicacion,
      },
    });
  },
);

/**
 * El agente que atiende el chat del catalogo, o null si no hay chat.
 *
 * Hay chat solo si el anfitrion lo pidio (mostrarEnCatalogo), el agente esta
 * encendido y el servidor tiene con que llamar al modelo. Las tres: ofrecer
 * un chat que luego no contesta es peor que no ofrecerlo.
 */
async function agenteDelChat(companyId: string): Promise<{ nombre: string } | null> {
  if (!env.OPENAI_API_KEY) return null;
  const a = await prisma.aiAgent.findUnique({
    where: { companyId },
    select: { enabled: true, mostrarEnCatalogo: true, nombre: true },
  });
  return a?.enabled && a.mostrarEnCatalogo ? { nombre: a.nombre } : null;
}

// El id de sesion lo genera el navegador del visitante y es lo unico que
// identifica su hilo: tiene que ser largo y aleatorio, no adivinable.
const sesionDelChat = z.string().regex(/^[A-Za-z0-9_-]{16,64}$/, 'Sesión inválida');

/** Un mensaje al agente desde el catalogo. Sin sesion: el visitante no tiene cuenta. */
publicRouter.post(
  '/agente/:slug/mensaje',
  limiteChatPublico,
  validate(paramsSchema, 'params'),
  validate(z.object({ sessionId: sesionDelChat, texto: z.string().trim().min(1).max(600) })),
  async (req: Request, res: Response) => {
    const { slug } = req.params as unknown as z.infer<typeof paramsSchema>;
    const { sessionId, texto } = req.body as { sessionId: string; texto: string };

    const company = await prisma.company.findFirst({
      where: dondeEstaElCatalogo(slug),
      select: { id: true },
    });
    if (!company || !(await agenteDelChat(company.id))) {
      throw NotFound('Este catálogo no tiene chat');
    }

    const r = await agenteService.responder({
      companyId: company.id,
      telefono: `web:${sessionId}`,
      nombrePerfil: null,
      texto,
      canal: CANAL_WEB,
    });
    // El motivo es para el panel del anfitrion; al visitante solo le toca
    // saber si hubo respuesta. Un hilo tomado por el anfitrion tampoco debe
    // sonar a error: el mensaje queda guardado y alguien lo va a leer.
    res.json({ data: { respuesta: r.respuesta } });
  },
);

/** El hilo del visitante, para no perderlo al recargar. */
publicRouter.get(
  '/agente/:slug/conversacion/:sessionId',
  validate(z.object({ slug: z.string().min(1), sessionId: sesionDelChat }), 'params'),
  async (req: Request, res: Response) => {
    const { slug, sessionId } = req.params as { slug: string; sessionId: string };
    const company = await prisma.company.findFirst({
      where: dondeEstaElCatalogo(slug),
      select: { id: true },
    });
    if (!company || !(await agenteDelChat(company.id))) {
      throw NotFound('Este catálogo no tiene chat');
    }
    res.json({ data: { mensajes: await agenteService.historialWeb(company.id, sessionId) } });
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
      select: {
        reservationNumber: true,
        status: true,
        paymentStatus: true,
        company: { select: { brandPrimary: true } },
      },
    });
    if (!reserva) throw NotFound('Reserva no encontrada');

    // El color de marca no identifica a nadie y deja la pagina de retorno con
    // el aspecto del catalogo desde el que se pago.
    const { company, ...estado } = reserva;
    res.json({ data: { ...estado, colorMarca: company?.brandPrimary ?? null } });
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
