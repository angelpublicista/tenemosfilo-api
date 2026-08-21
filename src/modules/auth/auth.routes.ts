import { Router } from 'express';
import { requireAuth, requireHumanAuth } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
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

// Con sesion: cambiar la propia contraseña sin pasar por el correo.
authRouter.post(
  '/change-password',
  requireAuth,
  requireHumanAuth,
  validate(changePasswordSchema),
  authController.changePassword,
);
