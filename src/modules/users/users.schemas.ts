import { z } from 'zod';

// Espeja el enum UserRole de Prisma. Si falta un valor aqui, filtrar o
// asignar ese rol responde 400 aunque la BD si lo acepte.
const userRoleSchema = z.enum(['HOST', 'GUEST', 'ADMIN', 'RESELLER']);

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  role: userRoleSchema.optional(),
  search: z.string().trim().optional(),
});

export const userIdParamsSchema = z.object({
  id: z.string().min(1),
});

/**
 * Alta de usuario desde el panel de administracion (solo ADMIN).
 *
 * A diferencia de /auth/register, aqui SI se puede asignar cualquier rol y
 * una empresa: el que llama ya es administrador de la plataforma, asi que
 * no hay escalada de privilegios posible.
 */
export const createUserSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Minimo 8 caracteres'),
  name: z.string().min(1).optional(),
  role: userRoleSchema.default('GUEST'),
  phone: z.string().optional(),
  documentType: z.string().optional(),
  documentNumber: z.string().optional(),
  companyId: z.string().min(1).optional(),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional().nullable(),
  image: z.string().url().optional().nullable(),
  documentType: z.string().optional().nullable(),
  documentNumber: z.string().optional().nullable(),
  role: userRoleSchema.optional(),
  companyId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateUserInput = z.infer<typeof createUserSchema>;
