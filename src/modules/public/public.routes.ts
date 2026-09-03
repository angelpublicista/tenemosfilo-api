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
import { NotFound } from '../../lib/errors.js';
import { prisma } from '../../config/prisma.js';
import { getPlatformSettings } from '../../lib/commissions.js';
import { dondeEstaElCatalogo } from '../companies/companies.service.js';

export const publicRouter = Router();

const paramsSchema = z.object({ slug: z.string().min(1) });

/** Lo que necesita el motor de reservas para funcionar de principio a fin. */
const experienciaPublica = {
  company: { select: { id: true, companyName: true } },
  locations: {
    where: { deletedAt: null },
    select: { id: true, name: true, isMain: true, address: true },
  },
  // Sin esto el paso de fecha y hora no tiene horarios que ofrecer y el
  // cliente no puede completar la reserva.
  availabilities: {
    where: { deletedAt: null, isActive: true },
    select: {
      id: true,
      name: true,
      weeklySchedule: true,
      bufferTime: true,
      minimumNotice: true,
      blockedDates: true,
      locationId: true,
    },
  },
} as const;

/** Solo lo que necesita pintar el catalogo. Nada de documentos ni finanzas. */
const companiaPublica = {
  id: true,
  companyName: true,
  slug: true,
  logo: true,
  tagline: true,
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
    });

    const ajustes = await getPlatformSettings();
    const paymentsEnabled = Boolean(
      ajustes.wompiEnabled && ajustes.wompiPublicKey && ajustes.wompiIntegritySecret,
    );

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
    });

    // Solo si se cobra en linea. El resumen previo a confirmar cambia el
    // texto segun esto: prometer "pagas ahora" con la pasarela apagada deja
    // al cliente esperando un cobro que nunca llega.
    const ajustes = await getPlatformSettings();
    const paymentsEnabled = Boolean(
      ajustes.wompiEnabled && ajustes.wompiPublicKey && ajustes.wompiIntegritySecret,
    );

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
