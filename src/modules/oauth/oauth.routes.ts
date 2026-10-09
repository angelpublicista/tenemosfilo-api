// Servidor de autorizacion para el MCP.
//
// Es lo que hay detras del boton «Conectar» de un asistente: el asistente se
// registra, manda al anfitrion a aprobar en una pantalla de FILO, y canjea el
// codigo que recibe por un token con el que habla con /mcp.
//
// Va en tres partes, y conviene no mezclarlas:
//
//   Lo que llama el asistente — descubrimiento, registro, token, revocacion.
//     Publico: se autentica con el propio codigo y con PKCE, no con sesion.
//   Lo que llama el navegador del anfitrion — /authorize, que solo valida y
//     lo lleva al front.
//   Lo que llama el front — con sesion humana: ver que se esta pidiendo,
//     aprobarlo o negarlo, y listar y cortar las conexiones.
//
// Los tokens que salen de aqui solo sirven en /mcp. El resto del API no los
// acepta: asi lo que un asistente puede hacer lo acota la lista de
// herramientas del MCP, no la suma de todos los endpoints.
import express, { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { prisma } from '../../config/prisma.js';
import { env } from '../../config/env.js';
import { requireAuth, requireHumanAuth } from '../../middleware/auth.js';
import { limitePublico } from '../../middleware/rate-limit.js';
import { validate } from '../../middleware/validate.js';
import { API_SCOPES } from '../../middleware/scope.js';
import { BadRequest, Forbidden, NotFound } from '../../lib/errors.js';
import { logger } from '../../lib/logger.js';
import {
  PREFIJO_REFRESCO,
  VIDA_DEL_ACCESO_MS,
  VIDA_DEL_CODIGO_MS,
  VIDA_DEL_REFRESCO_MS,
  conParametros,
  hashDeToken,
  nuevoCodigo,
  nuevoTokenDeAcceso,
  nuevoTokenDeRefresco,
  pkceValido,
  uriDeRedireccionAdmisible,
  uriRegistrada,
  urlDelApi,
  urlDelMcp,
} from '../../lib/oauth.js';

const TODOS_LOS_PERMISOS: readonly string[] = API_SCOPES;

/** De la cadena `scope` de OAuth a permisos nuestros. Sin nada, todos. */
function permisosPedidos(scope: string | undefined): string[] {
  const pedidos = (scope ?? '').split(/\s+/).filter((s) => TODOS_LOS_PERMISOS.includes(s));
  return pedidos.length > 0 ? [...new Set(pedidos)] : [...TODOS_LOS_PERMISOS];
}

// ─── Descubrimiento ─────────────────────────────────────────────────────────
//
// Se monta en la raiz, bajo /.well-known. Un asistente que recibe un 401 de
// /mcp lee de ahi a quien pedirle permiso y como.

export const descubrimientoRouter = Router();

// Con comodin: segun el cliente, la ruta del recurso va pegada detras
// (/.well-known/oauth-protected-resource/mcp) o no.
descubrimientoRouter.get('/oauth-protected-resource*', (req: Request, res: Response) => {
  res.json({
    resource: urlDelMcp(req),
    authorization_servers: [urlDelApi(req)],
    scopes_supported: TODOS_LOS_PERMISOS,
    bearer_methods_supported: ['header'],
    resource_name: 'Tenemos Filo',
  });
});

descubrimientoRouter.get('/oauth-authorization-server*', (req: Request, res: Response) => {
  const base = urlDelApi(req);
  res.json({
    issuer: base,
    authorization_endpoint: `${base}/oauth/authorize`,
    token_endpoint: `${base}/oauth/token`,
    registration_endpoint: `${base}/oauth/register`,
    revocation_endpoint: `${base}/oauth/revoke`,
    scopes_supported: TODOS_LOS_PERMISOS,
    response_types_supported: ['code'],
    grant_types_supported: ['authorization_code', 'refresh_token'],
    // Solo clientes publicos: un asistente no puede guardar un secreto, y
    // PKCE es lo que impide que otro canjee su codigo.
    token_endpoint_auth_methods_supported: ['none'],
    code_challenge_methods_supported: ['S256'],
  });
});

// ─── Lo que llama el asistente ──────────────────────────────────────────────

export const oauthRouter = Router();

// El endpoint de token recibe un formulario, no json: lo manda el estandar.
oauthRouter.use(express.urlencoded({ extended: false }));

/** Los errores de OAuth tienen su propio formato; los clientes lo esperan. */
const errorOAuth = (res: Response, estado: number, error: string, descripcion: string) =>
  res.status(estado).json({ error, error_description: descripcion });

const registroSchema = z.object({
  client_name: z.string().trim().min(1).max(120).optional(),
  redirect_uris: z.array(z.string().max(500)).min(1).max(10),
});

/**
 * Registro dinamico (RFC 7591).
 *
 * Abierto a proposito: es como un asistente se da de alta sin que nadie le
 * cree credenciales a mano. Registrarse no da acceso a nada —eso lo da el
 * anfitrion al aprobar— asi que lo unico que hay que cuidar es que no nos
 * llenen la tabla, y para eso esta el limite.
 */
oauthRouter.post('/register', limitePublico, async (req: Request, res: Response) => {
  const datos = registroSchema.safeParse(req.body);
  if (!datos.success) {
    return errorOAuth(res, 400, 'invalid_client_metadata', 'Faltan redirect_uris validas.');
  }
  const uris = datos.data.redirect_uris;
  if (!uris.every(uriDeRedireccionAdmisible)) {
    return errorOAuth(
      res,
      400,
      'invalid_redirect_uri',
      'Las redirect_uris deben ser https, http hacia localhost o un esquema propio.',
    );
  }

  const cliente = await prisma.oAuthClient.create({
    data: { name: datos.data.client_name ?? 'Aplicación sin nombre', redirectUris: uris },
  });

  res.status(201).json({
    client_id: cliente.id,
    client_name: cliente.name,
    redirect_uris: cliente.redirectUris,
    token_endpoint_auth_method: 'none',
    grant_types: ['authorization_code', 'refresh_token'],
    response_types: ['code'],
    client_id_issued_at: Math.floor(cliente.createdAt.getTime() / 1000),
  });
});

/**
 * Comprueba que la peticion de autorizacion es de un cliente conocido y va a
 * una de SUS direcciones.
 *
 * Es la comprobacion de la que depende todo: el codigo se entrega a esa
 * direccion, asi que si no es la registrada no se redirige a ningun sitio.
 */
async function clienteYDestino(clientId: string | undefined, redirectUri: string | undefined) {
  if (!clientId || !redirectUri) return null;
  const cliente = await prisma.oAuthClient.findUnique({ where: { id: clientId } });
  if (!cliente || !uriRegistrada(cliente.redirectUris, redirectUri)) return null;
  return cliente;
}

/**
 * A donde llega el navegador del anfitrion desde el asistente.
 *
 * Aqui no se decide nada: se valida y se le lleva a la pantalla del front,
 * que es donde tiene su sesion y donde aprueba.
 */
oauthRouter.get('/authorize', async (req: Request, res: Response) => {
  const q = req.query as Record<string, string | undefined>;

  const cliente = await clienteYDestino(q.client_id, q.redirect_uri);
  if (!cliente || !q.redirect_uri) {
    // Sin destino de confianza no hay a donde devolver el error: se dice aqui.
    return res
      .status(400)
      .type('text/plain')
      .send('Esta aplicación no está registrada en Tenemos Filo o su dirección de retorno no coincide.');
  }

  // A partir de aqui el destino es de fiar y los errores vuelven al asistente.
  const rechazar = (error: string, descripcion: string) =>
    res.redirect(
      conParametros(q.redirect_uri!, { error, error_description: descripcion, state: q.state }),
    );

  if (q.response_type !== 'code') {
    return rechazar('unsupported_response_type', 'Solo se admite response_type=code.');
  }
  if (!q.code_challenge || (q.code_challenge_method ?? 'plain') !== 'S256') {
    return rechazar('invalid_request', 'Hace falta PKCE con code_challenge_method=S256.');
  }

  const destino = new URL(`${env.APP_URL.replace(/\/+$/, '')}/oauth/autorizar`);
  for (const campo of ['client_id', 'redirect_uri', 'code_challenge', 'state', 'scope'] as const) {
    if (q[campo]) destino.searchParams.set(campo, q[campo]!);
  }
  res.redirect(destino.toString());
});

/** Emite el par de tokens de una conexion. */
async function emitirTokens(grantId: string, scopes: string[]) {
  const acceso = nuevoTokenDeAcceso();
  const refresco = nuevoTokenDeRefresco();
  const ahora = Date.now();
  await prisma.oAuthToken.createMany({
    data: [
      {
        tokenHash: hashDeToken(acceso),
        kind: 'ACCESS',
        grantId,
        expiresAt: new Date(ahora + VIDA_DEL_ACCESO_MS),
      },
      {
        tokenHash: hashDeToken(refresco),
        kind: 'REFRESH',
        grantId,
        expiresAt: new Date(ahora + VIDA_DEL_REFRESCO_MS),
      },
    ],
  });
  // De paso se barre lo caducado de esta conexion: no hay otra tarea que lo
  // haga y si no la tabla solo crece.
  prisma.oAuthToken
    .deleteMany({ where: { grantId, expiresAt: { lt: new Date(ahora) } } })
    .catch(() => undefined);

  return {
    access_token: acceso,
    token_type: 'Bearer',
    expires_in: Math.floor(VIDA_DEL_ACCESO_MS / 1000),
    refresh_token: refresco,
    scope: scopes.join(' '),
  };
}

oauthRouter.post('/token', limitePublico, async (req: Request, res: Response) => {
  const b = (req.body ?? {}) as Record<string, string | undefined>;
  // Los tokens no se cachean nunca.
  res.set('Cache-Control', 'no-store');

  if (b.grant_type === 'authorization_code') {
    if (!b.code || !b.code_verifier || !b.client_id || !b.redirect_uri) {
      return errorOAuth(res, 400, 'invalid_request', 'Faltan code, code_verifier, client_id o redirect_uri.');
    }
    const codeHash = hashDeToken(b.code);
    const codigo = await prisma.oAuthCode.findUnique({ where: { codeHash } });
    // Se borra ANTES de comprobar nada mas y se mira cuantos se borraron: es
    // lo que hace que un codigo valga una sola vez aunque lleguen dos
    // canjes a la vez.
    const borrados = await prisma.oAuthCode.deleteMany({ where: { codeHash } });
    if (!codigo || borrados.count !== 1 || codigo.expiresAt.getTime() < Date.now()) {
      return errorOAuth(res, 400, 'invalid_grant', 'El código no existe, ya se usó o caducó.');
    }
    if (codigo.clientId !== b.client_id || codigo.redirectUri !== b.redirect_uri) {
      return errorOAuth(res, 400, 'invalid_grant', 'El código no es de este cliente o de esta dirección.');
    }
    if (!pkceValido(b.code_verifier, codigo.codeChallenge)) {
      return errorOAuth(res, 400, 'invalid_grant', 'El code_verifier no corresponde.');
    }

    const conexion = await prisma.oAuthGrant.create({
      data: {
        clientId: codigo.clientId,
        userId: codigo.userId,
        companyId: codigo.companyId,
        scopes: codigo.scopes,
      },
    });
    logger.info({ conexion: conexion.id, cliente: codigo.clientId }, 'Asistente conectado por MCP');
    return res.json(await emitirTokens(conexion.id, conexion.scopes));
  }

  if (b.grant_type === 'refresh_token') {
    if (!b.refresh_token || !b.refresh_token.startsWith(PREFIJO_REFRESCO)) {
      return errorOAuth(res, 400, 'invalid_request', 'Falta refresh_token.');
    }
    const tokenHash = hashDeToken(b.refresh_token);
    const token = await prisma.oAuthToken.findUnique({
      where: { tokenHash },
      include: { grant: true },
    });
    if (!token || token.kind !== 'REFRESH') {
      return errorOAuth(res, 400, 'invalid_grant', 'El refresh_token no es válido.');
    }
    // Rota: el viejo deja de valer en cuanto se usa. Igual que con el codigo,
    // el borrado es lo que decide quien gana si llegan dos a la vez.
    const borrados = await prisma.oAuthToken.deleteMany({ where: { tokenHash } });
    if (
      borrados.count !== 1 ||
      token.expiresAt.getTime() < Date.now() ||
      token.grant.revokedAt ||
      (b.client_id && b.client_id !== token.grant.clientId)
    ) {
      return errorOAuth(res, 400, 'invalid_grant', 'El refresh_token caducó o la conexión se cortó.');
    }
    return res.json(await emitirTokens(token.grantId, token.grant.scopes));
  }

  return errorOAuth(res, 400, 'unsupported_grant_type', 'Solo authorization_code y refresh_token.');
});

/** Corta una conexion y deja sin valor todos sus tokens. */
async function cortarConexion(grantId: string) {
  await prisma.$transaction([
    prisma.oAuthGrant.update({ where: { id: grantId }, data: { revokedAt: new Date() } }),
    prisma.oAuthToken.deleteMany({ where: { grantId } }),
  ]);
}

/**
 * Revocacion (RFC 7009): el asistente se desconecta por su cuenta.
 *
 * Responde 200 tambien si el token no existe, como pide el estandar: no se
 * le dice a quien pregunta si un token era valido.
 */
oauthRouter.post('/revoke', limitePublico, async (req: Request, res: Response) => {
  const token = (req.body as { token?: string } | undefined)?.token;
  if (token) {
    const encontrado = await prisma.oAuthToken.findUnique({
      where: { tokenHash: hashDeToken(token) },
      select: { grantId: true },
    });
    if (encontrado) await cortarConexion(encontrado.grantId);
  }
  res.status(200).json({});
});

// ─── Lo que llama el front, con sesion ──────────────────────────────────────

const sesion = [requireAuth, requireHumanAuth];

/**
 * Quien puede conectar un asistente, y sobre que empresa.
 *
 * Solo anfitriones y administradores: las herramientas del MCP son las del
 * panel del anfitrion. Y siempre sobre una empresa concreta —la que tiene
 * activa en el panel— porque la conexion queda atada a ella.
 */
function empresaDeLaSesion(req: Request): string {
  const u = req.user!;
  if (u.role !== 'HOST' && u.role !== 'ADMIN') {
    throw Forbidden('Solo un anfitrión puede conectar un asistente a su cuenta.');
  }
  if (!u.companyId) {
    throw BadRequest('Elige primero la empresa sobre la que quieres conectar el asistente.');
  }
  return u.companyId;
}

const solicitudSchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  scope: z.string().optional(),
});

