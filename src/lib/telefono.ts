// Teléfonos en formato internacional.
//
// Quien escribe en un chat no pone el código de país: dice "300 123 4567". Y
// WhatsApp entrega el número con el código pero sin el "+" (573001234567). Si
// se guarda tal cual, el formulario de reserva —que espera "+57…"— no sabe
// leerlo y lo muestra con el país equivocado.
//
// La plataforma opera en Colombia, así que un número de diez dígitos sin
// código es colombiano. Lo que no encaja ahí no se adivina: se devuelve null
// para que quien pregunta pida el código de país.

/** Indicativo que se supone cuando la persona no lo escribe. */
const PAIS_POR_DEFECTO = '57';

/** El máximo de dígitos de un número internacional (E.164). */
const MAX_DIGITOS = 15;

/**
 * El teléfono en formato "+573001234567", o null si no se puede saber de qué
 * país es.
 *
 * - Con "+" o "00" delante ya trae su código: se respeta.
 * - Diez dígitos a secas: colombiano, se le antepone +57.
 * - "57" seguido de diez dígitos: es el colombiano sin "+" (así llega de
 *   WhatsApp).
 * - Cualquier otra cosa sin código: null. Adivinar un país es peor que
 *   preguntar.
 */
export function aTelefonoInternacional(crudo?: string | null): string | null {
  const t = (crudo ?? '').trim();
  if (!t) return null;
  const digitos = t.replace(/\D/g, '');
  if (!digitos) return null;

  const conCodigo = t.startsWith('+') || digitos.startsWith('00');
  if (conCodigo) {
    const internacional = digitos.startsWith('00') ? digitos.slice(2) : digitos;
    return internacional.length >= 8 && internacional.length <= MAX_DIGITOS ? `+${internacional}` : null;
  }
  if (digitos.length === 10) return `+${PAIS_POR_DEFECTO}${digitos}`;
  if (digitos.length === 12 && digitos.startsWith(PAIS_POR_DEFECTO)) return `+${digitos}`;
  return null;
}

/** Los últimos diez dígitos, que identifican a la persona sin importar el formato guardado. */
export function ultimosDiez(crudo?: string | null): string | null {
  const d = (crudo ?? '').replace(/\D/g, '');
  return d.length >= 10 ? d.slice(-10) : null;
}
