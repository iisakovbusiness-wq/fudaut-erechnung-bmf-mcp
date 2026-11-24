/**
 * Werkzeug 4: parse_gaeb_xml
 * Parst GAEB DA XML (X83 Angebotsaufforderung, X84 Angebotsabgabe, X86 Auftragserteilung; Versionen 3.2 & 3.3)
 * in sauberes, deterministisches ERP-JSON:
 * - Kopfdaten (Dateiphase, Projekt, Vergabe, Auftraggeber, Auftragnehmer, Währung, OZ-Maske)
 * - Hierarchische Los-/Titel-Struktur (BoQCtgy)
 * - Alle Positionen (OZ, Menge, Einheit, EP, ausgewiesener GP, exakt berechneter GP, Kurz-/Langtext, Bedarfsstatus)
 * - Automatischer Summenabgleich je Position, je Los/Titel und für das gesamte Leistungsverzeichnis.
 */
import { ValidationSeverity } from "./bmf2026.js";
export interface GaebFinding {
    stufe: ValidationSeverity;
    code: string;
    oz: string | null;
    zeile: number;
    meldung: string;
}
export interface GaebCategorySummary {
    id: string | null;
    ozTeil: string;
    pfadOz: string;
    bezeichnung: string;
    positionenAnzahl: number;
    berechneteSummeCent: number;
    ausgewieseneSummeCent: number | null;
    abweichungCent: number | null;
    untergruppen: GaebCategorySummary[];
}
export interface GaebPositionItem {
    id: string | null;
    zeile: number;
    oz: string;
    gruppeOz: string;
    gruppeBezeichnung: string;
    positionsart: "Normalposition" | "Bedarfsposition" | "BedarfspositionMitSumme" | "Alternativposition";
    zaehltInGesamtsumme: boolean;
    kurztext: string;
    langtext: string | null;
    menge: string | null;
    einheit: string | null;
    epText: string | null;
    epCent: number | null;
    gpAusgewiesenCent: number | null;
    gpAusgewiesenIso: string | null;
    gpBerechnetCent: number | null;
    gpBerechnetIso: string | null;
    abweichungCent: number | null;
    nurEinheitspreis: boolean;
    steuersatzProzent: string | null;
}
export interface GaebParseResult {
    ok: boolean;
    kopf: {
        dateiphase: string;
        phasenBezeichnung: string;
        gaebVersion: string | null;
        datum: string | null;
        waehrung: string;
        projektnummer: string | null;
        projektname: string | null;
        vergabenummer: string | null;
        lvBezeichnung: string | null;
        auftraggeber: string | null;
        auftragnehmer: string | null;
        ozEbenenLaengen: number[];
    };
    gruppen: GaebCategorySummary[];
    positionen: GaebPositionItem[];
    summen: {
        positionenGesamt: number;
        bepreistePositionen: number;
        preiseErwartet: boolean;
        berechneteNettoCent: number;
        berechneteNettoIso: string;
        berechneteNettoDeutsch: string;
        ausgewieseneNettoCent: number | null;
        ausgewieseneNettoIso: string | null;
        ausgewieseneNettoDeutsch: string | null;
        abweichungNettoCent: number | null;
        steuersatzProzent: string | null;
        ausgewieseneBruttoCent: number | null;
        berechneteBruttoCent: number | null;
    };
    fehlerAnzahl: number;
    warnungAnzahl: number;
    befunde: GaebFinding[];
}
export declare function parseGaebXml(xml: string, dateiname?: string): GaebParseResult;
