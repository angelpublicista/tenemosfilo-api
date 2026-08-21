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

export const publicRouter = Router();

const paramsSchema = z.object({ slug: z.string().min(1) });

/** Solo lo que necesita pintar el catalogo. Nada de documentos ni finanzas. */
const companiaPublica = {
  id: true,
  companyName: true,
  slug: true,
  logo: true,
  description: true,
  companyEmail: true,
  companyPhone: true,
  website: true,
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
      where: { deletedAt: null, OR: [{ slug }, { id: slug }] },
      select: { embedDomains: true },
    });
    // Empresa inexistente: sin politica. La pagina ya devuelve su propio
    // error, aqui no hace falta distinguir.
    res.json({ data: { domains: company?.embedDomains ?? [] } });
  },
);

publicRouter.get(
  '/catalog/:slug',
  validate(paramsSchema, 'params'),
  async (req: Request, res: Response) => {
    const { slug } = req.params as unknown as z.infer<typeof paramsSchema>;

    // Acepta slug o id: los enlaces compartidos antes del cambio llevan el
    // id y deben seguir funcionando.
    const company = await prisma.company.findFirst({
      where: { deletedAt: null, OR: [{ slug }, { id: slug }] },
      select: companiaPublica,
    });
    if (!company) throw NotFound('Catálogo no encontrado');

    const experiences = await prisma.experience.findMany({
      // Solo las publicadas: un borrador no debe verse desde fuera.
      where: { companyId: company.id, deletedAt: null, status: 'ACTIVE' },
      include: {
        company: { select: { id: true, companyName: true } },
        locations: {
          where: { deletedAt: null },
          select: { id: true, name: true, isMain: true, address: true },
        },
        // Sin esto el paso de fecha y hora no tiene horarios que ofrecer y
        // el cliente no puede completar la reserva.
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
      },
      orderBy: [{ isFeatured: 'desc' }, { createdAt: 'desc' }],
    });

    // Solo si se cobra en linea. El resumen previo a confirmar cambia el
    // texto segun esto: prometer "pagas ahora" con la pasarela apagada deja
    // al cliente esperando un cobro que nunca llega.
    const ajustes = await getPlatformSettings();
    const paymentsEnabled = Boolean(
      ajustes.wompiEnabled && ajustes.wompiPublicKey && ajustes.wompiIntegritySecret,
    );

    res.json({ data: { company, experiences, paymentsEnabled } });
  },
);
