import { z } from 'zod';

const experienceStatusEnum = z.enum(['DRAFT', 'PENDING', 'ACTIVE', 'PAUSED', 'INACTIVE']);

const galleryItemSchema = z.object({
  assetId: z.string().min(1), // ahora es URL S3/CloudFront
  alt: z.string().optional().default(''),
  caption: z.string().optional().default(''),
});

const addonSchema = z.object({
  name: z.string().min(1),
  price: z.number().nonnegative(),
  priceType: z.enum(['per_person', 'total']),
  description: z.string().optional(),
});

const emptyToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optStr = z.preprocess(emptyToUndef, z.string().optional());
const optUrl = z.preprocess(emptyToUndef, z.string().url().optional());

export const createExperienceSchema = z.object({
  title: z.string().min(1),
  // companyId opcional: si falta usamos el del JWT
  company: z.string().min(1).optional(),
  description: z.string().optional(),
  categories: z.array(z.string()).optional().default([]),
  duration: z.number().int().positive().optional(),
  // TR-19. Lo que ocupa ademas de si misma: montar antes y recoger despues.
  // En ese rato no cabe otra cosa, y la agenda lo cuenta.
  prepTime: z.number().int().nonnegative().max(1440).nullish(),
  cleanupTime: z.number().int().nonnegative().max(1440).nullish(),
  // Cuanta anticipacion hace falta para reservarla, en horas. Estaba en el
  // horario y ahi no era: un mismo horario sirve a experiencias que necesitan
  // avisos muy distintos.
  minimumNotice: z.number().int().nonnegative().max(8760).nullish(),
  minCapacity: z.number().int().nonnegative().optional(),
  basePrice: z.number().nonnegative().optional(),
  currency: z.string().optional().default('COP'),
  featuredImage: optUrl,
  gallery: z.array(galleryItemSchema).optional().default([]),
  locations: z.array(z.string().min(1)).optional().default([]),
  menus: z.array(z.string().min(1)).optional().default([]),
  availabilities: z.array(z.string().min(1)).optional().default([]),
  // Donde ocurre: en un sitio del anfitrion o en casa de quien reserva. Todo
  // es presencial; lo virtual se fue porque no se usaba.
  atHome: z.boolean().optional().default(false),
  presentialLocation: optStr,
  presentialAddress: optStr,
  presentialCity: optStr,
  presentialState: optStr,
  hideAddress: z.boolean().optional().default(false),
  requirements: z.string().optional(),
  includes: z.union([z.array(z.string()), z.string()]).optional(),
  addons: z.array(addonSchema).optional().default([]),
  // ISO strings; el API los castea a Date
  startDate: z.preprocess(emptyToUndef, z.string().datetime().or(z.string()).optional()),
  endDate: z.preprocess(emptyToUndef, z.string().datetime().or(z.string()).optional()),
  startTime: optStr,
  endTime: optStr,
  status: experienceStatusEnum.optional().default('DRAFT'),
  isFeatured: z.boolean().optional().default(false),
});

// PATCH: todo opcional. Para arrays vacios significa "limpiar"; para no
// tocar el campo el front debe omitirlo del body.
// Comisiones de la experiencia. Null explicito = volver a heredar el valor
// por defecto de la plataforma. Solo un ADMIN puede enviarlas: el
// controller las descarta para el resto de roles.
const commissionTypeEnum = z.enum(['PERCENT', 'FIXED']);

export const commissionFieldsSchema = z.object({
  filoCommissionType: commissionTypeEnum.nullable().optional(),
  filoCommissionValue: z.number().nonnegative().nullable().optional(),
  resellerCommissionType: commissionTypeEnum.nullable().optional(),
  resellerCommissionValue: z.number().nonnegative().nullable().optional(),
});

export const updateExperienceSchema = createExperienceSchema
  .partial()
  .extend({
    // No permitimos cambiar el companyId en update.
    company: z.never().optional(),
  })
  .merge(commissionFieldsSchema)
  .refine(
    (d) =>
      !(d.filoCommissionType === 'PERCENT' && (d.filoCommissionValue ?? 0) > 100) &&
      !(d.resellerCommissionType === 'PERCENT' && (d.resellerCommissionValue ?? 0) > 100),
    { message: 'Un porcentaje no puede ser mayor que 100' },
  );

export type CommissionFields = z.infer<typeof commissionFieldsSchema>;

export const updateStatusSchema = z.object({ status: experienceStatusEnum });

export const listExperiencesQuerySchema = z.object({
  companyId: z.string().min(1).optional(),
  status: experienceStatusEnum.optional(),
  category: z.string().optional(),
  search: z.string().optional(),
  isFeatured: z.coerce.boolean().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  // Para separar lo que se da a domicilio de lo que se da en un sitio.
  atHome: z.coerce.boolean().optional(),
  // Sin 'totalBookings': una experiencia no lleva contador de reservas. Para
  // ordenar por lo que mas se vende esta el desglose de Ingresos (TR-28).
  sortBy: z.enum(['title', 'basePrice', 'rating', 'createdAt']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export const featuredQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional().default(6),
});

export const experienceIdParamsSchema = z.object({ id: z.string().min(1) });

// Las condiciones de una experiencia en una sede.
//
// Todo nullish a proposito: null es "aqui vale lo que diga la experiencia", y
// es la respuesta mas comun. Una sede que solo cambia el aforo manda el aforo
// y nada mas; si tuviera que repetir precio, tiempos y aviso, esos tres se
// quedarian viejos el dia que la experiencia los cambie.
export const condicionesDeSedeSchema = z.object({
  kind: z.enum(['ABIERTA', 'PRIVADA']).nullish(),
  minCapacity: z.number().int().nonnegative().nullish(),
  basePrice: z.number().nonnegative().nullish(),
  prepTime: z.number().int().nonnegative().max(1440).nullish(),
  cleanupTime: z.number().int().nonnegative().max(1440).nullish(),
  minimumNotice: z.number().int().nonnegative().max(8760).nullish(),
  isPublished: z.boolean().optional(),
  notes: z.string().nullish(),
});

export const sedeParamsSchema = z.object({
  id: z.string().min(1),
  locationId: z.string().min(1),
});

export type CreateExperienceInput = z.infer<typeof createExperienceSchema>;
export type UpdateExperienceInput = z.infer<typeof updateExperienceSchema>;
export type ListExperiencesQuery = z.infer<typeof listExperiencesQuerySchema>;
export type CondicionesDeSedeInput = z.infer<typeof condicionesDeSedeSchema>;
