/**
 * Exakte Festkomma-Arithmetik auf Basis von BigInt (Skalierung 10^8).
 * Vermeidet jeden IEEE-754-Gleitkommafehler bei Mengen, Einheitspreisen, Rabatten und Umsatzsteuer.
 */

export const SCALE = 100_000_000n; // 1.00000000 = 10^8
export const CENT_FACTOR = 1_000_000n; // 0.01 = 10^6 Einheiten in SCALE

const STRICT_XML_DECIMAL = /^[+-]?(?:\d+(?:\.\d+)?|\.\d+)$/;

/** Parst eine XML-Dezimalzahl (Punkt als Dezimaltrennzeichen) exakt in 10^8-Einheiten. */
export function parseXmlScaled(raw: string | null | undefined): bigint | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  if (!trimmed || !STRICT_XML_DECIMAL.test(trimmed)) return null;

  const negative = trimmed.startsWith("-");
  const unsigned = trimmed.startsWith("-") || trimmed.startsWith("+") ? trimmed.slice(1) : trimmed;
  const parts = unsigned.split(".");
  const intPart = parts[0] || "0";
  const fracRaw = parts[1] || "";

  let scaledInt: bigint;
  try {
    scaledInt = BigInt(intPart) * SCALE;
  } catch {
    return null;
  }

  // Bis zu 8 Nachkommastellen direkt, 9. Stelle kaufmännisch runden
  const padded9 = (fracRaw + "000000000").slice(0, 9);
  const first8 = BigInt(padded9.slice(0, 8));
  const ninth = Number(padded9[8] ?? "0");
  let total = scaledInt + first8 + (ninth >= 5 ? 1n : 0n);
  if (negative && total !== 0n) total = -total;
  return total;
}

/** Kaufmaennische Rundung (Half-Away-From-Zero) von 10^8-Einheiten auf ganze Cent. */
export function scaledToCents(scaled: bigint): number {
  const negative = scaled < 0n;
  const abs = negative ? -scaled : scaled;
  const q = abs / CENT_FACTOR;
  const rem = abs % CENT_FACTOR;
  const rounded = rem >= CENT_FACTOR / 2n ? q + 1n : q;
  const signed = negative ? -rounded : rounded;
  return Number(signed);
}

/** Parst einen XML-Geldbetrag direkt in ganze Cent (kaufmännisch gerundet) plus Roh-Skalierung. */
export function parseXmlAmount(raw: string | null | undefined): { cents: number; scaled: bigint; hatMehrAlsZweiNachkommastellen: boolean } | null {
  if (raw === null || raw === undefined) return null;
  const trimmed = raw.trim();
  const scaled = parseXmlScaled(trimmed);
  if (scaled === null) return null;
  const dotIdx = trimmed.indexOf(".");
  const fracLen = dotIdx >= 0 ? trimmed.slice(dotIdx + 1).replace(/0+$/, "").length : 0;
  return {
    cents: scaledToCents(scaled),
    scaled,
    hatMehrAlsZweiNachkommastellen: fracLen > 2,
  };
}

/** Exakte Multiplikation zweier 10^8-skalierter Werte mit kaufmännischer Rundung auf 10^8. */
export function mulScaled(a: bigint, b: bigint): bigint {
  const prod = a * b;
  const negative = prod < 0n;
  const abs = negative ? -prod : prod;
  const q = abs / SCALE;
  const rem = abs % SCALE;
  const rounded = rem >= SCALE / 2n ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** Exakte Division zweier 10^8-skalierter Werte mit kaufmännischer Rundung auf 10^8. */
export function divScaled(a: bigint, b: bigint): bigint {
  if (b === 0n) throw new Error("Division durch null in Festkomma-Arithmetik.");
  const negative = (a < 0n) !== (b < 0n);
  const absA = a < 0n ? -a : a;
  const absB = b < 0n ? -b : b;
  const num = absA * SCALE;
  const q = num / absB;
  const rem = num % absB;
  const rounded = rem * 2n >= absB ? q + 1n : q;
  return negative ? -rounded : rounded;
}

/** Berechnet roundHalfUp(basisCent * prozentScaled / 100) exakt in ganzen Cent. */
export function prozentAufCent(basisCent: number, prozentScaled: bigint): number {
  const basisScaled = BigInt(basisCent) * CENT_FACTOR;
  const hundertScaled = 100n * SCALE;
  const steuerScaled = divScaled(mulScaled(basisScaled, prozentScaled), hundertScaled);
  return scaledToCents(steuerScaled);
}

/** Formatiert ganze Cent als deutsches Zahlenformat mit zwei Nachkommastellen (z. B. 1.450,00 EUR). */
export function centsAlsDeutsch(cents: number, waehrung?: string): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const euro = Math.trunc(abs / 100);
  const rest = abs % 100;
  const euroText = String(euro).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
  const zahl = `${neg ? "-" : ""}${euroText},${String(rest).padStart(2, "0")}`;
  return waehrung ? `${zahl} ${waehrung}` : zahl;
}

/** Formatiert ganze Cent als ISO-Dezimalwert mit Punkt (z. B. 1450.00). */
export function centsAlsIso(cents: number): string {
  const neg = cents < 0;
  const abs = Math.abs(cents);
  const euro = Math.trunc(abs / 100);
  const rest = abs % 100;
  return `${neg ? "-" : ""}${euro}.${String(rest).padStart(2, "0")}`;
}

/** Formatiert 10^8-skalierte Zahl kompakt als Dezimalstring ohne überflüssige Nullen. */
export function scaledAlsText(scaled: bigint, minDecimals = 0): string {
  const neg = scaled < 0n;
  const abs = neg ? -scaled : scaled;
  const intPart = abs / SCALE;
  let frac = (abs % SCALE).toString().padStart(8, "0").replace(/0+$/, "");
  if (frac.length < minDecimals) frac = frac.padEnd(minDecimals, "0");
  return `${neg ? "-" : ""}${intPart.toString()}${frac.length > 0 ? "." + frac : ""}`;
}
