import { z } from 'zod';

export const listAuditQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
  /** Filtra por quien lo hizo. */
  actorId: z.string().min(1).optional(),
  /** Filtra por la empresa sobre la que se actuo. */
  companyId: z.string().min(1).optional(),
  resourceType: z.string().min(1).optional(),
  action: z.enum(['CREATE', 'UPDATE', 'DELETE']).optional(),
  /** Busca en el correo del actor o en la ruta. */
  search: z.string().trim().optional(),
});

export type ListAuditQuery = z.infer<typeof listAuditQuerySchema>;
