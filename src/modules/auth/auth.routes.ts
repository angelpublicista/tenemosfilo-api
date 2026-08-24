import { Router } from 'express';
import { requireAuth, requireHumanAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { limiteAuth, limiteGeneral } from '../../middleware/rate-limit.js';
import { authController } from './auth.controller.js';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  googleAuthSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from './auth.schemas.js';

export const authRouter = Router();

// Endpoints consumidos por NextAuth en el front (provider Credentials/Google).
authRouter.post('/login', limiteAuth, validate(loginSchema), authController.login);
authRouter.post('/register', limiteAuth, validate(registerSchema), authController.register);
authRouter.post('/oauth/google', limiteAuth, validate(googleAuthSchema), authController.google);

// Recuperacion de contraseña (publicos, sin sesion).
// Los consume /reset-password del front via /api/proxy.
authRouter.post(
  '/forgot-password',
  limiteAuth,
  validate(forgotPasswordSchema),
  authController.forgotPassword,
);
authRouter.post('/reset-password', limiteAuth, validate(resetPasswordSchema), authController.resetPassword);

// Con sesion: cambiar la propia contraseña sin pasar por el correo.
authRouter.post(
  '/change-password',
  limiteGeneral,
  requireAuth,
  requireHumanAuth,
  validate(changePasswordSchema),
  authController.changePassword,
);
