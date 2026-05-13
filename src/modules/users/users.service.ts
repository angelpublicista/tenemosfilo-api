import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { NotFound } from '../../lib/errors.js';
import type { ListUsersQuery, UpdateUserInput } from './users.schemas.js';

const publicSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  image: true,
  phone: true,
  documentType: true,
  documentNumber: true,
  companyId: true,
  isActive: true,
  createdAt: true,
  updatedAt: true,
} satisfies Prisma.UserSelect;

export const usersService = {
  async list(query: ListUsersQuery) {
    const { page, pageSize, role, search } = query;
    const where: Prisma.UserWhereInput = {
      deletedAt: null,
      ...(role && { role }),
      ...(search && {
        OR: [
          { email: { contains: search, mode: 'insensitive' } },
          { name: { contains: search, mode: 'insensitive' } },
        ],
      }),
    };

    const [items, total] = await Promise.all([
      prisma.user.findMany({
        where,
        select: publicSelect,
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
      }),
      prisma.user.count({ where }),
    ]);

    return { items, total };
  },

  async getById(id: string) {
    const user = await prisma.user.findFirst({
      where: { id, deletedAt: null },
      select: publicSelect,
    });
    if (!user) throw NotFound('Usuario no encontrado');
    return user;
  },

  async update(id: string, input: UpdateUserInput) {
    await this.getById(id); // valida existencia
    return prisma.user.update({
      where: { id },
      data: input,
      select: publicSelect,
    });
  },

  async softDelete(id: string) {
    await this.getById(id);
    await prisma.user.update({
      where: { id },
      data: { deletedAt: new Date(), isActive: false },
    });
  },
};
