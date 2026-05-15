import { z } from 'zod';

const statusEnum = z.enum(['ACTIVE', 'INACTIVE', 'QUALIFIED', 'UNQUALIFIED', 'ARCHIVED']);

const addressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
});

const socialMediaSchema = z.object({
  linkedin: z.string().optional(),
  twitter: z.string().optional(),
  facebook: z.string().optional(),
  instagram: z.string().optional(),
});

const emptyToUndef = (v: unknown) => (typeof v === 'string' && v.trim() === '' ? undefined : v);
const optStr = z.preprocess(emptyToUndef, z.string().optional());
const optEmail = z.preprocess(emptyToUndef, z.string().email().optional());
const optUrl = z.preprocess(emptyToUndef, z.string().url().optional());

export const createContactSchema = z.object({
  hostCompany: z.string().min(1).optional(), // si no viene usamos companyId del JWT
  firstName: z.string().min(1),
  lastName: z.string().optional(),
  email: optEmail,
  phone: optStr,
  mobile: optStr,
  jobTitle: optStr,
  department: optStr,
  company: z.string().min(1).optional(), // crmCompanyId
  contactType: optStr,
  status: statusEnum.optional().default('ACTIVE'),
  source: optStr,
  address: addressSchema.optional(),
  avatar: optUrl,
  notes: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
  socialMedia: socialMediaSchema.optional(),
  assignedTo: z.string().min(1).optional(),
  createdBy: z.string().min(1).optional(), // si no viene usamos id del JWT
  lastContactDate: z.string().optional(),
  nextFollowUp: z.string().optional(),
  isActive: z.boolean().optional().default(true),
});

export const updateContactSchema = z.object({
  firstName: z.string().min(1).optional(),
  lastName: z.string().nullable().optional(),
  email: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().email().nullable().optional(),
  ),
  phone: z.string().nullable().optional(),
  mobile: z.string().nullable().optional(),
  jobTitle: z.string().nullable().optional(),
  department: z.string().nullable().optional(),
  company: z.string().nullable().optional(),
  contactType: z.string().nullable().optional(),
  status: statusEnum.optional(),
  source: z.string().nullable().optional(),
  address: addressSchema.nullable().optional(),
  avatar: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z.string().url().nullable().optional(),
  ),
  notes: z.string().nullable().optional(),
  tags: z.array(z.string()).optional(),
  socialMedia: socialMediaSchema.nullable().optional(),
  assignedTo: z.string().nullable().optional(),
  lastContactDate: z.string().nullable().optional(),
  nextFollowUp: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const listContactsQuerySchema = z.object({
  hostCompanyId: z.string().min(1).optional(),
  contactType: z.string().optional(),
  status: statusEnum.optional(),
  source: z.string().optional(),
  company: z.string().optional(),
  assignedTo: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().optional(),
  sortBy: z
    .enum(['firstName', 'lastName', 'createdAt', 'lastContactDate', 'nextFollowUp'])
    .optional()
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
});

export const contactIdParamsSchema = z.object({ id: z.string().min(1) });

export type CreateContactInput = z.infer<typeof createContactSchema>;
export type UpdateContactInput = z.infer<typeof updateContactSchema>;
export type ListContactsQuery = z.infer<typeof listContactsQuerySchema>;
