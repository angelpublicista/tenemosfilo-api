export class HttpError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export const NotFound = (msg = 'Recurso no encontrado') => new HttpError(404, 'NOT_FOUND', msg);
export const Unauthorized = (msg = 'No autenticado') => new HttpError(401, 'UNAUTHORIZED', msg);
export const Forbidden = (msg = 'Sin permisos') => new HttpError(403, 'FORBIDDEN', msg);
export const BadRequest = (msg = 'Solicitud invalida', details?: unknown) =>
  new HttpError(400, 'BAD_REQUEST', msg, details);
export const Conflict = (msg = 'Conflicto') => new HttpError(409, 'CONFLICT', msg);
export const NotImplemented = (msg = 'No implementado') =>
  new HttpError(501, 'NOT_IMPLEMENTED', msg);
