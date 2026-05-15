import { z } from 'zod';

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

export const createCrmCompanySchema = z.object({
  hostCompany: z.string().min(1).optional(), // si no viene, JWT
  companyName: z.string().min(1),
  businessName: optStr,
  companyType: optStr,
  industry: optStr,
  description: optStr,
  email: optEmail,
  phone: optStr,
  website: optUrl,
  documentType: optStr,
  documentNumber: optStr,
  address: addressSchema.optional(),
  employeeCount: optStr,
  annualRevenue: optStr,
  logo: optUrl,
  status: optStr,
  source: optStr,
  notes: z.string().optional(),
  tags: z.array(z.string()).optional().default([]),
  socialMedia: socialMediaSchema.optional(),
  assignedTo: z.string().min(1).optional(),
  lastContactDate: z.string().optional(),
  nextFollowUp: z.string().optional(),
  isActive: z.boolean().optional().default(true),
});

const nullishStr = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().nullable().optional(),
);
const nullishUrl = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().url().nullable().optional(),
);
const nullishEmail = z.preprocess(
  (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
  z.string().email().nullable().optional(),
);

export const updateCrmCompanySchema = z.object({
  companyName: z.string().min(1).optional(),
  businessName: nullishStr,
  companyType: nullishStr,
  industry: nullishStr,
  description: nullishStr,
  email: nullishEmail,
  phone: nullishStr,
  website: nullishUrl,
  documentType: nullishStr,
  documentNumber: nullishStr,
  address: addressSchema.nullable().optional(),
  employeeCount: nullishStr,
  annualRevenue: nullishStr,
  logo: nullishUrl,
  status: nullishStr,
  source: nullishStr,
  notes: nullishStr,
  tags: z.array(z.string()).optional(),
  socialMedia: socialMediaSchema.nullable().optional(),
  assignedTo: z.string().nullable().optional(),
  lastContactDate: z.string().nullable().optional(),
  nextFollowUp: z.string().nullable().optional(),
  isActive: z.boolean().optional(),
});

export const listCrmCompaniesQuerySchema = z.object({
  hostCompanyId: z.string().min(1).optional(),
  companyType: z.string().optional(),
  status: z.string().optional(),
  industry: z.string().optional(),
  source: z.string().optional(),
  assignedTo: z.string().optional(),
  isActive: z.coerce.boolean().optional(),
  search: z.string().optional(),
  sortBy: z
    .enum(['companyName', 'createdAt', 'lastContactDate', 'nextFollowUp'])
    .optional()
    .default('createdAt'),
  sortOrder: z.enum(['asc', 'desc']).optional().default('desc'),
  limit: z.coerce.number().int().positive().max(200).optional().default(50),
});

export const crmCompanyIdParamsSchema = z.object({ id: z.string().min(1) });

export type CreateCrmCompanyInput = z.infer<typeof createCrmCompanySchema>;
export type UpdateCrmCompanyInput = z.infer<typeof updateCrmCompanySchema>;
export type ListCrmCompaniesQuery = z.infer<typeof listCrmCompaniesQuerySchema>;
