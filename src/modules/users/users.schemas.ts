import { z } from 'zod';

export const listUsersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  role: z.enum(['HOST', 'GUEST', 'ADMIN']).optional(),
  search: z.string().trim().optional(),
});

export const userIdParamsSchema = z.object({
  id: z.string().min(1),
});

export const updateUserSchema = z.object({
  name: z.string().min(1).optional(),
  phone: z.string().optional().nullable(),
  image: z.string().url().optional().nullable(),
  documentType: z.string().optional().nullable(),
  documentNumber: z.string().optional().nullable(),
  role: z.enum(['HOST', 'GUEST', 'ADMIN']).optional(),
  companyId: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export type ListUsersQuery = z.infer<typeof listUsersQuerySchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
