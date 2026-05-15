import { z } from 'zod';

const timeSlotSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
});

const dayScheduleSchema = z.object({
  isActive: z.boolean(),
  timeSlots: z.array(timeSlotSchema),
});

export const weeklyScheduleSchema = z.object({
  monday: dayScheduleSchema,
  tuesday: dayScheduleSchema,
  wednesday: dayScheduleSchema,
  thursday: dayScheduleSchema,
  friday: dayScheduleSchema,
  saturday: dayScheduleSchema,
  sunday: dayScheduleSchema,
});

const blockedDateSchema = z.union([
  z.string(),
  z.object({ date: z.string(), reason: z.string().optional(), description: z.string().optional() }),
]);

export const createAvailabilitySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  location: z.string().min(1).optional(), // locationId opcional
  experience: z.string().min(1).optional(), // experienceId opcional (M:N)
  isMain: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  weeklySchedule: weeklyScheduleSchema,
  bufferTime: z.number().int().nonnegative().optional().default(0),
  minimumNotice: z.number().int().nonnegative().optional().default(24),
  notes: z.string().optional(),
  blockedDates: z.array(blockedDateSchema).optional().default([]),
});

export const updateAvailabilitySchema = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  isMain: z.boolean().optional(),
  isActive: z.boolean().optional(),
  weeklySchedule: weeklyScheduleSchema.optional(),
  bufferTime: z.number().int().nonnegative().optional(),
  minimumNotice: z.number().int().nonnegative().optional(),
  notes: z.string().nullable().optional(),
  blockedDates: z.array(blockedDateSchema).optional(),
});

export const listAvailabilitiesQuerySchema = z.object({
  locationId: z.string().min(1).optional(),
  experienceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  primaryOnly: z.coerce.boolean().optional().default(false),
});

export const setPrimarySchema = z.object({
  contextId: z.string().min(1),
  contextType: z.enum(['location', 'experience']).default('location'),
});

export const availabilityIdParamsSchema = z.object({ id: z.string().min(1) });

export type CreateAvailabilityInput = z.infer<typeof createAvailabilitySchema>;
export type UpdateAvailabilityInput = z.infer<typeof updateAvailabilitySchema>;
export type ListAvailabilitiesQuery = z.infer<typeof listAvailabilitiesQuerySchema>;
export type SetPrimaryInput = z.infer<typeof setPrimarySchema>;
