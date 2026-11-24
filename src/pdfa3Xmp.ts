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

import { extractInvoiceModel } from "./invoiceModel.js";
import { centsAlsDeutsch } from "./math.js";
import { inspectPdfContainer } from "./pdfContainer.js";
import { XmlNode, XmlParseError, descendantsByLocal, parseXmlDocument } from "./xml.js";
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

const PDFAID_NS = "http://www.aiim.org/pdfa/ns/id/";
const PDFA_EXT_NS = "http://www.aiim.org/pdfa/ns/extension/";
const PDFA_SCHEMA_NS = "http://www.aiim.org/pdfa/ns/schema#";
const PDFA_PROP_NS = "http://www.aiim.org/pdfa/ns/property#";

const ZUGFERD_SCHEMAS: Record<string, { name: string; erlaubteVersionen: string[] }> = {
  "urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#": {
    name: "Factur-X 1.0 / ZUGFeRD 2.1.1-2.3",
    erlaubteVersionen: ["1.0"],
  },
  "urn:zugferd:pdfa:CrossIndustryDocument:invoice:2p0#": {
    name: "ZUGFeRD 2.0",
    erlaubteVersionen: ["2p0", "2.0"],
  },
  "urn:ferd:pdfa:CrossIndustryDocument:invoice:1p0#": {
    name: "ZUGFeRD 1.0",
    erlaubteVersionen: ["1.0"],
  },
};

const STANDARD_ATTACHMENT_NAMES = new Set([
  "factur-x.xml",
  "zugferd-invoice.xml",
  "xrechnung.xml",
  "ZUGFeRD-invoice.xml",
]);

const VALID_CONFORMANCE_LEVELS = new Set([
  "MINIMUM",
  "BASIC WL",
  "BASIC",
  "CONFORT",
  "EN 16931",
  "EXTENDED",
  "XRECHNUNG",
]);

const REQUIRED_EXTENSION_PROPS = ["DocumentFileName", "DocumentType", "Version", "ConformanceLevel"];

function readRdfProperty(descriptions: XmlNode[], localName: string, allowedNs?: Set<string>): { value: string | null; ns: string | null; zeile: number } {
  for (const desc of descriptions) {
    // 1. Als Attribut auf rdf:Description
    for (const attr of desc.attrList) {
      if (attr.localName === localName && (!allowedNs || allowedNs.has(attr.ns))) {
        return { value: attr.value.trim(), ns: attr.ns, zeile: desc.line };
      }
    }
    // 2. Als Kindelement unter rdf:Description
    for (const child of desc.children) {
      if (child.localName === localName && (!allowedNs || allowedNs.has(child.ns))) {
        return { value: child.text.trim(), ns: child.ns, zeile: child.line };
      }
    }
  }
  return { value: null, ns: null, zeile: descriptions[0]?.line ?? 1 };
}

function readNodeField(node: XmlNode, localName: string, expectedNs: string): string | null {
  for (const attr of node.attrList) {
    if (attr.localName === localName && (!attr.ns || attr.ns === expectedNs)) {
      return attr.value.trim();
    }
  }
  for (const child of node.children) {
    if (child.localName === localName && (!child.ns || child.ns === expectedNs)) {
      return child.text.trim();
    }
  }
  return null;
}

export interface CheckZugferdXmpInput {
  pdfBytes?: Buffer;
  xmpXml?: string;
  embeddedXml?: string;
  erwartetNettoCent?: number;
  erwartetBruttoCent?: number;
  erwartetZahlbetragCent?: number;
}

