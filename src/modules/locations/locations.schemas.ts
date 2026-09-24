import { z } from 'zod';

const addressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
});

const contactInfoSchema = z.object({
  phone: z.string().optional(),
  email: z.string().email().optional().or(z.literal('')),
});

/**
 * Cuanta gente cabe a la vez en la sede.
 *
 * Minimo 1: una sede donde no cabe nadie no es una sede, y un 0 guardado
 * pasaria por "sin declarar" en cualquier sitio que lo mire.
 *
 * Ya no hay minimo de invitados. No era de la sede sino de cada experiencia:
 * un salon no tiene un minimo de personas, una cena maridaje si.
 */
const maxCapacitySchema = z.number().int().min(1);

export const createLocationSchema = z.object({
  name: z.string().min(1),
  // companyId opcional: si no viene, usamos el companyId del user logueado.
  companyId: z.string().min(1).optional(),
  isMain: z.boolean().optional().default(false),
  description: z.string().optional(),
  address: addressSchema.optional(),
  contactInfo: contactInfoSchema.optional(),
  maxCapacity: maxCapacitySchema,
  isPublic: z.boolean().optional(),
  isActive: z.boolean().optional().default(true),
});

export const updateLocationSchema = z.object({
  name: z.string().min(1).optional(),
  isMain: z.boolean().optional(),
  description: z.string().nullable().optional(),
  address: addressSchema.nullable().optional(),
  contactInfo: contactInfoSchema.nullable().optional(),
  // Sin nullable: la capacidad es obligatoria, asi que se puede cambiar pero
  // no borrar.
  maxCapacity: maxCapacitySchema.optional(),
  isPublic: z.boolean().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const listLocationsQuerySchema = z.object({
  companyId: z.string().min(1).optional(),
  includeInactive: z.coerce.boolean().optional().default(false),
});

export const locationIdParamsSchema = z.object({ id: z.string().min(1) });

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type ListLocationsQuery = z.infer<typeof listLocationsQuerySchema>;
