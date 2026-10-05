import { z } from 'zod';

const payoutRoleEnum = z.enum(['HOST', 'RESELLER']);

export const createPayoutSchema = z.object({
  companyId: z.string().min(1),
  /** En calidad de que se le paga: por sus experiencias o por sus ventas. */
  role: payoutRoleEnum,
  /**
   * Quien paga. Omitido = FILO, que es lo normal. Con una empresa, es un
   * anfitrion que cobro con su propia pasarela saldando la comision de su
   * revendedor: ese dinero nunca paso por FILO.
   */
  payerCompanyId: z.string().min(1).optional(),
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

/**
 * TR-28. Los cortes del panel de ingresos.
 *
 * El rango es obligatorio: un desglose "de siempre" no se puede leer y no
 * responde a ninguna pregunta real. Las preguntas son "como fue este mes" y
 * "que me dio mas el trimestre pasado".
 */
export const desgloseQuerySchema = z.object({
  desde: z.string().min(8),
  hasta: z.string().min(8),
  role: payoutRoleEnum.default('HOST'),
});

export type DesgloseQuery = z.infer<typeof desgloseQuerySchema>;
export type CreatePayoutInput = z.infer<typeof createPayoutSchema>;
export type ListPayoutsQuery = z.infer<typeof listPayoutsQuerySchema>;
export type ListEarningsQuery = z.infer<typeof listEarningsQuerySchema>;
