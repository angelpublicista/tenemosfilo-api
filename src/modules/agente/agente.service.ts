// El agente: recibe un mensaje y decide que contestar.
//
// Lo que lo hace util es que no inventa. Todo lo que dice sobre precios,
// horarios o sedes sale de las herramientas, que leen la base del anfitrion; y
// lo que no puede hacer —confirmar, cobrar, cancelar— no esta en la lista, asi
// que no es cuestion de pedirselo amablemente en el prompt.
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { logger } from '../../lib/logger.js';
import {
  HERRAMIENTAS,
  ejecutarHerramienta,
  type ContextoDelAgente,
} from './agente.herramientas.js';

/** Cuantos turnos del hilo se le pasan al modelo. */
const MEMORIA = 16;
/** Cuantas vueltas de herramienta se le permiten antes de contestar. */
const MAX_VUELTAS = 4;
const MODELO = 'gpt-4o-mini';

type MensajeOpenAI = {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>;
  tool_call_id?: string;
};

/**
 * Las reglas que no dependen del anfitrion.
 *
 * Van en el sistema y ademas estan respaldadas por lo que el agente puede
 * hacer: un prompt es una peticion, no una garantia, y lo que de verdad impide
 * que confirme una reserva es que no existe ninguna herramienta para hacerlo.
 */
function instruccionesBase(datos: {
  nombreDelAgente: string;
  empresa: string;
  tono: string | null;
  instrucciones: string | null;
  puedeCrearSolicitud: boolean;
  puedeEnviarEnlace: boolean;
}): string {
  return [
    `Eres ${datos.nombreDelAgente}, quien atiende el WhatsApp de ${datos.empresa}.`,
    datos.tono ? `Tono: ${datos.tono}.` : 'Tono: cercano, claro y breve.',
    'Escribes por WhatsApp: frases cortas, sin markdown, sin listas numeradas largas. Normalmente dos o tres líneas.',
    '',
    'Reglas que no puedes saltarte:',
    '- Nunca inventes precios, horarios, sedes ni disponibilidad. Si no lo sacaste de una herramienta, no lo digas: pregunta o di que lo confirmas con el equipo.',
    '- No confirmas reservas ni cobras. Si te lo piden, explica que le pasas el enlace para que reserve o que un asesor lo contacta.',
    '- No prometes descuentos ni condiciones especiales.',
    '- Si te preguntan algo que no sabes, dilo y ofrece que un asesor lo contacte.',
    '- Si la persona pide hablar con alguien del equipo, dile que ya avisas y deja de insistir.',
    datos.puedeCrearSolicitud
      ? '- En cuanto sepas su nombre y si quiere algo abierto o privado, guarda la solicitud. No esperes a tenerlo todo.'
      : '- No puedes guardar solicitudes; cuando haya interés real, dile que un asesor lo contactará.',
    datos.puedeEnviarEnlace
      ? '- Si quiere reservar y ya guardaste la solicitud, pásale el enlace de reserva.'
      : '',
    '',
    datos.instrucciones ? `Indicaciones del anfitrión:\n${datos.instrucciones}` : '',
  ]
    .filter(Boolean)
    .join('\n');
}

/**
 * El tope de consumo, con el contador que se reinicia solo cada mes.
 *
 * El modelo lo paga FILO, asi que el limite no es un adorno: sin el, un bucle
 * de mensajes —dos agentes hablandose, por ejemplo— se lleva la factura por
 * delante sin que nadie se entere hasta que llega.
 */
async function consumirCupo(agentId: string): Promise<{ hayCupo: boolean; usados: number; tope: number }> {
  const mes = new Date().toISOString().slice(0, 7);
  const agente = await prisma.aiAgent.findUnique({
    where: { id: agentId },
    select: { mensajesPorMes: true, mensajesUsados: true, mesDelConteo: true },
  });
  if (!agente) return { hayCupo: false, usados: 0, tope: 0 };

  const usados = agente.mesDelConteo === mes ? agente.mensajesUsados : 0;
  if (usados >= agente.mensajesPorMes) {
    return { hayCupo: false, usados, tope: agente.mensajesPorMes };
  }
  await prisma.aiAgent.update({
    where: { id: agentId },
    data: { mensajesUsados: usados + 1, mesDelConteo: mes },
  });
  return { hayCupo: true, usados: usados + 1, tope: agente.mensajesPorMes };
}

