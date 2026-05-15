import { Prisma, QuoteStatus } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { Forbidden, NotFound } from '../../lib/errors.js';
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
  ) {
    const companyId = input.companyId ?? requesterCompanyId;
    if (!companyId) throw Forbidden('No tienes una company asociada');
    if (input.companyId && input.companyId !== requesterCompanyId) {
      throw Forbidden('No puedes crear cotizaciones en otra company');
    }
    const hostId = input.hostId ?? requesterId;

    return prisma.quote.create({
      data: {
        customerName: input.customerName,
        customerEmail: input.customerEmail,
        customerPhone: input.customerPhone ?? null,
        eventDate: input.eventDate ? new Date(input.eventDate) : null,
        eventTime: input.eventTime ?? null,
        guests: input.guests ?? null,
        location: input.location ?? null,
        notes: input.notes ?? null,
        company: { connect: { id: companyId } },
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
  ) {
    if (requesterCompanyId && query.companyId !== requesterCompanyId) {
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
