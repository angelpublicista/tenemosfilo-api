import { createHash, randomBytes } from 'node:crypto';
import { OAuth2Client } from 'google-auth-library';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { invitationEmailHtml, passwordResetEmailHtml, sendEmail } from '../../lib/email.js';
import { BadRequest, Conflict, NotFound, Unauthorized } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import { hashPassword, verifyPassword } from '../../lib/password.js';
import type {
  ChangePasswordInput,
  ForgotPasswordInput,
  GoogleAuthInput,
  LoginInput,
  RegisterInput,
  ResetPasswordInput,
} from './auth.schemas.js';

const googleClient = env.GOOGLE_CLIENT_ID ? new OAuth2Client(env.GOOGLE_CLIENT_ID) : null;

// Ventana corta: el enlace de reset es una credencial temporal.
const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hora
const RESET_TOKEN_BYTES = 32;

// La invitacion dura mucho mas que un reset. Quien pide recuperar su
// contraseña esta delante de la pantalla esperando el correo; a quien le
// crean una cuenta puede que le llegue un viernes y la abra el lunes. Una
// hora convertiria casi todas las invitaciones en un enlace caducado.
const INVITE_TOKEN_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 dias

/** Guardamos solo el sha256; el token plano viaja unicamente en el correo. */
function hashResetToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

function generateResetToken(): { token: string; tokenHash: string } {
  const token = randomBytes(RESET_TOKEN_BYTES).toString('base64url');
  return { token, tokenHash: hashResetToken(token) };
}

const publicUserSelect = {
  id: true,
  email: true,
  name: true,
  role: true,
  image: true,
  phone: true,
  companyId: true,
} as const;

