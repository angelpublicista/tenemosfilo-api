// Cuanto usa el API cada canal de venta.
//
// La pregunta que responde es una sola: quien se lleva el catalogo y no vende
// por aqui. Un canal que lee experiencias todos los dias y crea dos reservas
// al mes esta vendiendo en otro sitio, y hasta ahora no habia forma de verlo
// —de una API key solo se guardaba `lastUsedAt`—.
//
// Se cuenta por dia y no por peticion: guardar cada llamada de un canal
// activo serian millones de filas para responder lo mismo.
import type { NextFunction, Request, Response } from 'express';
import { prisma } from '../config/prisma.js';

/** Medianoche UTC del dia de hoy. */
function hoy(): Date {
  const d = new Date();
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function contarUsoDeApiKey(req: Request, res: Response, next: NextFunction) {
  const esLectura = req.method === 'GET';

  // La comprobacion de si vino por API key va DENTRO del handler, no aqui:
  // este middleware es global y corre antes que los routers, y quien pone
  // `req.apiKey` es el requireAuth de cada router. Mirandolo aqui siempre
  // estaba vacio y no se contaba nada.
  res.on('finish', () => {
    if (!req.apiKey) return;
    const apiKeyId = req.apiKey.id;

    // Solo lo que salio bien. Un 401 repetido no es uso del catalogo, y
    // contarlo haria parecer activo a quien tiene la llave mal puesta.
    if (res.statusCode >= 400) return;

    // Una venta es una reserva creada. Es el numerador de la comparacion:
    // cuanto de lo que lee acaba siendo una reserva aqui.
    const esVenta = req.method === 'POST' && req.baseUrl === '/reservations' && req.path === '/';
    const dia = hoy();
    const suma = {
      lecturas: esLectura ? 1 : 0,
      escrituras: esLectura ? 0 : 1,
      reservas: esVenta ? 1 : 0,
    };

    // Fire-and-forget, como `lastUsedAt`: perder una cuenta es irrelevante
    // comparado con hacer esperar —o fallar— la peticion de un cliente.
    prisma.apiKeyUsage
      .upsert({
        where: { apiKeyId_dia: { apiKeyId, dia } },
        create: { apiKeyId, dia, ...suma },
        update: {
          lecturas: { increment: suma.lecturas },
          escrituras: { increment: suma.escrituras },
          reservas: { increment: suma.reservas },
        },
      })
      .catch(() => undefined);
  });

  next();
}
