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

// Rangos reales del planeta: fuera de ellos no es una coordenada, es un dedazo.
const latitudeSchema = z.number().min(-90).max(90);
const longitudeSchema = z.number().min(-180).max(180);

/**
 * Latitud y longitud van juntas o no van.
 *
 * Una latitud sin su longitud no ubica nada, y guardar media coordenada
 * dejaria un pin que el mapa no sabria donde poner. Se comprueba aqui porque
 * es donde se ve el par completo.
 */
const coordenadasCompletas = (d: { latitude?: unknown; longitude?: unknown }) =>
  (d.latitude === undefined || d.latitude === null) ===
  (d.longitude === undefined || d.longitude === null);
const MENSAJE_COORDENADAS = 'La latitud y la longitud van juntas';

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
  latitude: latitudeSchema.optional(),
  longitude: longitudeSchema.optional(),
  isActive: z.boolean().optional().default(true),
}).refine(coordenadasCompletas, { message: MENSAJE_COORDENADAS, path: ['longitude'] });

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
  // null borra el pin y devuelve la sede a "sin ubicar".
  latitude: latitudeSchema.nullable().optional(),
  longitude: longitudeSchema.nullable().optional(),
  isActive: z.boolean().optional(),
}).refine(coordenadasCompletas, { message: MENSAJE_COORDENADAS, path: ['longitude'] });

export const listLocationsQuerySchema = z.object({
  companyId: z.string().min(1).optional(),
  includeInactive: z.coerce.boolean().optional().default(false),
});

export const locationIdParamsSchema = z.object({ id: z.string().min(1) });

export type CreateLocationInput = z.infer<typeof createLocationSchema>;
export type UpdateLocationInput = z.infer<typeof updateLocationSchema>;
export type ListLocationsQuery = z.infer<typeof listLocationsQuerySchema>;
