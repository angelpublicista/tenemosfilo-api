// Lo que el agente puede mirar y hacer.
//
// Es una lista corta a proposito. Un agente que puede hacer cualquier cosa es
// un agente del que no se puede responder, y aqui habla con clientes reales en
// nombre de un restaurante. Lo que NO esta aqui no lo puede hacer: no confirma
// reservas, no cobra, no cancela y no toca precios.
//
// Todas las lecturas van acotadas a la empresa del agente. No es una
// precaucion teorica: el modelo decide los argumentos, y basta con que invente
// un id para pedir datos de otro anfitrion.
import { prisma } from '../../config/prisma.js';
import { enlaceService } from '../opportunities/opportunities.enlace.js';
import { opportunitiesService } from '../opportunities/opportunities.service.js';

export interface ContextoDelAgente {
  companyId: string;
  conversationId: string;
  telefono: string;
  nombrePerfil: string | null;
  puedeCrearSolicitud: boolean;
  puedeEnviarEnlace: boolean;
  /** El usuario al que se le atribuyen las solicitudes que abra el agente. */
  usuarioId: string;
}

/** Lo que se le devuelve al modelo: texto plano, nada de objetos crudos. */
type Resultado = { ok: true; texto: string } | { ok: false; texto: string };

const pesos = (n: number) =>
  new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 }).format(n);