export function checkZugferdPdfa3Xmp(input: CheckZugferdXmpInput): Pdfa3XmpCheckResult {
  const befunde: XmpFinding[] = [];
  let wawi86919Betroffen = false;

  let xmpRaw = input.xmpXml ?? null;
  let embeddedXmlRaw = input.embeddedXml ?? null;
  let hatGtsPdfa1: boolean | null = null;
  let hatAfArray: boolean | null = null;
  let dateinamenImPdf: string[] = [];
  const eingabeTyp: "PDF" | "XMP_XML" = input.pdfBytes ? "PDF" : "XMP_XML";

  if (input.pdfBytes) {
    const pdf = inspectPdfContainer(input.pdfBytes);
    if (!pdf.istPdf) {
      return {
        ok: false,
        wawi86919Betroffen: false,
        eingabeTyp,
        pdfa: { part: null, conformance: null, hatGtsPdfa1: false, hatAfArray: false },
        zugferdXmp: {
          erkanntesSchemaUri: null,
          documentType: null,
          documentFileName: null,
          version: null,
          conformanceLevel: null,
          extensionSchemaDeklariert: false,
          deklarierteProperties: [],
        },
        eingebettetesXml: {
          vorhanden: false,
          dateinamenImPdf: [],
          rechnungsnummer: null,
          typcode: null,
          waehrung: null,
          nettoCent: null,
          bruttoCent: null,
          zahlbetragCent: null,
        },
        fehlerAnzahl: 1,
        warnungAnzahl: 0,
        befunde: [{ stufe: "fehler", code: "PDF_UNGUELTIG", feld: "PDF", zeile: 1, meldung: "Kein gültiger %PDF-Header in den übergebenen Bytes gefunden." }],
      };
    }

    hatGtsPdfa1 = pdf.hatGtsPdfa1;
    hatAfArray = pdf.hatAfArray;
    dateinamenImPdf = pdf.anhaenge.map((a) => a.dateiname);

    for (const w of pdf.warnungen) {
      befunde.push({ stufe: "warnung", code: "PDF_STREAM_WARNUNG", feld: "PDF/Stream", zeile: 1, meldung: w });
    }

    if (!pdf.hatGtsPdfa1) {
      befunde.push({
        stufe: "warnung",
        code: "PDFA3_OUTPUT_INTENT_FEHLT",
        feld: "PDF/OutputIntents",
        zeile: 1,
        meldung: "PDF enthält keinen /GTS_PDFA1 OutputIntent für die Langzeitarchivierung nach ISO 19005-3.",
      });
    }
    if (!pdf.hatAfArray) {
      befunde.push({
        stufe: "warnung",
        code: "PDFA3_AF_EINTRAG_FEHLT",
        feld: "PDF/AF",
        zeile: 1,
        meldung: "Im PDF-Katalog fehlt das /AF-Array (Associated Files) für eingebettete PDF/A-3-Dateien.",
      });
    }

    if (!xmpRaw) xmpRaw = pdf.xmpXml;

    const xmlAnhang =
      pdf.anhaenge.find((a) => STANDARD_ATTACHMENT_NAMES.has(a.dateiname)) ??
      pdf.anhaenge.find((a) => /\.xml$/i.test(a.dateiname));

    if (!xmlAnhang) {
      befunde.push({
        stufe: "fehler",
        code: "PDFA3_EMBEDDED_XML_FEHLT",
        feld: "PDF/EmbeddedFiles",
        zeile: 1,
        meldung: "Im PDF/A-3-Container fehlt die eingebettete E-Rechnungs-XML-Datei (factur-x.xml, zugferd-invoice.xml oder xrechnung.xml).",
      });
    } else if (!embeddedXmlRaw) {
      embeddedXmlRaw = xmlAnhang.inhaltUtf8;
      if (!xmlAnhang.afRelationship) {
        befunde.push({
          stufe: "warnung",
          code: "PDFA3_AF_RELATIONSHIP_FEHLT",
          feld: "PDF/Filespec/AFRelationship",
          zeile: 1,
          meldung: `Eingebettete Datei "${xmlAnhang.dateiname}" besitzt kein /AFRelationship-Attribut (/Alternative, /Data oder /Source).`,
        });
      }
    }
  }

  // XMP parsen und auf PDF/A-3 sowie WAWI-86919 prüfen
  let part: string | null = null;
  let conformance: string | null = null;
  let erkanntesSchemaUri: string | null = null;
  let documentType: string | null = null;
  let documentFileName: string | null = null;
  let version: string | null = null;
  let conformanceLevel: string | null = null;
  let extensionSchemaDeklariert = false;
  const deklarierteProperties = new Set<string>();

  if (!xmpRaw || !xmpRaw.trim()) {
    wawi86919Betroffen = true;
    befunde.push({
      stufe: "fehler",
      code: "PDFA3_XMP_FEHLT",
      feld: "XMP",
      zeile: 1,
      meldung: "Im Dokument fehlen die XMP-Metadaten vollständig; ZUGFeRD/Factur-X erfordert einen PDF/A-3-XMP-Stream.",
    });
  } else {
    // <?xpacket ...?> Umhüllung ist reguläre Processing Instruction für unseren XML-Parser; falls nach </x:xmpmeta> Padding folgt, zuschneiden
    let cleanXmp = xmpRaw;
    const endMeta = cleanXmp.indexOf("</x:xmpmeta>");
    if (endMeta >= 0) {
      const startMeta = cleanXmp.indexOf("<x:xmpmeta");
      if (startMeta >= 0) cleanXmp = cleanXmp.slice(startMeta, endMeta + "</x:xmpmeta>".length);
    }

    try {
      const xmpRoot = parseXmlDocument(cleanXmp);
      const descriptions = [
        ...(xmpRoot.localName === "Description" ? [xmpRoot] : []),
        ...descendantsByLocal(xmpRoot, "Description"),
      ];

      // 1. pdfaid:part & pdfaid:conformance
      const pdfaidSet = new Set([PDFAID_NS]);
      const partProp = readRdfProperty(descriptions, "part", pdfaidSet);
      const confProp = readRdfProperty(descriptions, "conformance", pdfaidSet);
      part = partProp.value;
      conformance = confProp.value;

      if (part !== "3") {
        befunde.push({
          stufe: "fehler",
          code: "PDFA3_PDFAID_UNGUELTIG",
          feld: "pdfaid:part",
          zeile: partProp.zeile,
          meldung: `PDF/A-Teilkennung pdfaid:part ist "${part ?? "nicht gesetzt"}", erforderlich für hybride E-Rechnungen ist "3" (PDF/A-3 nach ISO 19005-3).`,
        });
      }
      if (!conformance || !["A", "B", "U"].includes(conformance.toUpperCase())) {
        befunde.push({
          stufe: "fehler",
          code: "PDFA3_CONFORMANCE_UNGUELTIG",
          feld: "pdfaid:conformance",
          zeile: confProp.zeile,
          meldung: `pdfaid:conformance ist "${conformance ?? "nicht gesetzt"}", erwartet wird A, B oder U.`,
        });
      }

      // 2. Factur-X / ZUGFeRD XMP-Eigenschaften lesen
      const zfUris = new Set(Object.keys(ZUGFERD_SCHEMAS));
      const dtProp = readRdfProperty(descriptions, "DocumentType", zfUris);
      const fnProp = readRdfProperty(descriptions, "DocumentFileName", zfUris);
      const verProp = readRdfProperty(descriptions, "Version", zfUris);
      const clProp = readRdfProperty(descriptions, "ConformanceLevel", zfUris);

      // Falls jemand einen unbekannten fx:/zf:-Namensraum benutzt hat, auch ohne URI-Filter prüfen
      const fallbackDt = dtProp.value === null ? readRdfProperty(descriptions, "DocumentType") : dtProp;
      const fallbackFn = fnProp.value === null ? readRdfProperty(descriptions, "DocumentFileName") : fnProp;
      const fallbackVer = verProp.value === null ? readRdfProperty(descriptions, "Version") : verProp;
      const fallbackCl = clProp.value === null ? readRdfProperty(descriptions, "ConformanceLevel") : clProp;

      erkanntesSchemaUri = dtProp.ns ?? fnProp.ns ?? verProp.ns ?? clProp.ns ?? fallbackDt.ns ?? fallbackFn.ns;
      documentType = dtProp.value ?? fallbackDt.value;
      documentFileName = fnProp.value ?? fallbackFn.value;
      version = verProp.value ?? fallbackVer.value;
      conformanceLevel = clProp.value ?? fallbackCl.value;

      if (!erkanntesSchemaUri || !ZUGFERD_SCHEMAS[erkanntesSchemaUri]) {
        wawi86919Betroffen = true;
        befunde.push({
          stufe: "fehler",
          code: "JTL_WAWI_86919_ZUGFERD_NAMESPACE_FEHLT",
          feld: "xmlns:fx / xmlns:zf",
          zeile: descriptions[0]?.line ?? 1,
          meldung: `Kein gültiger Factur-X/ZUGFeRD-XMP-Namensraum gefunden ("${erkanntesSchemaUri ?? "fehlt"}"). Erwartet wird z. B. "urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#".`,
        });
      }

      // WAWI-86919 Kernpruefung 1: Version in XMP-Metadaten fehlt, ist leer oder passt nicht zum Schema!
      const schemaSpec = erkanntesSchemaUri ? ZUGFERD_SCHEMAS[erkanntesSchemaUri] : undefined;
      if (!version) {
        wawi86919Betroffen = true;
        befunde.push({
          stufe: "fehler",
          code: "JTL_WAWI_86919_XMP_VERSION_FEHLT",
          feld: "fx:Version / zf:Version",
          zeile: fallbackVer.zeile,
          meldung: "WAWI-86919 erkannt: Das Pflichtfeld fx:Version bzw. zf:Version in den PDF/A-3-XMP-Metadaten fehlt oder ist leer. Strenge Eingangsvalidatoren weisen die ZUGFeRD-PDF als ungültig ab.",
        });
      } else if (schemaSpec && !schemaSpec.erlaubteVersionen.includes(version)) {
        wawi86919Betroffen = true;
        befunde.push({
          stufe: "fehler",
          code: "JTL_WAWI_86919_XMP_VERSION_UNGUELTIG",
          feld: "fx:Version / zf:Version",
          zeile: fallbackVer.zeile,
          meldung: `WAWI-86919 erkannt: Ungültiger XMP-Versionswert "${version}" für ${schemaSpec.name} (${erkanntesSchemaUri}). Zulässig ist: ${schemaSpec.erlaubteVersionen.join(", ")}.`,
        });
      }

      if (!documentType || !["INVOICE", "CREDIT NOTE"].includes(documentType)) {
        wawi86919Betroffen = true;
        befunde.push({
          stufe: "fehler",
          code: "PDFA3_XMP_DOCUMENT_TYPE_UNGUELTIG",
          feld: "fx:DocumentType",
          zeile: fallbackDt.zeile,
          meldung: `XMP DocumentType ist "${documentType ?? "nicht gesetzt"}", zulässig sind ausschließlich "INVOICE" oder "CREDIT NOTE".`,
        });
      }

      if (!documentFileName) {
        wawi86919Betroffen = true;
        befunde.push({
          stufe: "fehler",
          code: "PDFA3_XMP_FILENAME_FEHLT",
          feld: "fx:DocumentFileName",
          zeile: fallbackFn.zeile,
          meldung: "XMP DocumentFileName fehlt (z. B. factur-x.xml oder xrechnung.xml).",
        });
      } else if (input.pdfBytes && dateinamenImPdf.length > 0 && !dateinamenImPdf.includes(documentFileName)) {
        befunde.push({
          stufe: "fehler",
          code: "PDFA3_XMP_FILENAME_WIDERSPRUCH",
          feld: "fx:DocumentFileName",
          zeile: fallbackFn.zeile,
          meldung: `XMP DocumentFileName nennt "${documentFileName}", im PDF eingebettet ist jedoch: ${dateinamenImPdf.join(", ")}.`,
        });
      }

      if (!conformanceLevel || !VALID_CONFORMANCE_LEVELS.has(conformanceLevel)) {
        befunde.push({
          stufe: "fehler",
          code: "PDFA3_XMP_CONFORMANCE_LEVEL_UNGUELTIG",
          feld: "fx:ConformanceLevel",
          zeile: fallbackCl.zeile,
          meldung: `XMP ConformanceLevel ist "${conformanceLevel ?? "nicht gesetzt"}", erwartet wird einer der Werte: ${[...VALID_CONFORMANCE_LEVELS].join(", ")}.`,
        });
      }

      // 3. WAWI-86919 Kernpruefung 2: PDF/A-3 Extension Schema (pdfaExtension:schemas)
      const schemasNodes = descendantsByLocal(xmpRoot, "schemas").filter((n) => !n.ns || n.ns === PDFA_EXT_NS);
      for (const sn of schemasNodes) {
        for (const li of descendantsByLocal(sn, "li")) {
          const nsUri = readNodeField(li, "namespaceURI", PDFA_SCHEMA_NS);
          if (nsUri && (nsUri === erkanntesSchemaUri || Boolean(ZUGFERD_SCHEMAS[nsUri]))) {
            extensionSchemaDeklariert = true;
            for (const propNode of descendantsByLocal(li, "property")) {
              for (const propLi of descendantsByLocal(propNode, "li")) {
                const propName = readNodeField(propLi, "name", PDFA_PROP_NS);
                if (propName) deklarierteProperties.add(propName);
              }
            }
          }
        }
      }

      if (!extensionSchemaDeklariert) {
        wawi86919Betroffen = true;
        befunde.push({
          stufe: "fehler",
          code: "JTL_WAWI_86919_EXTENSION_SCHEMA_FEHLT",
          feld: "pdfaExtension:schemas",
          zeile: descriptions[0]?.line ?? 1,
          meldung: "WAWI-86919 / PDF/A-3-Schemafehler: In den XMP-Metadaten fehlt die erforderliche pdfaExtension:schemas-Deklaration für den Factur-X-/ZUGFeRD-Namensraum nach ISO 19005-3.",
        });
      } else {
        const fehlendeProps = REQUIRED_EXTENSION_PROPS.filter((p) => !deklarierteProperties.has(p));
        if (fehlendeProps.length > 0) {
          wawi86919Betroffen = true;
          befunde.push({
            stufe: "fehler",
            code: "JTL_WAWI_86919_EXTENSION_PROPERTIES_UNVOLLSTAENDIG",
            feld: "pdfaSchema:property",
            zeile: descriptions[0]?.line ?? 1,
            meldung: `WAWI-86919 / PDF/A-3-Schemafehler: Im pdfaExtension:schemas-Block fehlen folgende Pflicht-Property-Definitionen: ${fehlendeProps.join(", ")}.`,
          });
        }
      }
    } catch (err) {
      const line = err instanceof XmlParseError ? err.line : 1;
      befunde.push({
        stufe: "fehler",
        code: "PDFA3_XMP_XML_DEFEKT",
        feld: "XMP",
        zeile: line,
        meldung: `XMP-Metadaten sind kein wohlgeformtes XML: ${(err as Error).message}`,
      });
    }
  }

  // 4. Eingebettetes Rechnungs-XML prüfen und gegen XMP & erwartete Referenzbetraege abgleichen
  let rechnungsnummer: string | null = null;
  let typcode: string | null = null;
  let waehrung: string | null = null;
  let nettoCent: number | null = null;
  let bruttoCent: number | null = null;
  let zahlbetragCent: number | null = null;

  if (embeddedXmlRaw && embeddedXmlRaw.trim()) {
    try {
      const invRoot = parseXmlDocument(embeddedXmlRaw);
      const inv = extractInvoiceModel(invRoot);
      rechnungsnummer = inv.rechnungsnummer;
      typcode = inv.typcode;
      waehrung = inv.waehrung ?? "EUR";
      nettoCent = inv.summen.steuerbasisSummeCent;
      bruttoCent = inv.summen.bruttoSummeCent;
      zahlbetragCent = inv.summen.zahlbetragCent;

      // XMP DocumentType vs. XML BT-3
      const istXmlCreditNote = inv.typcode === "381" || inv.syntax === "UBL_CREDIT_NOTE";
      if (documentType === "INVOICE" && istXmlCreditNote) {
        befunde.push({
          stufe: "fehler",
          code: "PDFA3_DOKUMENTTYP_WIDERSPRUCH",
          feld: "fx:DocumentType / BT-3",
          zeile: inv.typcodeZeile,
          meldung: "XMP meldet DocumentType=\"INVOICE\", das eingebettete XML ist jedoch eine Gutschrift (Typcode 381 / CreditNote).",
        });
      } else if (documentType === "CREDIT NOTE" && !istXmlCreditNote && inv.typcode !== "384") {
        befunde.push({
          stufe: "fehler",
          code: "PDFA3_DOKUMENTTYP_WIDERSPRUCH",
          feld: "fx:DocumentType / BT-3",
          zeile: inv.typcodeZeile,
          meldung: `XMP meldet DocumentType="CREDIT NOTE", das eingebettete XML hat jedoch Typcode "${inv.typcode ?? "unbekannt"}".`,
        });
      }

      // Interne Summenkonsistenz im eingebetteten XML
      const bt110 = inv.summen.steuerSummeCent ?? 0;
      const bt113 = inv.summen.vorausbezahltCent ?? 0;
      const bt114 = inv.summen.rundungsbetragCent ?? 0;
      if (nettoCent !== null && bruttoCent !== null && nettoCent + bt110 !== bruttoCent) {
        befunde.push({
          stufe: "fehler",
          code: "PDFA3_XML_BRUTTO_INKONSISTENT",
          feld: "BT-109/BT-110/BT-112",
          zeile: inv.summen.bruttoZeile,
          meldung: `Im eingebetteten XML ergibt Steuerbasis (${centsAlsDeutsch(nettoCent, waehrung)}) plus Steuer (${centsAlsDeutsch(bt110, waehrung)}) nicht den Bruttobetrag (${centsAlsDeutsch(bruttoCent, waehrung)}).`,
        });
      }
      if (bruttoCent !== null && zahlbetragCent !== null && bruttoCent - bt113 + bt114 !== zahlbetragCent) {
        befunde.push({
          stufe: "fehler",
          code: "PDFA3_XML_ZAHLBETRAG_INKONSISTENT",
          feld: "BT-112/BT-113/BT-115",
          zeile: inv.summen.zahlbetragZeile,
          meldung: `Im eingebetteten XML stimmt Zahlbetrag BT-115 (${centsAlsDeutsch(zahlbetragCent, waehrung)}) nicht mit Brutto minus Vorauszahlung überein.`,
        });
      }

      // Abgleich gegen optionale Referenzsummen (z. B. aus Belegbild / ERP-Datensatz)
      if (input.erwartetNettoCent !== undefined && nettoCent !== null && input.erwartetNettoCent !== nettoCent) {
        befunde.push({
          stufe: "fehler",
          code: "PDFA3_SUMMEN_ABWEICHUNG_NETTO",
          feld: "BT-109",
          zeile: inv.summen.steuerbasisZeile,
          meldung: `Eingebetteter XML-Nettobetrag (${centsAlsDeutsch(nettoCent, waehrung)}) weicht vom erwarteten Nettobetrag (${centsAlsDeutsch(input.erwartetNettoCent, waehrung)}) ab.`,
        });
      }
      if (input.erwartetBruttoCent !== undefined && bruttoCent !== null && input.erwartetBruttoCent !== bruttoCent) {
        befunde.push({
          stufe: "fehler",
          code: "PDFA3_SUMMEN_ABWEICHUNG_BRUTTO",
          feld: "BT-112",
          zeile: inv.summen.bruttoZeile,
          meldung: `Eingebetteter XML-Bruttobetrag (${centsAlsDeutsch(bruttoCent, waehrung)}) weicht vom erwarteten Bruttobetrag (${centsAlsDeutsch(input.erwartetBruttoCent, waehrung)}) ab.`,
        });
      }
      if (input.erwartetZahlbetragCent !== undefined && zahlbetragCent !== null && input.erwartetZahlbetragCent !== zahlbetragCent) {
        befunde.push({
          stufe: "fehler",
          code: "PDFA3_SUMMEN_ABWEICHUNG_ZAHLBETRAG",
          feld: "BT-115",
          zeile: inv.summen.zahlbetragZeile,
          meldung: `Eingebetteter XML-Zahlbetrag (${centsAlsDeutsch(zahlbetragCent, waehrung)}) weicht vom erwarteten Zahlbetrag (${centsAlsDeutsch(input.erwartetZahlbetragCent, waehrung)}) ab.`,
        });
      }
    } catch (err) {
      const line = err instanceof XmlParseError ? err.line : 1;
      befunde.push({
        stufe: "fehler",
        code: "PDFA3_EMBEDDED_XML_DEFEKT",
        feld: "EmbeddedXML",
        zeile: line,
        meldung: `Eingebettetes Rechnungs-XML konnte nicht gelesen werden: ${(err as Error).message}`,
      });
    }
  }

  const fehlerAnzahl = befunde.filter((b) => b.stufe === "fehler").length;
  const warnungAnzahl = befunde.filter((b) => b.stufe === "warnung").length;

  return {
    ok: fehlerAnzahl === 0,
    wawi86919Betroffen,
    eingabeTyp,
    pdfa: {
      part,
      conformance,
      hatGtsPdfa1,
      hatAfArray,
    },
    zugferdXmp: {
      erkanntesSchemaUri,
      documentType,
      documentFileName,
      version,
      conformanceLevel,
      extensionSchemaDeklariert,
      deklarierteProperties: [...deklarierteProperties],
    },
    eingebettetesXml: {
      vorhanden: Boolean(embeddedXmlRaw && embeddedXmlRaw.trim()),
      dateinamenImPdf,
      rechnungsnummer,
      typcode,
      waehrung,
      nettoCent,
      bruttoCent,
      zahlbetragCent,
    },
    fehlerAnzahl,
    warnungAnzahl,
    befunde,
  };
}