export const authService = {
  async login({ email, password }: LoginInput) {
    const user = await prisma.user.findUnique({ where: { email } });
    if (!user || !user.password) throw Unauthorized('Credenciales invalidas');

    const ok = await verifyPassword(password, user.password);
    if (!ok) throw Unauthorized('Credenciales invalidas');
    if (!user.isActive || user.deletedAt) throw Unauthorized('Usuario inactivo');

    return this.toPublic(user);
  },

  async register(input: RegisterInput) {
    const exists = await prisma.user.findUnique({ where: { email: input.email } });
    if (exists) throw Conflict('Ya existe un usuario con ese email');

    const passwordHash = await hashPassword(input.password);
    const user = await prisma.user.create({
      data: {
        email: input.email,
        password: passwordHash,
        name: input.name ?? null,
        phone: input.phone ?? null,
        role: input.role,
        documentType: input.documentType ?? null,
        documentNumber: input.documentNumber ?? null,
      },
      select: publicUserSelect,
    });
    return user;
  },

  async loginWithGoogle({ idToken }: GoogleAuthInput) {
    if (!googleClient) throw Unauthorized('Google OAuth no configurado en el API');

    const ticket = await googleClient.verifyIdToken({
      idToken,
      audience: env.GOOGLE_CLIENT_ID,
    });
    const payload = ticket.getPayload();
    if (!payload?.email) throw Unauthorized('Token de Google invalido');

    const user = await prisma.user.upsert({
      where: { email: payload.email },
      update: {
        name: payload.name ?? undefined,
        image: payload.picture ?? undefined,
        emailVerified: payload.email_verified ? new Date() : undefined,
      },
      create: {
        email: payload.email,
        name: payload.name ?? null,
        image: payload.picture ?? null,
        emailVerified: payload.email_verified ? new Date() : null,
        role: 'GUEST',
      },
      select: publicUserSelect,
    });

    if (!user) throw Unauthorized('No se pudo crear el usuario');
    return user;
  },

  /**
   * Paso 1 del reset. SIEMPRE termina sin error, exista o no el email:
   * cualquier diferencia observable (status, mensaje, tiempo) convertiria
   * este endpoint en un oraculo para enumerar usuarios registrados.
   */
  async forgotPassword({ email }: ForgotPasswordInput) {
    const user = await prisma.user.findUnique({ where: { email } });

    // Silencio deliberado para usuario inexistente, inactivo o borrado.
    if (!user || !user.isActive || user.deletedAt) {
      logger.info({ email }, 'forgot-password para email sin cuenta activa: no se envia correo');
      return;
    }

    const { token, tokenHash } = generateResetToken();

    // Invalidamos los tokens vigentes previos: solo el ultimo enlace sirve.
    await prisma.passwordResetToken.updateMany({
      where: { userId: user.id, usedAt: null },
      data: { usedAt: new Date() },
    });

    await prisma.passwordResetToken.create({
      data: {
        tokenHash,
        userId: user.id,
        expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
      },
    });

    const resetUrl = `${env.APP_URL}/reset-password?token=${token}`;
    const sent = await sendEmail({
      to: user.email,
      subject: 'Recupera tu contraseña - Tenemos Filo',
      html: passwordResetEmailHtml(resetUrl),
    });

    // Un fallo de correo se registra pero no cambia la respuesta HTTP.
    if (!sent) logger.error({ userId: user.id }, 'No se pudo enviar el correo de recuperacion');
  },

  /** Paso 2 del reset: canjea el token por una contraseña nueva. */
  /**
   * Invitacion a una cuenta creada por un administrador.
   *
   * Reutiliza el mismo mecanismo que la recuperacion de contraseña: un token
   * de un solo uso del que solo se guarda el sha256. Cambian el texto y la
   * caducidad, no la maquinaria — y asi el endpoint que fija la contraseña
   * sirve para los dos casos sin tocarlo.
   *
   * No lanza si falla el envio: la cuenta ya esta creada, y que el correo no
   * salga no debe convertir en error una operacion que si ocurrio. Queda en
   * el log, y siempre se puede reenviar.
   */
  async enviarInvitacion(userId: string): Promise<boolean> {
    try {
      const user = await prisma.user.findUnique({
        where: { id: userId },
        select: { id: true, email: true, name: true, isActive: true, deletedAt: true },
      });
      if (!user || !user.isActive || user.deletedAt) return false;

      const { token, tokenHash } = generateResetToken();

      // Como en el reset: solo el ultimo enlace emitido sirve.
      await prisma.passwordResetToken.updateMany({
        where: { userId: user.id, usedAt: null },
        data: { usedAt: new Date() },
      });
      await prisma.passwordResetToken.create({
        data: {
          tokenHash,
          userId: user.id,
          expiresAt: new Date(Date.now() + INVITE_TOKEN_TTL_MS),
        },
      });

      // El parametro `invitacion` solo cambia lo que dice la pantalla: para
      // el API el token es el mismo. Si se pierde por el camino, la persona
      // vera el texto de recuperacion y podra elegir contraseña igualmente.
      const url = `${env.APP_URL}/reset-password?token=${token}&invitacion=1`;
      const enviado = await sendEmail({
        to: user.email,
        subject: 'Tu cuenta en Tenemos Filo',
        html: invitationEmailHtml(url, user.name),
      });

      if (!enviado) {
        logger.error({ userId, email: user.email }, 'no se pudo enviar la invitacion');
      }
      return enviado;
    } catch (err) {
      logger.error({ err, userId }, 'fallo al preparar la invitacion');
      return false;
    }
  },

  async resetPassword({ token, password }: ResetPasswordInput) {
    const record = await prisma.passwordResetToken.findUnique({
      where: { tokenHash: hashResetToken(token) },
      include: { user: true },
    });

    // Mismo error para token inexistente, ya usado o vencido: no damos
    // pistas sobre cual de los tres fue.
    if (!record || record.usedAt || record.expiresAt < new Date()) {
      throw BadRequest('El enlace de recuperacion no es valido o ya expiro');
    }
    if (!record.user.isActive || record.user.deletedAt) {
      throw BadRequest('El enlace de recuperacion no es valido o ya expiro');
    }

    const passwordHash = await hashPassword(password);

    // Transaccion: cambiar la contraseña y quemar el token deben ocurrir
    // juntos, o el enlace quedaria reutilizable.
    await prisma.$transaction([
      prisma.user.update({
        where: { id: record.userId },
        data: { password: passwordHash },
      }),
      prisma.passwordResetToken.updateMany({
        where: { userId: record.userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    logger.info({ userId: record.userId }, 'Contraseña restablecida');
  },

  /**
   * Cambio de contraseña desde la sesion, sin pasar por el correo.
   *
   * Se exige la actual aunque ya haya sesion: si alguien deja el equipo
   * abierto, no deberia poder quedarse con la cuenta cambiando la clave.
   */
  async changePassword(userId: string, { currentPassword, newPassword }: ChangePasswordInput) {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { id: true, password: true },
    });
    if (!user) throw NotFound('Usuario no encontrado');

    // Las cuentas creadas con Google no tienen contraseña que comparar.
    if (!user.password) {
      throw BadRequest('Tu cuenta entra con Google; no tiene contraseña que cambiar');
    }
    if (!(await verifyPassword(currentPassword, user.password))) {
      throw BadRequest('La contraseña actual no es correcta');
    }
    if (currentPassword === newPassword) {
      throw BadRequest('La contraseña nueva debe ser distinta de la actual');
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { password: await hashPassword(newPassword) },
      }),
      // Cambiar la clave invalida cualquier enlace de recuperacion vivo:
      // si el cambio fue porque sospechas que te entraron, un enlace
      // pendiente en el correo seguiria siendo una puerta abierta.
      prisma.passwordResetToken.updateMany({
        where: { userId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    logger.info({ userId }, 'Contraseña cambiada desde la sesion');
  },

  toPublic(user: { id: string; email: string; name: string | null; role: 'HOST' | 'GUEST' | 'ADMIN' | 'RESELLER'; image: string | null; phone: string | null; companyId: string | null }) {
    return {
      id: user.id,
      email: user.email,
      name: user.name,
      role: user.role,
      image: user.image,
      phone: user.phone,
      companyId: user.companyId,
    };
  },
};
