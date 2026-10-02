import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireHumanAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { getPlatformSettings } from '../../lib/commissions.js';
import { llaveCoincideConEntorno } from '../../lib/wompi.js';
import { cifrar, hayLlaveDeCifrado } from '../../lib/cripto.js';
import { BadRequest } from '../../lib/errors.js';
import { prisma } from '../../config/prisma.js';

export const settingsRouter = Router();

const commissionTypeEnum = z.enum(['PERCENT', 'FIXED']);
const wompiEnvironmentEnum = z.enum(['SANDBOX', 'PRODUCTION']);

// Cadena vacia = borrar el secreto. Omitido = dejarlo como esta. Sin esta
// distincion no habria forma de quitar una llave ya guardada.
const secreto = z.string().trim().optional();

const updateSettingsSchema = z
  .object({
    filoCommissionType: commissionTypeEnum.optional(),
    filoCommissionValue: z.number().nonnegative().optional(),
    resellerCommissionType: commissionTypeEnum.optional(),
    resellerCommissionValue: z.number().nonnegative().optional(),

    wompiEnabled: z.boolean().optional(),
    requirePaymentDefault: z.boolean().optional(),
    wompiEnvironment: wompiEnvironmentEnum.optional(),
    wompiPublicKey: secreto,
    wompiPrivateKey: secreto,
    wompiIntegritySecret: secreto,
    wompiEventsSecret: secreto,
  })
  .refine(
    (d) =>
      !(d.filoCommissionType === 'PERCENT' && (d.filoCommissionValue ?? 0) > 100) &&
      !(d.resellerCommissionType === 'PERCENT' && (d.resellerCommissionValue ?? 0) > 100),
    { message: 'Un porcentaje no puede ser mayor que 100' },
  );

type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;

/**
 * Version publica de los ajustes.
 *
 * Las llaves privadas NUNCA salen del API, ni siquiera para un admin: en el
 * navegador acabarian en memoria, en el historial de red y en cualquier
 * extension instalada. Se informa solo si estan configuradas.
 */
function aRespuesta(s: Awaited<ReturnType<typeof getPlatformSettings>>) {
  return {
    filoCommissionType: s.filoCommissionType,
    filoCommissionValue: s.filoCommissionValue,
    resellerCommissionType: s.resellerCommissionType,
    resellerCommissionValue: s.resellerCommissionValue,

    wompiEnabled: s.wompiEnabled,
    requirePaymentDefault: s.requirePaymentDefault,
    wompiEnvironment: s.wompiEnvironment,
    // La llave publica si se devuelve: es publica por diseño y el front la
    // necesita para abrir el checkout.
    wompiPublicKey: s.wompiPublicKey,
    wompiPrivateKeyConfigured: !!s.wompiPrivateKey,
    wompiIntegritySecretConfigured: !!s.wompiIntegritySecret,
    wompiEventsSecretConfigured: !!s.wompiEventsSecret,
  };
}

settingsRouter.use(requireAuth, requireHumanAuth, requireRole('ADMIN'));

settingsRouter.get('/', async (_req: Request, res: Response) => {
  res.json({ data: aRespuesta(await getPlatformSettings()) });
});

settingsRouter.patch('/', validate(updateSettingsSchema), async (req: Request, res: Response) => {
  const input = req.body as UpdateSettingsInput;
  const actuales = await getPlatformSettings();

  const entorno = input.wompiEnvironment ?? actuales.wompiEnvironment;
  const llave = input.wompiPublicKey !== undefined ? input.wompiPublicKey : actuales.wompiPublicKey;
  if (!llaveCoincideConEntorno(llave, entorno)) {
    throw BadRequest(
      `La llave pública no corresponde al entorno ${entorno === 'PRODUCTION' ? 'de producción' : 'de pruebas'}.`,
    );
  }

  // Activar la pasarela sin las llaves dejaria el checkout roto en silencio.
  const activando = input.wompiEnabled === true;
  if (activando) {
    const conIntegridad =
      input.wompiIntegritySecret !== undefined
        ? input.wompiIntegritySecret
        : actuales.wompiIntegritySecret;
    if (!llave || !conIntegridad) {
      throw BadRequest(
        'Para activar Wompi hacen falta la llave pública y el secreto de integridad.',
      );
    }
  }

  // Una cadena vacia borra el secreto; omitirlo lo deja intacto.
  //
  // Los tres secretos se cifran antes de guardarse. La llave publica no: viaja
  // al navegador para abrir el checkout, cifrarla no protegeria nada y
  // obligaria a descifrarla para enseñarla.
  const conSecretos: Record<string, unknown> = {};
  if (input.wompiPublicKey !== undefined) {
    conSecretos.wompiPublicKey = input.wompiPublicKey === '' ? null : input.wompiPublicKey;
  }
  const secretos = ['wompiPrivateKey', 'wompiIntegritySecret', 'wompiEventsSecret'] as const;
  if (secretos.some((c) => input[c]) && !hayLlaveDeCifrado()) {
    throw BadRequest(
      'Falta CREDENTIALS_KEY en el servidor: no se pueden guardar las llaves de Wompi. ' +
        'Con ella puesta, se guardan cifradas.',
    );
  }
  for (const campo of secretos) {
    if (input[campo] !== undefined) {
      conSecretos[campo] = input[campo] === '' ? null : cifrar(input[campo] as string);
    }
  }

  const data = await prisma.platformSettings.update({
    where: { id: 'default' },
    data: {
      ...(input.requirePaymentDefault !== undefined && {
        requirePaymentDefault: input.requirePaymentDefault,
      }),
      ...(input.filoCommissionType !== undefined && { filoCommissionType: input.filoCommissionType }),
      ...(input.filoCommissionValue !== undefined && {
        filoCommissionValue: input.filoCommissionValue,
      }),
      ...(input.resellerCommissionType !== undefined && {
        resellerCommissionType: input.resellerCommissionType,
      }),
      ...(input.resellerCommissionValue !== undefined && {
        resellerCommissionValue: input.resellerCommissionValue,
      }),
      ...(input.wompiEnabled !== undefined && { wompiEnabled: input.wompiEnabled }),
      ...(input.wompiEnvironment !== undefined && { wompiEnvironment: input.wompiEnvironment }),
      ...conSecretos,
    },
  });

  res.json({ data: aRespuesta(data) });
});
