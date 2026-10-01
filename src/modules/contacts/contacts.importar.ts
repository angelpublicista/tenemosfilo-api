// CRM-30. Importacion masiva de contactos desde un archivo.
//
// Lo que entra aqui es una base historica: una hoja que alguien lleva años
// manteniendo a mano, con columnas raras, filas a medias y repetidos. Dos
// decisiones vienen de ahi:
//
// 1. Solo se exige el nombre. Pedir correo o telefono rechazaria media hoja, y
//    el requisito dice expresamente que no hay que completar cada registro
//    antes de importarlo. Lo que falte se dice en el resumen.
// 2. Una fila mala no tumba la importacion. Se procesan todas y al final se
//    cuenta que paso con cada una: lo contrario obligaria a limpiar el archivo
//    entero antes de poder meter nada.
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { Forbidden } from '../../lib/errors.js';
import type { ImportarContactosInput } from './contacts.schemas.js';

/**
 * Que hacer cuando el contacto ya existe.
 *
 * Las reglas definitivas de deduplicacion estan sin decidir en el documento de
 * revision, asi que no se cablean: se eligen en cada importacion. COMPLETAR es
 * el defecto porque es el unico que no puede perder datos.
 */
export type SiExiste = 'OMITIR' | 'COMPLETAR' | 'SOBRESCRIBIR';

export interface ResumenDeImportacion {
  creados: number;
  actualizados: number;
  omitidos: number;
  /** Filas repetidas dentro del propio archivo. */
  repetidosEnElArchivo: number;
  /** Contactos que entraron sin correo ni telefono. */
  sinFormaDeContacto: number;
  /** Correos que venian mal escritos: el contacto entro, el correo no. */
  correosInvalidos: number;
  empresasCreadas: number;
  errores: Array<{ fila: number; motivo: string }>;
}

/**
 * Para comparar: sin acentos, sin espacios de mas y en minusculas.
 *
 * Los espacios internos se colapsan tambien, no solo los de los extremos. En
 * una hoja mantenida a mano "Jose  Munoz" con dos espacios es constante, y sin
 * esto entraria como una persona distinta de "Jose Munoz".
 */
