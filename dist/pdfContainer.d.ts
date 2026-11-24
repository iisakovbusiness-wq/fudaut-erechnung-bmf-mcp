/**
 * Deterministischer PDF/A-3-Container-Inspektor für hybride ZUGFeRD- und Factur-X-Dokumente.
 * Extrahiert XMP-Metadaten-Streams, eingebettete XML-Dateien (/Filespec -> /EF), /GTS_PDFA1 und /AF.
 * Unterstützt unkomprimierte sowie /FlateDecode-komprimierte PDF-Streams über node:zlib.
 */
export interface ExtractedPdfAttachment {
    dateiname: string;
    afRelationship: string | null;
    mimeType: string | null;
    inhaltUtf8: string;
    bytes: number;
}
export interface PdfInspectionResult {
    istPdf: boolean;
    pdfVersion: string | null;
    hatGtsPdfa1: boolean;
    hatAfArray: boolean;
    xmpXml: string | null;
    anhaenge: ExtractedPdfAttachment[];
    warnungen: string[];
}
/** Inspiziert einen PDF-Puffer auf PDF/A-3-Merkmale, XMP-Metadaten und eingebettete XML-Rechnungen. */
export declare function inspectPdfContainer(pdfBytes: Buffer): PdfInspectionResult;
