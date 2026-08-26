import type { Request, Response } from 'express';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
import { prisma } from '../../config/prisma.js';
import { apiKeysService } from './api-keys.service.js';
import type { CreateApiKeyInput, UpdateApiKeyInput } from './api-keys.schemas.js';

function requireCompany(req: Request): string {
  const companyId = req.user?.companyId;
  if (!companyId) throw Forbidden('No tienes una company asociada');
  return companyId;
}

/**
 * Sobre que llaves puede actuar quien llama.
 *
 * Un ADMIN sin empresa las ve todas: no tiene una propia, y si se le
 * exigiera no podria ni consultar ni revocar las que el mismo emite para
 * otras empresas. Un admin que SI esta operando como empresa —con la
 * cabecera de empresa activa— se queda en ese ambito, que es lo que espera
 * ver mientras trabaja dentro de ella.
 */
function ambito(req: Request): string | null {
  if (req.user?.role === 'ADMIN' && !req.user.companyId) return null;
  return requireCompany(req);
}

/**
 * A que empresa pertenece la llave que se va a crear.
 *
 * Un ADMIN emite a nombre de la empresa de la plataforma: Filo tambien vende
 * por su propio canal, y esas ventas se le atribuyen. No se le pide elegir
 * porque su empresa es siempre la misma; puede indicar otra explicitamente
 * para emitir en nombre de un tercero, pero no es el caso normal.
 *
 * Los admins NO tienen companyId propio a proposito: media aplicacion filtra
 * por la empresa del usuario cuando la tiene, y darsela les estrecharia la
 * vista global del panel.
 *
 * El resto de roles solo emite para su empresa, aunque mande otra en el
 * cuerpo: fiarse del companyId del cliente dejaria que un revendedor creara
 * llaves a nombre de otra empresa y le desviara las ventas.
 */
async function empresaDeLaLlave(req: Request): Promise<string> {
  const pedida = (req.body as { companyId?: string }).companyId;

  if (!pedida) {
    if (req.user?.role === 'ADMIN' && !req.user.companyId) {
      const ajustes = await prisma.platformSettings.findUnique({
        where: { id: 'default' },
        select: { platformCompanyId: true },
      });
      if (!ajustes?.platformCompanyId) {
        throw BadRequest(
          'No hay una empresa de plataforma configurada. Créala antes de emitir claves.',
        );
      }
      return ajustes.platformCompanyId;
    }
    return requireCompany(req);
  }

  if (req.user?.role !== 'ADMIN') {
    // Silencio en vez de error: quien no es admin nunca deberia mandarlo, y
    // decirle que el campo existe solo le da una pista de que intentar.
    return requireCompany(req);
  }

  const empresa = await prisma.company.findFirst({
    where: { id: pedida, deletedAt: null },
    select: { id: true },
  });
  if (!empresa) throw NotFound('La empresa indicada no existe');
  return empresa.id;
}

export const apiKeysController = {
  async list(req: Request, res: Response) {
    const items = await apiKeysService.list(ambito(req));
    res.json({ data: items });
  },

  async getById(req: Request, res: Response) {
    const { id } = req.params as { id: string };
    const item = await apiKeysService.getById(id, ambito(req));
    res.json({ data: item });
  },

  async create(req: Request, res: Response) {
    const companyId = await empresaDeLaLlave(req);
    const created = await apiKeysService.create(
      companyId,
      req.user!.id,
      req.body as CreateApiKeyInput,
    );
    res.status(201).json({
      data: created,
      meta: {
        warning:
          'Guarda este token: no podra recuperarse. Solo se muestra en esta respuesta.',
      },
    });
  },

  async update(req: Request, res: Response) {
    const { id } = req.params as { id: string };
    const item = await apiKeysService.update(
      id,
      ambito(req),
      req.body as UpdateApiKeyInput,
    );
    res.json({ data: item });
  },

  async revoke(req: Request, res: Response) {
    const { id } = req.params as { id: string };
    await apiKeysService.revoke(id, ambito(req));
    res.status(204).end();
  },
};
