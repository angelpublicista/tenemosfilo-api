import type { NextFunction, Request, Response } from 'express';
import { jwtVerify } from 'jose';
import { env } from '../config/env.js';
import { prisma } from '../config/prisma.js';
import { Forbidden, Unauthorized } from '../lib/errors.js';
import { hashApiKey, isApiKeyToken } from '../lib/api-key.js';

export type AuthUser = {
  id: string;
  email: string;
  role: 'HOST' | 'GUEST' | 'ADMIN' | 'RESELLER';
  companyId?: string | null;
};

export type AuthApiKey = {
  id: string;
  prefix: string;
  scopes: string[];
  companyId: string;
};

declare module 'express-serve-static-core' {
  interface Request {
    user?: AuthUser;
    apiKey?: AuthApiKey;
  }
}

const secret = new TextEncoder().encode(env.NEXTAUTH_SECRET);

/**
 * Acepta dos formatos en Authorization: Bearer:
 *   1) JWT firmado por NextAuth (HS256 con NEXTAUTH_SECRET)
 *   2) API key con prefijo `tf_live_` para integraciones externas
 *
 * Cuando viene una API key, poblamos `req.user` como un "host sintetico"
 * de la company duena de la key, para que los controllers existentes
 * sigan funcionando sin cambios (todos leen req.user.companyId).
 */
/** Cabecera con la que el ADMIN dice sobre que empresa esta operando. */
export const ACTING_COMPANY_HEADER = 'x-acting-company';

/**
 * Permite que un ADMIN opere como si perteneciera a una empresa concreta.
 *
 * Por que aqui y no en cada servicio: todos los modulos ya resuelven el
 * alcance con `req.user.companyId`. Poblandolo una sola vez, el admin puede
 * crear y listar en cualquier empresa sin tocar controllers ni servicios.
 *
 * Solo aplica a ADMIN. Para cualquier otro rol la cabecera se ignora, asi
 * que no sirve para escalar privilegios ni para saltarse el aislamiento.
 */
async function applyActingCompany(req: Request) {
  const raw = req.headers[ACTING_COMPANY_HEADER];
  const companyId = Array.isArray(raw) ? raw[0] : raw;
  if (!companyId || !req.user) return;

  const esAdmin = req.user.role === 'ADMIN';
  // Un HOST puede tener varias empresas, asi que tambien cambia entre ellas
  // con esta cabecera. La diferencia con el ADMIN es el alcance: el admin
  // puede indicar cualquiera; el host, solo las que posee o aquella a la
  // que pertenece. Para el resto de roles la cabecera se ignora.
  const esHost = req.user.role === 'HOST';
  if (!esAdmin && !esHost) return;

  const company = await prisma.company.findFirst({
    where: {
      id: companyId,
      deletedAt: null,
      ...(esAdmin ? {} : { OR: [{ ownerId: req.user.id }, { users: { some: { id: req.user.id } } }] }),
    },
    select: { id: true },
  });
  if (!company) {
    throw Forbidden(
      esAdmin
        ? 'La empresa indicada no existe o esta desactivada'
        : 'No tienes acceso a esa empresa',
    );
  }

  req.user.companyId = company.id;
}

export async function requireAuth(req: Request, _res: Response, next: NextFunction) {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw Unauthorized('Token requerido');
    }
    const token = header.slice('Bearer '.length).trim();
    if (!token) throw Unauthorized('Token vacio');

    if (isApiKeyToken(token)) {
      await authenticateApiKey(req, token);
    } else {
      await authenticateJwt(req, token);
    }
    await applyActingCompany(req);
    next();
  } catch (err) {
    if (err instanceof Error && err.name === 'HttpError') return next(err);
    next(Unauthorized('Token invalido'));
  }
}

async function authenticateJwt(req: Request, token: string) {
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
}

async function authenticateApiKey(req: Request, token: string) {
  const keyHash = hashApiKey(token);
  const key = await prisma.apiKey.findUnique({ where: { keyHash } });
  if (!key) throw Unauthorized('API key invalida');
  if (key.revokedAt) throw Unauthorized('API key revocada');
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) {
    throw Unauthorized('API key expirada');
  }

  req.apiKey = {
    id: key.id,
    prefix: key.prefix,
    scopes: key.scopes,
    companyId: key.companyId,
  };
  req.user = {
    id: `apikey:${key.id}`,
    email: `apikey+${key.prefix}@tenemosfilo.api`,
    role: 'RESELLER',
    companyId: key.companyId,
  };

  // fire-and-forget: no bloqueamos la request por actualizar lastUsedAt
  prisma.apiKey
    .update({ where: { id: key.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);
}

export function requireRole(...roles: AuthUser['role'][]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(Unauthorized());
    if (!roles.includes(req.user.role)) return next(Forbidden('Rol insuficiente'));
    next();
  };
}

/**
 * Bloquea endpoints que requieren un JWT humano (no una API key).
 * Util para la administracion de las propias API keys.
 */
export function requireHumanAuth(req: Request, _res: Response, next: NextFunction) {
  if (req.apiKey) return next(Forbidden('Este endpoint no acepta API keys'));
  if (!req.user) return next(Unauthorized());
  next();
}
