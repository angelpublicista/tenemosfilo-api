import { z } from 'zod';
import { CompanyType, PersonType, CompanyContactType } from '@prisma/client';
import { esVideoSoportado } from '../../lib/video-embed.js';

// Se saca del enum de Prisma en vez de escribir la lista otra vez: estaban
// duplicadas y ya se habian desincronizado —el schema y este archivo decian
// cosas distintas al añadir tipos nuevos—. Asi el esquema de la base es la
// unica fuente y esto no puede quedarse atras.
const companyTypeEnum = z.nativeEnum(CompanyType);
const personTypeEnum = z.nativeEnum(PersonType);
const documentTypeEnum = z.enum(['NIT', 'CEDULA', 'PASAPORTE', 'OTHER']);
// El del representante legal identifica a una PERSONA: un NIT es de empresa.
const personDocumentTypeEnum = z.enum(['CEDULA', 'PASAPORTE', 'OTHER']);

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

/**
 * Color de marca en hexadecimal.
 *
 * Se exige la forma completa #RRGGBB, en vez de admitir tambien #RGB o un
 * nombre CSS, porque este valor acaba dentro de un atributo style de un correo
 * y de una variable CSS del catalogo: cuanto mas estrecho sea lo que entra,
 * menos hay que vigilar donde sale. El selector de color del navegador entrega
 * justo este formato.
 */
const HEX = /^#[0-9a-fA-F]{6}$/;
const normalizarHex = (v: unknown) => {
  if (typeof v !== 'string') return v;
  const t = v.trim();
  if (t === '') return undefined;
  // En mayusculas siempre: si no, el mismo color entra como #f26726 o
  // #F26726 segun quien lo mande y no habria forma de compararlos.
  return HEX.test(t) ? t.toUpperCase() : t;
};
/**
 * Codigo CIIU: cuatro digitos.
 *
 * No se valida contra una lista de codigos existentes a proposito. La
 * clasificacion la fija la DIAN y cambia sin avisar; una lista aqui
 * rechazaria el codigo que el anfitrion tiene impreso en su RUT en cuanto
 * saliera uno nuevo.
 */
const CIIU = /^[0-9]{4}$/;
const limpiarCiiu = (v: unknown) => (typeof v === 'string' ? v.trim() : v);
const optCiiu = z.preprocess(
  (v) => {
    const t = limpiarCiiu(v);
    return t === '' ? undefined : t;
  },
  z.string().regex(CIIU, 'El código CIIU son cuatro dígitos').optional(),
);
const nullishCiiu = z.preprocess(
  (v) => {
    const t = limpiarCiiu(v);
    return t === '' ? null : t;
  },
  z.string().regex(CIIU, 'El código CIIU son cuatro dígitos').nullable().optional(),
);

/**
 * Un contacto de la empresa.
 *
 * El telefono y el cargo son opcionales; el nombre y el correo no, porque un
 * contacto sin a quien escribir no sirve para lo unico que hace.
 */
const contactSchema = z.object({
  /**
   * El id del contacto cuando ya existe.
   *
   * Sin esto, guardar la empresa borraba los contactos y los volvia a crear
   * con ids nuevos. Da igual mientras nadie los referencie, pero las sedes
   * apuntan a uno como responsable: se habrian quedado sin el cada vez que el
   * anfitrion tocara su ficha, y sin avisar.
   */
  id: z.string().min(1).optional(),
  type: z.nativeEnum(CompanyContactType),
  // Los obligatorios se llaman por su tipo; solo OTRO necesita nombre propio.
  label: z.preprocess(emptyToUndef, z.string().max(60).optional()),
  name: z.string().min(2).max(120),
  email: z.string().email(),
  phone: z.preprocess(emptyToUndef, z.string().max(40).optional()),
  position: z.preprocess(emptyToUndef, z.string().max(80).optional()),
});

/**
 * La lista completa de contactos: sustituye a la que hubiera.
 *
 * Se manda entera y no por piezas porque el formulario la edita entera. Y al
 * ser opcional, un PATCH que no la traiga deja los contactos como estan: sin
 * eso, guardar el color de marca borraria la agenda.
 */
