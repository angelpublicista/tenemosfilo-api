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
  avisarPagoDeSuscripcion,
  cancelarRenovacionAutomatica,
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

/** Dejar de renovar solo (Mercado Pago). Los dias ya pagados se conservan. */
subscriptionRouter.post('/renovacion/cancelar', async (req: Request, res: Response) => {
  const companyId = empresaDeLaSesion(req);
  await cancelarRenovacionAutomatica(companyId);
  res.json({ data: await estadoDeSuscripcion(companyId) });
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

/** Mes (AAAA-MM) de una fecha, en hora de Bogota (UTC-5 fijo). */
const mesDeBogota = (d: Date): string =>
  new Date(d.getTime() - 5 * 3_600_000).toISOString().slice(0, 7);

const estadisticasQuerySchema = z.object({
  /** Cuantos meses hacia atras, contando el actual. */
  meses: z.coerce.number().int().min(1).max(36).default(12),
});

/**
 * Lo vendido en suscripciones: ingresos por mes y por metodo de pago, y como
 * esta la cartera de anfitriones. Solo cuentan los pagos en PAID.
 */
subscriptionRouter.get(
  '/admin/estadisticas',
  validate(estadisticasQuerySchema, 'query'),
  async (req: Request, res: Response) => {
    const { meses } = req.query as unknown as z.infer<typeof estadisticasQuerySchema>;

    const ahora = new Date();
    const [y, m] = mesDeBogota(ahora).split('-').map(Number) as [number, number];
    const claves: string[] = [];
    for (let i = meses - 1; i >= 0; i -= 1) {
      const d = new Date(Date.UTC(y, m - 1 - i, 1));
      claves.push(d.toISOString().slice(0, 7));
    }
    const desde = new Date(`${claves[0]}-01T00:00:00-05:00`);

    const [pagos, primeros, empresas] = await Promise.all([
      prisma.subscriptionPayment.findMany({
        where: { status: 'PAID', paidAt: { gte: desde } },
        select: {
          companyId: true,
          amount: true,
          baseAmount: true,
          vatAmount: true,
          method: true,
          paidAt: true,
        },
      }),
      prisma.subscriptionPayment.groupBy({
        by: ['companyId'],
        where: { status: 'PAID' },
        _min: { paidAt: true },
      }),
      prisma.company.findMany({
        where: { deletedAt: null, owner: { role: 'HOST' } },
        select: { subscriptionEndsAt: true, subscriptionExempt: true },
      }),
    ]);

    const porMes = new Map(
      claves.map((c) => [
        c,
        { period: c, pagos: 0, total: 0, base: 0, iva: 0, empresas: new Set<string>() },
      ]),
    );
    const porMetodo = new Map<string, { method: string; pagos: number; total: number }>();
    let total = 0;
    let base = 0;
    let iva = 0;
    let cantidad = 0;
    const pagadoras = new Set<string>();

    for (const p of pagos) {
      if (!p.paidAt) continue;
      const fila = porMes.get(mesDeBogota(p.paidAt));
      if (!fila) continue;
      const monto = Number(p.amount);
      fila.pagos += 1;
      fila.total += monto;
      fila.base += Number(p.baseAmount);
      fila.iva += Number(p.vatAmount);
      fila.empresas.add(p.companyId);
      cantidad += 1;
      total += monto;
      base += Number(p.baseAmount);
      iva += Number(p.vatAmount);
      pagadoras.add(p.companyId);
      const met = porMetodo.get(p.method) ?? { method: p.method, pagos: 0, total: 0 };
      met.pagos += 1;
      met.total += monto;
      porMetodo.set(p.method, met);
    }

    // Altas: empresas cuyo primer pago de siempre cae en cada mes.
    const altas = new Map<string, number>();
    for (const f of primeros) {
      const primero = f._min.paidAt;
      if (!primero) continue;
      const k = mesDeBogota(primero);
      altas.set(k, (altas.get(k) ?? 0) + 1);
    }

    const t = ahora.getTime();
    let alDia = 0;
    let vencidas = 0;
    let sinPagar = 0;
    let exentas = 0;
    for (const e of empresas) {
      if (e.subscriptionExempt) exentas += 1;
      else if (!e.subscriptionEndsAt) sinPagar += 1;
      else if (e.subscriptionEndsAt.getTime() <= t) vencidas += 1;
      else alDia += 1;
    }

    res.json({
      data: {
        meses,
        totales: {
          pagos: cantidad,
          total: Math.round(total),
          base: Math.round(base),
          iva: Math.round(iva),
          empresasQuePagaron: pagadoras.size,
          ticketPromedio: cantidad ? Math.round(total / cantidad) : 0,
        },
        porMes: [...porMes.values()].map((f) => ({
          period: f.period,
          pagos: f.pagos,
          total: Math.round(f.total),
          base: Math.round(f.base),
          iva: Math.round(f.iva),
          empresas: f.empresas.size,
          altas: altas.get(f.period) ?? 0,
        })),
        porMetodo: [...porMetodo.values()]
          .map((f) => ({ ...f, total: Math.round(f.total) }))
          .sort((a, b) => b.total - a.total),
        cartera: { alDia, vencidas, sinPagar, exentas, total: empresas.length },
      },
    });
  },
);

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
      // Un pago registrado a mano activa la suscripcion igual que uno en linea, y
      // el titular tiene que enterarse igual.
      if (await aplicarPago(pago.id)) void avisarPagoDeSuscripcion(companyId).catch(() => undefined);
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
