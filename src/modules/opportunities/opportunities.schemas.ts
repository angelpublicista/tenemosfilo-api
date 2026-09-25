import { z } from 'zod';

const stageEnum = z.enum([
  'PROSPECTING',
  'QUALIFICATION',
  'PROPOSAL',
  'NEGOTIATION',
  'APPROVAL',
  'CLOSED_WON',
  'CLOSED_LOST',
]);
const statusEnum = z.enum(['OPEN', 'WON', 'LOST', 'PAUSED']);

const experienceItemSchema = z.object({
  experience: z.string().min(1),
  quantity: z.number().int().positive().default(1),
  customPrice: z.number().nonnegative().optional(),
  notes: z.string().optional(),
});

// Un campo en blanco es un campo sin rellenar, no una cadena vacia.
const emptyToUndef = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

export const experienceKindEnum = z.enum(['ABIERTA', 'PRIVADA']);
export const buyerKindEnum = z.enum(['SOCIAL', 'CORPORATIVO']);
export const leadSourceEnum = z.enum([
  'WHATSAPP',
  'INSTAGRAM',
  'WEB',
  'REFERIDO',
  'PROSPECCION',
  'RESELLER',
  'OTRO',
]);

/**
 * Una solicitud nueva: lo minimo para no perder un lead.
 *
 * Nombre, una forma de contacto y la clasificacion comercial. Nada mas es
 * obligatorio —ni fecha, ni empresa, ni experiencia, ni sede, ni valor—
 * porque lo que mata un lead es pedirle diez datos a quien acaba de escribir
 * por WhatsApp.
 *
 * El contacto viene de dos formas: el id de uno que ya existe, o los datos de
 * uno nuevo. Asi la pantalla puede ofrecer reutilizar en vez de duplicar.
 */
export const crearSolicitudSchema = z
  .object({
    experienceKind: experienceKindEnum,
    // Solo se pregunta en las privadas: una abierta se le vende siempre a un
    // particular y el servicio lo fija solo.
    buyerKind: buyerKindEnum.optional(),

    contactId: z.string().min(1).optional(),
    contacto: z
      .object({
        firstName: z.string().min(1, 'Falta el nombre'),
        lastName: z.string().optional(),
        email: z.preprocess(emptyToUndef, z.string().email().optional()),
        phone: z.preprocess(emptyToUndef, z.string().max(40).optional()),
      })
      .optional(),

    crmCompanyId: z.string().min(1).optional(),
    leadSource: leadSourceEnum.optional(),
    leadSourceDetail: z.preprocess(emptyToUndef, z.string().max(160).optional()),
    name: z.preprocess(emptyToUndef, z.string().max(200).optional()),
    notes: z.preprocess(emptyToUndef, z.string().max(2000).optional()),
  })
  .superRefine((d, ctx) => {
    // Una privada puede ser de particular o de empresa, y eso hay que decirlo.
    if (d.experienceKind === 'PRIVADA' && !d.buyerKind) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['buyerKind'],
        message: 'En una experiencia privada hay que indicar si es Social o Corporativo',
      });
    }
    if (!d.contactId && !d.contacto) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contacto'],
        message: 'Indica un contacto existente o los datos de uno nuevo',
      });
    }
    // Un lead sin forma de contactarlo no sirve para nada.
    if (d.contacto && !d.contacto.email && !d.contacto.phone) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['contacto'],
        message: 'Hace falta al menos un teléfono o un correo',
      });
    }
    if (
      d.leadSource &&
      ['REFERIDO', 'RESELLER'].includes(d.leadSource) &&
      !d.leadSourceDetail
    ) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['leadSourceDetail'],
        message: 'Indica quién refirió o de qué canal viene',
      });
    }
  });

export type CrearSolicitudInput = z.infer<typeof crearSolicitudSchema>;

export const createOpportunitySchema = z.object({
  name: z.string().min(1),
  hostCompany: z.string().min(1).optional(), // si no viene, JWT
  crmCompany: z.string().min(1).optional(),
  contact: z.string().min(1).optional(),
  stage: stageEnum.optional().default('PROSPECTING'),
  status: statusEnum.optional().default('OPEN'),
  value: z.number().nonnegative().optional(),
  currency: z.string().optional().default('COP'),
  expectedCloseDate: z.string().optional(),
  actualCloseDate: z.string().optional(),
  description: z.string().optional(),
  lostReason: z.string().optional(),
  lostReasonNotes: z.string().optional(),
  wonReason: z.string().optional(),
  source: z.string().optional(),
  experienceKind: experienceKindEnum.optional(),
  buyerKind: buyerKindEnum.optional(),
  leadSource: leadSourceEnum.optional(),
  leadSourceDetail: z.string().max(160).optional(),
  assignedTo: z.string().min(1),
  notes: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
  experiences: z.array(experienceItemSchema).optional().default([]),
  decisionMakers: z.array(z.string().min(1)).optional().default([]),
  isActive: z.boolean().optional().default(true),
  createdBy: z.string().min(1).optional(), // si no viene, JWT
});

export const updateOpportunitySchema = z.object({
  name: z.string().min(1).optional(),
  crmCompany: z.string().nullable().optional(),
  contact: z.string().nullable().optional(),
  stage: stageEnum.optional(),
  status: statusEnum.optional(),
  value: z.number().nullable().optional(),
  currency: z.string().optional(),
  expectedCloseDate: z.string().nullable().optional(),
  actualCloseDate: z.string().nullable().optional(),
  description: z.string().nullable().optional(),
  lostReason: z.string().nullable().optional(),
  lostReasonNotes: z.string().nullable().optional(),
  wonReason: z.string().nullable().optional(),
  source: z.string().nullable().optional(),
  // null = desasignar; undefined = no tocar; string = nuevo asignado
  assignedTo: z.string().min(1).nullable().optional(),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  experiences: z.array(experienceItemSchema).optional(),
  decisionMakers: z.array(z.string().min(1)).optional(),
  isActive: z.boolean().optional(),
});

export const listOpportunitiesQuerySchema = z.object({
  hostCompanyId: z.string().min(1).optional(),
  stage: stageEnum.optional(),
  status: statusEnum.optional(),
  source: z.string().optional(),
  assignedTo: z.string().optional(),
  crmCompany: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().optional(),
  sortBy: z
    .enum(['name', 'value', 'stage', 'status', 'expectedCloseDate', 'createdAt', 'updatedAt'])
    .optional()
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  limit: z.coerce.number().int().positive().max(200).optional(),
});

export const opportunityIdParamsSchema = z.object({ id: z.string().min(1) });

export type CreateOpportunityInput = z.infer<typeof createOpportunitySchema>;
export type UpdateOpportunityInput = z.infer<typeof updateOpportunitySchema>;
export type ListOpportunitiesQuery = z.infer<typeof listOpportunitiesQuerySchema>;
