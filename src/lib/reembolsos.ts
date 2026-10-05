// Los reembolsos de una reserva (TR-30).
//
// Un reembolso no es solo un numero que se apunta: baja lo vendido y, con
// ello, la base sobre la que FILO cobra su fee y la que se le dispersa al
// anfitrion. Si solo se apuntara, FILO seguiria cobrando comision sobre un
// dinero que se devolvio.
//
// No hay periodos que cerrar: lo que se le debe a cada empresa se calcula
// como devengado menos transferido, asi que un reembolso posterior a una
// transferencia deja el saldo en negativo y se descuenta de la siguiente.
// Eso es exactamente "si el periodo cerro, va al siguiente".
import { randomUUID } from 'node:crypto';

export type OrigenDeReembolso = 'CANCELACION' | 'BAJA_PARCIAL' | 'AJUSTE';

export interface Reembolso {
  id: string;
  fecha: string;
  importe: number;
  motivo: string;
  origen: OrigenDeReembolso;
  /** `pendiente` hasta que alguien confirme que el dinero salio. */
  estado: 'pendiente' | 'pagado';
  pagadoEl?: string | null;
}

export function nuevoReembolso(
  importe: number,
  motivo: string,
  origen: OrigenDeReembolso,
): Reembolso {
  return {
    id: randomUUID(),
    fecha: new Date().toISOString(),
    importe,
    motivo,
    origen,
    estado: 'pendiente',
    pagadoEl: null,
  };
}

/** Lo ya devuelto, para no devolver dos veces lo mismo. */
export function totalReembolsado(refunds: unknown): number {
  if (!Array.isArray(refunds)) return 0;
  return refunds.reduce((suma: number, r) => {
    const importe = Number((r as { importe?: unknown })?.importe ?? 0);
    return suma + (Number.isFinite(importe) ? importe : 0);
  }, 0);
}

/**
 * Como queda el pago despues de devolver dinero.
 *
 * Se deriva de lo que queda cobrado frente a lo que queda por vender, en vez
 * de guardarse a mano: una reserva de la que se devolvio todo esta
 * reembolsada, y una a la que se le bajo el precio y el abono sigue siendo
 * una reserva pagada.
 */
export function estadoDePagoTrasReembolso(
  pagado: number,
  totalVendido: number,
): 'PAID' | 'PARTIAL' | 'REFUNDED' {
  if (pagado <= 0) return 'REFUNDED';
  if (totalVendido > 0 && pagado >= totalVendido) return 'PAID';
  return 'PARTIAL';
}
