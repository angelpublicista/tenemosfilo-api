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

export const ventasPropiasQuerySchema = z.object({
  companyId: z.string().min(1).optional(),
  /** Omitido = todos los meses. */
  period: periodoSchema.optional(),
  /** Omitido = todas. PLATFORM = cobradas por FILO; HOST = por el anfitrion con su pasarela. */
  cobro: z.enum(['PLATFORM', 'HOST']).optional(),
  /** Omitido = todas. RESELLER = las que trajo un revendedor; DIRECTO = el resto. */
  canal: z.enum(['RESELLER', 'DIRECTO']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export type VentasPropiasQuery = z.infer<typeof ventasPropiasQuerySchema>;
