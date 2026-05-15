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
