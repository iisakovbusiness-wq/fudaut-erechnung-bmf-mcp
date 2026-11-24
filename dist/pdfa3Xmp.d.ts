/**
 * Werkzeug 2: check_zugferd_pdfa3_xmp
 * Analysiert PDF/A-3-Bytes oder XMP-Metadaten gezielt auf den offenen JTL-Wawi-Fehler WAWI-86919:
 * - PDF/A-3 Identifikation (pdfaid:part = 3, pdfaid:conformance = A/B/U)
 * - PDF/A-3 Extension Schema Deklaration (pdfaExtension:schemas für Factur-X / ZUGFeRD Namensraum
 *   inkl. aller 4 Pflichtfelder DocumentFileName, DocumentType, Version, ConformanceLevel)
 * - Gesetzte und zum Namensraum passende Versionsangabe fx:Version / zf:Version (Kern von WAWI-86919)
 * - Vorhandenes eingebettetes Rechnungs-XML (factur-x.xml / zugferd-invoice.xml / xrechnung.xml)
 * - Abgleich zwischen XMP-Angaben, eingebettetem XML und optionalen Referenzsummen.
 */
import { ValidationSeverity } from "./bmf2026.js";
export interface XmpFinding {
    stufe: ValidationSeverity;
    code: string;
    feld: string;
    zeile: number;
    meldung: string;
}
export interface Pdfa3XmpCheckResult {
    ok: boolean;
    wawi86919Betroffen: boolean;
    eingabeTyp: "PDF" | "XMP_XML";
    pdfa: {
        part: string | null;
        conformance: string | null;
        hatGtsPdfa1: boolean | null;
        hatAfArray: boolean | null;
    };
    zugferdXmp: {
        erkanntesSchemaUri: string | null;
        documentType: string | null;
        documentFileName: string | null;
        version: string | null;
        conformanceLevel: string | null;
        extensionSchemaDeklariert: boolean;
        deklarierteProperties: string[];
    };
    eingebettetesXml: {
        vorhanden: boolean;
        dateinamenImPdf: string[];
        rechnungsnummer: string | null;
        typcode: string | null;
        waehrung: string | null;
        nettoCent: number | null;
        bruttoCent: number | null;
        zahlbetragCent: number | null;
    };
    fehlerAnzahl: number;
    warnungAnzahl: number;
    befunde: XmpFinding[];
}
export interface CheckZugferdXmpInput {
    pdfBytes?: Buffer;
    xmpXml?: string;
    embeddedXml?: string;
    erwartetNettoCent?: number;
    erwartetBruttoCent?: number;
    erwartetZahlbetragCent?: number;
}
export declare function checkZugferdPdfa3Xmp(input: CheckZugferdXmpInput): Pdfa3XmpCheckResult;
