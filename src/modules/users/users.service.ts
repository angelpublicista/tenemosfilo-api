import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { Conflict, NotFound } from '../../lib/errors.js';
import { hashPassword } from '../../lib/password.js';
import type { CreateUserInput, ListUsersQuery, UpdateUserInput } from './users.schemas.js';

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
  /** Alta desde el panel de administracion. Solo la usa un ADMIN. */
  async create(input: CreateUserInput) {
    const exists = await prisma.user.findUnique({
      where: { email: input.email },
      select: { id: true },
    });
    if (exists) throw Conflict('Ya existe un usuario con ese email');

    if (input.companyId) {
      const company = await prisma.company.findFirst({
        where: { id: input.companyId, deletedAt: null },
        select: { id: true },
      });
      if (!company) throw NotFound('La empresa indicada no existe');
    }

    return prisma.user.create({
      data: {
        email: input.email,
        // Sin contraseña la cuenta queda inaccesible hasta que su titular
        // la elija por el enlace de invitacion. login() ya lo contempla:
        // rechaza a quien no tiene contraseña, sin caso especial.
        password: input.password ? await hashPassword(input.password) : null,
        name: input.name ?? null,
        role: input.role,
        phone: input.phone ?? null,
        documentType: input.documentType ?? null,
        documentNumber: input.documentNumber ?? null,
        companyId: input.companyId ?? null,
      },
      select: publicSelect,
    });
  },

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
