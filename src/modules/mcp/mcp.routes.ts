// El servidor MCP de FILO.
//
// Un asistente (Claude, ChatGPT, Cursor) se conecta aqui en nombre de un
// anfitrion y recibe una lista de herramientas: ver sus reservas, crear una
// solicitud en su CRM, mover una fecha.
//
// Como funciona por dentro, que es lo que hay que entender antes de tocarlo:
//
//   1. El asistente trae un token de OAuth que SOLO vale aqui. Dice quien lo
//      autorizo, sobre que empresa y con que permisos.
//   2. Cada herramienta es un endpoint del API. Para ejecutarla, este modulo
//      se llama a si mismo por HTTP presentandose como ese anfitrion, con un
//      JWT de un minuto que firma el mismo.
//
// El rodeo del punto 2 es deliberado. Llamar a los servicios directamente
// habria obligado a repetir aqui lo que hace cada ruta —validar, comprobar
// rol, comprobar de quien es cada cosa— y a mantenerlo igual en dos sitios.
// Asi el asistente pasa exactamente por las mismas puertas que el panel.
//
// Sin sesiones: cada peticion se atiende sola. El API corre en una instancia
// pequeña y no hay nada que recordar entre una llamada y la siguiente.
import { Router } from 'express';
import type { NextFunction, Request, Response } from 'express';
import { SignJWT } from 'jose';
import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';
import { zodToJsonSchema } from 'zod-to-json-schema';
import { env } from '../../config/env.js';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../lib/logger.js';
import { PREFIJO_ACCESO, hashDeToken, urlDelApi } from '../../lib/oauth.js';
import { HERRAMIENTAS, parametrosDeRuta, type Herramienta } from './mcp.herramientas.js';

/** Quien esta detras de una peticion al MCP. */
type Conexion = {
  grantId: string;
  permisos: Set<string>;
  usuario: { id: string; email: string; role: 'HOST' | 'ADMIN' };
  companyId: string;
};

declare module 'express-serve-static-core' {
  interface Request {
    conexionMcp?: Conexion;
  }
}

const secreto = new TextEncoder().encode(env.NEXTAUTH_SECRET);

/** Una respuesta mas larga que esto no le sirve a un modelo: se corta y se dice. */
const MAXIMO_DE_RESPUESTA = 60_000;

// ─── Autenticacion ──────────────────────────────────────────────────────────

/**
 * Exige un token de acceso de OAuth vigente.
 *
 * El 401 lleva la cabecera que le dice al asistente donde esta descrito como
 * conseguir uno: es lo que hace que «Conectar» funcione sin configurar nada.
 *
 * En cada peticion se vuelve a mirar que quien aprobo la conexion siga siendo
 * anfitrion de esa empresa. Un token dura una hora, y a alguien a quien se le
 * quito el acceso no se le puede dejar esa hora.
 */
async function requireConexion(req: Request, res: Response, next: NextFunction) {
  const rechazar = (descripcion: string) =>
    res
      .status(401)
      .set(
        'WWW-Authenticate',
        `Bearer resource_metadata="${urlDelApi(req)}/.well-known/oauth-protected-resource", error="invalid_token", error_description="${descripcion}"`,
      )
      .json({ error: 'invalid_token', error_description: descripcion });

  const cabecera = req.headers.authorization;
  const token = cabecera?.startsWith('Bearer ') ? cabecera.slice('Bearer '.length).trim() : '';
  if (!token.startsWith(PREFIJO_ACCESO)) return rechazar('Falta el token de acceso.');

  const guardado = await prisma.oAuthToken.findUnique({
    where: { tokenHash: hashDeToken(token) },
    include: {
      grant: {
        include: { user: { select: { id: true, email: true, role: true, companyId: true } } },
      },
    },
  });
  if (
    !guardado ||
    guardado.kind !== 'ACCESS' ||
    guardado.expiresAt.getTime() < Date.now() ||
    guardado.grant.revokedAt
  ) {
    return rechazar('El token caduco o la conexion se corto.');
  }

  const { grant } = guardado;
  const { user } = grant;
  if (user.role !== 'HOST' && user.role !== 'ADMIN') {
    return rechazar('Quien autorizo esta conexion ya no es anfitrion.');
  }
  if (user.role === 'HOST') {
    const sigueSiendoSuya = await prisma.company.findFirst({
      where: {
        id: grant.companyId,
        deletedAt: null,
        OR: [{ ownerId: user.id }, { users: { some: { id: user.id } } }],
      },
      select: { id: true },
    });
    if (!sigueSiendoSuya) return rechazar('Quien autorizo esta conexion ya no tiene acceso a la empresa.');
  }

  req.conexionMcp = {
    grantId: grant.id,
    permisos: new Set(grant.scopes),
    usuario: { id: user.id, email: user.email, role: user.role },
    companyId: grant.companyId,
  };

  // Sin esperar, como `lastUsedAt` en las API keys.
  prisma.oAuthGrant
    .update({ where: { id: grant.id }, data: { lastUsedAt: new Date() } })
    .catch(() => undefined);

  next();
}

