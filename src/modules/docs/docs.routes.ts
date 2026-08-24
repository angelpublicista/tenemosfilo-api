// Documentacion del API.
//
// Se sirve desde el propio API a proposito: una spec que vive en otro sitio
// se queda vieja sin que nadie se entere, y quien integra necesita poder
// mirarla exactamente contra el servidor con el que esta hablando.
//
// Sin autenticacion: saber que endpoints existen no es un secreto, y
// obligar a tener credenciales para leer como conseguirlas es una puerta
// cerrada con la llave dentro.
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { Router } from 'express';
import type { Request, Response } from 'express';
import { logger } from '../../lib/logger.js';

export const docsRouter = Router();

// Relativa a la raiz del proyecto, que es desde donde arranca el proceso
// tanto en desarrollo (tsx) como compilado (node dist/).
const RUTA_SPEC = join(process.cwd(), 'docs', 'openapi.yaml');

let cache: string | null = null;

docsRouter.get('/openapi.yaml', async (_req: Request, res: Response) => {
  try {
    if (!cache) cache = await readFile(RUTA_SPEC, 'utf8');
    res.type('application/yaml').send(cache);
  } catch (err) {
    // Si el fichero no viajo en el despliegue, decirlo claro vale mas que
    // un 500 generico: el que integra sabra que no es culpa suya.
    logger.error({ err, ruta: RUTA_SPEC }, 'no se pudo leer openapi.yaml');
    res.status(503).json({
      error: {
        code: 'SPEC_NO_DISPONIBLE',
        message: 'La especificacion no esta disponible en este servidor.',
      },
    });
  }
});

/**
 * Visor de la documentacion.
 *
 * Se carga Scalar desde su CDN. La alternativa era mantener a mano una
 * pagina con todos los endpoints, que se desincroniza de la spec en cuanto
 * alguien añade uno; esto siempre muestra lo que dice el YAML.
 */
docsRouter.get('/', (_req: Request, res: Response) => {
  res.type('html').send(`<!doctype html>
<html lang="es">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>API de Tenemos Filo</title>
    <link rel="icon" href="data:," />
  </head>
  <body>
    <!-- Sin scripts en linea: la configuracion va en el atributo, asi la
         CSP de esta ruta no necesita permitir 'unsafe-inline'. -->
    <script
      id="api-reference"
      data-url="/docs/openapi.yaml"
      data-configuration='{"theme":"default"}'
    ></script>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
  </body>
</html>`);
});
