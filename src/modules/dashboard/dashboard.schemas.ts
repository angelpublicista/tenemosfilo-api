import { z } from 'zod';

export const statsQuerySchema = z.object({
  companyId: z.string().min(1).optional(),
});

export const activitiesQuerySchema = z.object({
  companyId: z.string().min(1).optional(),
  limit: z.coerce.number().int().positive().max(50).optional().default(5),
});

export type StatsQuery = z.infer<typeof statsQuerySchema>;
export type ActivitiesQuery = z.infer<typeof activitiesQuerySchema>;
