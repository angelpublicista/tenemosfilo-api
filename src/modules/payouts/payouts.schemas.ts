import { z } from 'zod';

const payoutRoleEnum = z.enum(['HOST', 'RESELLER']);

export const createPayoutSchema = z.object({
  companyId: z.string().min(1),
  /** En calidad de que se le paga: por sus experiencias o por sus ventas. */
  role: payoutRoleEnum,
  amount: z.number().positive(),
  reference: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  /** Fecha real de la transferencia; por defecto, ahora. */
  paidAt: z.string().datetime().optional(),
});

export const listPayoutsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(50),
  companyId: z.string().min(1).optional(),
  role: payoutRoleEnum.optional(),
});

/**
 * Detalle de ingresos de la propia empresa. No lleva companyId: se toma de
 * la sesion, nunca de la query.
 */
export const listEarningsQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  /** En calidad de que se miran: como anfitriona o como revendedora. */
  role: payoutRoleEnum.default('HOST'),
});

export type CreatePayoutInput = z.infer<typeof createPayoutSchema>;
export type ListPayoutsQuery = z.infer<typeof listPayoutsQuerySchema>;
export type ListEarningsQuery = z.infer<typeof listEarningsQuerySchema>;
