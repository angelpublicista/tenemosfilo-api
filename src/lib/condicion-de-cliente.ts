// CRM-20. Cliente y cliente recurrente, derivados del historial de ventas.
//
// Es una CONDICION, no un estado que alguien marca. El documento de revision
// lo pide asi por un motivo concreto: "perder una oportunidad no modifica la
// condicion historica del cliente; un cliente recurrente puede tener una
// oportunidad en Perdido cerrado y seguir siendo cliente recurrente". Con un
// campo guardado, tarde o temprano alguien lo pone al dia desde la oportunidad
// y se pierde esa historia.
//
// Al calcularse de las reservas no hay nada que mantener: si el contacto
// compro, es cliente, diga lo que diga su ficha.
import { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';

export type CondicionDeCliente = 'PROSPECTO' | 'CLIENTE' | 'RECURRENTE';

export interface HistorialDeCliente {
  condicion: CondicionDeCliente;
  /** Cuantas ventas suyas hay. */
  ventas: number;
  /** La ultima, para poder decir "cliente desde" o "hace un año que no vuelve". */
  ultimaVenta: string | null;
}

export const SIN_HISTORIAL: HistorialDeCliente = {
  condicion: 'PROSPECTO',
  ventas: 0,
  ultimaVenta: null,
};

function condicionPor(ventas: number): CondicionDeCliente {
  if (ventas >= 2) return 'RECURRENTE';
  if (ventas === 1) return 'CLIENTE';
  return 'PROSPECTO';
}

/**
 * Que cuenta como venta.
 *
 * Una reserva pagada, o confirmada aunque el cobro llegue despues. Quedan
 * fuera las canceladas y los no-show —no hubo venta— y tambien las que estan
 * apartadas o pendientes sin pagar: ahi todavia no compro nadie, y contarlas
 * convertiria en cliente a quien solo pidio precio.
 */
const ES_UNA_VENTA = Prisma.sql`
  r.status NOT IN ('CANCELLED', 'NO_SHOW')
  AND (
    r."paymentStatus" = 'PAID'
    OR r.status IN ('CONFIRMED', 'COMPLETED')
  )
`;

/**
 * El historial de varios contactos de una vez.
 *
 * De una vez y no uno por uno: esto alimenta un listado, y una consulta por
 * fila serian cincuenta viajes para pintar una pagina.
 *
 * Se reconocen sus ventas por dos vias. Por la oportunidad de la que salieron,
 * que es la unica que ata una reserva a un contacto; y por el correo, porque
 * la mayoria de las ventas entran por el catalogo publico, donde quien reserva
 * no tiene ficha en el CRM y lo unico que deja es su correo. Sin la segunda,
 * un cliente de toda la vida que compra por el catalogo figuraria como
 * prospecto.
 */
export async function historialDeContactos(
  hostCompanyId: string,
  contactIds: string[],
): Promise<Map<string, HistorialDeCliente>> {
  const mapa = new Map<string, HistorialDeCliente>();
  if (contactIds.length === 0) return mapa;

  const filas = await prisma.$queryRaw<
    Array<{ id: string; ventas: bigint; ultima: Date | null }>
  >`
    SELECT c.id                     AS id,
           COUNT(r.id)              AS ventas,
           MAX(r."reservationDate") AS ultima
    FROM "Contact" c
    LEFT JOIN "Reservation" r
      ON r."companyId" = ${hostCompanyId}
     AND ${ES_UNA_VENTA}
     AND (
       r."opportunityId" IN (SELECT o.id FROM "Opportunity" o WHERE o."contactId" = c.id)
       OR (c.email IS NOT NULL AND lower(r.client ->> 'email') = lower(c.email))
     )
    WHERE c.id IN (${Prisma.join(contactIds)})
    GROUP BY c.id
  `;

  for (const f of filas) {
    const ventas = Number(f.ventas);
    mapa.set(f.id, {
      condicion: condicionPor(ventas),
      ventas,
      ultimaVenta: f.ultima ? f.ultima.toISOString() : null,
    });
  }
  return mapa;
}

/**
 * El historial de una empresa del CRM.
 *
 * Aqui la via es la oportunidad: lo que se le vendio a la empresa, sin
 * importar cual de sus contactos lo gestiono. Por correo no se puede —una
 * empresa no reserva, reservan sus personas— asi que una compra suelta por el
 * catalogo publico no se le atribuye.
 */
export async function historialDeEmpresas(
  hostCompanyId: string,
  crmCompanyIds: string[],
): Promise<Map<string, HistorialDeCliente>> {
  const mapa = new Map<string, HistorialDeCliente>();
  if (crmCompanyIds.length === 0) return mapa;

  const filas = await prisma.$queryRaw<
    Array<{ id: string; ventas: bigint; ultima: Date | null }>
  >`
    SELECT e.id                     AS id,
           COUNT(r.id)              AS ventas,
           MAX(r."reservationDate") AS ultima
    FROM "CrmCompany" e
    LEFT JOIN "Opportunity" o ON o."crmCompanyId" = e.id
    LEFT JOIN "Reservation" r
      ON r."opportunityId" = o.id
     AND r."companyId" = ${hostCompanyId}
     AND ${ES_UNA_VENTA}
    WHERE e.id IN (${Prisma.join(crmCompanyIds)})
    GROUP BY e.id
  `;

  for (const f of filas) {
    const ventas = Number(f.ventas);
    mapa.set(f.id, {
      condicion: condicionPor(ventas),
      ventas,
      ultimaVenta: f.ultima ? f.ultima.toISOString() : null,
    });
  }
  return mapa;
}

/**
 * Los contactos de una empresa que estan en una condicion dada.
 *
 * Hace falta para poder FILTRAR por ella. La condicion no es una columna, asi
 * que no se puede meter en el `where` de Prisma: se resuelven antes los ids
 * que cumplen y se filtra por ellos. Una sola consulta agregada, no una por
 * contacto.
 */
export async function contactosEnCondicion(
  hostCompanyId: string,
  condicion: CondicionDeCliente,
): Promise<string[]> {
  const filas = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT c.id AS id
    FROM "Contact" c
    LEFT JOIN "Reservation" r
      ON r."companyId" = ${hostCompanyId}
     AND ${ES_UNA_VENTA}
     AND (
       r."opportunityId" IN (SELECT o.id FROM "Opportunity" o WHERE o."contactId" = c.id)
       OR (c.email IS NOT NULL AND lower(r.client ->> 'email') = lower(c.email))
     )
    WHERE c."hostCompanyId" = ${hostCompanyId} AND c."deletedAt" IS NULL
    GROUP BY c.id
    HAVING ${cuantasVentas(condicion)}
  `;
  return filas.map((f) => f.id);
}

/**
 * Las empresas del CRM que estan en una condicion dada.
 *
 * Mismo motivo que en contactos: la condicion no es una columna. La diferencia
 * es que a una empresa no se le puede casar una reserva por el correo —la
 * reserva la hace una persona, no la empresa—, asi que solo cuenta lo que
 * llego por una oportunidad suya.
 */
export async function empresasEnCondicion(
  hostCompanyId: string,
  condicion: CondicionDeCliente,
): Promise<string[]> {
  const filas = await prisma.$queryRaw<Array<{ id: string }>>`
    SELECT e.id AS id
    FROM "CrmCompany" e
    LEFT JOIN "Opportunity" o ON o."crmCompanyId" = e.id
    LEFT JOIN "Reservation" r
      ON r."opportunityId" = o.id
     AND r."companyId" = ${hostCompanyId}
     AND ${ES_UNA_VENTA}
    WHERE e."hostCompanyId" = ${hostCompanyId} AND e."deletedAt" IS NULL
    GROUP BY e.id
    HAVING ${cuantasVentas(condicion)}
  `;
  return filas.map((f) => f.id);
}

/**
 * El corte de ventas de cada condicion, en un solo sitio.
 *
 * Esta regla la usan dos consultas distintas; escrita dos veces acabarian
 * diciendo cosas diferentes el dia que cambie el umbral de "recurrente".
 */
function cuantasVentas(condicion: CondicionDeCliente) {
  if (condicion === 'CLIENTE') return Prisma.sql`COUNT(r.id) = 1`;
  if (condicion === 'RECURRENTE') return Prisma.sql`COUNT(r.id) >= 2`;
  return Prisma.sql`COUNT(r.id) = 0`;
}
