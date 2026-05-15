import type { Request, Response } from 'express';
import { integrationsService } from './integrations.service.js';
import type {
  CreateIntegrationInput,
  ListIntegrationsQuery,
  UpdateIntegrationInput,
  UpdateStatusInput,
} from './integrations.schemas.js';

const p = <T,>(req: Request) => req.params as unknown as T;
const q = <T,>(req: Request) => req.query as unknown as T;

export const integrationsController = {
  async list(req: Request, res: Response) {
    const items = await integrationsService.list(req.user!.id, q<ListIntegrationsQuery>(req));
    res.json({ data: items });
  },

  async stats(req: Request, res: Response) {
    const stats = await integrationsService.stats(req.user!.id);
    res.json({ data: stats });
  },

  async create(req: Request, res: Response) {
    const i = await integrationsService.create(req.user!.id, req.body as CreateIntegrationInput);
    res.status(201).json({ data: i });
  },

  async getById(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const i = await integrationsService.getById(req.user!.id, id);
    res.json({ data: i });
  },

  async update(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const i = await integrationsService.update(req.user!.id, id, req.body as UpdateIntegrationInput);
    res.json({ data: i });
  },

  async updateStatus(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const i = await integrationsService.updateStatus(
      req.user!.id,
      id,
      req.body as UpdateStatusInput,
    );
    res.json({ data: i });
  },

  async remove(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    await integrationsService.softDelete(req.user!.id, id);
    res.status(204).end();
  },
};
