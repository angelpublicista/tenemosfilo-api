import { Router } from 'express';
import { validate } from '../../middleware/validate.js';
import { authController } from './auth.controller.js';
import { googleAuthSchema, loginSchema, registerSchema } from './auth.schemas.js';

export const authRouter = Router();

// Endpoints consumidos por NextAuth en el front (provider Credentials/Google).
authRouter.post('/login', validate(loginSchema), authController.login);
authRouter.post('/register', validate(registerSchema), authController.register);
authRouter.post('/oauth/google', validate(googleAuthSchema), authController.google);
