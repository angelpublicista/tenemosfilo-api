import { z } from 'zod';

export const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
] as const;

export const presignSchema = z.object({
  filename: z.string().min(1).max(255),
  contentType: z
    .string()
    .refine((v) => (ALLOWED_IMAGE_TYPES as readonly string[]).includes(v), {
      message: `Tipo no soportado. Permitidos: ${ALLOWED_IMAGE_TYPES.join(', ')}`,
    }),
  // Opcional: namespace logico ("logos", "avatars", "experiences"). Default "misc".
  scope: z
    .string()
    .regex(/^[a-z0-9-]+$/i, 'scope debe ser alfanumerico')
    .max(32)
    .optional(),
});

export type PresignInput = z.infer<typeof presignSchema>;
