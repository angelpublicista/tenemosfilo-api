// El comprador de una reserva, como contacto del anfitrion (TR-26).
//
// Una venta de revendedor le dejaba al anfitrion el dinero pero no el cliente:
// el comprador vivia dentro del JSON de la reserva y el CRM no se enteraba.
// Quien vende una cena quiere poder invitar a esa persona a la siguiente.
//
// Lo que NO hace, a proposito: crear una oportunidad. Una compra por catalogo
// ya esta cerrada; meterla en el embudo llenaria el CRM de ventas que nadie
// tiene que trabajar. Eso lo dice el documento (TR-03) y lo repite aqui.
import { prisma } from '../config/prisma.js';

/** Un telefono se compara por sus digitos: +57 300 123 vs 300123 es el mismo. */
function soloDigitos(v: string | null | undefined): string {
  return (v ?? '').replace(/\D/g, '');
}

function partirNombre(nombre: string): { firstName: string; lastName: string | null } {
  const partes = nombre.trim().split(/\s+/);
  if (partes.length <= 1) return { firstName: partes[0] || 'Cliente', lastName: null };
  return { firstName: partes[0]!, lastName: partes.slice(1).join(' ') };
}

export interface CompradorDeReserva {
  name?: string | null;
  email?: string | null;
  phone?: string | null;
}

/**
 * Busca al comprador entre los contactos del anfitrion y, si no esta, lo crea.
 *
 * El cruce es el mismo que la importacion (TR-41): correo exacto o los diez
 * ultimos digitos del telefono. Nada de nombres: dos Juan Perez son dos
 * personas, y fundir sus fichas es peor que tener dos.
 *
 * Sin correo ni telefono devuelve null. Crear una ficha sin forma de contacto
 * es basura en el CRM, y cruzarla con alguien seria adivinar.
 */
export async function vincularCompradorAlCrm(
  hostCompanyId: string,
  comprador: CompradorDeReserva,
  origen: string,
): Promise<string | null> {
  const correo = comprador.email?.trim() || null;
  const telefono = soloDigitos(comprador.phone);
  const tel10 = telefono.length >= 7 ? telefono.slice(-10) : null;
  if (!correo && !tel10) return null;

  // Los telefonos se comparan por sus digitos y no por el texto guardado:
  // "+57 300 123 4567" y "3001234567" son el mismo numero, y en el CRM
  // conviven las dos formas porque cada uno lo teclea como quiere. Eso no se
  // puede expresar con `endsWith` sobre la columna, de ahi el SQL.
  const encontrados = await prisma.$queryRaw<{ id: string }[]>`
    SELECT c."id"
    FROM "Contact" c
    WHERE c."hostCompanyId" = ${hostCompanyId}
      AND c."deletedAt" IS NULL
      AND (
        (${correo}::text IS NOT NULL AND lower(c."email") = lower(${correo}::text))
        OR (
          ${tel10}::text IS NOT NULL
          AND (
            regexp_replace(COALESCE(c."phone", ''), '[^0-9]', '', 'g') LIKE '%' || ${tel10}::text
            OR regexp_replace(COALESCE(c."mobile", ''), '[^0-9]', '', 'g') LIKE '%' || ${tel10}::text
          )
        )
      )
    ORDER BY c."createdAt" ASC
    LIMIT 1
  `;

  const existente = encontrados[0]
    ? await prisma.contact.findUnique({
        where: { id: encontrados[0].id },
        select: { id: true, email: true, phone: true },
      })
    : null;

  if (existente) {
    // Se rellenan huecos, no se sobrescribe: lo que el anfitrion tenga escrito
    // de su cliente vale mas que lo que teclearon en un checkout.
    await prisma.contact.update({
      where: { id: existente.id },
      data: {
        ...(correo && !existente.email ? { email: correo } : {}),
        ...(comprador.phone && !existente.phone ? { phone: comprador.phone } : {}),
        lastContactDate: new Date(),
      },
    });
    return existente.id;
  }

  const { firstName, lastName } = partirNombre(comprador.name || 'Cliente');
  const creado = await prisma.contact.create({
    data: {
      hostCompanyId,
      firstName,
      lastName,
      email: correo,
      phone: comprador.phone?.trim() || null,
      // De donde salio el cliente. Importa: un cliente que llego por un canal
      // no se trabaja igual que uno que escribio por WhatsApp.
      source: origen,
      lastContactDate: new Date(),
    },
    select: { id: true },
  });
  return creado.id;
}
