// Plantillas de correo: el administrador las ve, las edita, las prueba y las
// restaura. Los textos por defecto viven en el codigo; aqui solo se guarda lo
// que el administrador cambie (ver lib/plantillas-de-correo.ts).
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireHumanAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { BadRequest, NotFound } from '../../lib/errors.js';
import { prisma } from '../../config/prisma.js';
import { sendEmail } from '../../lib/email.js';
import {
  PLANTILLAS,
  componer,
  esClaveDePlantilla,
  plantillaVigente,
  validarContenido,
  valoresDeEjemplo,
  type ClaveDePlantilla,
} from '../../lib/plantillas-de-correo.js';

export const plantillasDeCorreoRouter = Router();

plantillasDeCorreoRouter.use(requireAuth, requireHumanAuth, requireRole('ADMIN'));

const contenidoSchema = z.object({
  subject: z.string().trim().min(1, 'El asunto es obligatorio').max(200),
  title: z.string().trim().min(1, 'El título es obligatorio').max(200),
  body: z.string().trim().min(1, 'El cuerpo es obligatorio').max(20_000),
  // Vacio = sin boton.
  buttonText: z.string().trim().max(60),
});

const claveSchema = z.object({ key: z.string().min(1) });

function claveDe(req: Request): ClaveDePlantilla {
  const { key } = req.params as { key: string };
  if (!esClaveDePlantilla(key)) throw NotFound('Esa plantilla no existe');
  return key;
}

const detalle = async (key: ClaveDePlantilla) => {
  const def = PLANTILLAS[key];
  const vigente = await plantillaVigente(key);
  return {
    key,
    nombre: def.nombre,
    descripcion: def.descripcion,
    cuando: def.cuando,
    variables: def.variables,
    defecto: def.defecto,
    actual: {
      subject: vigente.subject,
      title: vigente.title,
      body: vigente.body,
      buttonText: vigente.buttonText,
    },
    personalizada: vigente.personalizada,
    updatedAt: vigente.updatedAt,
  };
};

plantillasDeCorreoRouter.get('/', async (_req: Request, res: Response) => {
  const filas = await prisma.emailTemplate.findMany({ select: { key: true, updatedAt: true } });
  const editadas = new Map(filas.map((f) => [f.key, f.updatedAt]));
  res.json({
    data: (Object.keys(PLANTILLAS) as ClaveDePlantilla[]).map((key) => ({
      key,
      nombre: PLANTILLAS[key].nombre,
      descripcion: PLANTILLAS[key].descripcion,
      cuando: PLANTILLAS[key].cuando,
      personalizada: editadas.has(key),
      updatedAt: editadas.get(key) ?? null,
    })),
  });
});

plantillasDeCorreoRouter.get('/:key', validate(claveSchema, 'params'), async (req: Request, res: Response) => {
  res.json({ data: await detalle(claveDe(req)) });
});

plantillasDeCorreoRouter.put(
  '/:key',
  validate(claveSchema, 'params'),
  validate(contenidoSchema),
  async (req: Request, res: Response) => {
    const key = claveDe(req);
    const contenido = validarContenido(key, req.body as z.infer<typeof contenidoSchema>);
    await prisma.emailTemplate.upsert({
      where: { key },
      create: { key, ...contenido, updatedByEmail: req.user!.email },
      update: { ...contenido, updatedByEmail: req.user!.email },
    });
    res.json({ data: await detalle(key) });
  },
);

/** Volver al texto por defecto. */
plantillasDeCorreoRouter.delete('/:key', validate(claveSchema, 'params'), async (req: Request, res: Response) => {
  const key = claveDe(req);
  await prisma.emailTemplate.deleteMany({ where: { key } });
  res.json({ data: await detalle(key) });
});

/**
 * Cómo quedaría, con valores de ejemplo. Sin guardar: recibe el borrador, para
 * ver los cambios antes de aplicarlos.
 */
plantillasDeCorreoRouter.post(
  '/:key/vista-previa',
  validate(claveSchema, 'params'),
  validate(contenidoSchema),
  async (req: Request, res: Response) => {
    const key = claveDe(req);
    const contenido = validarContenido(key, req.body as z.infer<typeof contenidoSchema>);
    res.json({ data: componer(key, contenido, valoresDeEjemplo(key)) });
  },
);

/** Un envío real al correo del administrador, para verlo en una bandeja de verdad. */
plantillasDeCorreoRouter.post(
  '/:key/prueba',
  validate(claveSchema, 'params'),
  validate(contenidoSchema),
  async (req: Request, res: Response) => {
    const key = claveDe(req);
    const contenido = validarContenido(key, req.body as z.infer<typeof contenidoSchema>);
    const { subject, html } = componer(key, contenido, valoresDeEjemplo(key));
    const enviado = await sendEmail({ to: req.user!.email, subject: `[Prueba] ${subject}`, html });
    if (!enviado) throw BadRequest('No se pudo enviar el correo de prueba. Revisa la configuración del correo.');
    res.json({ data: { enviadoA: req.user!.email } });
  },
);
