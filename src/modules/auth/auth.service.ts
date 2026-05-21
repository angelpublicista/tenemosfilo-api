import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { Conflict, Unauthorized } from '../../lib/errors.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import type { GoogleAuthInput, LoginInput, RegisterInput } from './auth.schemas.js';

const googleClient = env.GOOGLE_CLIENT_ID ? new OAuth2Client(env.GOOGLE_CLIENT_ID) : null;

const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  image: true,
  phone: true,
  companyId: true,
} as const;

export const authService = {
  async login({ email, password }: LoginInput) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) throw Unauthorized('Credenciales invalidas');

    const ok = await verifyPassword(password, user.password);
    if (!ok) throw Unauthorized('Credenciales invalidas');
    if (!user.isActive || user.deletedAt) throw Unauthorized('Usuario inactivo');

    return this.toPublic(user);
  },

  async register(input: RegisterInput) {
    const exists = await prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw Conflict('Ya existe un usuario con ese email');

    const passwordHash = await hashPassword(input.password);
    const user = await prisma.user.create({
      data: {
        email: input.email,
        password: passwordHash,
        name: input.name ?? null,
        phone: input.phone ?? null,
        role: input.role,
        documentType: input.documentType ?? null,
        documentNumber: input.documentNumber ?? null,
      },
      select: publicUserSelect,
    });
    return user;
  },

  async loginWithGoogle({ idToken }: GoogleAuthInput) {
    if (!googleClient) throw Unauthorized('Google OAuth no configurado en el API');

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) throw Unauthorized('Token de Google invalido');

    const user = await prisma.user.upsert({
      where: { email: payload.email },
      update: {
        name: payload.name ?? undefined,
        image: payload.picture ?? undefined,
        emailVerified: payload.email_verified ? new Date() : undefined,
      },
      create: {
        email: payload.email,
        name: payload.name ?? null,
        image: payload.picture ?? null,
        emailVerified: payload.email_verified ? new Date() : null,
        role: 'GUEST',
      },
      select: publicUserSelect,
    });

    if (!user) throw Unauthorized('No se pudo crear el usuario');
    return user;
  },

  toPublic(user: { id: string; email: string; name: string | null; role: 'HOST' | 'GUEST' | 'ADMIN' | 'RESELLER'; image: string | null; phone: string | null; companyId: string | null }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      image: user.image,
      phone: user.phone,
      companyId: user.companyId,
    };
  },
};