// ─── Las herramientas, vistas desde fuera ───────────────────────────────────

type EsquemaJson = {
  type?: string;
  properties?: Record<string, unknown>;
  required?: string[];
  [k: string]: unknown;
};

const aJson = (esquema: Herramienta['consulta']): EsquemaJson =>
  zodToJsonSchema(esquema!, { $refStrategy: 'none', target: 'jsonSchema7' }) as EsquemaJson;

/**
 * El esquema de entrada de una herramienta.
 *
 * Los `:algo` de la ruta y los filtros de la consulta van como argumentos
 * sueltos; el cuerpo, en `datos`. Asi una consulta se escribe plana —que es
 * como un modelo las escribe bien— y en una escritura queda claro que es lo
 * que se va a guardar.
 */
function esquemaDeEntrada(h: Herramienta): EsquemaJson {
  const propiedades: Record<string, unknown> = {};
  const obligatorias: string[] = [];

  for (const p of parametrosDeRuta(h.ruta)) {
    propiedades[p] = { type: 'string', description: 'El id, tal como lo devolvió otra herramienta.' };
    obligatorias.push(p);
  }
  if (h.consulta) {
    const c = aJson(h.consulta);
    Object.assign(propiedades, c.properties ?? {});
    obligatorias.push(...(c.required ?? []));
  }
  if (h.cuerpo) {
    const { $schema: _omitido, ...cuerpo } = aJson(h.cuerpo);
    propiedades.datos = cuerpo;
    obligatorias.push('datos');
  }

  return {
    type: 'object',
    properties: propiedades,
    ...(obligatorias.length > 0 ? { required: obligatorias } : {}),
  };
}

/**
 * Se calcula una vez: convertir setenta esquemas en cada `tools/list` seria
 * tirar CPU en una instancia que no la tiene de sobra.
 */
const DEFINICIONES = HERRAMIENTAS.map((h) => ({
  herramienta: h,
  definicion: {
    name: h.nombre,
    description: h.descripcion,
    inputSchema: esquemaDeEntrada(h),
    annotations: {
      readOnlyHint: h.metodo === 'GET',
      destructiveHint: h.destructiva === true,
    },
  },
}));

const POR_NOMBRE = new Map(DEFINICIONES.map((d) => [d.herramienta.nombre, d.herramienta]));

// ─── Ejecutar una herramienta ───────────────────────────────────────────────

type Resultado = { content: Array<{ type: 'text'; text: string }>; isError?: boolean };

const fallo = (texto: string): Resultado => ({ content: [{ type: 'text', text: texto }], isError: true });

/**
 * El pase con el que este modulo llama al API en nombre del anfitrion.
 *
 * Es un JWT como el del panel, con la empresa de la conexion ya puesta, y
 * dura un minuto: lo justo para una llamada. No sale nunca de este proceso.
 */
const pase = (c: Conexion) =>
  new SignJWT({ email: c.usuario.email, role: c.usuario.role, companyId: c.companyId })
    .setProtectedHeader({ alg: 'HS256' })
    .setSubject(c.usuario.id)
    .setIssuedAt()
    .setExpirationTime('60s')
    .sign(secreto);

