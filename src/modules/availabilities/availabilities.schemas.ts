import { z } from 'zod';

/**
 * Una franja horaria de un dia.
 *
 * `cupos` es el inventario de ESA franja y es OBLIGATORIO: los cupos son del
 * horario, no de la experiencia. El almuerzo y la cena de un sabado son dos
 * cosas distintas y se llenan por separado, y la misma experiencia puede
 * admitir ocho en el local y veinte en la terraza.
 *
 * Antes vivian en la experiencia como un numero unico, asi que decir "los
 * sabados por la noche caben menos" no se podia expresar.
 */
const franjaSchema = z.object({
  startTime: z.string(),
  endTime: z.string(),
  cupos: z.number().int().positive(),
});

const dayScheduleSchema = z.object({
  isActive: z.boolean(),
  // `timeSlots` se sigue aceptando al escribir —hay clientes viejos en
  // circulacion— pero lo que se guarda es `franjas`.
  franjas: z.array(franjaSchema).optional(),
  timeSlots: z.array(franjaSchema).optional(),
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

/**
 * Lo que pasa en una fecha concreta, por encima del patron semanal.
 *
 * { "2026-12-24": { isActive: false },
 *   "2026-12-31": { isActive: true, franjas: [{ startTime, endTime, cupos }] } }
 *
 * Misma forma que un dia de la semana: un dia suelto se cierra o se abre con
 * otras franjas, y el codigo que saca las franjas es el mismo.
 */
const dateOverridesSchema = z.record(
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'La fecha va en formato AAAA-MM-DD'),
  dayScheduleSchema,
);

/**
 * TR-35. Desde y hasta cuando se repite el horario.
 *
 * `validUntil` se pide en los nuevos: un horario semanal sin corte genera
 * inventario para siempre, y en 2031 se podria reservar un sabado que nadie
 * decidio abrir. Los que ya existian lo tienen nulo —"sin fecha final"— y se
 * les pide al editarlos, no se les inventa una.
 */
export const createAvailabilitySchema = z.object({
  name: z.string().min(1),
  description: z.string().optional(),
  location: z.string().min(1).optional(), // locationId opcional
  experience: z.string().min(1).optional(), // experienceId opcional (M:N)
  isMain: z.boolean().optional().default(false),
  isActive: z.boolean().optional().default(true),
  weeklySchedule: weeklyScheduleSchema,
  // `bufferTime` y `minimumNotice` ya no se guardan aqui: son de la
  // experiencia. Se siguen aceptando para no romper clientes viejos, y se
  // ignoran — el horario no es quien decide cuanta preparacion necesita una
  // cena ni cuanta anticipacion hace falta para pedirla.
  bufferTime: z.number().int().nonnegative().optional(),
  minimumNotice: z.number().int().nonnegative().optional(),
  notes: z.string().optional(),
  // `blockedDates` se sigue aceptando de clientes viejos y se ignora: lo que
  // pasa en una fecha vive en `dateOverrides`, que ademas sabe abrir.
  blockedDates: z.array(blockedDateSchema).optional().default([]),
  dateOverrides: dateOverridesSchema.optional(),
  validFrom: z.string().min(1),
  validUntil: z.string().min(1),
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
  dateOverrides: dateOverridesSchema.optional(),
  validFrom: z.string().min(1).optional(),
  // Nulo explicito = volver a "sin fecha final". Se permite porque hay
  // horarios que de verdad no tienen corte —un restaurante que abre todos los
  // sabados— y obligar a inventarse una fecha solo produce fechas falsas.
  validUntil: z.string().min(1).nullable().optional(),
});

export const listAvailabilitiesQuerySchema = z.object({
  locationId: z.string().min(1).optional(),
  experienceId: z.string().min(1).optional(),
  companyId: z.string().min(1).optional(),
  primaryOnly: z.coerce.boolean().optional().default(false),
  /**
   * TR-21. Solo la agenda propia del anfitrion: los horarios que no son de
   * ninguna sede ni de ninguna experiencia.
   */
  soloPropias: z.coerce.boolean().optional().default(false),
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
