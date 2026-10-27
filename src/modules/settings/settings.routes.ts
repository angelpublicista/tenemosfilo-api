import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireHumanAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { getPlatformSettings } from '../../lib/commissions.js';
import { olvidarSuscripciones, urlDelWebhookDeSuscripcionMp } from '../../lib/suscripcion.js';
import { credencialCoincideConEntorno } from '../../lib/mercadopago.js';
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
    filoCommissionOwnGatewayType: commissionTypeEnum.optional(),
    filoCommissionOwnGatewayValue: z.number().nonnegative().optional(),
    resellerCommissionType: commissionTypeEnum.optional(),
    resellerCommissionValue: z.number().nonnegative().optional(),

    wompiEnabled: z.boolean().optional(),
    requirePaymentDefault: z.boolean().optional(),
    subscriptionRequired: z.boolean().optional(),
    // Sin IVA. El minimo evita un precio de 0, que dejaria a todos pagando nada.
    subscriptionPrice: z.number().min(1000).max(100_000_000).optional(),
    subscriptionVat: z.number().min(0).max(100).optional(),
    wompiEnvironment: wompiEnvironmentEnum.optional(),
    wompiPublicKey: secreto,
    wompiPrivateKey: secreto,
    wompiIntegritySecret: secreto,
    wompiEventsSecret: secreto,

    mercadopagoEnabled: z.boolean().optional(),
    mercadopagoEnvironment: wompiEnvironmentEnum.optional(),
    mercadopagoAccessToken: secreto,
    mercadopagoWebhookSecret: secreto,
    // Con cual se cobra la suscripcion de los anfitriones. Una sola a la vez.
    subscriptionProvider: z.enum(['WOMPI', 'MERCADO_PAGO']).optional(),
    // Con cual se cobran las reservas que cobra FILO. Independiente de la anterior.
    reservationsProvider: z.enum(['WOMPI', 'MERCADO_PAGO']).optional(),
  })
  .refine(
    (d) =>
      !(d.filoCommissionType === 'PERCENT' && (d.filoCommissionValue ?? 0) > 100) &&
      !(
        d.filoCommissionOwnGatewayType === 'PERCENT' &&
        (d.filoCommissionOwnGatewayValue ?? 0) > 100
      ) &&
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
    filoCommissionOwnGatewayType: s.filoCommissionOwnGatewayType,
    filoCommissionOwnGatewayValue: s.filoCommissionOwnGatewayValue,
    resellerCommissionType: s.resellerCommissionType,
    resellerCommissionValue: s.resellerCommissionValue,

    wompiEnabled: s.wompiEnabled,
    requirePaymentDefault: s.requirePaymentDefault,
    subscriptionRequired: s.subscriptionRequired,
    subscriptionPrice: s.subscriptionPrice,
    subscriptionVat: s.subscriptionVat,
    wompiEnvironment: s.wompiEnvironment,
    // La llave publica si se devuelve: es publica por diseño y el front la
    // necesita para abrir el checkout.
    wompiPublicKey: s.wompiPublicKey,
    wompiPrivateKeyConfigured: !!s.wompiPrivateKey,
    wompiIntegritySecretConfigured: !!s.wompiIntegritySecret,
    wompiEventsSecretConfigured: !!s.wompiEventsSecret,

    mercadopagoEnabled: s.mercadopagoEnabled,
    mercadopagoEnvironment: s.mercadopagoEnvironment,
    mercadopagoAccessTokenConfigured: !!s.mercadopagoAccessToken,
    mercadopagoWebhookSecretConfigured: !!s.mercadopagoWebhookSecret,
    subscriptionProvider: s.subscriptionProvider === 'MERCADO_PAGO' ? 'MERCADO_PAGO' : 'WOMPI',
    reservationsProvider: s.reservationsProvider === 'MERCADO_PAGO' ? 'MERCADO_PAGO' : 'WOMPI',
    // Lo que hay que pegar en el panel de Mercado Pago.
    mercadopagoWebhookUrl: urlDelWebhookDeSuscripcionMp(),
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

  // Mercado Pago. Mismas reglas que Wompi: no activar sin credenciales, no
  // cruzar un token de pruebas con produccion, y secretos solo si hay llave de cifrado.
  const entornoMp = input.mercadopagoEnvironment ?? actuales.mercadopagoEnvironment;
  const hayTokenMp =
    input.mercadopagoAccessToken !== undefined
      ? input.mercadopagoAccessToken !== ''
      : !!actuales.mercadopagoAccessToken;
  if (input.mercadopagoAccessToken && !credencialCoincideConEntorno(input.mercadopagoAccessToken, entornoMp)) {
    throw BadRequest(
      `El access token no corresponde al entorno ${entornoMp === 'PRODUCTION' ? 'de producción' : 'de pruebas'}.`,
    );
  }
  const mpActivo = input.mercadopagoEnabled ?? actuales.mercadopagoEnabled;
  if (input.mercadopagoEnabled === true && !hayTokenMp) {
    throw BadRequest('Para activar Mercado Pago hace falta el access token.');
  }
  if (input.mercadopagoAccessToken === '' && mpActivo) {
    throw BadRequest('Desactiva Mercado Pago antes de borrar su access token.');
  }
  // Elegir Mercado Pago para la suscripcion con la pasarela sin lista dejaria a
  // todos los anfitriones sin forma de pagar.
  const proveedor = input.subscriptionProvider ?? actuales.subscriptionProvider;
  if (proveedor === 'MERCADO_PAGO' && !(mpActivo && hayTokenMp)) {
    throw BadRequest('Activa Mercado Pago, con su access token, antes de usarlo para cobrar la suscripción.');
  }
  const proveedorReservas = input.reservationsProvider ?? actuales.reservationsProvider;
  if (proveedorReservas === 'MERCADO_PAGO' && !(mpActivo && hayTokenMp)) {
    throw BadRequest('Activa Mercado Pago, con su access token, antes de usarlo para cobrar las reservas.');
  }
  if (input.mercadopagoEnabled === false && proveedor === 'MERCADO_PAGO') {
    throw BadRequest('Mercado Pago es la pasarela de la suscripción: cámbiala a Wompi antes de desactivarlo.');
  }
  if (input.mercadopagoEnabled === false && proveedorReservas === 'MERCADO_PAGO') {
    throw BadRequest('Mercado Pago es la pasarela de las reservas: cámbiala a Wompi antes de desactivarlo.');
  }
  const secretosMp = ['mercadopagoAccessToken', 'mercadopagoWebhookSecret'] as const;
  if (secretosMp.some((c) => input[c]) && !hayLlaveDeCifrado()) {
    throw BadRequest(
      'Falta CREDENTIALS_KEY en el servidor: no se pueden guardar las credenciales de Mercado Pago. ' +
        'Con ella puesta, se guardan cifradas.',
    );
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

  for (const campo of secretosMp) {
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
      ...(input.filoCommissionOwnGatewayType !== undefined && {
        filoCommissionOwnGatewayType: input.filoCommissionOwnGatewayType,
      }),
      ...(input.filoCommissionOwnGatewayValue !== undefined && {
        filoCommissionOwnGatewayValue: input.filoCommissionOwnGatewayValue,
      }),
      ...(input.resellerCommissionType !== undefined && {
        resellerCommissionType: input.resellerCommissionType,
      }),
      ...(input.resellerCommissionValue !== undefined && {
        resellerCommissionValue: input.resellerCommissionValue,
      }),
      ...(input.subscriptionRequired !== undefined && {
        subscriptionRequired: input.subscriptionRequired,
      }),
      ...(input.subscriptionPrice !== undefined && { subscriptionPrice: input.subscriptionPrice }),
      ...(input.subscriptionVat !== undefined && { subscriptionVat: input.subscriptionVat }),
      ...(input.wompiEnabled !== undefined && { wompiEnabled: input.wompiEnabled }),
      ...(input.wompiEnvironment !== undefined && { wompiEnvironment: input.wompiEnvironment }),
      ...(input.mercadopagoEnabled !== undefined && { mercadopagoEnabled: input.mercadopagoEnabled }),
      ...(input.mercadopagoEnvironment !== undefined && {
        mercadopagoEnvironment: input.mercadopagoEnvironment,
      }),
      ...(input.subscriptionProvider !== undefined && {
        subscriptionProvider: input.subscriptionProvider,
      }),
      ...(input.reservationsProvider !== undefined && {
        reservationsProvider: input.reservationsProvider,
      }),
      ...conSecretos,
    },
  });

  // Encender la suscripcion, o cambiar su precio, cambia a quien se bloquea:
  // que la cache de 30 segundos no lo retrase.
  olvidarSuscripciones();

  res.json({ data: aRespuesta(data) });
});
