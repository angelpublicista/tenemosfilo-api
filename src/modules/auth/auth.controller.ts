import type { Request, Response } from 'express';
import { authService } from './auth.service.js';

export const authController = {
  async login(req: Request, res: Response) {
    const user = await authService.login(req.body);
    res.json({ data: user });
  },

  async register(req: Request, res: Response) {
    const user = await authService.register(req.body);
    res.status(201).json({ data: user });
  },

  async google(req: Request, res: Response) {
    const user = await authService.loginWithGoogle(req.body);
    res.json({ data: user });
  },

  // 204 siempre: que el email exista o no debe ser indistinguible.
  async forgotPassword(req: Request, res: Response) {
    await authService.forgotPassword(req.body);
    res.status(204).send();
  },

  async resetPassword(req: Request, res: Response) {
    await authService.resetPassword(req.body);
    res.status(204).send();
  },

  async changePassword(req: Request, res: Response) {
    await authService.changePassword(req.user!.id, req.body);
    res.status(204).send();
  },
};