async function llamarAlModelo(mensajes: MensajeOpenAI[]): Promise<{
  texto: string | null;
  llamadas: Array<{ id: string; nombre: string; argumentos: Record<string, unknown> }>;
}> {
  const base = env.OPENAI_API_URL ?? 'https://api.openai.com/v1';
  const r = await fetch(`${base}/chat/completions`, {
    method: 'POST',
    headers: {
      authorization: `Bearer ${env.OPENAI_API_KEY}`,
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: MODELO,
      messages: mensajes,
      tools: HERRAMIENTAS,
      temperature: 0.4,
      max_tokens: 400,
    }),
    signal: AbortSignal.timeout(20000),
  });
  if (!r.ok) throw new Error(`OpenAI respondio ${r.status}`);

  const datos = (await r.json()) as {
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ id: string; function: { name: string; arguments: string } }>;
      };
    }>;
  };
  const m = datos.choices?.[0]?.message;
  return {
    texto: m?.content ?? null,
    llamadas: (m?.tool_calls ?? []).map((t) => {
      let argumentos: Record<string, unknown> = {};
      try {
        argumentos = JSON.parse(t.function.arguments || '{}');
      } catch {
        // Un argumento mal formado no puede tumbar la conversacion: se le
        // pasa vacio y la herramienta dira que le falta algo.
      }
      return { id: t.id, nombre: t.function.name, argumentos };
    }),
  };
}

/** El canal de la prueba del panel: conversa de verdad, pero no escribe en el CRM. */
export const CANAL_DE_PRUEBA = 'PRUEBA';

