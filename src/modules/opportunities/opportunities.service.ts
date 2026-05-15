import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { Forbidden, NotFound } from '../../lib/errors.js';
import type {
  CreateOpportunityInput,
  ListOpportunitiesQuery,
  UpdateOpportunityInput,
} from './opportunities.schemas.js';

const fullInclude = {
  hostCompany: { select: { id: true, companyName: true } },
  crmCompany: { select: { id: true, companyName: true } },
  contact: { select: { id: true, firstName: true, lastName: true } },
  assignedTo: { select: { id: true, name: true } },
  createdBy: { select: { id: true, name: true } },
  experiences: {
    select: {
      id: true,
      experienceId: true,
      quantity: true,
      customPrice: true,
      notes: true,
      experience: { select: { id: true, title: true, basePrice: true, currency: true } },
    },
  },
  decisionMakers: { select: { id: true, firstName: true, lastName: true } },
} satisfies Prisma.OpportunityInclude;

async function assertCanManage(id: string, requesterCompanyId: string | null | undefined) {
  const o = await prisma.opportunity.findUnique({
    where: { id },
    select: { id: true, hostCompanyId: true },
  });
  if (!o) throw NotFound('Oportunidad no encontrada');
  if (!requesterCompanyId || o.hostCompanyId !== requesterCompanyId) {
    throw Forbidden('No tienes permiso sobre esta oportunidad');
  }
  return o;
}

