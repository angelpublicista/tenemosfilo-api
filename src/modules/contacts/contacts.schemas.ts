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
  doNotContact: z.boolean().optional(),
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
  doNotContact: z.boolean().optional(),
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
  /**
   * CRM-20. Filtrar por la relacion comercial, que sale de las ventas y no de
   * un campo de la ficha.
   */
  condicion: z.enum(['PROSPECTO', 'CLIENTE', 'RECURRENTE']).optional(),
  hostCompanyId: z.string().min(1).optional(),
  contactType: z.string().optional(),
  status: statusEnum.optional(),
  doNotContact: z.boolean().optional(),
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

/**
 * CRM-30. Una base historica que llega de una hoja de calculo.
 *
 * Solo el nombre es obligatorio: pedir correo o telefono rechazaria media hoja
 * y el requisito dice expresamente que no hay que completar cada registro
 * antes de importarlo. El correo se valida con suavidad —si viene mal, se
 * guarda el contacto sin el en vez de descartar la fila entera.
 */
const filaDeContacto = z.object({
  // Opcional aqui, aunque sin el la fila no sirve: si lo exigiera, una sola
  // fila sin nombre —y una hoja historica siempre trae alguna— rechazaria el
  // archivo entero. Lo revisa el servicio, que puede señalar que fila fue y
  // dejar entrar al resto.
  firstName: z.preprocess(emptyToUndef, z.string().max(120).optional()),
  lastName: z.string().max(120).optional(),
  // Sin validar el formato aqui a proposito: un correo mal escrito no
  // justifica tirar la fila entera, y descartarlo en silencio deja a alguien
  // sin correo sin enterarse. Lo revisa el servicio, que si puede contarlos y
  // decirlo en el resumen.
  email: z.preprocess(emptyToUndef, z.string().max(200).optional()),
  phone: z.preprocess(emptyToUndef, z.string().max(40).optional()),
  mobile: z.preprocess(emptyToUndef, z.string().max(40).optional()),
  jobTitle: z.preprocess(emptyToUndef, z.string().max(120).optional()),
  empresa: z.preprocess(emptyToUndef, z.string().max(200).optional()),
  notas: z.preprocess(emptyToUndef, z.string().max(2000).optional()),
  origen: z.preprocess(emptyToUndef, z.string().max(80).optional()),
  etiquetas: z.array(z.string().max(60)).max(20).optional(),
});

export const importarContactosSchema = z.object({
  /**
   * Que hacer con los que ya existen. Se elige en cada importacion: depende
   * de que archivo sea, no de una regla fija de la empresa.
   */
  siExiste: z.enum(['OMITIR', 'COMPLETAR', 'SOBRESCRIBIR']).optional().default('COMPLETAR'),
  // Por tanda, no por archivo: una hoja grande llega en varias y la pantalla
  // va contando. Asi tampoco se pasa del limite del cuerpo de la peticion.
  contactos: z.array(filaDeContacto).min(1).max(500),
});

export type ImportarContactosInput = z.infer<typeof importarContactosSchema>;
