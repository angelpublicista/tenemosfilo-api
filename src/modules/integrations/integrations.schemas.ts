import { z } from 'zod';

const typeEnum = z.enum(['GOOGLE', 'OUTLOOK', 'ZOHO']);
const statusEnum = z.enum(['CONNECTED', 'DISCONNECTED', 'PENDING', 'ERROR']);

export const createIntegrationSchema = z.object({
  type: typeEnum,
  name: z.string().optional(),
  status: statusEnum.optional().default('PENDING'),
  config: z.record(z.string(), z.unknown()).optional(),
});

export const updateIntegrationSchema = z.object({
  name: z.string().nullable().optional(),
  status: statusEnum.optional(),
  config: z.record(z.string(), z.unknown()).nullable().optional(),
  error: z.string().nullable().optional(),
  lastSync: z.string().optional(),
});

export const updateStatusSchema = z.object({
  status: statusEnum,
  config: z.record(z.string(), z.unknown()).optional(),
  error: z.string().optional(),
});

export const listIntegrationsQuerySchema = z.object({
  type: typeEnum.optional(),
  status: statusEnum.optional(),
});

export const integrationIdParamsSchema = z.object({ id: z.string().min(1) });

export type CreateIntegrationInput = z.infer<typeof createIntegrationSchema>;
export type UpdateIntegrationInput = z.infer<typeof updateIntegrationSchema>;
export type UpdateStatusInput = z.infer<typeof updateStatusSchema>;
export type ListIntegrationsQuery = z.infer<typeof listIntegrationsQuerySchema>;
