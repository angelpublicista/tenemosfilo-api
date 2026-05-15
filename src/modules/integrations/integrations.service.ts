import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { Forbidden, NotFound } from '../../lib/errors.js';
import type {
  CreateIntegrationInput,
  ListIntegrationsQuery,
  UpdateIntegrationInput,
  UpdateStatusInput,
} from './integrations.schemas.js';

async function assertOwner(id: string, requesterId: string) {
  const i = await prisma.integration.findFirst({
    where: { id, deletedAt: null },
    select: { id: true, userId: true },
  });
  if (!i) throw NotFound('Integracion no encontrada');
  if (i.userId !== requesterId) throw Forbidden('No tienes permiso sobre esta integracion');
  return i;
}

export const integrationsService = {
  async list(requesterId: string, query: ListIntegrationsQuery) {
    return prisma.integration.findMany({
      where: {
        userId: requesterId,
        deletedAt: null,
        ...(query.type ? { type: query.type } : {}),
        ...(query.status ? { status: query.status } : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getById(requesterId: string, id: string) {
    await assertOwner(id, requesterId);
    return prisma.integration.findUnique({ where: { id } });
  },

  async create(requesterId: string, input: CreateIntegrationInput) {
    return prisma.integration.create({
      data: {
        user: { connect: { id: requesterId } },
        type: input.type,
        name: input.name ?? null,
        status: input.status ?? 'PENDING',
        config: (input.config as Prisma.InputJsonValue | undefined) ?? Prisma.JsonNull,
      },
    });
  },

  async update(requesterId: string, id: string, input: UpdateIntegrationInput) {
    await assertOwner(id, requesterId);
    const data: Prisma.IntegrationUpdateInput = {};
    if (input.name !== undefined) data.name = input.name;
    if (input.status !== undefined) data.status = input.status;
    if (input.config !== undefined)
      data.config = (input.config as Prisma.InputJsonValue) ?? Prisma.JsonNull;
    if (input.error !== undefined) data.error = input.error;
    if (input.lastSync !== undefined) data.lastSync = input.lastSync ? new Date(input.lastSync) : null;
    return prisma.integration.update({ where: { id }, data });
  },

  async updateStatus(requesterId: string, id: string, input: UpdateStatusInput) {
    await assertOwner(id, requesterId);
    const data: Prisma.IntegrationUpdateInput = { status: input.status };
    if (input.config) data.config = input.config as Prisma.InputJsonValue;
    if (input.status === 'CONNECTED') {
      data.lastSync = new Date();
      data.error = null;
    } else if (input.status === 'ERROR' && input.error) {
      data.error = input.error;
    }
    return prisma.integration.update({ where: { id }, data });
  },

  async softDelete(requesterId: string, id: string) {
    await assertOwner(id, requesterId);
    await prisma.integration.update({
      where: { id },
      data: { deletedAt: new Date(), status: 'DISCONNECTED' },
    });
  },

  async stats(requesterId: string) {
    const items = await prisma.integration.findMany({
      where: { userId: requesterId, deletedAt: null },
      select: { status: true, lastSync: true },
    });
    let lastSync: Date | null = null;
    let connected = 0,
      disconnected = 0,
      pending = 0,
      error = 0;
    for (const i of items) {
      if (i.status === 'CONNECTED') {
        connected++;
        if (i.lastSync && (!lastSync || i.lastSync > lastSync)) lastSync = i.lastSync;
      } else if (i.status === 'DISCONNECTED') disconnected++;
      else if (i.status === 'PENDING') pending++;
      else if (i.status === 'ERROR') error++;
    }
    return {
      total: items.length,
      connected,
      disconnected,
      pending,
      error,
      lastSync: lastSync ? lastSync.toISOString() : undefined,
    };
  },
};
