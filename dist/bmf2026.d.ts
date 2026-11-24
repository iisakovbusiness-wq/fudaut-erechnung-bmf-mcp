/**
 * Werkzeug 1: check_bmf_2026_erechnung
 * Prüft XRechnung 3.0 und ZUGFeRD 2.3 (UBL 2.1 & UN/CEFACT CII, optional direkt aus PDF/A-3) auf:
 * - EN 16931 Kern-Arithmetik (BT-106, BT-109, BT-110, BT-112, BT-115, BR-CO-10..16, BR-S-08/09)
 * - BMF-Schreiben vom 15.10.2026: Bau-/SHK-Abschlags- & Schlussrechnungen (BT-113 Vorauszahlung,
 *   Einzelaufstellung in BT-22/BT-25 oder eingebettetem Anhang BG-24), Leistungsbeschreibung (BT-153/BT-154
 *   bzw. referenzierter LV-Anhang in BG-24) sowie Leistungsdatum/-zeitraum (BT-72 / BG-14)
 * - Storno- und Gutschrifts-Typcodes (381 / 384 / 389) samt Bezugsrechnung (BT-25) und Vorzeichenlogik.
 */
import { NormalizedInvoice } from "./invoiceModel.js";
export type ValidationSeverity = "fehler" | "warnung" | "hinweis";
export interface BmfFinding {
    stufe: ValidationSeverity;
    code: string;
    feld: string;
    zeile: number;
    meldung: string;
}
export interface BmfCheckResult {
    ok: boolean;
    quelleTyp: "XML" | "PDF_HYBRID";
    syntax: string | null;
    profilId: string | null;
    rechnungsnummer: string | null;
    ausstellungsdatum: string | null;
    typcode: string | null;
    istBauOderAbschlagKontext: boolean;
    istSchlussrechnung: boolean;
    istKorrekturOderGutschrift: boolean;
    waehrung: string;
    summen: {
        bt106PositionenNettoCent: number | null;
        bt107NachlaesseCent: number;
        bt108ZuschlaegeCent: number;
        bt109SteuerbasisCent: number | null;
        bt110SteuerCent: number | null;
        bt112BruttoCent: number | null;
        bt113VorausbezahltCent: number;
        bt115ZahlbetragCent: number | null;
        zahlbetragDeutsch: string | null;
        zahlbetragIso: string | null;
    };
    positionenAnzahl: number;
    anhaengeAnzahl: number;
    fehlerAnzahl: number;
    warnungAnzahl: number;
    befunde: BmfFinding[];
}
export declare function validateInvoiceAgainstBmf2026(inv: NormalizedInvoice, quelleTyp?: "XML" | "PDF_HYBRID"): BmfCheckResult;
/** Einstiegspunkt für XML-String oder hybriden PDF/A-3-Puffer. */
export declare function checkBmf2026Erechnung(input: {
    xml?: string;
    pdfBytes?: Buffer;
}): BmfCheckResult;
