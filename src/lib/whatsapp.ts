// WhatsApp Cloud API, con las credenciales del propio anfitrion.
//
// Cada anfitrion conecta su numero desde su cuenta de Meta: FILO no es
// intermediario, no guarda un numero propio y no manda nada en su nombre sin
// que el haya pegado sus credenciales.
import { createHmac, timingSafeEqual } from 'node:crypto';

const API = 'https://graph.facebook.com/v21.0';

/** Lo poco que nos interesa de una notificacion entrante. */
export type MensajeEntrante = {
  telefono: string;
  nombrePerfil: string | null;
  texto: string;
  /** El id de Meta: sirve para no procesar dos veces el mismo reintento. */
  messageId: string;
  phoneNumberId: string | null;
};

/**
 * Saca los mensajes de texto de una notificacion.
 *
 * Meta manda muchas cosas por el mismo webhook —acuses de entrega, cambios de
 * estado, plantillas— y aqui solo interesan los mensajes de texto que escribe
 * una persona. Lo demas se descarta en silencio: no es un error, es ruido.
 */
export function mensajesDeTexto(cuerpo: unknown): MensajeEntrante[] {
  const salida: MensajeEntrante[] = [];
  const entradas = (cuerpo as { entry?: unknown[] })?.entry;
  if (!Array.isArray(entradas)) return salida;

  for (const entrada of entradas) {
    const cambios = (entrada as { changes?: unknown[] })?.changes;
    if (!Array.isArray(cambios)) continue;
    for (const cambio of cambios) {
      const valor = (cambio as { value?: Record<string, unknown> })?.value;
      if (!valor) continue;
      const phoneNumberId =
        (valor.metadata as { phone_number_id?: string } | undefined)?.phone_number_id ?? null;
      const perfiles = new Map<string, string>();
      for (const c of (valor.contacts as Array<Record<string, unknown>>) ?? []) {
        const wa = String(c.wa_id ?? '');
        const nombre = (c.profile as { name?: string } | undefined)?.name;
        if (wa && nombre) perfiles.set(wa, nombre);
      }
      for (const m of (valor.messages as Array<Record<string, unknown>>) ?? []) {
        if (m.type !== 'text') continue;
        const telefono = String(m.from ?? '');
        const texto = (m.text as { body?: string } | undefined)?.body ?? '';
        if (!telefono || !texto.trim()) continue;
        salida.push({
          telefono,
          nombrePerfil: perfiles.get(telefono) ?? null,
          texto: texto.trim(),
          messageId: String(m.id ?? ''),
          phoneNumberId,
        });
      }
    }
  }
  return salida;
}

/**
 * Valida la firma de la notificacion.
 *
 *   X-Hub-Signature-256: sha256=HMAC_SHA256(cuerpo crudo, app secret)
 *
 * Sobre el cuerpo CRUDO, no sobre el json ya parseado y vuelto a serializar:
 * un espacio de diferencia y la firma no cuadra.
 */
export function firmaValida(
  cuerpoCrudo: Buffer | string | undefined,
  cabecera: string | undefined,
  appSecret: string,
): boolean {
  if (!cuerpoCrudo || !cabecera?.startsWith('sha256=')) return false;
  const esperado = createHmac('sha256', appSecret)
    .update(typeof cuerpoCrudo === 'string' ? Buffer.from(cuerpoCrudo, 'utf8') : cuerpoCrudo)
    .digest('hex');
  const recibido = cabecera.slice('sha256='.length).toLowerCase();
  const a = Buffer.from(esperado, 'utf8');
  const b = Buffer.from(recibido, 'utf8');
  // Tiempo constante: comparar firmas con === filtra el prefijo correcto.
  return a.length === b.length && timingSafeEqual(a, b);
}

/** Enviar un mensaje de texto. Devuelve si Meta lo acepto. */
export async function enviarTexto(params: {
  phoneNumberId: string;
  accessToken: string;
  para: string;
  texto: string;
}): Promise<{ ok: boolean; detalle?: string }> {
  try {
    const r = await fetch(`${API}/${encodeURIComponent(params.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${params.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: params.para,
        type: 'text',
        text: { preview_url: true, body: params.texto },
      }),
      signal: AbortSignal.timeout(10000),
    });
    if (r.ok) return { ok: true };
    return { ok: false, detalle: `Meta respondió ${r.status}: ${(await r.text()).slice(0, 300)}` };
  } catch (err) {
    return { ok: false, detalle: err instanceof Error ? err.message : 'No se pudo enviar' };
  }
}