function normalizar(v: string | null | undefined): string {
  return (v ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

/**
 * Un correo utilizable.
 *
 * Deliberadamente laxa: esto viene de una hoja escrita a mano y lo unico que
 * se descarta es lo que no puede ser un correo de ninguna manera. Guardar
 * basura seria peor —rebotaria cada envio— pero rechazar de mas deja sin
 * correo a gente que si lo tiene.
 */
function correoUtilizable(v: string | undefined): string | null {
  const t = v?.trim();
  if (!t) return null;
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(t) ? t : null;
}

/** Un telefono se compara por sus digitos: +57 300 123 vs 300123 es el mismo. */
function soloDigitos(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '');
}

/**
 * Las claves por las que se reconoce un contacto, en orden de confianza.
 *
 * El correo identifica a una persona; el telefono casi —se comparte en
 * familias y empresas pequeñas—; el nombre es el ultimo recurso y falla con
 * los homonimos. Se usa la primera que exista, y cual fue se dice en el
 * resumen para que nadie tenga que adivinar por que se fusionaron dos filas.
 */
function clavesDe(c: { email?: string | null; phone?: string | null; mobile?: string | null; firstName: string; lastName?: string | null }): string[] {
  const claves: string[] = [];
  if (c.email) claves.push(`e:${normalizar(c.email)}`);
  const tel = soloDigitos(c.phone) || soloDigitos(c.mobile);
  // Menos de 7 digitos no identifica a nadie: es una extension o un error.
  if (tel.length >= 7) claves.push(`t:${tel.slice(-10)}`);
  claves.push(`n:${normalizar(c.firstName)} ${normalizar(c.lastName)}`.trim());
  return claves;
}

export const importarContactos = {
  async ejecutar(
    requesterId: string,
    requesterCompanyId: string | null | undefined,
    input: ImportarContactosInput,
  ): Promise<ResumenDeImportacion> {
    if (!requesterCompanyId) throw Forbidden('No tienes una company asociada');
    const siExiste = input.siExiste ?? 'COMPLETAR';

    const resumen: ResumenDeImportacion = {
      creados: 0,
      actualizados: 0,
      omitidos: 0,
      repetidosEnElArchivo: 0,
      sinFormaDeContacto: 0,
      correosInvalidos: 0,
      empresasCreadas: 0,
      errores: [],
    };

    // Se traen una vez los que ya hay y se cruzan en memoria. Con una consulta
    // por fila, importar cinco mil contactos serian diez mil viajes a la base.
    const existentes = await prisma.contact.findMany({
      where: { hostCompanyId: requesterCompanyId, deletedAt: null },
      select: {
        id: true, firstName: true, lastName: true, email: true, phone: true, mobile: true,
        jobTitle: true, department: true, notes: true, source: true, tags: true,
        crmCompanyId: true,
      },
    });

    const porClave = new Map<string, (typeof existentes)[number]>();
    for (const c of existentes) {
      for (const k of clavesDe(c)) if (!porClave.has(k)) porClave.set(k, c);
    }

    // Las empresas del CRM, para poder enlazar la columna "empresa" sin crear
    // una copia nueva de cada una en cada importacion.
    const empresas = await prisma.crmCompany.findMany({
      where: { hostCompanyId: requesterCompanyId, deletedAt: null },
      select: { id: true, companyName: true },
    });
    const empresaPorNombre = new Map(empresas.map((e) => [normalizar(e.companyName), e.id]));

    const vistasEnElArchivo = new Set<string>();

    for (const [i, fila] of input.contactos.entries()) {
      // La fila 1 es la de encabezados, asi que la primera de datos es la 2.
      const numeroDeFila = i + 2;
      try {
        const firstName = fila.firstName?.trim();
        if (!firstName) {
          resumen.errores.push({ fila: numeroDeFila, motivo: 'Sin nombre' });
          continue;
        }

        const email = correoUtilizable(fila.email);
        if (fila.email?.trim() && !email) resumen.correosInvalidos += 1;

        const claves = clavesDe({ ...fila, firstName, email });

        // Repetidos dentro del propio archivo: la hoja de la que salen suele
        // traerlos, y sin esto se crearian dos veces o se pisarian entre si.
        if (claves.some((k) => vistasEnElArchivo.has(k))) {
          resumen.repetidosEnElArchivo += 1;
          continue;
        }
        for (const k of claves) vistasEnElArchivo.add(k);

        if (!email && !fila.phone && !fila.mobile) resumen.sinFormaDeContacto += 1;

        let crmCompanyId: string | null = null;
        if (fila.empresa?.trim()) {
          const clave = normalizar(fila.empresa);
          crmCompanyId = empresaPorNombre.get(clave) ?? null;
          if (!crmCompanyId) {
            const nueva = await prisma.crmCompany.create({
              data: { hostCompanyId: requesterCompanyId, companyName: fila.empresa.trim() },
              select: { id: true },
            });
            crmCompanyId = nueva.id;
            empresaPorNombre.set(clave, nueva.id);
            resumen.empresasCreadas += 1;
          }
        }

        const existente = claves.map((k) => porClave.get(k)).find(Boolean);

        if (existente) {
          if (siExiste === 'OMITIR') {
            resumen.omitidos += 1;
            continue;
          }
          // COMPLETAR solo rellena huecos; SOBRESCRIBIR pisa con lo que traiga
          // el archivo, pero nunca borra con un campo vacio: una columna que no
          // venia en la hoja no es una orden de vaciar lo que ya habia.
          const nuevo = (campo: keyof typeof existente, valor: string | null | undefined) => {
            const v = typeof valor === 'string' ? valor.trim() : valor;
            if (!v) return undefined;
            if (siExiste === 'SOBRESCRIBIR') return v;
            return existente[campo] ? undefined : v;
          };

          const datos: Prisma.ContactUpdateInput = {};
          const apellido = nuevo('lastName', fila.lastName);
          if (apellido !== undefined) datos.lastName = apellido;
          const correo = nuevo('email', email);
          if (correo !== undefined) datos.email = correo;
          const telefono = nuevo('phone', fila.phone);
          if (telefono !== undefined) datos.phone = telefono;
          const movil = nuevo('mobile', fila.mobile);
          if (movil !== undefined) datos.mobile = movil;
          const cargo = nuevo('jobTitle', fila.jobTitle);
          if (cargo !== undefined) datos.jobTitle = cargo;
          const notas = nuevo('notes', fila.notas);
          if (notas !== undefined) datos.notes = notas;
          const origen = nuevo('source', fila.origen);
          if (origen !== undefined) datos.source = origen;
          if (crmCompanyId && (siExiste === 'SOBRESCRIBIR' || !existente.crmCompanyId)) {
            datos.crmCompany = { connect: { id: crmCompanyId } };
          }
          // Las etiquetas se suman en vez de sustituirse: son acumulativas por
          // naturaleza y perder las que ya tenia seria una sorpresa.
          if (fila.etiquetas?.length) {
            datos.tags = [...new Set([...existente.tags, ...fila.etiquetas])];
          }

          if (Object.keys(datos).length === 0) {
            resumen.omitidos += 1;
            continue;
          }
          await prisma.contact.update({ where: { id: existente.id }, data: datos });
          resumen.actualizados += 1;
          continue;
        }

        const creado = await prisma.contact.create({
          data: {
            hostCompanyId: requesterCompanyId,
            firstName,
            lastName: fila.lastName?.trim() || null,
            email,
            phone: fila.phone?.trim() || null,
            mobile: fila.mobile?.trim() || null,
            jobTitle: fila.jobTitle?.trim() || null,
            notes: fila.notas?.trim() || null,
            source: fila.origen?.trim() || null,
            tags: fila.etiquetas ?? [],
            ...(crmCompanyId ? { crmCompanyId } : {}),
            createdById: requesterId,
          },
          select: {
            id: true, firstName: true, lastName: true, email: true, phone: true, mobile: true,
            jobTitle: true, department: true, notes: true, source: true, tags: true,
            crmCompanyId: true,
          },
        });
        // Entra al indice para que una fila posterior lo reconozca como
        // existente en vez de crearlo otra vez.
        for (const k of clavesDe(creado)) if (!porClave.has(k)) porClave.set(k, creado);
        resumen.creados += 1;
      } catch (err) {
        resumen.errores.push({
          fila: numeroDeFila,
          motivo: err instanceof Error ? err.message : 'No se pudo importar',
        });
      }
    }

    return resumen;
  },
};
