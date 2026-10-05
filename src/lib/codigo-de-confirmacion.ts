// El codigo que el cliente enseña al llegar.
//
// Existe para que pasar por FILO no sea opcional para un canal de venta: una
// reserva que no entro por aqui no tiene codigo valido, asi que el anfitrion
// lo descubre en la puerta en vez de nunca.
//
// No vale el numero de reserva para esto: lleva la hora dentro y solo tres
// caracteres al azar, asi que quien quisiera inventarse uno acertaria tarde o
// temprano.
import { randomInt } from 'node:crypto';

// Sin 0/O, 1/I/L ni 5/S: este codigo se dicta en voz alta en la puerta de un
// restaurante, y una confusion ahi deja a un cliente discutiendo en la
// entrada. Quedan 29 simbolos.
const ALFABETO = '23468579ABCDEFGHJKMNPQRTUVWXYZ'.replace(/[5S]/g, '');
const LARGO = 8;

/** `XXXX-XXXX`. El guion es solo para leerlo; no se guarda aparte. */
export function generarCodigoDeConfirmacion(): string {
  let salida = '';
  for (let i = 0; i < LARGO; i += 1) {
    salida += ALFABETO[randomInt(ALFABETO.length)];
  }
  return `${salida.slice(0, 4)}-${salida.slice(4)}`;
}

/**
 * Deja un codigo tecleado como esta guardado.
 *
 * Quien lo escribe lo esta leyendo de un movil o copiandolo de un correo, asi
 * que llega con espacios, en minusculas o sin el guion. Rechazarlo por eso
 * seria mandar a alguien a reescribirlo delante de la fila.
 */
export function normalizarCodigo(valor: string): string {
  const limpio = valor.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return limpio.length === LARGO ? `${limpio.slice(0, 4)}-${limpio.slice(4)}` : limpio;
}
