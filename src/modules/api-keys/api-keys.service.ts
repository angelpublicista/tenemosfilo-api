import { prisma } from '../../config/prisma.js';
import { Forbidden, NotFound } from '../../lib/errors.js';
import { generateApiKey } from '../../lib/api-key.js';
import type { CreateApiKeyInput, UpdateApiKeyInput } from './api-keys.schemas.js';

const safeSelect = {
  id: true,
  name: true,
  prefix: true,
  scopes: true,
  companyId: true,
  createdById: true,
  lastUsedAt: true,
  expiresAt: true,
  revokedAt: true,
  createdAt: true,
  updatedAt: true,
} as const;

/**
 * `null` significa "sin restringir a una empresa", y solo lo pasa un ADMIN.
 *
 * Un admin no tiene empresa propia: si se le exigiera una, no podria ni ver
 * ni revocar las llaves que el mismo emite para otros.
 */
type Ambito = string | null;

async function assertOwner(id: string, companyId: Ambito) {
  const key = await prisma.apiKey.findUnique({ where: { id }, select: { companyId: true } });
  if (!key) throw NotFound('API key no encontrada');
  if (companyId !== null && key.companyId !== companyId) {
    throw Forbidden('Esta key no pertenece a tu company');
  }
}

export const apiKeysService = {
  async create(companyId: string, userId: string, input: CreateApiKeyInput) {
    const { token, prefix, keyHash } = generateApiKey();

    const key = await prisma.apiKey.create({
      data: {
        name: input.name,
        prefix,
        keyHash,
        scopes: input.scopes,
        expiresAt: input.expiresAt ? new Date(input.expiresAt) : null,
        company: { connect: { id: companyId } },
        createdBy: { connect: { id: userId } },
      },
      select: safeSelect,
    });

    // El token plano solo se devuelve aqui; despues no hay forma de recuperarlo.
    return { ...key, token };
  },

  async list(companyId: Ambito) {
    return prisma.apiKey.findMany({
      where: companyId === null ? {} : { companyId },
      // El admin ve llaves de varias empresas a la vez: sin el nombre, la
      // lista serian identificadores indistinguibles.
      select: { ...safeSelect, company: { select: { id: true, companyName: true } } },
      orderBy: { createdAt: 'desc' },
    });
  },

  async getById(id: string, companyId: Ambito) {
    const key = await prisma.apiKey.findUnique({
      where: { id },
      select: { ...safeSelect, company: { select: { id: true, companyName: true } } },
    });
    if (!key) throw NotFound('API key no encontrada');
    if (companyId !== null && key.companyId !== companyId) {
      throw Forbidden('Esta key no pertenece a tu company');
    }
    return key;
  },

  async update(id: string, companyId: Ambito, input: UpdateApiKeyInput) {
    await assertOwner(id, companyId);
    return prisma.apiKey.update({
      where: { id },
      data: {
        ...(input.name !== undefined ? { name: input.name } : {}),
        ...(input.scopes !== undefined ? { scopes: input.scopes } : {}),
        ...(input.expiresAt !== undefined
          ? { expiresAt: input.expiresAt ? new Date(input.expiresAt) : null }
          : {}),
      },
      select: safeSelect,
    });
  },

  async revoke(id: string, companyId: Ambito) {
    await assertOwner(id, companyId);
    await prisma.apiKey.update({
      where: { id },
      data: { revokedAt: new Date() },
    });
  },
};
