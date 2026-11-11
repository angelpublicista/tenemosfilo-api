// Primeros pasos del anfitrion: cuanto lleva hecho y como va su recorrido.
//
// El avance sale de lo que de verdad existe en la base —sedes, experiencias,
// horarios, publicaciones, cobros— y no de marcas que alguien pulse: un paso
// "hecho" que no lo esta es peor que no tener lista. Lo unico que se guarda es
// lo que el usuario decide: si ya vio el tour, que pasos descarto y si oculto
// la lista.
import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import type { Prisma } from '@prisma/client';
import { requireAuth, requireHumanAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { prisma } from '../../config/prisma.js';
import { pasarelaDe } from '../../lib/pasarela.js';

export const onboardingRouter = Router();

onboardingRouter.use(requireAuth, requireHumanAuth);

/** Lo que el usuario decide. Lo demas se calcula. */
interface EstadoGuardado {
  tourVisto: boolean;
  descartados: string[];
  oculto: boolean;
}

const SIN_ESTADO: EstadoGuardado = { tourVisto: false, descartados: [], oculto: false };

const leerEstado = (crudo: unknown): EstadoGuardado => {
  const e = (crudo ?? {}) as Partial<EstadoGuardado>;
  return {
    tourVisto: e.tourVisto === true,
    descartados: Array.isArray(e.descartados) ? e.descartados.filter((d) => typeof d === 'string') : [],
    oculto: e.oculto === true,
  };
};

/** Cuanto lleva hecho la empresa. Sin empresa, todo en cero. */
async function avanceDe(companyId: string | null | undefined) {
  if (!companyId) {
    return { sedes: 0, experiencias: 0, horarios: 0, publicaciones: 0, cobros: false };
  }
  const vivos = { deletedAt: null, isActive: true } as const;
  const [sedes, experiencias, horarios, publicaciones, pasarela] = await Promise.all([
    prisma.location.count({ where: { companyId, ...vivos } }),
    prisma.experience.count({ where: { companyId, ...vivos } }),
    prisma.availability.count({ where: { companyId, ...vivos } }),
    prisma.locationListing.count({
      where: { deletedAt: null, isPublished: true, experience: { companyId, deletedAt: null } },
    }),
    pasarelaDe(companyId).catch(() => null),
  ]);
  return { sedes, experiencias, horarios, publicaciones, cobros: pasarela !== null };
}

onboardingRouter.get('/', async (req: Request, res: Response) => {
  const usuario = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { onboarding: true },
  });
  res.json({
    data: {
      estado: leerEstado(usuario?.onboarding),
      avance: await avanceDe(req.user!.companyId),
    },
  });
});

const cambioSchema = z.object({
  tourVisto: z.boolean().optional(),
  oculto: z.boolean().optional(),
  descartados: z.array(z.string().trim().min(1).max(40)).max(30).optional(),
  /** Vuelve a empezar: el tour se ofrece otra vez y la lista reaparece. */
  reiniciar: z.boolean().optional(),
});

onboardingRouter.put('/', validate(cambioSchema), async (req: Request, res: Response) => {
  const cambio = req.body as z.infer<typeof cambioSchema>;
  const usuario = await prisma.user.findUnique({
    where: { id: req.user!.id },
    select: { onboarding: true },
  });
  const actual = leerEstado(usuario?.onboarding);

  const nuevo: EstadoGuardado = cambio.reiniciar
    ? { ...SIN_ESTADO }
    : {
        tourVisto: cambio.tourVisto ?? actual.tourVisto,
        oculto: cambio.oculto ?? actual.oculto,
        descartados: cambio.descartados ?? actual.descartados,
      };

  await prisma.user.update({
    where: { id: req.user!.id },
    data: { onboarding: nuevo as unknown as Prisma.InputJsonValue },
  });
  res.json({ data: { estado: nuevo, avance: await avanceDe(req.user!.companyId) } });
});
