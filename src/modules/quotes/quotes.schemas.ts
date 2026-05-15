import { z } from 'zod';

const statusEnum = z.enum(['PENDING', 'ACCEPTED', 'REJECTED', 'EXPIRED']);

export const createQuoteSchema = z.object({
  customerName: z.string().min(1),
  customerEmail: z.string().email(),
  customerPhone: z.string().optional(),
  eventDate: z.string().optional(),
  eventTime: z.string().optional(),
  guests: z.number().int().nonnegative().optional(),
  location: z.string().optional(),
  experiences: z.array(z.string().min(1)).min(1, 'Debes incluir al menos una experiencia'),
  notes: z.string().optional(),
  companyId: z.string().min(1).optional(), // si no viene, usamos el del JWT
  hostId: z.string().min(1).optional(), // si no viene, usamos el del JWT
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