export const opportunitiesService = {
  async create(
    requesterId: string,
    requesterCompanyId: string | null | undefined,
    input: CreateOpportunityInput,
  ) {
    const hostCompanyId = input.hostCompany ?? requesterCompanyId;
    if (!hostCompanyId) throw Forbidden('No tienes una company asociada');
    if (input.hostCompany && input.hostCompany !== requesterCompanyId) {
      throw Forbidden('No puedes crear oportunidades en otra company');
    }
    const createdById = input.createdBy ?? requesterId;

    return prisma.opportunity.create({
      data: {
        name: input.name,
        hostCompany: { connect: { id: hostCompanyId } },
        ...(input.crmCompany ? { crmCompany: { connect: { id: input.crmCompany } } } : {}),
        ...(input.contact ? { contact: { connect: { id: input.contact } } } : {}),
        stage: input.stage ?? 'PROSPECTING',
        status: input.status ?? 'OPEN',
        value: input.value ?? 0,
        currency: input.currency ?? 'COP',
        expectedCloseDate: input.expectedCloseDate ? new Date(input.expectedCloseDate) : null,
        actualCloseDate: input.actualCloseDate ? new Date(input.actualCloseDate) : null,
        description: input.description ?? null,
        lostReason: input.lostReason ?? null,
        lostReasonNotes: input.lostReasonNotes ?? null,
        wonReason: input.wonReason ?? null,
        source: input.source ?? null,
        assignedTo: { connect: { id: input.assignedTo } },
        createdBy: { connect: { id: createdById } },
        notes: input.notes ?? null,
        tags: input.tags ?? [],
        isActive: input.isActive ?? true,
        ...(input.experiences && input.experiences.length
          ? {
              experiences: {
                create: input.experiences.map((e) => ({
                  experience: { connect: { id: e.experience } },
                  quantity: e.quantity,
                  customPrice: e.customPrice ?? null,
                  notes: e.notes ?? null,
                })),
              },
            }
          : {}),
        ...(input.decisionMakers && input.decisionMakers.length
          ? { decisionMakers: { connect: input.decisionMakers.map((id) => ({ id })) } }
          : {}),
      },
      include: fullInclude,
    });
  },

  async getById(id: string) {
    const o = await prisma.opportunity.findFirst({
      where: { id, deletedAt: null },
      include: fullInclude,
    });
    if (!o) throw NotFound('Oportunidad no encontrada');
    return o;
  },

  async list(requesterCompanyId: string | null | undefined, query: ListOpportunitiesQuery) {
    const targetHostId = query.hostCompanyId ?? requesterCompanyId;
    if (
      query.hostCompanyId &&
      requesterCompanyId &&
      query.hostCompanyId !== requesterCompanyId
    ) {
      throw Forbidden('No tienes acceso a oportunidades de otra company');
    }
    if (!targetHostId) return [];

    const where: Prisma.OpportunityWhereInput = {
      deletedAt: null,
      hostCompanyId: targetHostId,
      ...(query.stage ? { stage: query.stage } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.assignedTo ? { assignedToId: query.assignedTo } : {}),
      ...(query.crmCompany ? { crmCompanyId: query.crmCompany } : {}),
      ...(query.isActive !== undefined ? { isActive: query.isActive } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search, mode: 'insensitive' } },
              { description: { contains: query.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    return prisma.opportunity.findMany({
      where,
      include: fullInclude,
      orderBy: { [query.sortBy]: query.sortOrder },
      ...(query.limit ? { take: query.limit } : {}),
    });
  },

  async update(
    id: string,
    requesterCompanyId: string | null | undefined,
    input: UpdateOpportunityInput,
  ) {
    await assertCanManage(id, requesterCompanyId);

    const data: Prisma.OpportunityUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.stage !== undefined) data.stage = input.stage;
    if (input.status !== undefined) {
      data.status = input.status;
      // Auto-set actualCloseDate cuando se gana o pierde
      if ((input.status === 'WON' || input.status === 'LOST') && input.actualCloseDate === undefined) {
        data.actualCloseDate = new Date();
      }
    }
    if (input.value !== undefined) data.value = input.value ?? 0;
    if (input.currency !== undefined) data.currency = input.currency;
    if (input.expectedCloseDate !== undefined)
      data.expectedCloseDate = input.expectedCloseDate ? new Date(input.expectedCloseDate) : null;
    if (input.actualCloseDate !== undefined)
      data.actualCloseDate = input.actualCloseDate ? new Date(input.actualCloseDate) : null;
    if (input.description !== undefined) data.description = input.description;
    if (input.lostReason !== undefined) data.lostReason = input.lostReason;
    if (input.lostReasonNotes !== undefined) data.lostReasonNotes = input.lostReasonNotes;
    if (input.wonReason !== undefined) data.wonReason = input.wonReason;
    if (input.source !== undefined) data.source = input.source;
    if (input.notes !== undefined) data.notes = input.notes;
    if (input.tags !== undefined) data.tags = input.tags;
    if (input.isActive !== undefined) data.isActive = input.isActive;
    if (input.crmCompany !== undefined) {
      data.crmCompany = input.crmCompany
        ? { connect: { id: input.crmCompany } }
        : { disconnect: true };
    }
    if (input.contact !== undefined) {
      data.contact = input.contact ? { connect: { id: input.contact } } : { disconnect: true };
    }
    if (input.assignedTo !== undefined) {
      // assignedTo es relacion obligatoria; rechazamos null para no perder
      // consistencia (el modelo requiere un user). El front debe pasar otro
      // userId en lugar de null si quiere reasignar.
      if (input.assignedTo === null) {
        throw new Error('assignedTo es obligatorio; pasa un userId valido');
      }
      data.assignedTo = { connect: { id: input.assignedTo } };
    }
    if (input.decisionMakers !== undefined) {
      data.decisionMakers = { set: input.decisionMakers.map((id) => ({ id })) };
    }

    // Si vienen experiences, reemplazamos en transaction (delete pivot existentes + create nuevos)
    if (input.experiences !== undefined) {
      await prisma.$transaction([
        prisma.opportunityExperience.deleteMany({ where: { opportunityId: id } }),
        ...input.experiences.map((e) =>
          prisma.opportunityExperience.create({
            data: {
              opportunityId: id,
              experienceId: e.experience,
              quantity: e.quantity,
              customPrice: e.customPrice ?? null,
              notes: e.notes ?? null,
            },
          }),
        ),
      ]);
    }

    return prisma.opportunity.update({ where: { id }, data, include: fullInclude });
  },

  async softDelete(id: string, requesterCompanyId: string | null | undefined) {
    await assertCanManage(id, requesterCompanyId);
    await prisma.opportunity.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  },
};
