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
  tagline: optStr,
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
  tagline: nullishStr,
  openTableRid: nullishStr,
  // Ajustes de operacion: cambian como entran las reservas.
  autoConfirmReservations: z.boolean().optional(),
  blockWhenFull: z.boolean().optional(),
});

export const companyIdParamsSchema = z.object({ id: z.string().min(1) });

/**
 * Dominios autorizados a insertar el catalogo. Se validan como texto libre
 * y se normalizan en el servicio: la gente pega la URL de muchas formas.
 * Lista vacia = cualquiera puede insertarlo.
 */
export const embedDomainsSchema = z.object({
  embedDomains: z.array(z.string().trim().min(1)).max(50),
});

export type EmbedDomainsInput = z.infer<typeof embedDomainsSchema>;

/**
 * Dueño de la empresa. Solo el ADMIN puede indicarlo: crea empresas para
 * terceros, y sin esto quedaria el mismo como dueño de todas. Para el resto
 * de roles el dueño es siempre quien llama.
 */
export const createCompanyAsAdminSchema = createCompanySchema.extend({
  ownerId: z.string().min(1).optional(),
});

// Listado global de empresas (solo ADMIN). Mismo shape de paginacion que
// listUsersQuerySchema para que el front trate ambos listados igual.
export const listCompaniesQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  search: z.string().trim().optional(),
  /** true = solo desactivadas, false = solo activas, omitido = todas */
  deleted: z.coerce.boolean().optional(),
});

export type CreateCompanyInput = z.infer<typeof createCompanyAsAdminSchema>;
export type UpdateCompanyInput = z.infer<typeof updateCompanySchema>;
export type ListCompaniesQuery = z.infer<typeof listCompaniesQuerySchema>;
