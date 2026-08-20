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
  role: z.enum(['HOST', 'GUEST', 'RESELLER']).default('GUEST'),
  documentType: z.string().optional(),
  documentNumber: z.string().optional(),
});

export const googleAuthSchema = z.object({
  // id_token recibido del flujo OAuth de Google
  idToken: z.string().min(1),
});

export const forgotPasswordSchema = z.object({
  email: z.string().email(),
});

export const resetPasswordSchema = z.object({
  token: z.string().min(1),
  // Mismo minimo que registerSchema: no tiene sentido que el reset
  // permita contraseñas mas debiles que el registro.
  password: z.string().min(8, 'Minimo 8 caracteres'),
});

export type LoginInput = z.infer<typeof loginSchema>;
export type ForgotPasswordInput = z.infer<typeof forgotPasswordSchema>;
export type ResetPasswordInput = z.infer<typeof resetPasswordSchema>;
export type RegisterInput = z.infer<typeof registerSchema>;
export type GoogleAuthInput = z.infer<typeof googleAuthSchema>;