/** Lo que la pantalla de aprobacion necesita enseñar. */
oauthRouter.get(
  '/solicitud',
  ...sesion,
  validate(solicitudSchema, 'query'),
  async (req: Request, res: Response) => {
    const q = req.query as unknown as z.infer<typeof solicitudSchema>;
    const cliente = await clienteYDestino(q.client_id, q.redirect_uri);
    if (!cliente) throw BadRequest('Esta aplicación no está registrada o su dirección no coincide.');

    const companyId = empresaDeLaSesion(req);
    const empresa = await prisma.company.findUnique({
      where: { id: companyId },
      select: { id: true, companyName: true },
    });

    res.json({
      data: {
        // El nombre lo puso la propia aplicacion; la direccion a la que
        // vuelve no se puede inventar, y por eso se enseñan las dos.
        aplicacion: cliente.name,
        vuelveA: new URL(q.redirect_uri).host || new URL(q.redirect_uri).protocol,
        permisos: permisosPedidos(q.scope),
        empresa,
      },
    });
  },
);

const decisionSchema = z.object({
  client_id: z.string().min(1),
  redirect_uri: z.string().min(1),
  code_challenge: z.string().min(43).max(128),
  state: z.string().max(2000).optional(),
  aprobado: z.boolean(),
  /** Los que el anfitrion dejo marcados. */
  permisos: z.array(z.string()).max(TODOS_LOS_PERMISOS.length).default([]),
});

