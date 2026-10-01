import { Router } from 'express';
import type { Request, Response } from 'express';
import { z } from 'zod';
import { requireAuth, requireHumanAuth, requireRole } from '../../middleware/auth.js';
import { validate } from '../../middleware/validate.js';
import { logger } from '../../lib/logger.js';
import { prisma } from '../../config/prisma.js';
import { descifrar } from '../../lib/cripto.js';
import { enviarTexto, firmaValida, mensajesDeTexto } from '../../lib/whatsapp.js';
import { agenteService } from './agente.service.js';
import { agenteConfigService } from './agente.config.js';

export const agenteRouter = Router();

// ─── Webhook de WhatsApp (publico: lo llama Meta, no un usuario) ────────────
//
// La URL lleva la empresa dentro porque cada anfitrion conecta su propia app
// de Meta: sin eso no habria forma de saber de quien es el numero que escribe,
// ni con que token contestarle.

/**
 * Verificacion del webhook. Meta llama una vez con un reto y espera que se le
 * devuelva tal cual si el token coincide.
 */
agenteRouter.get('/whatsapp/webhook/:companyId', async (req: Request, res: Response) => {
  const { companyId } = req.params as { companyId: string };
  const modo = req.query['hub.mode'];
  const token = String(req.query['hub.verify_token'] ?? '');
  const reto = String(req.query['hub.challenge'] ?? '');

  const agente = await prisma.aiAgent.findUnique({
    where: { companyId },
    select: { waVerifyToken: true },
  });
  const esperado = descifrar(agente?.waVerifyToken);

  if (modo === 'subscribe' && esperado && token === esperado) {
    // Texto plano y sin comillas: Meta compara el cuerpo literal.
    res.type('text/plain').send(reto);
    return;
  }
  logger.warn({ companyId }, 'verificacion de webhook de WhatsApp rechazada');
  res.sendStatus(403);
});

/**
 * Mensajes entrantes.
 *
 * Se responde 200 enseguida y se procesa aparte: Meta reintenta si tardas, y
 * un modelo que piensa cinco segundos provocaria mensajes duplicados.
 */
agenteRouter.post('/whatsapp/webhook/:companyId', async (req: Request, res: Response) => {
  const { companyId } = req.params as { companyId: string };

  const agente = await prisma.aiAgent.findUnique({
    where: { companyId },
    select: { enabled: true, waAppSecret: true, waAccessToken: true, waPhoneNumberId: true },
  });
  if (!agente) {
    res.sendStatus(200);
    return;
  }

  // Si el anfitrion guardo el secreto de la app, se exige la firma. Sin el no
  // se puede comprobar nada, pero tampoco se puede hacer daño: lo peor que
  // consigue un tercero es que el agente conteste a un numero inventado.
  const secreto = descifrar(agente.waAppSecret);
  if (secreto) {
    const crudo = (req as Request & { rawBody?: Buffer }).rawBody;
    if (!firmaValida(crudo, req.headers['x-hub-signature-256'] as string | undefined, secreto)) {
      logger.warn({ companyId }, 'webhook de WhatsApp con firma invalida');
      res.sendStatus(401);
      return;
    }
  }

  res.sendStatus(200);

  const entrantes = mensajesDeTexto(req.body);
  if (entrantes.length === 0 || !agente.enabled) return;

  const token = descifrar(agente.waAccessToken);
  if (!token || !agente.waPhoneNumberId) {
    logger.error({ companyId }, 'agente encendido sin credenciales para responder');
    return;
  }

  void (async () => {
    for (const m of entrantes) {
      try {
        const { respuesta } = await agenteService.responder({
          companyId,
          telefono: m.telefono,
          nombrePerfil: m.nombrePerfil,
          texto: m.texto,
        });
        if (!respuesta) continue;
        const envio = await enviarTexto({
          phoneNumberId: agente.waPhoneNumberId!,
          accessToken: token,
          para: m.telefono,
          texto: respuesta,
        });
        if (!envio.ok) logger.error({ companyId, detalle: envio.detalle }, 'no se pudo responder por WhatsApp');
      } catch (err) {
        logger.error({ err, companyId }, 'fallo atendiendo un mensaje de WhatsApp');
      }
    }
  })();
});

// ─── Resto: el anfitrion configurando su agente ─────────────────────────────

agenteRouter.use(requireAuth, requireHumanAuth, requireRole('HOST', 'ADMIN'));

const configSchema = z.object({
  enabled: z.boolean().optional(),
  nombre: z.string().trim().min(1).max(60).optional(),
  tono: z.string().trim().max(300).optional(),
  instrucciones: z.string().trim().max(4000).optional(),
  puedeCrearSolicitud: z.boolean().optional(),
  puedeEnviarEnlace: z.boolean().optional(),
  // Cadena vacia borra; omitido deja como esta. Igual que las pasarelas.
  waPhoneNumberId: z.string().trim().max(60).optional(),
  waNumero: z.string().trim().max(40).optional(),
  waAccessToken: z.string().trim().max(400).optional(),
  waVerifyToken: z.string().trim().max(200).optional(),
  waAppSecret: z.string().trim().max(200).optional(),
});

agenteRouter.get('/', async (req: Request, res: Response) => {
  res.json({ data: await agenteConfigService.ver(req.user!.companyId) });
});

agenteRouter.put('/', validate(configSchema), async (req: Request, res: Response) => {
  res.json({
    data: await agenteConfigService.guardar(req.user!.companyId, req.body as never),
  });
});

/**
 * Probar el agente sin WhatsApp.
 *
 * Existe porque encender un agente que habla con clientes sin haberlo oido
 * antes es temerario, y porque conectar WhatsApp lleva su tramite: esto deja
 * verlo funcionando desde el primer minuto.
 */
agenteRouter.post(
  '/probar',
  validate(z.object({ texto: z.string().trim().min(1).max(1000) })),
  async (req: Request, res: Response) => {
    const { texto } = req.body as { texto: string };
    const r = await agenteService.responder({
      companyId: req.user!.companyId!,
      telefono: `prueba:${req.user!.id}`,
      nombrePerfil: 'Prueba',
      texto,
      canal: 'PRUEBA',
    });
    res.json({ data: r });
  },
);

agenteRouter.get('/conversaciones', async (req: Request, res: Response) => {
  res.json({ data: await agenteConfigService.conversaciones(req.user!.companyId) });
});

agenteRouter.get('/conversaciones/:id', async (req: Request, res: Response) => {
  res.json({
    data: await agenteConfigService.conversacion(req.params.id as string, req.user!.companyId),
  });
});

agenteRouter.patch('/conversaciones/:id/pausa', async (req: Request, res: Response) => {
  const { pausada } = (req.body ?? {}) as { pausada?: boolean };
  res.json({
    data: await agenteConfigService.pausar(
      req.params.id as string,
      req.user!.companyId,
      pausada !== false,
    ),
  });
});
