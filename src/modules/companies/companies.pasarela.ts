// Conectar y desconectar la pasarela de cobro de un anfitrion.
//
// Vive aparte del servicio de empresas porque no es un campo mas del perfil:
// son credenciales de cobro, se guardan cifradas, no vuelven a salir nunca y
// cambiarlas cambia a donde va el dinero de las proximas ventas.
import type { PaymentProvider } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
import { cifrar, hayLlaveDeCifrado } from '../../lib/cripto.js';
import { llaveCoincideConEntorno } from '../../lib/wompi.js';
import { credencialCoincideConEntorno } from '../../lib/mercadopago.js';

export interface PasarelaInput {
  provider?: PaymentProvider;
  enabled?: boolean;
  environment?: 'SANDBOX' | 'PRODUCTION';
  publicKey?: string;
  privateKey?: string;
  integritySecret?: string;
  eventsSecret?: string;
}

const CAMPOS_SECRETOS = {
  privateKey: 'gatewayPrivateKey',
  integritySecret: 'gatewayIntegritySecret',
  eventsSecret: 'gatewayEventsSecret',
} as const;

async function miEmpresa(id: string, requesterId: string, esAdmin: boolean) {
  const c = await prisma.company.findFirst({
    where: { id, deletedAt: null },
    select: {
      id: true,
      ownerId: true,
      paymentProvider: true,
      paymentGatewayEnabled: true,
      paymentEnvironment: true,
      gatewayPublicKey: true,
      gatewayPrivateKey: true,
      gatewayIntegritySecret: true,
      gatewayEventsSecret: true,
    },
  });
  if (!c) throw NotFound('Company no encontrada');
  // Cobrar en nombre de una empresa es lo mas delicado que se puede tocar
  // aqui: se limita al titular, no a cualquiera con acceso a la empresa.
  if (!esAdmin && c.ownerId !== requesterId) {
    throw Forbidden('Solo el titular de la empresa puede configurar el cobro');
  }
  return c;
}

/**
 * Lo que se puede contar de la pasarela sin enseñar credenciales.
 *
 * Los secretos no vuelven a salir del API ni para su dueño: en el navegador
 * acabarian en memoria, en el historial de red y en cualquier extension
 * instalada. Se dice solo si estan puestos.
 */
export function aRespuestaDePasarela(c: {
  paymentProvider: PaymentProvider | null;
  paymentGatewayEnabled: boolean;
  paymentEnvironment: 'SANDBOX' | 'PRODUCTION';
  gatewayPublicKey: string | null;
  gatewayPrivateKey: string | null;
  gatewayIntegritySecret: string | null;
  gatewayEventsSecret: string | null;
}) {
  return {
    provider: c.paymentProvider,
    enabled: c.paymentGatewayEnabled,
    environment: c.paymentEnvironment,
    // Publica por diseño: el navegador la necesita para abrir el checkout.
    publicKey: c.gatewayPublicKey,
    privateKeyConfigured: !!c.gatewayPrivateKey,
    integritySecretConfigured: !!c.gatewayIntegritySecret,
    eventsSecretConfigured: !!c.gatewayEventsSecret,
  };
}

