import type { NextFunction, Request, Response } from 'express';
import { ZodError } from 'zod';
import { HttpError } from '../lib/errors.js';
import { logger } from '../lib/logger.js';

export function errorHandler(
  err: unknown,
  req: Request,
  res: Response,
  _next: NextFunction,
) {
  if (err instanceof ZodError) {
    // Que campo fallo y por que, en el log.
    //
    // El detalle ya iba en la respuesta, pero no quedaba rastro en el
    // servidor: cuando alguien reportaba "me sale un error al crear la sede",
    // el log mostraba un 400 pelado y no habia forma de saber que campo era
    // sin pedirle que lo reprodujera.
    //
    // Se registran la ruta del campo y el codigo del fallo, NO el mensaje ni
    // el valor. El codigo ya dice lo que hace falta para actuar
    // —`maxCapacity: invalid_type` no deja dudas— y asi no acaba en el log lo
    // que la persona escribio, que en estos formularios son telefonos,
    // documentos y direcciones.
    logger.warn(
      {
        ruta: `${req.method} ${req.originalUrl}`,
        campos: err.issues.map((i) => ({
          campo: i.path.join('.') || '(raiz)',
          fallo: i.code,
        })),
      },
      'validacion rechazada',
    );
    return res.status(400).json({
      error: { code: 'VALIDATION_ERROR', message: 'Datos invalidos', details: err.flatten() },
    });
  }

  if (err instanceof HttpError) {
    return res.status(err.status).json({
      error: { code: err.code, message: err.message, details: err.details },
    });
  }

  logger.error({ err }, 'unhandled error');
  return res.status(500).json({
    error: { code: 'INTERNAL_ERROR', message: 'Error interno del servidor' },
  });
}

export function notFoundHandler(_req: Request, res: Response) {
  res.status(404).json({ error: { code: 'NOT_FOUND', message: 'Ruta no encontrada' } });
}
