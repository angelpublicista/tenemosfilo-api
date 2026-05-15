import type { Request, Response } from 'express';
import { companiesService } from './companies.service.js';
import { NotFound } from '../../lib/errors.js';
import type { CreateCompanyInput, UpdateCompanyInput } from './companies.schemas.js';

const p = <T,>(req: Request) => req.params as unknown as T;

export const companiesController = {
  async create(req: Request, res: Response) {
    const company = await companiesService.create(req.user!.id, req.body as CreateCompanyInput);
    res.status(201).json({ data: company });
  },

  async getMine(req: Request, res: Response) {
    // Devuelve la company del user actual (busca por companyId del user).
    const company = await companiesService.getByUser(req.user!.id);
    res.json({ data: company });
  },

  async getById(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const company = await companiesService.getById(id);
    res.json({ data: company });
  },

  async getBySlug(req: Request, res: Response) {
    const { slug } = p<{ slug: string }>(req);
    const company = await companiesService.getBySlug(slug);
    res.json({ data: company });
  },

  async getByOwner(req: Request, res: Response) {
    const { userId } = p<{ userId: string }>(req);
    const company = await companiesService.getByOwner(userId);
    if (!company) throw NotFound('Sin company para este owner');
    res.json({ data: company });
  },

  async update(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const company = await companiesService.update(id, req.user!.id, req.body as UpdateCompanyInput);
    res.json({ data: company });
  },

  async associateMe(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const result = await companiesService.associateUser(req.user!.id, id);
    res.json({ data: result });
  },
};
