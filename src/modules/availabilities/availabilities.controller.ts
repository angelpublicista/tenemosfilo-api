import type { Request, Response } from 'express';
import { availabilitiesService } from './availabilities.service.js';
import type {
  CreateAvailabilityInput,
  ListAvailabilitiesQuery,
  SetPrimaryInput,
  UpdateAvailabilityInput,
} from './availabilities.schemas.js';

const p = <T,>(req: Request) => req.params as unknown as T;
const q = <T,>(req: Request) => req.query as unknown as T;

export const availabilitiesController = {
  async list(req: Request, res: Response) {
    const items = await availabilitiesService.list(
      req.user!.companyId,
      q<ListAvailabilitiesQuery>(req),
    );
    res.json({ data: items });
  },

  async create(req: Request, res: Response) {
    const av = await availabilitiesService.create(
      req.user!.companyId,
      req.body as CreateAvailabilityInput,
    );
    res.status(201).json({ data: av });
  },

  async getById(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const av = await availabilitiesService.getById(id, req.user!.companyId);
    res.json({ data: av });
  },

  async update(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const av = await availabilitiesService.update(
      id,
      req.user!.companyId,
      req.body as UpdateAvailabilityInput,
    );
    res.json({ data: av });
  },

  async remove(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    await availabilitiesService.softDelete(id, req.user!.companyId);
    res.status(204).end();
  },

  async setPrimary(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    await availabilitiesService.setPrimary(
      id,
      req.user!.companyId,
      req.body as SetPrimaryInput,
    );
    res.status(204).end();
  },
};
