// Conectar y desconectar la pasarela de cobro de un anfitrion.
//
// Vive aparte del servicio de empresas porque no es un campo mas del perfil:
// son credenciales de cobro, se guardan cifradas, no vuelven a salir nunca y
// cambiarlas cambia a donde va el dinero de las proximas ventas.
import type { PaymentProvider } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
import { cifrar, descifrar, hayLlaveDeCifrado } from '../../lib/cripto.js';
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

type FilaDePasarela = {
  paymentProvider: PaymentProvider | null;
  paymentEnvironment: 'SANDBOX' | 'PRODUCTION';
  gatewayPublicKey: string | null;
  gatewayPrivateKey: string | null;
  gatewayIntegritySecret: string | null;
  gatewayEventsSecret: string | null;
};

/**
 * Que le falta a esta configuracion para poder cobrar de verdad.
 *
 * Devuelve frases, no codigos: van derechas a la pantalla. Y no impide
 * guardar: activar con las llaves a medias es un estado legitimo —uno las va
 * pegando— y mientras tanto no pasa nada malo, porque `pasarelaDelAnfitrion`
 * no da por buena una configuracion incompleta y el cobro sigue entrando por
 * la plataforma. Lo unico que no se puede es callarselo.
 */
export function queLeFalta(c: FilaDePasarela): string[] {
  const faltan: string[] = [];
  const entorno = c.paymentEnvironment;
  const nombreDelEntorno = entorno === 'PRODUCTION' ? 'de producción' : 'de pruebas';

  if (!c.paymentProvider) {
    faltan.push('Elige con qué pasarela vas a cobrar.');
    return faltan;
  }

  if (c.paymentProvider === 'MERCADO_PAGO') {
    const token = descifrar(c.gatewayPrivateKey);
    if (!token) faltan.push('Falta tu access token de Mercado Pago.');
    else if (!credencialCoincideConEntorno(token, entorno)) {
      faltan.push(`Tu access token no es ${nombreDelEntorno}.`);
    }
    return faltan;
  }

  if (!c.gatewayPublicKey) faltan.push('Falta la llave pública de Wompi.');
  else if (!llaveCoincideConEntorno(c.gatewayPublicKey, entorno)) {
    faltan.push(`Tu llave pública no es ${nombreDelEntorno}.`);
  }
  if (!descifrar(c.gatewayIntegritySecret)) faltan.push('Falta el secreto de integridad.');
  return faltan;
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
  const faltan = queLeFalta(c);
  return {
    provider: c.paymentProvider,
    enabled: c.paymentGatewayEnabled,
    environment: c.paymentEnvironment,
    // Publica por diseño: el navegador la necesita para abrir el checkout.
    publicKey: c.gatewayPublicKey,
    privateKeyConfigured: !!c.gatewayPrivateKey,
    integritySecretConfigured: !!c.gatewayIntegritySecret,
    eventsSecretConfigured: !!c.gatewayEventsSecret,
    /** Que le falta, en frases listas para enseñar. */
    faltan,
    /**
     * Si con esto se cobra de verdad. Activa pero incompleta no cobra: la
     * pantalla tiene que poder decir "aun no" en vez de "ya cobras tu".
     */
    listaParaCobrar: c.paymentGatewayEnabled && faltan.length === 0,
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

    // Activar con las llaves a medias NO se impide: uno las va pegando, y
    // frenarlo obliga a tenerlas todas antes de poder siquiera decir que
    // quiere cobrar por su cuenta. Tampoco es peligroso: una configuracion
    // incompleta no la da por buena `pasarelaDelAnfitrion`, asi que el cobro
    // sigue entrando por la plataforma, con su comision, hasta que este lista.
    // Lo que si se hace es decirle que le falta —ver `queLeFalta`.
    if (input.enabled === true && proveedor) data.paymentProvider = proveedor;
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
