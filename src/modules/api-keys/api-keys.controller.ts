import type { Request, Response } from 'express';
import { Forbidden } from '../../lib/errors.js';
import { apiKeysService } from './api-keys.service.js';
import type { CreateApiKeyInput, UpdateApiKeyInput } from './api-keys.schemas.js';

function requireCompany(req: Request): string {
  const companyId = req.user?.companyId;
  if (!companyId) throw Forbidden('No tienes una company asociada');
  return companyId;
}

export const apiKeysController = {
  async list(req: Request, res: Response) {
    const items = await apiKeysService.list(requireCompany(req));
    res.json({ data: items });
  },

  async getById(req: Request, res: Response) {
    const { id } = req.params as { id: string };
    const item = await apiKeysService.getById(id, requireCompany(req));
    res.json({ data: item });
  },

  async create(req: Request, res: Response) {
    const companyId = requireCompany(req);
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
      requireCompany(req),
      req.body as UpdateApiKeyInput,
    );
    res.json({ data: item });
  },

  async revoke(req: Request, res: Response) {
    const { id } = req.params as { id: string };
    await apiKeysService.revoke(id, requireCompany(req));
    res.status(204).end();
  },
};
