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

const capacitySchema = z.object({
  minGuests: z.number().int().nonnegative().optional(),
  maxGuests: z.number().int().nonnegative().optional(),
});

export const createLocationSchema = z.object({
  name: z.string().min(1),
  // companyId opcional: si no viene, usamos el companyId del user logueado.
  companyId: z.string().min(1).optional(),
  isMain: z.boolean().optional().default(false),
  description: z.string().optional(),
  address: addressSchema.optional(),
  contactInfo: contactInfoSchema.optional(),
  capacity: capacitySchema.optional(),
  isActive: z.boolean().optional().default(true),
});

export const updateLocationSchema = z.object({
  name: z.string().min(1).optional(),
  isMain: z.boolean().optional(),
  description: z.string().nullable().optional(),
  address: addressSchema.nullable().optional(),
  contactInfo: contactInfoSchema.nullable().optional(),
  capacity: capacitySchema.nullable().optional(),
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
