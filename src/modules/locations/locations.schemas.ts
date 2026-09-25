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

/** Hasta 12 fotos. Pasado eso nadie las mira y el formulario se vuelve un muro. */
// La descripcion vacia se guarda como ausente, no como cadena vacia.
const emptyToUndef = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const MAX_FOTOS = 12;
const photosSchema = z.array(z.string().url()).max(MAX_FOTOS);

/**
 * Un salon de la sede.
 *
 * Lleva `id` cuando ya existe. No es un detalle: sin el, guardar la sede
 * tomaria los salones por nuevos y les cambiaria el identificador en cada
 * guardado. Ya paso con los contactos de la empresa.
 */
const roomSchema = z.object({
  id: z.string().min(1).optional(),
  name: z.string().min(1).max(120),
  description: z.preprocess(emptyToUndef, z.string().max(1000).optional()),
  // Mismo minimo que la sede: un espacio donde no cabe nadie no es un espacio.
  maxCapacity: z.number().int().min(1),
  photos: photosSchema.optional(),
  isActive: z.boolean().optional(),
});

/** Hasta 30 salones. Mas que eso ya no es una sede, es un centro de convenciones. */
const roomsSchema = z.array(roomSchema).max(30);

/**
 * Lo que una sede puede ofrecer.
 *
 * Lista cerrada a proposito: son casillas, no texto libre, y si el front
 * mandara una clave que aqui no esta se rechaza con un mensaje claro en vez de
 * guardar algo que ninguna pantalla sabria pintar. El front tiene la misma
 * lista con sus etiquetas (lib/company/caracteristicas.ts); si se añade una,
 * hay que añadirla en los dos sitios y el rechazo avisa si se olvida.
 */
export const CARACTERISTICAS = [
  'aire_libre',
  'cocina',
  'parqueadero',
  'wifi',
  'acceso_movilidad_reducida',
  'ascensor',
  'mesas_y_sillas',
  'audiovisuales',
] as const;

const amenitiesSchema = z
  .array(z.enum(CARACTERISTICAS))
  // Repetir una casilla no significa nada; se guarda una sola vez.
  .transform((l) => [...new Set(l)]);

const bathroomsSchema = z.number().int().min(0).max(200);

/**
 * El video de la sede: cualquier enlace http(s).
 *
 * Mas permisivo que el de la portada de la empresa, que solo admite YouTube y
 * Vimeo porque se incrusta. Aqui un enlace que no se pueda incrustar se
 * enseña como enlace, asi que rechazarlo seria negar algo que si funciona.
 */
const videoUrlSchema = z
  .string()
  .url()
  // Con regex y no parseando la URL: zod ejecuta los refine AUNQUE el .url()
  // de arriba ya haya fallado, asi que un `new URL()` aqui dentro lanza con
  // cualquier cadena que no lo sea y el error se escapa como 500 en vez de
  // contestar 400. Comprobado.
  .regex(/^https?:\/\//i, 'El enlace del video debe empezar por http:// o https://');

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
  responsibleContactId: z.string().min(1).optional(),
  photos: photosSchema.optional(),
  videoUrl: videoUrlSchema.optional(),
  hasRooms: z.boolean().optional(),
  rooms: roomsSchema.optional(),
  amenities: amenitiesSchema.optional(),
  avEquipmentDetail: z.preprocess(emptyToUndef, z.string().max(300).optional()),
  bathroomsCount: bathroomsSchema.optional(),
  importantInfo: z.preprocess(emptyToUndef, z.string().max(2000).optional()),
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
  // null deja la sede sin responsable.
  responsibleContactId: z.string().min(1).nullable().optional(),
  // La lista llega entera: el orden ES el dato, y mandar trozos obligaria a
  // reconstruirlo aqui.
  photos: photosSchema.optional(),
  videoUrl: videoUrlSchema.nullable().optional(),
  hasRooms: z.boolean().nullable().optional(),
  rooms: roomsSchema.optional(),
  amenities: amenitiesSchema.optional(),
  avEquipmentDetail: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().max(300).nullable().optional(),
  ),
  bathroomsCount: bathroomsSchema.nullable().optional(),
  importantInfo: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().max(2000).nullable().optional(),
  ),
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
