import { z } from 'zod';

/**
 * Un plato. El precio es opcional a proposito: en un menu de degustacion
 * incluido en la experiencia no pinta nada, y en una carta si. Cuando falta,
 * el catalogo simplemente no lo enseña.
 *
 * `image` es la URL publica que devuelve /uploads/presign, no un id.
 */
const menuItemSchema = z.object({
  name: z.string().min(1).max(160),
  description: z.string().max(600).optional(),
  price: z.number().nonnegative().optional(),
  image: z.string().url().optional(),
});

const menuSectionSchema = z.object({
  name: z.string().min(1).max(120),
  description: z.string().max(600).optional(),
  // 60 platos por seccion no es un limite de negocio, es un tope para que un
  // PATCH no pueda meter un JSON sin fondo en la fila.
  items: z.array(menuItemSchema).max(60).default([]),
});

const sectionsSchema = z.array(menuSectionSchema).max(20);

export const createMenuSchema = z.object({
  name: z.string().min(1).max(160),
  // companyId opcional: si no viene, usamos el companyId del user logueado.
  companyId: z.string().min(1).optional(),
  description: z.string().max(2000).optional(),
  sections: sectionsSchema.optional(),
  isActive: z.boolean().optional().default(true),
});

export const updateMenuSchema = z.object({
  name: z.string().min(1).max(160).optional(),
  description: z.string().max(2000).nullable().optional(),
  sections: sectionsSchema.nullable().optional(),
  isActive: z.boolean().optional(),
});

export const listMenusQuerySchema = z.object({
  companyId: z.string().min(1).optional(),
  includeInactive: z.coerce.boolean().optional().default(false),
});

export const menuIdParamsSchema = z.object({ id: z.string().min(1) });

export type CreateMenuInput = z.infer<typeof createMenuSchema>;
export type UpdateMenuInput = z.infer<typeof updateMenuSchema>;
export type ListMenusQuery = z.infer<typeof listMenusQuerySchema>;
