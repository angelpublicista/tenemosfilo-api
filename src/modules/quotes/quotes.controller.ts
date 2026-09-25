import type { Request, Response } from 'express';
import { quotesService } from './quotes.service.js';
import type {
  CreateQuoteInput,
  ListQuotesQuery,
  SearchExperiencesQuery,
} from './quotes.schemas.js';
import type { QuoteStatus } from '@prisma/client';

const p = <T,>(req: Request) => req.params as unknown as T;
const q = <T,>(req: Request) => req.query as unknown as T;

export const quotesController = {
  async marcarEnviada(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const { via } = (req.body ?? {}) as { via?: 'FILO' | 'EXTERNO' };
    const q = await quotesService.marcarEnviada(id, req.user!.companyId, via ?? 'FILO');
    res.json({ data: q });
  },

  async porOportunidad(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const r = await quotesService.porOportunidad(id, req.user!.companyId);
    res.json({ data: r.items, meta: { vigenteId: r.vigenteId } });
  },

  async list(req: Request, res: Response) {
    const items = await quotesService.list(req.user!.companyId, q<ListQuotesQuery>(req));
    res.json({ data: items });
  },

  async create(req: Request, res: Response) {
    const asReseller = req.user!.role === 'RESELLER';
    const created = await quotesService.create(
      req.user!.id,
      req.user!.companyId,
      req.body as CreateQuoteInput,
      { asReseller },
    );
    res.status(201).json({ data: created });
  },

  async updateStatus(req: Request, res: Response) {
    const { id } = p<{ id: string }>(req);
    const { status } = req.body as { status: QuoteStatus };
    const quote = await quotesService.updateStatus(id, req.user!.companyId, status);
    res.json({ data: quote });
  },

  async searchExperiences(req: Request, res: Response) {
    const crossCompany = req.user!.role === 'RESELLER';
    const items = await quotesService.searchExperiences(
      req.user!.companyId,
      q<SearchExperiencesQuery>(req),
      { crossCompany },
    );
    res.json({ data: items });
  },
};