export const HERRAMIENTAS = [
  {
    type: 'function' as const,
    function: {
      name: 'listar_experiencias',
      description:
        'Las experiencias que ofrece este anfitrión, con su precio por persona, duración, ciudad y cuántas personas admite. Úsala siempre antes de hablar de precios o de qué se ofrece: nunca los inventes.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'ver_experiencia',
      description:
        'El detalle de una experiencia: descripción completa, qué incluye, sedes donde se hace y sus horarios habituales.',
      parameters: {
        type: 'object',
        properties: {
          experienceId: { type: 'string', description: 'El id que devolvió listar_experiencias.' },
        },
        required: ['experienceId'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'guardar_solicitud',
      description:
        'Guarda a esta persona como solicitud en el CRM del anfitrión para que la contacten. Úsala en cuanto sepas su nombre y si lo que quiere es una experiencia abierta (compra cupos de algo que ya existe) o privada (un evento solo para su grupo).',
      parameters: {
        type: 'object',
        properties: {
          nombre: { type: 'string', description: 'Nombre de la persona, como lo dijo.' },
          tipo: {
            type: 'string',
            enum: ['ABIERTA', 'PRIVADA'],
            description: 'ABIERTA si compra cupos de una experiencia existente; PRIVADA si quiere un evento para su grupo.',
          },
          comprador: {
            type: 'string',
            enum: ['SOCIAL', 'CORPORATIVO'],
            description: 'Solo para PRIVADA: si es un plan personal o de una empresa.',
          },
          notas: { type: 'string', description: 'Lo que pidió, en una o dos frases.' },
        },
        required: ['nombre', 'tipo'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'enviar_enlace_de_reserva',
      description:
        'Devuelve el enlace para que la persona reserve ella misma, ya con sus datos puestos. Requiere haber guardado antes la solicitud. Tú no reservas ni cobras: solo le pasas el enlace.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
];

export async function ejecutarHerramienta(
  nombre: string,
  argumentos: Record<string, unknown>,
  ctx: ContextoDelAgente,
): Promise<Resultado> {
  switch (nombre) {
    case 'listar_experiencias':
      return listarExperiencias(ctx);
    case 'ver_experiencia':
      return verExperiencia(String(argumentos.experienceId ?? ''), ctx);
    case 'guardar_solicitud':
      return guardarSolicitud(argumentos, ctx);
    case 'enviar_enlace_de_reserva':
      return enviarEnlace(ctx);
    default:
      return { ok: false, texto: 'Esa herramienta no existe.' };
  }
}

async function listarExperiencias(ctx: ContextoDelAgente): Promise<Resultado> {
  const items = await prisma.experience.findMany({
    where: { companyId: ctx.companyId, deletedAt: null, status: 'ACTIVE' },
    select: {
      id: true, title: true, basePrice: true, duration: true, capacity: true,
      presentialCity: true, atHome: true,
    },
    take: 25,
  });
  if (items.length === 0) {
    return { ok: true, texto: 'Este anfitrión no tiene experiencias publicadas ahora mismo.' };
  }
  const lineas = items.map(
    (e) =>
      `- ${e.title} (id: ${e.id}) · ${e.basePrice ? pesos(Number(e.basePrice)) + ' por persona' : 'precio a consultar'}` +
      `${e.duration ? ` · ${e.duration} min` : ''}` +
      `${e.capacity ? ` · hasta ${e.capacity} personas` : ''}` +
      `${e.presentialCity ? ` · ${e.presentialCity}` : ''}` +
      // Que va a casa del cliente es de lo primero que pregunta quien escribe.
      `${e.atHome ? ' · a domicilio' : ''}`,
  );
  return { ok: true, texto: lineas.join('\n') };
}

async function verExperiencia(id: string, ctx: ContextoDelAgente): Promise<Resultado> {
  const e = await prisma.experience.findFirst({
    // El filtro por empresa es lo que impide que un id inventado saque datos
    // de otro anfitrion.
    where: { id, companyId: ctx.companyId, deletedAt: null, status: 'ACTIVE' },
    select: {
      title: true, description: true, includes: true, basePrice: true, duration: true,
      capacity: true, presentialCity: true, atHome: true,
      locations: {
        where: { deletedAt: null },
        select: { id: true, name: true, address: true, isMain: true },
      },
      // Las condiciones propias de cada sede. Sin esto el agente contesta el
      // precio de la experiencia en una sede donde el precio es otro, y lo que
      // le dice al cliente no es lo que se le va a cobrar.
      locationListings: {
        where: { deletedAt: null, isPublished: true },
        select: {
          locationId: true,
          kind: true,
          capacity: true,
          basePrice: true,
          minimumNotice: true,
        },
      },
      availabilities: {
        where: { deletedAt: null, isActive: true },
        select: { name: true, weeklySchedule: true },
        take: 1,
      },
    },
  });
  if (!e) return { ok: false, texto: 'No encontré esa experiencia.' };

  const partes = [
    `${e.title}`,
    e.description ?? '',
    // `includes` es Json en el modelo: puede venir como lista o como otra cosa.
    Array.isArray(e.includes) && e.includes.length
      ? `Incluye: ${e.includes.map(String).join(', ')}`
      : '',
    e.basePrice ? `Precio: ${pesos(Number(e.basePrice))} por persona` : '',
    e.duration ? `Duración: ${e.duration} minutos` : '',
    e.capacity ? `Hasta ${e.capacity} personas` : '',
    // A domicilio no hay sede que nombrar: se va donde diga el cliente.
    e.atHome
      ? `Se hace a domicilio${e.presentialCity ? `, en ${e.presentialCity} y alrededores` : ''}`
      : '',
    !e.atHome && e.locations.length
      ? `Sedes: ${e.locations
          .map((l) => {
            const d = l.address as { street?: string; city?: string } | null;
            const donde = `${l.name}${d?.street ? ` (${d.street}${d.city ? ', ' + d.city : ''})` : ''}`;
            // Lo que cambia en esta sede, y solo eso: repetir el precio de la
            // experiencia en cada una alargaria la respuesta sin decir nada.
            const f = e.locationListings.find((x) => x.locationId === l.id);
            const propio = [
              f?.kind === 'PRIVADA' ? 'solo por encargo, para grupo completo' : '',
              f?.kind === 'ABIERTA' ? 'con cupos sueltos' : '',
              f?.basePrice ? `${pesos(Number(f.basePrice))} por persona` : '',
              f?.capacity ? `hasta ${f.capacity} personas` : '',
              f?.minimumNotice ? `con ${f.minimumNotice} h de anticipación` : '',
            ].filter(Boolean);
            return propio.length ? `${donde} — ${propio.join(', ')}` : donde;
          })
          .join(' · ')}`
      : '',
    e.availabilities[0]?.weeklySchedule
      ? `Horario habitual: ${JSON.stringify(e.availabilities[0].weeklySchedule)}`
      : '',
  ].filter(Boolean);

  return { ok: true, texto: partes.join('\n') };
}

async function guardarSolicitud(
  argumentos: Record<string, unknown>,
  ctx: ContextoDelAgente,
): Promise<Resultado> {
  if (!ctx.puedeCrearSolicitud) {
    return { ok: false, texto: 'No tienes permitido guardar solicitudes. Dile que un asesor lo contactará.' };
  }

  const conversacion = await prisma.aiConversation.findUnique({
    where: { id: ctx.conversationId },
    select: { opportunityId: true },
  });
  if (conversacion?.opportunityId) {
    return { ok: true, texto: 'Ya habías guardado su solicitud; no hace falta otra.' };
  }

  const nombre = String(argumentos.nombre ?? '').trim();
  if (!nombre) return { ok: false, texto: 'Falta el nombre de la persona.' };
  const tipo = argumentos.tipo === 'ABIERTA' ? 'ABIERTA' : 'PRIVADA';

  const [firstName, ...resto] = nombre.split(/\s+/);
  const creada = await opportunitiesService.crearSolicitud(ctx.usuarioId, ctx.companyId, {
    experienceKind: tipo,
    // En una privada hay que decir si es social o corporativo; si el agente no
    // lo supo, se asume social, que es lo mas comun en un WhatsApp entrante.
    ...(tipo === 'PRIVADA'
      ? { buyerKind: argumentos.comprador === 'CORPORATIVO' ? 'CORPORATIVO' : 'SOCIAL' }
      : {}),
    contacto: {
      firstName: firstName ?? nombre,
      ...(resto.length ? { lastName: resto.join(' ') } : {}),
      phone: ctx.telefono,
    },
    leadSource: 'WHATSAPP',
    notas: argumentos.notas ? String(argumentos.notas).slice(0, 2000) : undefined,
  } as never);

  await prisma.aiConversation.update({
    where: { id: ctx.conversationId },
    data: { opportunityId: creada.id, contactId: creada.contactId },
  });

  return { ok: true, texto: 'Solicitud guardada. Un asesor del anfitrión la va a ver.' };
}

async function enviarEnlace(ctx: ContextoDelAgente): Promise<Resultado> {
  if (!ctx.puedeEnviarEnlace) {
    return { ok: false, texto: 'No tienes permitido enviar el enlace de reserva.' };
  }
  const conversacion = await prisma.aiConversation.findUnique({
    where: { id: ctx.conversationId },
    select: { opportunityId: true },
  });
  if (!conversacion?.opportunityId) {
    return { ok: false, texto: 'Primero guarda la solicitud con guardar_solicitud.' };
  }
  const { url } = await enlaceService.generarEnlaceDeReserva(
    conversacion.opportunityId,
    ctx.companyId,
  );
  return { ok: true, texto: `Este es el enlace, pásaselo tal cual: ${url}` };
}
