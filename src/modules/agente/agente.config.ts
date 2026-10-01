// Configurar el agente: lo que ve y cambia el anfitrion.
//
// Los secretos de WhatsApp no vuelven a salir nunca, igual que las llaves de
// las pasarelas: se dice si estan puestos y nada mas.
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
import { cifrar, hayLlaveDeCifrado } from '../../lib/cripto.js';

export interface ConfigDelAgente {
  enabled?: boolean;
  nombre?: string;
  tono?: string;
  instrucciones?: string;
  puedeCrearSolicitud?: boolean;
  puedeEnviarEnlace?: boolean;
  waPhoneNumberId?: string;
  waNumero?: string;
  waAccessToken?: string;
  waVerifyToken?: string;
  waAppSecret?: string;
}

const SECRETOS = ['waAccessToken', 'waVerifyToken', 'waAppSecret'] as const;

type Fila = {
  id: string;
  enabled: boolean;
  nombre: string;
  tono: string | null;
  instrucciones: string | null;
  puedeCrearSolicitud: boolean;
  puedeEnviarEnlace: boolean;
  waPhoneNumberId: string | null;
  waNumero: string | null;
  waAccessToken: string | null;
  waVerifyToken: string | null;
  waAppSecret: string | null;
  mensajesPorMes: number;
  mensajesUsados: number;
  mesDelConteo: string | null;
};

const SELECT = {
  id: true, enabled: true, nombre: true, tono: true, instrucciones: true,
  puedeCrearSolicitud: true, puedeEnviarEnlace: true,
  waPhoneNumberId: true, waNumero: true, waAccessToken: true, waVerifyToken: true,
  waAppSecret: true, mensajesPorMes: true, mensajesUsados: true, mesDelConteo: true,
} as const;

/** Que le falta para poder atender WhatsApp. Frases, no codigos. */
function queLeFalta(a: Fila): string[] {
  const faltan: string[] = [];
  if (!a.waPhoneNumberId) faltan.push('Falta el Phone Number ID de tu número.');
  if (!a.waAccessToken) faltan.push('Falta el token de acceso.');
  if (!a.waVerifyToken) faltan.push('Falta el token de verificación del webhook.');
  return faltan;
}

function aRespuesta(a: Fila, companyId: string) {
  const mes = new Date().toISOString().slice(0, 7);
  const usados = a.mesDelConteo === mes ? a.mensajesUsados : 0;
  const faltan = queLeFalta(a);
  return {
    enabled: a.enabled,
    nombre: a.nombre,
    tono: a.tono,
    instrucciones: a.instrucciones,
    puedeCrearSolicitud: a.puedeCrearSolicitud,
    puedeEnviarEnlace: a.puedeEnviarEnlace,
    waPhoneNumberId: a.waPhoneNumberId,
    waNumero: a.waNumero,
    accessTokenConfigurado: !!a.waAccessToken,
    verifyTokenConfigurado: !!a.waVerifyToken,
    appSecretConfigurado: !!a.waAppSecret,
    mensajesPorMes: a.mensajesPorMes,
    mensajesUsados: usados,
    faltan,
    /** Encendido y con credenciales: solo entonces contesta WhatsApp. */
    atendiendoWhatsApp: a.enabled && faltan.length === 0,
    /** La URL que hay que pegar en Meta. Se arma aquí para no equivocarse. */
    urlDelWebhook: `${env.API_PUBLIC_URL ?? env.APP_URL}/agente/whatsapp/webhook/${companyId}`,
  };
}

async function suyo(companyId: string | null | undefined) {
  if (!companyId) throw Forbidden('No tienes una company asociada');
  const existente = await prisma.aiAgent.findUnique({ where: { companyId }, select: SELECT });
  if (existente) return existente;
  // Se crea al primer vistazo: asi la pantalla siempre tiene algo que enseñar
  // y no hay un "crear agente" que no significa nada.
  return prisma.aiAgent.create({ data: { companyId }, select: SELECT });
}

export const agenteConfigService = {
  async ver(companyId: string | null | undefined) {
    return aRespuesta(await suyo(companyId), companyId!);
  },

  async guardar(companyId: string | null | undefined, input: ConfigDelAgente) {
    await suyo(companyId);

    const data: Record<string, unknown> = {};
    for (const campo of ['nombre', 'tono', 'instrucciones', 'waPhoneNumberId', 'waNumero'] as const) {
      if (input[campo] !== undefined) data[campo] = input[campo] === '' ? null : input[campo];
    }
    for (const campo of ['enabled', 'puedeCrearSolicitud', 'puedeEnviarEnlace'] as const) {
      if (input[campo] !== undefined) data[campo] = input[campo];
    }
    for (const campo of SECRETOS) {
      const valor = input[campo];
      if (valor === undefined) continue;
      if (valor === '') {
        data[campo] = null;
        continue;
      }
      if (!hayLlaveDeCifrado()) {
        throw BadRequest(
          'Este servidor no tiene configurado el cifrado de credenciales. Avísale al administrador antes de guardar tus tokens.',
        );
      }
      data[campo] = cifrar(valor);
    }

    // Encender sin credenciales se permite: sirve para probarlo desde aquí
    // antes de conectar WhatsApp. Lo que no atiende es WhatsApp, y eso se dice.
    const guardado = await prisma.aiAgent.update({
      where: { companyId: companyId! },
      data,
      select: SELECT,
    });
    return aRespuesta(guardado, companyId!);
  },

  async conversaciones(companyId: string | null | undefined) {
    if (!companyId) throw Forbidden('No tienes una company asociada');
    return prisma.aiConversation.findMany({
      where: { companyId },
      orderBy: { ultimoMensajeAt: 'desc' },
      take: 50,
      select: {
        id: true, canal: true, telefono: true, nombrePerfil: true, pausada: true,
        ultimoMensajeAt: true,
        opportunity: { select: { id: true, name: true, stage: true } },
        _count: { select: { mensajes: true } },
      },
    });
  },

  async conversacion(id: string, companyId: string | null | undefined) {
    if (!companyId) throw Forbidden('No tienes una company asociada');
    const c = await prisma.aiConversation.findFirst({
      where: { id, companyId },
      select: {
        id: true, canal: true, telefono: true, nombrePerfil: true, pausada: true,
        opportunity: { select: { id: true, name: true } },
        mensajes: {
          orderBy: { createdAt: 'asc' },
          take: 200,
          select: { id: true, rol: true, texto: true, herramienta: true, createdAt: true },
        },
      },
    });
    if (!c) throw NotFound('Conversación no encontrada');
    return c;
  },

  /**
   * Tomar el hilo, o devolverselo al agente.
   *
   * Pausar no apaga el agente: solo deja de contestar en esa conversacion. Es
   * lo que hace falta cuando alguien pide hablar con una persona.
   */
  async pausar(id: string, companyId: string | null | undefined, pausada: boolean) {
    if (!companyId) throw Forbidden('No tienes una company asociada');
    const suya = await prisma.aiConversation.findFirst({
      where: { id, companyId },
      select: { id: true },
    });
    if (!suya) throw NotFound('Conversación no encontrada');
    return prisma.aiConversation.update({
      where: { id },
      data: { pausada },
      select: { id: true, pausada: true },
    });
  },
};