/**
 * El anfitrion aprueba o niega.
 *
 * Devuelve a donde tiene que ir el navegador en vez de redirigir: esto lo
 * llama el front por fetch, y una redireccion a otro origen ahi no llega.
 */
oauthRouter.post(
  '/decision',
  ...sesion,
  validate(decisionSchema),
  async (req: Request, res: Response) => {
    const d = req.body as z.infer<typeof decisionSchema>;
    const cliente = await clienteYDestino(d.client_id, d.redirect_uri);
    if (!cliente) throw BadRequest('Esta aplicación no está registrada o su dirección no coincide.');

    if (!d.aprobado) {
      return res.json({
        data: {
          redirigirA: conParametros(d.redirect_uri, {
            error: 'access_denied',
            error_description: 'El anfitrión no aprobó la conexión.',
            state: d.state,
          }),
        },
      });
    }

    const companyId = empresaDeLaSesion(req);
    const permisos = d.permisos.filter((p) => TODOS_LOS_PERMISOS.includes(p));
    if (permisos.length === 0) throw BadRequest('Deja marcado al menos un permiso.');

    const codigo = nuevoCodigo();
    await prisma.oAuthCode.create({
      data: {
        codeHash: hashDeToken(codigo),
        clientId: cliente.id,
        userId: req.user!.id,
        companyId,
        scopes: permisos,
        redirectUri: d.redirect_uri,
        codeChallenge: d.code_challenge,
        expiresAt: new Date(Date.now() + VIDA_DEL_CODIGO_MS),
      },
    });

    res.json({
      data: { redirigirA: conParametros(d.redirect_uri, { code: codigo, state: d.state }) },
    });
  },
);

/** Los asistentes conectados a la empresa activa. */
oauthRouter.get('/conexiones', ...sesion, async (req: Request, res: Response) => {
  const companyId = empresaDeLaSesion(req);
  const conexiones = await prisma.oAuthGrant.findMany({
    where: { companyId, revokedAt: null },
    orderBy: { createdAt: 'desc' },
    select: {
      id: true,
      scopes: true,
      createdAt: true,
      lastUsedAt: true,
      client: { select: { name: true } },
      user: { select: { name: true, email: true } },
    },
  });
  res.json({ data: conexiones });
});

oauthRouter.delete(
  '/conexiones/:id',
  ...sesion,
  validate(z.object({ id: z.string().min(1) }), 'params'),
  async (req: Request, res: Response) => {
    const companyId = empresaDeLaSesion(req);
    const conexion = await prisma.oAuthGrant.findFirst({
      where: { id: req.params.id as string, companyId, revokedAt: null },
      select: { id: true },
    });
    if (!conexion) throw NotFound('Esa conexión no existe o ya estaba cortada.');
    await cortarConexion(conexion.id);
    res.status(204).end();
  },
);
