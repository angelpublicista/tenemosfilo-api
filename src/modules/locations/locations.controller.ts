import type { Request, Response } from 'express';
import { locationsService } from './locations.service.js';
import type {
  CreateLocationInput,
  ListLocationsQuery,
  UpdateLocationInput,
} from './locations.schemas.js';

const p = <T,>(req: Request) => req.params as unknown as T;
const q = <T,>(req: Request) => req.query as unknown as T;

export const locationsController = {
  async list(req: Request, res: Response) {
    const items = await locationsService.list(req.user!.companyId, q<ListLocationsQuery>(req));
    res.json({ data: items });
  },

  async create(req: Request, res: Response) {
    const loc = await locationsService.create(req.user!.companyId, req.body as CreateLocationInput);
    res.status(201).json({ data: loc });
  },

  async getById(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const loc = await locationsService.getById(id, req.user!.companyId);
    res.json({ data: loc });
  },

  async update(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const loc = await locationsService.update(id, req.user!.companyId, req.body as UpdateLocationInput);
    res.json({ data: loc });
  },

  async remove(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    await locationsService.softDelete(id, req.user!.companyId);
    res.status(204).end();
  },

  async setMain(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    await locationsService.setMain(id, req.user!.companyId);
    res.status(204).end();
  },
};
