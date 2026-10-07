// El catalogo publico de la empresa: que experiencias se ofrecen y donde.
//
// Separado del panel de experiencias a proposito. Alli se CREA la pieza —que
// se hace, cuanto dura, que incluye—; aqui se USA: la misma pieza puede
// publicarse en el local del centro como abierta y en la finca como privada,
// con otro precio y otro horario.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { catalogoService } from './catalogo.service.js';
import { condicionesDeSedeSchema } from '../experiences/experiences.schemas.js';
import type { CondicionesDeSedeInput } from '../experiences/experiences.schemas.js';

export const catalogoRouter = Router();

catalogoRouter.use(requireAuth);

const paresSchema = z.object({
  experienceId: z.string().min(1),
  locationId: z.string().min(1),
});

catalogoRouter.get(
  '/publicaciones',
  requireRole('HOST', 'ADMIN'),
  async (req: Request, res: Response) => {
    const data = await catalogoService.publicaciones(req.user!.companyId);
    res.json({ data });
  },
);

// La publicacion de una experiencia a domicilio: no hay sede que nombrar,
// porque la direccion la pone quien reserva. Tiene sus condiciones y se pausa
// igual que las demas.
catalogoRouter.put(
  '/publicaciones/:experienceId',
  requireRole('HOST', 'ADMIN'),
  validate(z.object({ experienceId: z.string().min(1) }), 'params'),
  validate(condicionesDeSedeSchema),
  async (req: Request, res: Response) => {
    const { experienceId } = req.params as unknown as { experienceId: string };
    const data = await catalogoService.publicar(
      experienceId,
      null,
      req.body as CondicionesDeSedeInput,
      req.user!.companyId,
      { isAdmin: req.user!.role === 'ADMIN' },
    );
    res.json({ data });
  },
);

catalogoRouter.delete(
  '/publicaciones/:experienceId',
  requireRole('HOST', 'ADMIN'),
  validate(z.object({ experienceId: z.string().min(1) }), 'params'),
  async (req: Request, res: Response) => {
    const { experienceId } = req.params as unknown as { experienceId: string };
    const resultado = await catalogoService.quitar(experienceId, null, req.user!.companyId, {
      isAdmin: req.user!.role === 'ADMIN',
    });
    res.json({ data: resultado });
  },
);

catalogoRouter.put(
  '/publicaciones/:experienceId/:locationId',
  requireRole('HOST', 'ADMIN'),
  validate(paresSchema, 'params'),
  validate(condicionesDeSedeSchema),
  async (req: Request, res: Response) => {
    const { experienceId, locationId } = req.params as unknown as z.infer<typeof paresSchema>;
    const data = await catalogoService.publicar(
      experienceId,
      locationId,
      req.body as CondicionesDeSedeInput,
      req.user!.companyId,
      { isAdmin: req.user!.role === 'ADMIN' },
    );
    res.json({ data });
  },
);

// Quitar la experiencia de esa sede. No cancela lo ya vendido alli: cierra la
// venta futura, y la respuesta dice cuantas reservas quedan en pie para que la
// pantalla pueda avisarlo.
catalogoRouter.delete(
  '/publicaciones/:experienceId/:locationId',
  requireRole('HOST', 'ADMIN'),
  validate(paresSchema, 'params'),
  async (req: Request, res: Response) => {
    const { experienceId, locationId } = req.params as unknown as z.infer<typeof paresSchema>;
    // El aviso va DENTRO de `data` y no en `meta`: el cliente del front se
    // queda solo con `data`, y un dato que nadie puede leer es un dato que no
    // existe.
    const resultado = await catalogoService.quitar(
      experienceId,
      locationId,
      req.user!.companyId,
      { isAdmin: req.user!.role === 'ADMIN' },
    );
    res.json({ data: resultado });
  },
);