async function ejecutar(
  h: Herramienta,
  argumentos: Record<string, unknown>,
  conexion: Conexion,
): Promise<Resultado> {
  const resto = { ...argumentos };

  let ruta = h.ruta;
  for (const p of parametrosDeRuta(h.ruta)) {
    const valor = resto[p];
    if (typeof valor !== 'string' || !valor) return fallo(`Falta el argumento «${p}».`);
    ruta = ruta.replace(`:${p}`, encodeURIComponent(valor));
    delete resto[p];
  }

  const cuerpo = resto.datos;
  delete resto.datos;
  if (h.cuerpo && (cuerpo === undefined || cuerpo === null)) {
    return fallo('Falta el argumento «datos» con lo que hay que guardar.');
  }

  // Lo que queda son los filtros de la consulta.
  const consulta = new URLSearchParams();
  for (const [k, v] of Object.entries(resto)) {
    if (v === undefined || v === null) continue;
    for (const uno of Array.isArray(v) ? v : [v]) consulta.append(k, String(uno));
  }
  const qs = consulta.toString();

  let respuesta: globalThis.Response;
  try {
    respuesta = await fetch(`http://127.0.0.1:${env.PORT}${ruta}${qs ? `?${qs}` : ''}`, {
      method: h.metodo,
      headers: {
        authorization: `Bearer ${await pase(conexion)}`,
        ...(h.cuerpo ? { 'content-type': 'application/json' } : {}),
      },
      ...(h.cuerpo ? { body: JSON.stringify(cuerpo) } : {}),
      signal: AbortSignal.timeout(25_000),
    });
  } catch (err) {
    logger.error({ err, herramienta: h.nombre }, 'herramienta del MCP no pudo llamar al API');
    return fallo('No se pudo completar ahora mismo. Inténtalo de nuevo.');
  }

  if (respuesta.status === 204) return { content: [{ type: 'text', text: 'Hecho.' }] };

  const carga = (await respuesta.json().catch(() => null)) as
    | { data?: unknown; meta?: unknown; error?: { message?: string; details?: unknown } }
    | null;

  if (!respuesta.ok) {
    // El mensaje del API ya esta escrito para leerse, y el detalle por campo
    // es lo que le permite al modelo corregir y reintentar.
    const mensaje = carga?.error?.message ?? `El API respondió ${respuesta.status}.`;
    const detalle = carga?.error?.details ? `\n${JSON.stringify(carga.error.details)}` : '';
    return fallo(`${mensaje}${detalle}`);
  }

  let texto = JSON.stringify(
    carga && carga.meta !== undefined ? { datos: carga.data, meta: carga.meta } : (carga?.data ?? carga),
  );
  if (texto.length > MAXIMO_DE_RESPUESTA) {
    texto =
      `${texto.slice(0, MAXIMO_DE_RESPUESTA)}\n…[respuesta cortada: es demasiado larga. ` +
      'Acota con filtros o pide menos resultados por página.]';
  }
  return { content: [{ type: 'text', text: texto }] };
}

// ─── El protocolo ───────────────────────────────────────────────────────────

/** Un servidor por peticion, con la conexion de esa peticion dentro. */
function servidorPara(conexion: Conexion): Server {
  const servidor = new Server(
    { name: 'tenemos-filo', title: 'Tenemos Filo', version: '1.0.0' },
    {
      capabilities: { tools: {} },
      instructions:
        'Herramientas para operar la cuenta de un anfitrión en Tenemos Filo: sus experiencias, ' +
        'disponibilidad, reservas y CRM. Todo lo que hagas queda hecho de verdad y a nombre del ' +
        'anfitrión. Antes de cancelar, eliminar o registrar dinero, confírmalo con él. Los precios ' +
        'van en pesos colombianos. No inventes ids: sácalos siempre de una herramienta de listar.',
    },
  );

  // Solo se anuncian las herramientas que esta conexion puede usar: enseñar
  // las demas seria invitar al modelo a llamarlas para recibir un «no».
  servidor.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: DEFINICIONES.filter((d) => conexion.permisos.has(d.herramienta.permiso)).map(
      (d) => d.definicion,
    ),
  }));

  servidor.setRequestHandler(CallToolRequestSchema, async (peticion) => {
    const h = POR_NOMBRE.get(peticion.params.name);
    if (!h) return fallo(`La herramienta «${peticion.params.name}» no existe.`);
    if (!conexion.permisos.has(h.permiso)) {
      return fallo(
        `Esta conexión no tiene el permiso «${h.permiso}». El anfitrión puede volver a conectar el asistente y concederlo.`,
      );
    }
    return ejecutar(h, (peticion.params.arguments ?? {}) as Record<string, unknown>, conexion);
  });

  return servidor;
}

export const mcpRouter = Router();

mcpRouter.post('/', requireConexion, async (req: Request, res: Response) => {
  const servidor = servidorPara(req.conexionMcp!);
  const transporte = new StreamableHTTPServerTransport({
    // Sin id de sesion: modo sin estado.
    sessionIdGenerator: undefined,
    // Respuesta json normal en vez de un stream: ninguna herramienta manda
    // avances a medias, y asi no queda una conexion abierta por peticion.
    enableJsonResponse: true,
  });
  res.on('close', () => {
    void transporte.close();
    void servidor.close();
  });
  await servidor.connect(transporte);
  await transporte.handleRequest(req, res, req.body);
});

// Sin sesiones no hay stream que abrir ni sesion que cerrar. El protocolo
// pide contestar 405 para que el cliente no se quede esperando.
const sinSesion = (_req: Request, res: Response) =>
  res.status(405).set('Allow', 'POST').json({
    jsonrpc: '2.0',
    error: { code: -32000, message: 'Este servidor no mantiene sesiones: usa POST.' },
    id: null,
  });
mcpRouter.get('/', sinSesion);
mcpRouter.delete('/', sinSesion);
