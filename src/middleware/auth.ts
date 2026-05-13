import type { NextFunction, Request, Response } from 'express';
import { jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { Forbidden, Unauthorized } from '../lib/errors.js';

export type AuthUser = {
  id: string;
  email: string;
  role: 'HOST' | 'GUEST' | 'ADMIN';
  companyId?: string | null;
};

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
  }
}

const secret = new TextEncoder().encode(env.NEXTAUTH_SECRET);

/**
 * Verifica el JWT de NextAuth (firmado con NEXTAUTH_SECRET).
 * El front debe enviarlo como `Authorization: Bearer <jwt>`.
 *
 * Nota: NextAuth v5 firma con HS256 por defecto. Si cambias a RS256,
 * habria que cargar la JWK publica en lugar de un secret simetrico.
 */
export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw Unauthorized('Token requerido');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw Unauthorized('Token vacio');

    const { payload } = await jwtVerify(token, secret);

    if (!payload.sub || !payload.email) {
      throw Unauthorized('Token sin claims requeridos');
    }

    req.user = {
      id: String(payload.sub),
      email: String(payload.email),
      role: (payload.role as AuthUser['role']) ?? 'GUEST',
      companyId: (payload.companyId as string | null | undefined) ?? null,
    };
    next();
  } catch (err) {
    if (err instanceof Error && err.name === 'HttpError') return next(err);
    next(Unauthorized('Token invalido'));
  }
}

export function requireRole(...roles: AuthUser['role'][]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(Unauthorized());
    if (!roles.includes(req.user.role)) return next(Forbidden('Rol insuficiente'));
    next();
  };
}
