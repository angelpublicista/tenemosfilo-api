import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authController } from './auth.controller.js';
import {
  forgotPasswordSchema,
  googleAuthSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from './auth.schemas.js';

export const authRouter = Router();

// Endpoints consumidos por NextAuth en el front (provider Credentials/Google).
authRouter.post('/login', validate(loginSchema), authController.login);
authRouter.post('/register', validate(registerSchema), authController.register);
authRouter.post('/oauth/google', validate(googleAuthSchema), authController.google);

// Recuperacion de contraseña (publicos, sin sesion).
// Los consume /reset-password del front via /api/proxy.
authRouter.post(
  '/forgot-password',
  validate(forgotPasswordSchema),
  authController.forgotPassword,
);
authRouter.post('/reset-password', validate(resetPasswordSchema), authController.resetPassword);
