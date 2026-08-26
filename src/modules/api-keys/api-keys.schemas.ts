import { z } from 'zod';
import { API_SCOPES } from '../../middleware/scope.js';

const scopeEnum = z.enum(API_SCOPES);

export const createApiKeySchema = z.object({
  name: z.string().min(1).max(120),
  scopes: z.array(scopeEnum).min(1, 'Debes seleccionar al menos un scope'),
  expiresAt: z.string().datetime().optional(),
  // Solo ADMIN. Una llave identifica QUIEN vende: la reserva que se crea con
  // ella se atribuye a esa empresa y su comision se le liquida. Un admin no
  // tiene empresa propia, asi que sin esto no podria emitir ninguna; el
  // controlador rechaza el campo a cualquier otro rol.
  companyId: z.string().min(1).optional(),
});

export const updateApiKeySchema = z
  .object({
    name: z.string().min(1).max(120).optional(),
    scopes: z.array(scopeEnum).min(1).optional(),
    expiresAt: z.string().datetime().nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Sin cambios' });

export const apiKeyIdParamsSchema = z.object({ id: z.string().min(1) });

export type CreateApiKeyInput = z.infer<typeof createApiKeySchema>;
export type UpdateApiKeyInput = z.infer<typeof updateApiKeySchema>;
