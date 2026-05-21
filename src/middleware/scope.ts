import type { NextFunction, Request, Response } from 'express';
import { Forbidden } from '../lib/errors.js';

export const API_SCOPES = [
  'experiences:read',
  'experiences:write',
  'reservations:read',
  'reservations:write',
  'quotes:read',
  'quotes:write',
  'contacts:read',
  'contacts:write',
  'crm-companies:read',
  'crm-companies:write',
  'opportunities:read',
  'opportunities:write',
  'availabilities:read',
  'availabilities:write',
  'locations:read',
  'locations:write',
  'companies:read',
  'companies:write',
  'dashboard:read',
] as const;

export type ApiScope = (typeof API_SCOPES)[number];

/**
 * Si la request vino por API key, exige que la key tenga TODOS los scopes
 * indicados. Si vino por JWT humano, no aplica (los usuarios no tienen
 * scopes; su permiso lo definen rol y companyId).
 *
 * El scope comodin `*` concede acceso total.
 */
export function requireScope(...required: ApiScope[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.apiKey) return next();
    const granted = new Set(req.apiKey.scopes);
    if (granted.has('*')) return next();
    const missing = required.filter((s) => !granted.has(s));
    if (missing.length > 0) {
      return next(Forbidden(`Scope requerido: ${missing.join(', ')}`));
    }
    next();
  };
}
