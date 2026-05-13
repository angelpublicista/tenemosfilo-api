import { z } from 'zod';

export const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8, 'Minimo 8 caracteres'),
  name: z.string().min(1).optional(),
  phone: z.string().optional(),
  role: z.enum(['HOST', 'GUEST']).default('GUEST'),
});

export const googleAuthSchema = z.object({
  // id_token recibido del flujo OAuth de Google
  idToken: z.string().min(1),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;
