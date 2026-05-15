import { z } from 'zod';

const companyTypeEnum = z.enum(['RESTAURANT', 'CATERING', 'FOODTRUCK', 'OTHER']);
const documentTypeEnum = z.enum(['NIT', 'CEDULA', 'PASAPORTE', 'OTHER']);

const addressSchema = z.object({
  street: z.string().optional(),
  city: z.string().optional(),
  state: z.string().optional(),
  postalCode: z.string().optional(),
  country: z.string().optional(),
});

// Helpers: aceptar string vacio como undefined/null para no fallar zod
// cuando el form manda inputs sin tocar.
const emptyToUndef = (v: unknown) =>
  typeof v === 'string' && v.trim() === '' ? undefined : v;

const optStr = z.preprocess(emptyToUndef, z.string().optional());
const optUrl = z.preprocess(emptyToUndef, z.string().url().optional());
const optEmail = z.preprocess(emptyToUndef, z.string().email().optional());

// Para PATCH admite null explicito = "borrar el campo".
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

export const createCompanySchema = z.object({
  companyName: z.string().min(1),
  companyType: companyTypeEnum.optional(),
  description: optStr,
  companyEmail: optEmail,
  companyPhone: optStr,
  logo: optUrl,
  documentType: documentTypeEnum.optional(),
  documentNumber: optStr,
  businessName: optStr,
  website: optUrl,
  address: addressSchema.optional(),
  employeeCount: optStr,
  annualRevenue: optStr,
  businessYears: optStr,
});

// PATCH: todos los campos opcionales, y los "clearables" admiten null.
export const updateCompanySchema = z.object({
  companyName: z.string().min(1).optional(),
  companyType: companyTypeEnum.nullable().optional(),
  description: nullishStr,
  companyEmail: nullishEmail,
  companyPhone: nullishStr,
  logo: nullishUrl,
  documentType: documentTypeEnum.nullable().optional(),
  documentNumber: nullishStr,
  businessName: nullishStr,
  website: nullishUrl,
  address: addressSchema.nullable().optional(),
  employeeCount: nullishStr,
  annualRevenue: nullishStr,
  businessYears: nullishStr,
});

export const companyIdParamsSchema = z.object({ id: z.string().min(1) });

export type CreateCompanyInput = z.infer<typeof createCompanySchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
