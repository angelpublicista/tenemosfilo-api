// Base de conocimiento.
//
// Lectura: cualquier usuario con sesion ve los articulos publicados que van
// dirigidos a su rol. Escritura: solo el administrador, que ademas ve los
// borradores.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { requireAuth, requireHumanAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { Conflict, NotFound } from '../../lib/errors.js';
import { prisma } from '../../config/prisma.js';

export const ayudaRouter = Router();

ayudaRouter.use(requireAuth, requireHumanAuth);

const slugSchema = z
  .string()
  .trim()
  .min(3)
  .max(80)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/, 'Solo minúsculas, números y guiones');

const articuloSchema = z.object({
  slug: slugSchema,
  title: z.string().trim().min(3).max(160),
  summary: z.string().trim().min(3).max(300),
  body: z.string().trim().min(1).max(50_000),
  category: z.string().trim().min(2).max(60),
  position: z.number().int().min(0).max(10_000).default(0),
  audience: z.array(z.enum(['HOST', 'RESELLER', 'GUEST', 'ADMIN'])).default([]),
  isPublished: z.boolean().default(false),
});

const actualizarSchema = articuloSchema.partial();

const listaQuerySchema = z.object({
  q: z.string().trim().max(100).optional(),
  category: z.string().trim().max(60).optional(),
});

const idSchema = z.object({ id: z.string().min(1) });
const slugParamsSchema = z.object({ slug: z.string().min(1) });

/** Lo que se ve en la lista: sin el cuerpo, que pesa y solo hace falta al abrir. */
const sinCuerpo = {
  id: true,
  slug: true,
  title: true,
  summary: true,
  category: true,
  position: true,
  audience: true,
  isPublished: true,
  updatedAt: true,
} as const;

const buscar = (q?: string): Prisma.HelpArticleWhereInput =>
  q
    ? {
        OR: [
          { title: { contains: q, mode: 'insensitive' } },
          { summary: { contains: q, mode: 'insensitive' } },
          { body: { contains: q, mode: 'insensitive' } },
        ],
      }
    : {};

/** Lo que puede ver quien llama: el admin, todo; el resto, lo publicado para su rol. */
const visiblePara = (req: Request): Prisma.HelpArticleWhereInput =>
  req.user!.role === 'ADMIN'
    ? {}
    : {
        isPublished: true,
        OR: [{ audience: { isEmpty: true } }, { audience: { has: req.user!.role } }],
      };

ayudaRouter.get(
  '/articulos',
  validate(listaQuerySchema, 'query'),
  async (req: Request, res: Response) => {
    const { q, category } = req.query as unknown as z.infer<typeof listaQuerySchema>;
    const data = await prisma.helpArticle.findMany({
      where: { AND: [visiblePara(req), buscar(q), category ? { category } : {}] },
      select: sinCuerpo,
      orderBy: [{ category: 'asc' }, { position: 'asc' }, { title: 'asc' }],
    });
    res.json({ data });
  },
);

ayudaRouter.get(
  '/articulos/:slug',
  validate(slugParamsSchema, 'params'),
  async (req: Request, res: Response) => {
    const { slug } = req.params as unknown as z.infer<typeof slugParamsSchema>;
    const data = await prisma.helpArticle.findFirst({
      where: { AND: [{ slug }, visiblePara(req)] },
    });
    if (!data) throw NotFound('Artículo no encontrado');
    res.json({ data });
  },
);

// ---- Escritura: solo el administrador ----------------------------------

const soloAdmin = requireRole('ADMIN');

/** El slug es unico: chocar con otro articulo es un error del usuario, no un 500. */
const traducirChoque = (e: unknown): never => {
  if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
    throw Conflict('Ya existe un artículo con ese enlace');
  }
  throw e;
};

ayudaRouter.post('/articulos', soloAdmin, validate(articuloSchema), async (req: Request, res: Response) => {
  const data = await prisma.helpArticle
    .create({ data: req.body as z.infer<typeof articuloSchema> })
    .catch(traducirChoque);
  res.status(201).json({ data });
});

ayudaRouter.patch(
  '/articulos/:id',
  soloAdmin,
  validate(idSchema, 'params'),
  validate(actualizarSchema),
  async (req: Request, res: Response) => {
    const { id } = req.params as unknown as z.infer<typeof idSchema>;
    const existe = await prisma.helpArticle.findUnique({ where: { id }, select: { id: true } });
    if (!existe) throw NotFound('Artículo no encontrado');
    const data = await prisma.helpArticle
      .update({ where: { id }, data: req.body as z.infer<typeof actualizarSchema> })
      .catch(traducirChoque);
    res.json({ data });
  },
);

ayudaRouter.delete(
  '/articulos/:id',
  soloAdmin,
  validate(idSchema, 'params'),
  async (req: Request, res: Response) => {
    const { id } = req.params as unknown as z.infer<typeof idSchema>;
    const { count } = await prisma.helpArticle.deleteMany({ where: { id } });
    if (count === 0) throw NotFound('Artículo no encontrado');
    res.status(204).send();
  },
);
