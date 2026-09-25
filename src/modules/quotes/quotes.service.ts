import { Prisma, QuoteStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
import type {
  CreateQuoteInput,
  ListQuotesQuery,
  SearchExperiencesQuery,
} from './quotes.schemas.js';

const fullInclude = {
  company: { select: { id: true, companyName: true } },
  host: { select: { id: true, name: true, email: true } },
  experiences: {
    where: { deletedAt: null },
    select: { id: true, title: true, basePrice: true, currency: true },
  },
} satisfies Prisma.QuoteInclude;

const DAYS = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'] as const;

async function assertCanManage(id: string, requesterCompanyId: string | null | undefined) {
  const q = await prisma.quote.findUnique({
    where: { id },
    select: { id: true, companyId: true },
  });
  if (!q) throw NotFound('Cotizacion no encontrada');
  if (!requesterCompanyId || q.companyId !== requesterCompanyId)
    throw Forbidden('No tienes permiso sobre esta cotizacion');
  return q;
}

export const quotesService = {
  async create(
    requesterId: string,
    requesterCompanyId: string | null | undefined,
    input: CreateQuoteInput,
    opts?: { asReseller?: boolean },
  ) {
    const asReseller = opts?.asReseller === true;

    let companyId: string | undefined;

    if (asReseller) {
      // Derivamos la company de la(s) experiencia(s). Para v1 exigimos que
      // todas las experiencias pertenezcan a la misma host company y esten
      // ACTIVE.
      if (!input.experiences.length) {
        throw Forbidden('Una cotizacion necesita al menos una experiencia');
      }
      const exps = await prisma.experience.findMany({
        where: {
          id: { in: input.experiences },
          deletedAt: null,
          status: 'ACTIVE',
        },
        select: { id: true, companyId: true },
      });
      if (exps.length !== input.experiences.length) {
        throw NotFound('Una o mas experiencias no estan disponibles');
      }
      const companyIds = new Set(exps.map((e) => e.companyId));
      if (companyIds.size > 1) {
        throw Forbidden('Todas las experiencias de la cotizacion deben ser de la misma company');
      }
      companyId = [...companyIds][0];
      if (input.companyId && input.companyId !== companyId) {
        throw Forbidden('companyId no coincide con la company de las experiencias');
      }
    } else {
      companyId = input.companyId ?? requesterCompanyId ?? undefined;
      if (!companyId) throw Forbidden('No tienes una company asociada');
      if (input.companyId && input.companyId !== requesterCompanyId) {
        throw Forbidden('No puedes crear cotizaciones en otra company');
      }
    }

    // hostId: para reseller no hay host humano del lado del operador; usamos
    // el owner de la company. Para host, usa el requester o el override.
    let hostId = input.hostId;
    if (!hostId) {
      if (asReseller) {
        const company = await prisma.company.findUnique({
          where: { id: companyId! },
          select: { ownerId: true },
        });
        if (!company) throw NotFound('Company no encontrada');
        hostId = company.ownerId;
      } else {
        hostId = requesterId;
      }
    }

    /**
     * Los datos del cliente salen de la oportunidad si no vienen.
     *
     * Este es el punto de "no volver a ingresar lo que ya esta": quien cotiza
     * desde una solicitud manda el id y ya. Lo que SI mande gana, para poder
     * corregir un correo mal escrito sin tener que editar antes el contacto.
     */
    let delContacto: { nombre?: string; email?: string; telefono?: string } = {};
    if (input.opportunityId) {
      const op = await prisma.opportunity.findFirst({
        where: { id: input.opportunityId, hostCompanyId: companyId!, deletedAt: null },
        select: {
          contact: { select: { firstName: true, lastName: true, email: true, phone: true } },
        },
      });
      // Se comprueba que sea de esta empresa: si no, bastaria acertar un id
      // para copiarse los datos del cliente de otra.
      if (!op) throw NotFound('La oportunidad no existe en tu empresa');
      if (op.contact) {
        delContacto = {
          nombre: [op.contact.firstName, op.contact.lastName].filter(Boolean).join(' '),
          email: op.contact.email ?? undefined,
          telefono: op.contact.phone ?? undefined,
        };
      }
    }

    const customerName = input.customerName ?? delContacto.nombre;
    const customerEmail = input.customerEmail ?? delContacto.email;
    if (!customerName) throw BadRequest('La oportunidad no tiene un contacto con nombre');

    return prisma.quote.create({
      data: {
        ...(input.opportunityId
          ? { opportunity: { connect: { id: input.opportunityId } } }
          : {}),
        customerName,
        // El correo sigue siendo columna obligatoria en la base; un lead que
        // solo dio telefono se guarda con cadena vacia en vez de bloquear la
        // cotizacion. Cambiar la columna es harina de otro costal.
        customerEmail: customerEmail ?? '',
        customerPhone: input.customerPhone ?? delContacto.telefono ?? null,
        eventDate: input.eventDate ? new Date(input.eventDate) : null,
        eventTime: input.eventTime ?? null,
        guests: input.guests ?? null,
        location: input.location ?? null,
        notes: input.notes ?? null,
        company: { connect: { id: companyId! } },
        host: { connect: { id: hostId } },
        experiences: { connect: input.experiences.map((id) => ({ id })) },
      },
      include: fullInclude,
    });
  },

  async list(requesterCompanyId: string | null | undefined, query: ListQuotesQuery) {
    const targetCompanyId = query.companyId ?? requesterCompanyId;
    if (query.companyId && requesterCompanyId && query.companyId !== requesterCompanyId) {
      throw Forbidden('No tienes acceso a las cotizaciones de otra company');
    }
    return prisma.quote.findMany({
      where: {
        ...(targetCompanyId ? { companyId: targetCompanyId } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      include: fullInclude,
      orderBy: { createdAt: 'desc' },
    });
  },

  async updateStatus(
    id: string,
    requesterCompanyId: string | null | undefined,
    status: QuoteStatus,
  ) {
    await assertCanManage(id, requesterCompanyId);
    return prisma.quote.update({ where: { id }, data: { status }, include: fullInclude });
  },

  async searchExperiences(
    requesterCompanyId: string | null | undefined,
    query: SearchExperiencesQuery,
    opts?: { crossCompany?: boolean },
  ) {
    const crossCompany = opts?.crossCompany === true;
    if (!crossCompany && requesterCompanyId && query.companyId !== requesterCompanyId) {
      throw Forbidden('No tienes acceso a las experiencias de otra company');
    }

    // Filtros base: experiencia ACTIVE, de la company, con capacidad suficiente.
    const exps = await prisma.experience.findMany({
      where: {
        companyId: query.companyId,
        deletedAt: null,
        status: 'ACTIVE',
        capacity: { gte: query.guests },
        OR: [{ minCapacity: null }, { minCapacity: { lte: query.guests } }],
        ...(query.location
          ? {
              OR: [
                { presentialCity: { contains: query.location, mode: 'insensitive' } },
                {
                  locations: {
                    some: {
                      // Buscamos en address.city del JSON. No podemos hacerlo
                      // tipado, pero es solo un sub-filtro best-effort.
                      // Alternativa: full-text search a futuro.
                      deletedAt: null,
                    },
                  },
                },
              ],
            }
          : {}),
      },
      include: {
        company: { select: { id: true, companyName: true } },
        locations: {
          where: { deletedAt: null },
          select: { id: true, name: true, address: true },
        },
        availabilities: {
          where: { deletedAt: null, isActive: true },
          select: { id: true, weeklySchedule: true, name: true, locationId: true },
        },
      },
    });

    // Filtro de dia de la semana en JS (weeklySchedule es Json).
    if (!query.date) return exps;

    const selected = new Date(query.date + 'T12:00:00');
    const dow = DAYS[selected.getDay()];

    return exps.filter((e) => {
      if (e.availabilities.length === 0) return false;
      return e.availabilities.some((a) => {
        const ws = a.weeklySchedule as Record<string, { isActive?: boolean }> | null;
        return ws?.[dow!]?.isActive === true;
      });
    });
  },
};
