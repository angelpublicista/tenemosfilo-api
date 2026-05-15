import type { Request, Response } from 'express';
import { uploadsService } from './uploads.service.js';
import type { PresignInput } from './uploads.schemas.js';

export const uploadsController = {
  async presign(req: Request, res: Response) {
    const body = req.body as PresignInput;
    const result = await uploadsService.presign({ ...body, userId: req.user!.id });
    res.json({ data: result });
  },
};
