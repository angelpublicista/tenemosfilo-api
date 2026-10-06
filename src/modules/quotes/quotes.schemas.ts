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

/**
 * TR-14. Las opciones de una cotizacion: hasta tres, simultaneas.
 *
 * No son versiones —eso ya existe y es el historial de lo que se le fue
 * mandando— sino alternativas vivas a la vez entre las que el cliente elige.
 *
 * Todo opcional dentro de cada opcion salvo que tenga algo: una opcion vacia
 * no es una opcion, pero cual es el dato que la define cambia segun el caso
 * (a veces es la fecha, a veces la experiencia, a veces el precio).
 */
export const guardarOpcionesSchema = z.object({
  opciones: z
    .array(
      z
        .object({
          label: z.string().max(120).optional(),
          experienceId: z.string().min(1).optional(),
          eventDate: z.string().optional(),
          eventTime: z.string().optional(),
          guests: z.number().int().positive().optional(),
          total: z.number().nonnegative().optional(),
          notes: z.string().max(1000).optional(),
        })
        .refine(
          (o) => !!(o.label || o.experienceId || o.eventDate || o.total || o.notes),
          'Cada opción necesita al menos un dato',
        ),
    )
    .max(3, 'Una cotización admite hasta 3 opciones'),
});

export const elegirOpcionSchema = z.object({
  optionId: z.string().min(1),
  elegida: z.boolean().default(true),
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
export type GuardarOpcionesInput = z.infer<typeof guardarOpcionesSchema>;
export type ElegirOpcionInput = z.infer<typeof elegirOpcionSchema>;
export type ListQuotesQuery = z.infer<typeof listQuotesQuerySchema>;
export type SearchExperiencesQuery = z.infer<typeof searchExperiencesQuerySchema>;
