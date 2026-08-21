import { z } from 'zod';

export const channelEnum = z.enum(['OPENTABLE']);

export const channelParamsSchema = z.object({
  experienceId: z.string().min(1),
  channel: channelEnum,
});

export const marcarPublicadaSchema = z.object({
  // La URL de la ficha en el canal. Opcional porque no todos los canales
  // dan una, pero es lo que hace util el registro.
  externalUrl: z.string().url().optional(),
  externalId: z.string().trim().min(1).optional(),
  notes: z.string().trim().optional(),
});

export type MarcarPublicadaInput = z.infer<typeof marcarPublicadaSchema>;
export type ChannelParams = z.infer<typeof channelParamsSchema>;
