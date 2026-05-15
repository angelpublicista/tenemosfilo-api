import type { Request, Response } from 'express';
import { opportunitiesService } from './opportunities.service.js';
import type {
  CreateOpportunityInput,
  ListOpportunitiesQuery,
  UpdateOpportunityInput,
} from './opportunities.schemas.js';

const p = <T,>(req: Request) => req.params as unknown as T;
const q = <T,>(req: Request) => req.query as unknown as T;

export const opportunitiesController = {
  async list(req: Request, res: Response) {
    const items = await opportunitiesService.list(
      req.user!.companyId,
      q<ListOpportunitiesQuery>(req),
    );
    res.json({ data: items });
  },

  async create(req: Request, res: Response) {
    const o = await opportunitiesService.create(
      req.user!.id,
      req.user!.companyId,
      req.body as CreateOpportunityInput,
    );
    res.status(201).json({ data: o });
  },

  async getById(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const o = await opportunitiesService.getById(id);
    res.json({ data: o });
  },

  async update(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const o = await opportunitiesService.update(
      id,
      req.user!.companyId,
      req.body as UpdateOpportunityInput,
    );
    res.json({ data: o });
  },

  async remove(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    await opportunitiesService.softDelete(id, req.user!.companyId);
    res.status(204).end();
  },
};