export const agenteService = {
  /**
   * Responder a un mensaje. Devuelve lo que hay que enviarle a la persona, o
   * null si no hay que contestar (agente apagado, hilo pausado, sin cupo).
   */
  async responder(params: {
    companyId: string;
    telefono: string;
    nombrePerfil?: string | null;
    texto: string;
    canal?: string;
  }): Promise<{ respuesta: string | null; motivo?: string }> {
    const canal = params.canal ?? 'WHATSAPP';

    const agente = await prisma.aiAgent.findUnique({
      where: { companyId: params.companyId },
      select: {
        id: true, enabled: true, nombre: true, tono: true, instrucciones: true,
        puedeCrearSolicitud: true, puedeEnviarEnlace: true,
        company: { select: { companyName: true, ownerId: true } },
      },
    });
    if (!agente?.enabled) return { respuesta: null, motivo: 'El agente está apagado.' };
    if (!env.OPENAI_API_KEY) {
      logger.error({ companyId: params.companyId }, 'agente sin OPENAI_API_KEY');
      return { respuesta: null, motivo: 'Falta configurar la clave del modelo en el servidor.' };
    }

    const conversacion = await prisma.aiConversation.upsert({
      where: {
        companyId_canal_telefono: { companyId: params.companyId, canal, telefono: params.telefono },
      },
      create: {
        companyId: params.companyId,
        canal,
        telefono: params.telefono,
        nombrePerfil: params.nombrePerfil ?? null,
      },
      update: {
        ultimoMensajeAt: new Date(),
        ...(params.nombrePerfil ? { nombrePerfil: params.nombrePerfil } : {}),
      },
      select: { id: true, pausada: true },
    });

    // Lo que escribe la persona se guarda siempre, aunque no se le conteste:
    // si el anfitrion tomo el hilo, necesita leer lo que le siguen diciendo.
    await prisma.aiMessage.create({
      data: { conversationId: conversacion.id, rol: 'CLIENTE', texto: params.texto },
    });

    if (conversacion.pausada) {
      return { respuesta: null, motivo: 'Esta conversación la tomó el anfitrión.' };
    }

    const cupo = await consumirCupo(agente.id);
    if (!cupo.hayCupo) {
      logger.warn({ companyId: params.companyId, tope: cupo.tope }, 'agente sin cupo este mes');
      return { respuesta: null, motivo: `Se alcanzó el tope de ${cupo.tope} respuestas del mes.` };
    }

    const historial = await prisma.aiMessage.findMany({
      where: { conversationId: conversacion.id },
      orderBy: { createdAt: 'desc' },
      take: MEMORIA,
      select: { rol: true, texto: true },
    });

    const mensajes: MensajeOpenAI[] = [
      {
        role: 'system',
        content: instruccionesBase({
          nombreDelAgente: agente.nombre,
          empresa: agente.company.companyName,
          tono: agente.tono,
          instrucciones: agente.instrucciones,
          puedeCrearSolicitud: agente.puedeCrearSolicitud,
          puedeEnviarEnlace: agente.puedeEnviarEnlace,
        }),
      },
      ...historial
        .reverse()
        .map((m) => ({
          role: (m.rol === 'AGENTE' ? 'assistant' : 'user') as 'assistant' | 'user',
          content: m.texto,
        })),
    ];

    // Entre turnos la prueba no deja oportunidad de la que tirar, asi que el
    // "ya guarde la solicitud" se lee de las herramientas que uso antes.
    const esPrueba = canal === CANAL_DE_PRUEBA;
    const solicitudDePrueba = esPrueba
      ? (await prisma.aiMessage.count({
          where: {
            conversationId: conversacion.id,
            rol: 'AGENTE',
            herramienta: { contains: 'guardar_solicitud' },
          },
        })) > 0
      : false;

    const ctx: ContextoDelAgente = {
      companyId: params.companyId,
      conversationId: conversacion.id,
      telefono: params.telefono,
      nombrePerfil: params.nombrePerfil ?? null,
      puedeCrearSolicitud: agente.puedeCrearSolicitud,
      puedeEnviarEnlace: agente.puedeEnviarEnlace,
      usuarioId: agente.company.ownerId,
      esPrueba,
      solicitudDePrueba,
    };

    const herramientasUsadas: string[] = [];
    try {
      for (let vuelta = 0; vuelta < MAX_VUELTAS; vuelta += 1) {
        const { texto, llamadas } = await llamarAlModelo(mensajes);

        if (llamadas.length === 0) {
          const respuesta = (texto ?? '').trim();
          if (!respuesta) break;
          await prisma.aiMessage.create({
            data: {
              conversationId: conversacion.id,
              rol: 'AGENTE',
              texto: respuesta,
              herramienta: herramientasUsadas.join(', ') || null,
            },
          });
          return { respuesta };
        }

        mensajes.push({
          role: 'assistant',
          content: texto ?? null,
          tool_calls: llamadas.map((l) => ({
            id: l.id,
            type: 'function' as const,
            function: { name: l.nombre, arguments: JSON.stringify(l.argumentos) },
          })),
        });

        for (const llamada of llamadas) {
          herramientasUsadas.push(llamada.nombre);
          const resultado = await ejecutarHerramienta(llamada.nombre, llamada.argumentos, ctx).catch(
            (err) => {
              // Una herramienta que falla no puede dejar al cliente sin
              // respuesta: se le dice al modelo y que siga.
              logger.error({ err, herramienta: llamada.nombre }, 'herramienta del agente fallo');
              return { ok: false as const, texto: 'No se pudo consultar eso ahora mismo.' };
            },
          );
          mensajes.push({
            role: 'tool',
            tool_call_id: llamada.id,
            content: resultado.texto,
          });
        }
      }
    } catch (err) {
      logger.error({ err, companyId: params.companyId }, 'el agente no pudo responder');
      return { respuesta: null, motivo: 'El modelo no respondió.' };
    }

    return { respuesta: null, motivo: 'El agente no produjo una respuesta.' };
  },
};