export const pasarelaDeEmpresaService = {
  async ver(id: string, requesterId: string, esAdmin: boolean) {
    return aRespuestaDePasarela(await miEmpresa(id, requesterId, esAdmin));
  },

  /**
   * Guardar la configuracion.
   *
   * Cadena vacia borra el secreto; omitirlo lo deja intacto. Sin esa
   * distincion no habria forma de quitar una llave ya guardada.
   */
  async guardar(id: string, requesterId: string, esAdmin: boolean, input: PasarelaInput) {
    const actual = await miEmpresa(id, requesterId, esAdmin);

    const proveedor = input.provider ?? actual.paymentProvider;
    const entorno = input.environment ?? actual.paymentEnvironment;
    const publica = input.publicKey !== undefined ? input.publicKey : actual.gatewayPublicKey;

    // Cruzar una credencial de pruebas con el entorno de produccion es un
    // error facil de cometer y dificil de diagnosticar: los pagos no entran y
    // nadie sabe por que. Cada pasarela lo marca a su manera —Wompi en el
    // cuerpo de la llave, Mercado Pago con el prefijo TEST-.
    const noCoincide =
      proveedor === 'MERCADO_PAGO'
        ? !credencialCoincideConEntorno(input.privateKey || null, entorno)
        : !llaveCoincideConEntorno(publica, entorno);
    if (noCoincide) {
      throw BadRequest(
        `Las credenciales no corresponden al entorno ${
          entorno === 'PRODUCTION' ? 'de producción' : 'de pruebas'
        }.`,
      );
    }

    const data: Record<string, unknown> = {};
    if (input.provider !== undefined) data.paymentProvider = input.provider;
    if (input.environment !== undefined) data.paymentEnvironment = input.environment;
    if (input.publicKey !== undefined) {
      data.gatewayPublicKey = input.publicKey === '' ? null : input.publicKey;
    }

    for (const [campoEntrada, columna] of Object.entries(CAMPOS_SECRETOS)) {
      const valor = input[campoEntrada as keyof typeof CAMPOS_SECRETOS];
      if (valor === undefined) continue;
      if (valor === '') {
        data[columna] = null;
        continue;
      }
      if (!hayLlaveDeCifrado()) {
        throw BadRequest(
          'Este servidor no tiene configurado el cifrado de credenciales. Avisa al administrador antes de guardar tus llaves.',
        );
      }
      data[columna] = cifrar(valor);
    }

    // Activar sin las credenciales dejaria el catalogo con un checkout roto,
    // y ademas las proximas reservas naceran sin comision de FILO creyendo que
    // el anfitrion cobra — cuando en realidad no puede cobrar nada.
    //
    // Lo que hace falta depende de la pasarela: Mercado Pago cobra creando una
    // preferencia desde el servidor y le basta su access token, mientras que
    // Wompi firma en el navegador y necesita llave publica y secreto de
    // integridad.
    if (input.enabled === true) {
      if (!proveedor) throw BadRequest('Elige con qué pasarela vas a cobrar');
      const queda = (campo: keyof typeof actual, nuevo: unknown) =>
        nuevo !== undefined ? nuevo : actual[campo];

      if (proveedor === 'MERCADO_PAGO') {
        if (!queda('gatewayPrivateKey', data.gatewayPrivateKey)) {
          throw BadRequest('Para activar el cobro hace falta tu access token de Mercado Pago.');
        }
      } else {
        const conPublica = queda('gatewayPublicKey', data.gatewayPublicKey);
        const conIntegridad = queda('gatewayIntegritySecret', data.gatewayIntegritySecret);
        if (!conPublica || !conIntegridad) {
          throw BadRequest(
            'Para activar el cobro hacen falta la llave pública y el secreto de integridad.',
          );
        }
      }
      data.paymentProvider = proveedor;
    }
    if (input.enabled !== undefined) data.paymentGatewayEnabled = input.enabled;

    // Apagarla con reservas suyas sin cobrar deja ese dinero sin forma de
    // entrar: esas reservas no llevan comision de FILO descontada y no se
    // pueden cobrar en la cuenta de FILO. Se avisa en vez de impedirlo —es su
    // pasarela— pero decirlo despues no serviria de nada.
    let reservasSinCobrar = 0;
    if (input.enabled === false && actual.paymentGatewayEnabled) {
      reservasSinCobrar = await prisma.reservation.count({
        where: {
          companyId: id,
          collectedBy: 'HOST',
          paymentStatus: { not: 'PAID' },
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
        },
      });
    }

    const guardada = await prisma.company.update({
      where: { id },
      data,
      select: {
        paymentProvider: true,
        paymentGatewayEnabled: true,
        paymentEnvironment: true,
        gatewayPublicKey: true,
        gatewayPrivateKey: true,
        gatewayIntegritySecret: true,
        gatewayEventsSecret: true,
      },
    });

    return { ...aRespuestaDePasarela(guardada), reservasSinCobrar };
  },
};
