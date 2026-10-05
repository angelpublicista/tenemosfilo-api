import type { Request, Response } from 'express';
import { uploadsService } from './uploads.service.js';
import type { CopiarDesdeUrlInput, FirmaLecturaInput, PresignInput } from './uploads.schemas.js';

export const uploadsController = {
  /** Trae a nuestro bucket una imagen que el anfitrion eligio de su web. */
  async copiarDesdeUrl(req: Request, res: Response) {
    const { url } = req.body as CopiarDesdeUrlInput;
    const r = await uploadsService.copiarDesdeUrl({ userId: req.user!.id, url });
    res.status(201).json({ data: r });
  },

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
