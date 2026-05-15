import { z } from 'zod';

const experienceTypeEnum = z.enum(['VIRTUAL', 'PRESENTIAL', 'HYBRID']);
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
  capacity: z.number().int().positive().optional(),
  minCapacity: z.number().int().nonnegative().optional(),
  basePrice: z.number().nonnegative().optional(),
  currency: z.string().optional().default('COP'),
  featuredImage: optUrl,
  gallery: z.array(galleryItemSchema).optional().default([]),
  locations: z.array(z.string().min(1)).optional().default([]),
  availabilities: z.array(z.string().min(1)).optional().default([]),
  experienceType: experienceTypeEnum.optional().default('PRESENTIAL'),
  isVirtual: z.boolean().optional().default(false),
  virtualPlatform: optStr,
  presentialLocation: optStr,
  presentialAddress: optStr,
  presentialCity: optStr,
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
export const updateExperienceSchema = createExperienceSchema.partial().extend({
  // No permitimos cambiar el companyId en update.
  company: z.never().optional(),
});

export const updateStatusSchema = z.object({ status: experienceStatusEnum });

export const listExperiencesQuerySchema = z.object({
  companyId: z.string().min(1).optional(),
  status: experienceStatusEnum.optional(),
  category: z.string().optional(),
  search: z.string().optional(),
  isFeatured: z.coerce.boolean().optional(),
  minPrice: z.coerce.number().optional(),
  maxPrice: z.coerce.number().optional(),
  experienceType: experienceTypeEnum.optional(),
  sortBy: z.enum(['title', 'basePrice', 'rating', 'createdAt', 'totalBookings']).optional().default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(100).optional().default(20),
});

export const featuredQuerySchema = z.object({
  limit: z.coerce.number().int().positive().max(50).optional().default(6),
});

export const experienceIdParamsSchema = z.object({ id: z.string().min(1) });

export type CreateExperienceInput = z.infer<typeof createExperienceSchema>;
export type UpdateExperienceInput = z.infer<typeof updateExperienceSchema>;
export type ListExperiencesQuery = z.infer<typeof listExperiencesQuerySchema>;
