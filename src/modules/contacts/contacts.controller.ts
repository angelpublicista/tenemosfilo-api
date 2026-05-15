import type { Request, Response } from 'express';
import { contactsService } from './contacts.service.js';
import type {
  CreateContactInput,
  ListContactsQuery,
  UpdateContactInput,
} from './contacts.schemas.js';

const p = <T,>(req: Request) => req.params as unknown as T;
const q = <T,>(req: Request) => req.query as unknown as T;

export const contactsController = {
  async list(req: Request, res: Response) {
    const items = await contactsService.list(req.user!.companyId, q<ListContactsQuery>(req));
    res.json({ data: items });
  },

  async create(req: Request, res: Response) {
    const c = await contactsService.create(
      req.user!.id,
      req.user!.companyId,
      req.body as CreateContactInput,
    );
    res.status(201).json({ data: c });
  },

  async getById(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const c = await contactsService.getById(id, req.user!.companyId);
    res.json({ data: c });
  },

  async update(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const c = await contactsService.update(id, req.user!.companyId, req.body as UpdateContactInput);
    res.json({ data: c });
  },

  async remove(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    await contactsService.softDelete(id, req.user!.companyId);
    res.status(204).end();
  },

  async restore(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const c = await contactsService.restore(id, req.user!.companyId);
    res.json({ data: c });
  },
};
