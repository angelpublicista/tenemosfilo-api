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
};
