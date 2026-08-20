import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import type { ListAuditQuery } from './audit.schemas.js';

export const auditService = {
  async list(query: ListAuditQuery) {
    const { page, pageSize, actorId, companyId, resourceType, action, search } = query;

    const where: Prisma.AuditLogWhereInput = {
      ...(actorId && { actorId }),
      ...(companyId && { companyId }),
      ...(resourceType && { resourceType }),
      ...(action && { action }),
      ...(search && {
        OR: [
          { actorEmail: { contains: search, mode: 'insensitive' } },
          { path: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      prisma.auditLog.findMany({
        where,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.auditLog.count({ where }),
    ]);

    // El nombre de la empresa no se guarda en el registro (podria cambiar);
    // lo resolvemos al leer, en una sola consulta.
    const companyIds = [...new Set(items.map((i) => i.companyId).filter(Boolean))] as string[];
    const empresas = companyIds.length
      ? await prisma.company.findMany({
          where: { id: { in: companyIds } },
          select: { id: true, companyName: true },
        })
      : [];
    const nombrePorId = new Map(empresas.map((c) => [c.id, c.companyName]));

    return {
      items: items.map((i) => ({
        ...i,
        companyName: i.companyId ? (nombrePorId.get(i.companyId) ?? null) : null,
      })),
      total,
    };
  },
};
