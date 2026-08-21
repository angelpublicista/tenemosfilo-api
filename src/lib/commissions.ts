// Calculo de comisiones de una reserva.
//
// Modelo: la comision se DESCUENTA de lo que paga el cliente. El anfitrion
// recibe el total menos las comisiones; el precio al cliente no cambia.
import type { CommissionType } from '@prisma/client';
import { prisma } from '../config/prisma.js';

const SETTINGS_ID = 'default';

export type Comision = { type: CommissionType; value: number };

export type DesgloseComisiones = {
  filo: number;
  reseller: number;
  /** Suma de ambas, que es lo que va al campo `commission` del pricing. */
  total: number;
  hostEarnings: number;
};

/**
 * Ajustes de plataforma. La fila es unica; si no existe todavia la creamos
 * con los valores por defecto del schema (0%), para que el primer GET no
 * falle ni haya que sembrarla a mano.
 */
export async function getPlatformSettings() {
  return prisma.platformSettings.upsert({
    where: { id: SETTINGS_ID },
    update: {},
    create: { id: SETTINGS_ID },
  });
}

/** Redondea a peso: los importes en COP no llevan decimales. */
function redondear(n: number): number {
  return Math.round(n);
}

/**
 * Importe de una comision sobre una base.
 * Un porcentaje nunca puede pasarse del 100%, ni un monto fijo de la base:
 * si no, el anfitrion acabaria con ingresos negativos.
 */
export function calcularImporte(comision: Comision, base: number): number {
  if (base <= 0) return 0;
  const bruto =
    comision.type === 'PERCENT'
      ? (base * Math.min(Math.max(comision.value, 0), 100)) / 100
      : Math.max(comision.value, 0);
  return redondear(Math.min(bruto, base));
}

type FuenteComision = {
  filoCommissionType: CommissionType | null;
  filoCommissionValue: unknown; // Decimal | null
  resellerCommissionType: CommissionType | null;
  resellerCommissionValue: unknown;
};

function aNumero(v: unknown): number | null {
  if (v === null || v === undefined) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * Comisiones efectivas de una experiencia: las suyas si las tiene, y si no
 * las de la plataforma. Se resuelve campo a campo, asi que una experiencia
 * puede sobrescribir solo la de FILO y heredar la de revendedor.
 */
export function resolverComisiones(
  experiencia: FuenteComision | null,
  ajustes: FuenteComision,
): { filo: Comision; reseller: Comision } {
  const valorExpFilo = aNumero(experiencia?.filoCommissionValue);
  const valorExpReseller = aNumero(experiencia?.resellerCommissionValue);

  return {
    filo:
      experiencia?.filoCommissionType && valorExpFilo !== null
        ? { type: experiencia.filoCommissionType, value: valorExpFilo }
        : {
            type: ajustes.filoCommissionType ?? 'PERCENT',
            value: aNumero(ajustes.filoCommissionValue) ?? 0,
          },
    reseller:
      experiencia?.resellerCommissionType && valorExpReseller !== null
        ? { type: experiencia.resellerCommissionType, value: valorExpReseller }
        : {
            type: ajustes.resellerCommissionType ?? 'PERCENT',
            value: aNumero(ajustes.resellerCommissionValue) ?? 0,
          },
    };
}

/**
 * Desglose de una reserva.
 *
 * La comision de revendedor solo se cobra si la reserva entro por esa via;
 * en una reserva directa del anfitrion no hay revendedor a quien pagarle.
 */
export function calcularDesglose(
  total: number,
  comisiones: { filo: Comision; reseller: Comision },
  opts: { esDeReseller: boolean },
): DesgloseComisiones {
  const filo = calcularImporte(comisiones.filo, total);
  const reseller = opts.esDeReseller ? calcularImporte(comisiones.reseller, total) : 0;

  // Si entre las dos superan el total, se prorratean: el anfitrion nunca
  // debe terminar debiendo dinero.
  let filoFinal = filo;
  let resellerFinal = reseller;
  if (filo + reseller > total && total > 0) {
    const factor = total / (filo + reseller);
    filoFinal = redondear(filo * factor);
    resellerFinal = total - filoFinal;
  }

  const suma = filoFinal + resellerFinal;
  return {
    filo: filoFinal,
    reseller: resellerFinal,
    total: suma,
    hostEarnings: redondear(total - suma),
  };
}
