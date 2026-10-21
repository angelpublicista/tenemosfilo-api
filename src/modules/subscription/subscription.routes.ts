import { Router } from 'express';
import type { Request, Response } from 'express';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { requireAuth, requireHumanAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import { prisma } from '../../config/prisma.js';
import {
  PREFIJO_DE_SUSCRIPCION,
  aplicarPago,
  crearCheckoutDeSuscripcion,
  estadoDeSuscripcion,
  olvidarSuscripciones,
} from '../../lib/suscripcion.js';

export const subscriptionRouter = Router();

subscriptionRouter.use(requireAuth, requireHumanAuth);

// ─── Lo propio ───────────────────────────────────────────────────────────
// La empresa sale de la sesion, nunca de un parametro. Estas rutas siguen
// abiertas con la suscripcion vencida: son justo las que sirven para renovar.

function empresaDeLaSesion(req: Request): string {
  const companyId = req.user?.companyId;
  if (!companyId) throw BadRequest('Selecciona una empresa para ver su suscripción');
  return companyId;
}

/** Estado actual y los ultimos pagos. */
subscriptionRouter.get('/', async (req: Request, res: Response) => {
  const companyId = empresaDeLaSesion(req);
  const [estado, pagos] = await Promise.all([
    estadoDeSuscripcion(companyId),
    prisma.subscriptionPayment.findMany({
      where: { companyId, status: 'PAID' },
      orderBy: { paidAt: 'desc' },
      take: 12,
      select: {
        id: true,
        amount: true,
        baseAmount: true,
        vatAmount: true,
        method: true,
        paidAt: true,
        periodStart: true,
        periodEnd: true,
      },
    }),
  ]);
  res.json({ data: { ...estado, pagos } });
});

/** El pago de otro mes, firmado y listo para llevar al anfitrion a Wompi. */
subscriptionRouter.post('/checkout', async (req: Request, res: Response) => {
  res.status(201).json({ data: await crearCheckoutDeSuscripcion(empresaDeLaSesion(req)) });
});

// ─── Lo de FILO ──────────────────────────────────────────────────────────
subscriptionRouter.use(requireRole('ADMIN'));

/** Cada anfitrion con su estado. */
subscriptionRouter.get('/admin', async (_req: Request, res: Response) => {
  const empresas = await prisma.company.findMany({
    where: { deletedAt: null, owner: { role: 'HOST' } },
    orderBy: { companyName: 'asc' },
    select: {
      id: true,
      companyName: true,
      subscriptionEndsAt: true,
      subscriptionExempt: true,
      owner: { select: { email: true } },
    },
  });
  const estados = await Promise.all(empresas.map((e) => estadoDeSuscripcion(e.id)));
  res.json({
    data: empresas.map((e, i) => ({
      companyId: e.id,
      companyName: e.companyName,
      ownerEmail: e.owner.email,
      endsAt: e.subscriptionEndsAt,
      exenta: e.subscriptionExempt,
      diasRestantes: estados[i]!.diasRestantes,
      // Con la suscripcion apagada nadie esta "bloqueado", pero igual hay que
      // ver quien estaria vencido el dia que se encienda.
      vencida: e.subscriptionEndsAt === null || e.subscriptionEndsAt.getTime() <= Date.now(),
      bloqueada: estados[i]!.bloqueada,
    })),
  });
});

const pagoManualSchema = z.object({
  /** Cuantos periodos de 30 dias se registran. Por defecto uno. */
  periodos: z.number().int().min(1).max(12).default(1),
  notes: z.string().trim().max(500).optional(),
});

/**
 * Registrar un pago que no paso por la pasarela: una transferencia, un
 * acuerdo. Suma los dias igual que uno en linea.
 */
subscriptionRouter.post(
  '/admin/:companyId/pago-manual',
  validate(z.object({ companyId: z.string().min(1) }), 'params'),
  validate(pagoManualSchema),
  async (req: Request, res: Response) => {
    const { companyId } = req.params as { companyId: string };
    const { periodos, notes } = req.body as z.infer<typeof pagoManualSchema>;

    const empresa = await prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { id: true },
    });
    if (!empresa) throw NotFound('La empresa indicada no existe');

    const { precio, iva, total } = await estadoDeSuscripcion(companyId);
    for (let i = 0; i < periodos; i += 1) {
      const pago = await prisma.subscriptionPayment.create({
        data: {
          companyId,
          reference: `${PREFIJO_DE_SUSCRIPCION}M${randomBytes(5).toString('hex').toUpperCase()}`,
          amount: total,
          baseAmount: precio,
          vatAmount: iva,
          method: 'MANUAL',
          notes: notes ?? null,
          createdByEmail: req.user!.email,
        },
      });
      await aplicarPago(pago.id);
    }
    res.status(201).json({ data: await estadoDeSuscripcion(companyId) });
  },
);

/** Exentar a una empresa de pagar, o quitarle la exencion. */
subscriptionRouter.patch(
  '/admin/:companyId/exenta',
  validate(z.object({ companyId: z.string().min(1) }), 'params'),
  validate(z.object({ exenta: z.boolean() })),
  async (req: Request, res: Response) => {
    const { companyId } = req.params as { companyId: string };
    const { exenta } = req.body as { exenta: boolean };
    const empresa = await prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { id: true },
    });
    if (!empresa) throw NotFound('La empresa indicada no existe');

    await prisma.company.update({ where: { id: companyId }, data: { subscriptionExempt: exenta } });
    olvidarSuscripciones();
    res.json({ data: await estadoDeSuscripcion(companyId) });
  },
);

const vencimientoSchema = z.object({
  /** Null deja a la empresa sin suscripcion pagada. */
  endsAt: z.string().datetime().nullable(),
  /** Por que se cambia. Queda en el registro de actividad junto al cambio. */
  notes: z.string().trim().max(500).optional(),
});

/**
 * Corregir la fecha de vencimiento a mano.
 *
 * Para lo que un pago manual no resuelve: un pago extemporaneo que hay que
 * cubrir desde su fecha real, un error al registrar, un acuerdo. No crea un
 * pago ni suma dias: fija la fecha tal cual. El cambio queda en el registro de
 * actividad con el body, nota incluida.
 */
subscriptionRouter.patch(
  '/admin/:companyId/vencimiento',
  validate(z.object({ companyId: z.string().min(1) }), 'params'),
  validate(vencimientoSchema),
  async (req: Request, res: Response) => {
    const { companyId } = req.params as { companyId: string };
    const { endsAt } = req.body as z.infer<typeof vencimientoSchema>;
    const empresa = await prisma.company.findFirst({
      where: { id: companyId, deletedAt: null },
      select: { id: true },
    });
    if (!empresa) throw NotFound('La empresa indicada no existe');

    await prisma.company.update({
      where: { id: companyId },
      data: { subscriptionEndsAt: endsAt ? new Date(endsAt) : null },
    });
    olvidarSuscripciones();
    res.json({ data: await estadoDeSuscripcion(companyId) });
  },
);
