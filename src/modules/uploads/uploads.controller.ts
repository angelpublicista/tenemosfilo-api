import type { Request, Response } from 'express';
import { uploadsService } from './uploads.service.js';
import type { FirmaLecturaInput, PresignInput } from './uploads.schemas.js';

export const uploadsController = {
  async presign(req: Request, res: Response) {
    const body = req.body as PresignInput;
    const result = await uploadsService.presign({ ...body, userId: req.user!.id });
    res.json({ data: result });
  },

  async firmarLectura(req: Request, res: Response) {
    const { key } = req.query as unknown as FirmaLecturaInput;
    const result = await uploadsService.firmarLectura({
      key,
      userId: req.user!.id,
      role: req.user!.role,
    });
    res.json({ data: result });
  },
};
