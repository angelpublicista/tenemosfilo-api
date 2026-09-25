import { z } from 'zod';

const statusEnum = z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED']);

/**
 * Una cotizacion.
 *
 * De lo comercial, lo unico obligatorio es la cantidad de personas: sin ella
 * no hay precio que calcular. Ni la fecha ni la hora hacen falta —cuando no
 * hay fecha confirmada, la propuesta queda sujeta a disponibilidad— y
 * exigirlas obligaba a inventarse una para poder cotizar.
 *
 * Los datos del cliente se pueden omitir si viene `opportunityId`: ya estan en
 * la solicitud y el servicio los toma de ahi. Volver a pedirlos era el motivo
 * de que se tecleara dos veces lo mismo.
 */
export const createQuoteSchema = z
  .object({
    opportunityId: z.string().min(1).optional(),
    customerName: z.string().min(1).optional(),
    customerEmail: z.string().email().optional(),
    customerPhone: z.string().optional(),
    eventDate: z.string().optional(),
    eventTime: z.string().optional(),
    // Obligatoria y al menos 1: cotizar para cero personas no es cotizar.
    guests: z.number().int().min(1, 'Indica para cuántas personas'),
    location: z.string().optional(),
    experiences: z.array(z.string().min(1)).min(1, 'Debes incluir al menos una experiencia'),
    notes: z.string().optional(),
    companyId: z.string().min(1).optional(), // si no viene, usamos el del JWT
    hostId: z.string().min(1).optional(), // si no viene, usamos el del JWT
  })
  .superRefine((d, ctx) => {
    // Sin oportunidad detras no hay de donde sacar al cliente, asi que aqui si
    // hace falta decir quien es y como se le escribe.
    if (!d.opportunityId) {
      if (!d.customerName) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['customerName'],
          message: 'Indica el nombre del cliente o la oportunidad de la que sale',
        });
      }
      if (!d.customerEmail && !d.customerPhone) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['customerEmail'],
          message: 'Hace falta al menos un correo o un teléfono',
        });
      }
    }
  });

export const updateQuoteStatusSchema = z.object({ status: statusEnum });

export const listQuotesQuerySchema = z.object({
  companyId: z.string().min(1).optional(),
  status: statusEnum.optional(),
});

export const searchExperiencesQuerySchema = z.object({
  companyId: z.string().min(1),
  date: z.string().optional(),
  time: z.string().optional(),
  guests: z.coerce.number().int().positive(),
  location: z.string().optional(),
});

export const quoteIdParamsSchema = z.object({ id: z.string().min(1) });

export type CreateQuoteInput = z.infer<typeof createQuoteSchema>;
export type ListQuotesQuery = z.infer<typeof listQuotesQuerySchema>;
export type SearchExperiencesQuery = z.infer<typeof searchExperiencesQuerySchema>;
