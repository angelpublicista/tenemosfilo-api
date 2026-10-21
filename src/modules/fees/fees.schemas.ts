import { z } from 'zod';

/** "2026-10": un mes, en hora de Bogota. */
export const periodoSchema = z.string().regex(/^\d{4}-(0[1-9]|1[0-2])$/, 'Periodo con formato AAAA-MM');

export const registrarPagoSchema = z.object({
  companyId: z.string().min(1),
  period: periodoSchema,
  /** Omitido = todo lo pendiente del mes, que es el caso normal. */
  amount: z.number().positive().optional(),
  /** Numero de la factura o del comprobante. */
  reference: z.string().trim().optional(),
  notes: z.string().trim().optional(),
  /** Fecha real del pago; por defecto, ahora. */
  paidAt: z.string().datetime().optional(),
});

export type RegistrarPagoInput = z.infer<typeof registrarPagoSchema>;
