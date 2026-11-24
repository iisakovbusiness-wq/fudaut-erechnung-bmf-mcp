/**
 * Deterministischer, XXE-sicherer XML-Baum-Parser ohne externe Abhängigkeiten.
 * Bewahrt Zeilennummern, Namensräume (xmlns) und Reihenfolge für UBL 2.1, UN/CEFACT CII, Adobe XMP und GAEB DA XML.
 */
export interface XmlAttribute {
    name: string;
    prefix: string;
    localName: string;
    ns: string;
    value: string;
}
export interface XmlNode {
    name: string;
    prefix: string;
    localName: string;
    ns: string;
    attrs: Record<string, string>;
    attrList: XmlAttribute[];
    children: XmlNode[];
    text: string;
    line: number;
}
export declare class XmlParseError extends Error {
    readonly line: number;
    readonly code: string;
    constructor(code: string, message: string, line: number);
}
export declare function decodeXmlEntities(input: string, line?: number): string;
/** Parst ein XML-Dokument in den Wurzelknoten; lehnt <!ENTITY (XXE / Billion Laughs) strikt ab. */
export declare function parseXmlDocument(rawInput: string): XmlNode;
/** Erstes direktes Kind mit passendem localName. */
export declare function childByLocal(node: XmlNode | null | undefined, localName: string): XmlNode | undefined;
/** Alle direkten Kinder mit passendem localName. */
export declare function childrenByLocal(node: XmlNode | null | undefined, localName: string): XmlNode[];
/** Pfad aus mehreren localNames nacheinander auflösen. */
export declare function pathByLocal(node: XmlNode | null | undefined, ...localNames: string[]): XmlNode | undefined;
/** Textinhalt entlang eines localName-Pfads (oder null). */
export declare function textAtPath(node: XmlNode | null | undefined, ...localNames: string[]): string | null;
/** Alle Nachfahren mit passendem localName in Dokumentreihenfolge. */
export declare function descendantsByLocal(node: XmlNode | null | undefined, localName: string): XmlNode[];
/** Sammelt gesamten sichtbaren Text eines Teilbaums (z. B. für HTML-artige GAEB-Langtexte). */
export declare function collectPlainText(node: XmlNode | null | undefined): string;
/** Attributwert anhand localName (optional gefiltert nach Namespace-URI). */
export declare function attrByLocal(node: XmlNode | null | undefined, localName: string, nsUri?: string): string | null;
