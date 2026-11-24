/**
 * Exakte Festkomma-Arithmetik auf Basis von BigInt (Skalierung 10^8).
 * Vermeidet jeden IEEE-754-Gleitkommafehler bei Mengen, Einheitspreisen, Rabatten und Umsatzsteuer.
 */
export declare const SCALE = 100000000n;
export declare const CENT_FACTOR = 1000000n;
/** Parst eine XML-Dezimalzahl (Punkt als Dezimaltrennzeichen) exakt in 10^8-Einheiten. */
export declare function parseXmlScaled(raw: string | null | undefined): bigint | null;
/** Kaufmaennische Rundung (Half-Away-From-Zero) von 10^8-Einheiten auf ganze Cent. */
export declare function scaledToCents(scaled: bigint): number;
/** Parst einen XML-Geldbetrag direkt in ganze Cent (kaufmännisch gerundet) plus Roh-Skalierung. */
export declare function parseXmlAmount(raw: string | null | undefined): {
    cents: number;
    scaled: bigint;
    hatMehrAlsZweiNachkommastellen: boolean;
} | null;
/** Exakte Multiplikation zweier 10^8-skalierter Werte mit kaufmännischer Rundung auf 10^8. */
export declare function mulScaled(a: bigint, b: bigint): bigint;
/** Exakte Division zweier 10^8-skalierter Werte mit kaufmännischer Rundung auf 10^8. */
export declare function divScaled(a: bigint, b: bigint): bigint;
/** Berechnet roundHalfUp(basisCent * prozentScaled / 100) exakt in ganzen Cent. */
export declare function prozentAufCent(basisCent: number, prozentScaled: bigint): number;
/** Formatiert ganze Cent als deutsches Zahlenformat mit zwei Nachkommastellen (z. B. 1.450,00 EUR). */
export declare function centsAlsDeutsch(cents: number, waehrung?: string): string;
/** Formatiert ganze Cent als ISO-Dezimalwert mit Punkt (z. B. 1450.00). */
export declare function centsAlsIso(cents: number): string;
/** Formatiert 10^8-skalierte Zahl kompakt als Dezimalstring ohne überflüssige Nullen. */
export declare function scaledAlsText(scaled: bigint, minDecimals?: number): string;
