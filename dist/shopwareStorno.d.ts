/**
 * Werkzeug 3: check_shopware_storno_math
 * Prüft B2B-Gutschriften, Storno-/Korrekturrechnungen (381/384), Positionen und Nachlässe/Zuschläge
 * (BG-20/BG-21 sowie BG-27/BG-28) auf Vorzeichenfehler, fehlende Bezugsrechnungen, BR-27-Verstöße
 * und Brutto-zu-Netto-Rundungsdrift > 0,01 EUR (bekannte Shopware-6-Sonderfälle).
 */
import { ValidationSeverity } from "./bmf2026.js";
import { NormalizedInvoice } from "./invoiceModel.js";
export interface StornoMathFinding {
    stufe: ValidationSeverity;
    code: string;
    feld: string;
    zeile: number;
    abweichungCent: number;
    meldung: string;
}
export interface LineMathAudit {
    id: string;
    zeile: number;
    menge: string | null;
    einzelpreisNetto: string | null;
    ausgewiesenNettoCent: number | null;
    berechnetNettoCent: number | null;
    abweichungCent: number;
}
export interface ShopwareStornoCheckResult {
    ok: boolean;
    syntax: string | null;
    rechnungsnummer: string | null;
    typcode: string | null;
    istStornoOderGutschrift: boolean;
    bezugsrechnungen: string[];
    waehrung: string;
    maxRundungsdriftCent: number;
    vorzeichenfehlerAnzahl: number;
    rundungsfehlerAnzahl: number;
    fehlerAnzahl: number;
    warnungAnzahl: number;
    positionenPruefung: LineMathAudit[];
    summen: {
        bt106AusgewiesenCent: number | null;
        bt106BerechnetCent: number;
        bt107NachlaesseCent: number;
        bt108ZuschlaegeCent: number;
        bt109AusgewiesenCent: number | null;
        bt109BerechnetCent: number;
        bt110AusgewiesenCent: number | null;
        bt110BerechnetCent: number;
        bt112AusgewiesenCent: number | null;
        bt115AusgewiesenCent: number | null;
    };
    befunde: StornoMathFinding[];
}
export declare function auditShopwareStornoInvoice(inv: NormalizedInvoice): ShopwareStornoCheckResult;
export declare function checkShopwareStornoMath(xml: string): ShopwareStornoCheckResult;
