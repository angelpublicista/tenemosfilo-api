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

  /**
   * Cuanto se ha usado una key y cuanto de eso acabo en una venta aqui.
   *
   * La cifra que importa es la ultima: un canal que lee el catalogo a diario
   * y crea dos reservas al mes esta vendiendo en otro sitio. No prueba nada
   * por si sola —puede estar arrancando, o cacheando— pero es lo unico que
   * permite ir a preguntar.
   */
  async uso(id: string, companyId: Ambito, dias = 30) {
    await assertOwner(id, companyId);

    const desde = new Date();
    desde.setUTCHours(0, 0, 0, 0);
    desde.setUTCDate(desde.getUTCDate() - (dias - 1));

    const filas = await prisma.apiKeyUsage.findMany({
      where: { apiKeyId: id, dia: { gte: desde } },
      orderBy: { dia: 'asc' },
      select: { dia: true, lecturas: true, escrituras: true, reservas: true },
    });

    const total = filas.reduce(
      (a, f) => ({
        lecturas: a.lecturas + f.lecturas,
        escrituras: a.escrituras + f.escrituras,
        reservas: a.reservas + f.reservas,
      }),
      { lecturas: 0, escrituras: 0, reservas: 0 },
    );

    return {
      dias,
      desde: desde.toISOString().slice(0, 10),
      porDia: filas.map((f) => ({ ...f, dia: f.dia.toISOString().slice(0, 10) })),
      total,
      /** Lecturas por cada reserva creada. Null cuando aun no vendio nada. */
      lecturasPorVenta: total.reservas > 0 ? Math.round(total.lecturas / total.reservas) : null,
    };
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
