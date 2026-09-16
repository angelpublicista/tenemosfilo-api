import { z } from 'zod';

export const ALLOWED_IMAGE_TYPES = [
  'image/png',
  'image/jpeg',
  'image/jpg',
  'image/webp',
  'image/gif',
] as const;

/**
 * Lo que vale para un documento legal: el PDF que entrega la DIAN, y tambien
 * una foto, porque mucha gente lo tiene fotografiado y no en PDF.
 */
export const ALLOWED_DOCUMENT_TYPES = ['application/pdf', ...ALLOWED_IMAGE_TYPES] as const;

/**
 * Prefijo de S3 donde cae cada cosa.
 *
 * `uploads/` lo abre la politica del bucket para lectura publica, que es lo que
 * queremos para un logo o la foto de un plato. `privado/` queda fuera de esa
 * politica a proposito: ahi van los documentos legales, que llevan NIT,
 * direccion y a veces datos del representante legal, y solo se leen con un
 * enlace firmado que caduca.
 */
export const PREFIJO_PUBLICO = 'uploads';
export const PREFIJO_PRIVADO = 'privado';

/** Que clase de fichero se sube. Decide el prefijo y los tipos admitidos. */
export const VISIBILIDADES = ['publico', 'privado'] as const;
export type Visibilidad = (typeof VISIBILIDADES)[number];

export const presignSchema = z
  .object({
    filename: z.string().min(1).max(255),
    contentType: z.string().min(1),
    // Namespace logico ("logos", "avatars", "experiences"). Default "misc".
    scope: z
      .string()
      .regex(/^[a-z0-9-]+$/i, 'scope debe ser alfanumerico')
      .max(32)
      .optional(),
    // Por defecto publico: es lo que se hacia antes de que existieran los
    // documentos, y cambiarlo en silencio dejaria de servir los logos.
    visibilidad: z.enum(VISIBILIDADES).optional().default('publico'),
  })
  .superRefine((v, ctx) => {
    const permitidos: readonly string[] =
      v.visibilidad === 'privado' ? ALLOWED_DOCUMENT_TYPES : ALLOWED_IMAGE_TYPES;
    if (!permitidos.includes(v.contentType)) {
      ctx.addIssue({
        code: 'custom',
        path: ['contentType'],
        message: `Tipo no soportado. Permitidos: ${permitidos.join(', ')}`,
      });
    }
  });

/**
 * Para firmar la lectura de un fichero privado.
 *
 * Solo se admiten claves del prefijo privado: firmar cualquier clave dejaria
 * leer el bucket entero a quien supiera adivinar una ruta.
 */
export const firmaLecturaSchema = z.object({
  key: z
    .string()
    .min(1)
    .max(500)
    .refine((k) => k.startsWith(`${PREFIJO_PRIVADO}/`), {
      message: 'Solo se pueden firmar documentos privados',
    })
    // `..` permitiria salirse del prefijo y pedir la firma de otra cosa.
    .refine((k) => !k.includes('..'), { message: 'Clave no valida' }),
});

export type PresignInput = z.infer<typeof presignSchema>;
export type FirmaLecturaInput = z.infer<typeof firmaLecturaSchema>;