const contactsSchema = z
  .array(contactSchema)
  .max(5)
  .superRefine((lista, ctx) => {
    const cuantos = (t: CompanyContactType) => lista.filter((c) => c.type === t).length;
    for (const t of [CompanyContactType.RESERVAS, CompanyContactType.CONTABILIDAD]) {
      if (cuantos(t) > 1) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: `Solo puede haber un contacto de ${t.toLowerCase()}`,
        });
      }
    }
    if (cuantos(CompanyContactType.OTRO) > 3) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        message: 'Como maximo 3 contactos adicionales',
      });
    }
    lista.forEach((c, i) => {
      // Un contacto libre sin etiqueta seria una fila sin titulo en la ficha.
      if (c.type === CompanyContactType.OTRO && !c.label) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: [i, 'label'],
          message: 'Indica para que es este contacto',
        });
      }
    });
  });

const optColor = z.preprocess(normalizarHex, z.string().regex(HEX).optional());
const nullishColor = z.preprocess(
  (v) => {
    const n = normalizarHex(v);
    return n === undefined ? null : n;
  },
  z.string().regex(HEX).nullable().optional(),
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
  documentDv: optStr,
  businessName: optStr,
  website: optUrl,
  address: addressSchema.optional(),
  employeeCount: optStr,
  annualRevenue: optStr,
  businessYears: optStr,
  tagline: optStr,
  personType: personTypeEnum.optional(),
  ciiuCode: optCiiu,
  legalRepName: optStr,
  legalRepDocType: personDocumentTypeEnum.optional(),
  legalRepDocNumber: optStr,
  contacts: contactsSchema.optional(),
  companyTypeSecondary: companyTypeEnum.optional(),
  brandPrimary: optColor,
  brandSecondary: optColor,
  // Claves de S3, no URLs: viven en el prefijo privado (ver uploads.schemas).
  rutKey: optStr,
  camaraKey: optStr,
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
  documentDv: nullishStr,
  businessName: nullishStr,
  website: nullishUrl,
  address: addressSchema.nullable().optional(),
  employeeCount: nullishStr,
  annualRevenue: nullishStr,
  businessYears: nullishStr,
  tagline: nullishStr,
  personType: personTypeEnum.nullable().optional(),
  ciiuCode: nullishCiiu,
  legalRepName: nullishStr,
  legalRepDocType: personDocumentTypeEnum.nullable().optional(),
  legalRepDocNumber: nullishStr,
  contacts: contactsSchema.optional(),
  companyTypeSecondary: companyTypeEnum.nullable().optional(),
  // null borra el color y devuelve el catalogo a los de la plataforma.
  brandPrimary: nullishColor,
  brandSecondary: nullishColor,
  rutKey: nullishStr,
  camaraKey: nullishStr,
  openTableRid: nullishStr,
  // Portada del catalogo. Un slider con una sola imagen es una imagen, y
  // seis ya son demasiadas para que alguien las vea todas.
  coverType: z.enum(['NONE', 'IMAGE', 'VIDEO', 'SLIDER']).optional(),
  coverImages: z.array(z.string().url()).max(6).optional(),
  // Solo YouTube o Vimeo: son los que permiten incrustar sin controles y
  // sin que el anfitrion tenga que alojar el archivo.
  coverVideo: z.preprocess(
    (v) => (typeof v === 'string' && v.trim() === '' ? null : v),
    z
      .string()
      .refine(esVideoSoportado, 'Pega un enlace de YouTube o de Vimeo')
      .nullable()
      .optional(),
  ),
  // Ajustes de operacion: cambian como entran las reservas.
  autoConfirmReservations: z.boolean().optional(),
  blockWhenFull: z.boolean().optional(),
  // nullable ademas de optional: null es "usar el valor de la plataforma",
  // que es una eleccion distinta de no mandar el campo.
  requirePayment: z.boolean().nullable().optional(),
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

/** Cambio de titular. Solo ADMIN. */
export const transferirTitularidadSchema = z.object({
  ownerId: z.string().min(1),
});

export type TransferirTitularidadInput = z.infer<typeof transferirTitularidadSchema>;
