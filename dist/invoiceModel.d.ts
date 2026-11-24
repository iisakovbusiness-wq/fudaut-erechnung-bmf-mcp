/**
 * Kanonisches EN-16931-Rechnungsmodell für UBL 2.1 (Invoice & CreditNote) und UN/CEFACT CII (CrossIndustryInvoice).
 * Extrahiert alle Geschäftsbegriffe (BT/BG) samt Zeilennummern und Festkomma-Werten.
 */
import { XmlNode } from "./xml.js";
export type InvoiceSyntax = "UBL_INVOICE" | "UBL_CREDIT_NOTE" | "CII";
export interface AllowanceChargeEntry {
    istZuschlag: boolean;
    betragCent: number;
    betragScaled: bigint;
    betragRaw: string;
    basisBetragCent: number | null;
    prozentScaled: bigint | null;
    grund: string | null;
    steuerKategorie: string | null;
    steuersatzScaled: bigint | null;
    zeile: number;
}
export interface InvoiceLineEntry {
    id: string;
    zeile: number;
    name: string | null;
    beschreibung: string | null;
    mengeScaled: bigint | null;
    mengeRaw: string | null;
    einheit: string | null;
    einzelpreisNettoScaled: bigint | null;
    einzelpreisRaw: string | null;
    basismengeScaled: bigint;
    zeilenNettoCent: number | null;
    zeilenNettoScaled: bigint | null;
    zeilenNettoRaw: string | null;
    zeilenNettoZeile: number;
    nachlaesse: AllowanceChargeEntry[];
    zuschlaege: AllowanceChargeEntry[];
    steuerKategorie: string | null;
    steuersatzScaled: bigint | null;
}
export interface TaxSubtotalEntry {
    kategorie: string | null;
    satzScaled: bigint | null;
    satzRaw: string | null;
    basisCent: number | null;
    basisScaled: bigint | null;
    steuerCent: number | null;
    steuerScaled: bigint | null;
    befreiungsgrund: string | null;
    zeile: number;
}
export interface NoteEntry {
    subjectCode: string | null;
    text: string;
    zeile: number;
}
export interface PrecedingInvoiceEntry {
    nummer: string;
    datum: string | null;
    zeile: number;
}
export interface AttachmentEntry {
    id: string | null;
    typcode: string | null;
    beschreibung: string | null;
    dateiname: string | null;
    mimeCode: string | null;
    hatEingebettetesObjekt: boolean;
    uri: string | null;
    zeile: number;
}
export interface MonetaryTotals {
    positionenNettoSummeCent: number | null;
    positionenNettoZeile: number;
    nachlaesseSummeCent: number | null;
    nachlaesseZeile: number;
    zuschlaegeSummeCent: number | null;
    zuschlaegeZeile: number;
    steuerbasisSummeCent: number | null;
    steuerbasisZeile: number;
    steuerSummeCent: number | null;
    steuerSummeZeile: number;
    bruttoSummeCent: number | null;
    bruttoZeile: number;
    vorausbezahltCent: number | null;
    vorausbezahltZeile: number;
    rundungsbetragCent: number | null;
    rundungZeile: number;
    zahlbetragCent: number | null;
    zahlbetragZeile: number;
    ungueltigeZahlenfelder: Array<{
        feld: string;
        wert: string;
        zeile: number;
    }>;
}
export interface NormalizedInvoice {
    syntax: InvoiceSyntax;
    wurzelZeile: number;
    profilId: string | null;
    geschaeftsprozessId: string | null;
    rechnungsnummer: string | null;
    ausstellungsdatum: string | null;
    typcode: string | null;
    typcodeZeile: number;
    waehrung: string | null;
    kaeuferreferenz: string | null;
    lieferdatum: string | null;
    abrechnungszeitraumVon: string | null;
    abrechnungszeitraumBis: string | null;
    verkaeuferName: string | null;
    verkaeuferUstId: string | null;
    verkaeuferSteuernummer: string | null;
    kaeuferName: string | null;
    kaeuferUstId: string | null;
    notizen: NoteEntry[];
    vorherigeRechnungen: PrecedingInvoiceEntry[];
    anhaenge: AttachmentEntry[];
    dokumentNachlaesse: AllowanceChargeEntry[];
    dokumentZuschlaege: AllowanceChargeEntry[];
    steuerAufschluesselung: TaxSubtotalEntry[];
    positionen: InvoiceLineEntry[];
    summen: MonetaryTotals;
}
/** Erkennt UBL 2.1 (Invoice / CreditNote) oder UN/CEFACT CII anhand des Wurzelelements und extrahiert das Modell. */
export declare function extractInvoiceModel(root: XmlNode): NormalizedInvoice;
