import type { Request, Response } from 'express';
import { crmCompaniesService } from './crm-companies.service.js';
import type {
  CreateCrmCompanyInput,
  ListCrmCompaniesQuery,
  UpdateCrmCompanyInput,
} from './crm-companies.schemas.js';

const p = <T,>(req: Request) => req.params as unknown as T;
const q = <T,>(req: Request) => req.query as unknown as T;

export const crmCompaniesController = {
  async list(req: Request, res: Response) {
    const items = await crmCompaniesService.list(req.user!.companyId, q<ListCrmCompaniesQuery>(req));
    res.json({ data: items });
  },

  async create(req: Request, res: Response) {
    const c = await crmCompaniesService.create(
      req.user!.companyId,
      req.body as CreateCrmCompanyInput,
    );
    res.status(201).json({ data: c });
  },

  async getById(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const c = await crmCompaniesService.getById(id, req.user!.companyId);
    res.json({ data: c });
  },

  async update(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const c = await crmCompaniesService.update(
      id,
      req.user!.companyId,
      req.body as UpdateCrmCompanyInput,
    );
    res.json({ data: c });
  },

  async remove(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    await crmCompaniesService.softDelete(id, req.user!.companyId);
    res.status(204).end();
  },

  async restore(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const c = await crmCompaniesService.restore(id, req.user!.companyId);
    res.json({ data: c });
  },
};
