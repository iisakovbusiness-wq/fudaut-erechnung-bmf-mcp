#!/usr/bin/env node
/**
 * server.ts: Lokaler stdio-MCP-Server für deutsche E-Rechnungs-, JTL-PDF/A-3-XMP-, Shopware-Storno- und GAEB-Prüfungen.
 *
 * Sicherheitsgrenzen im Serverprozess:
 *   1. Strikte Ordnergrenze (ERECHNUNG_ORDNER, Standard: Arbeitsverzeichnis). Alle Dateipfade werden samt realpathSync
 *      gegen diesen Wurzelordner geprüft; "..", Pfade außerhalb sowie symbolische Verknüpfungen/Junctions nach draussen
 *      werden abgewiesen. Dateien über 20 MB werden nicht gelesen.
 *   2. Rein lesender Betrieb (readOnlyHint: true auf allen vier Werkzeugen, 0 Schreibzugriffe, 0 Netzwerkaufrufe).
 *   3. Datensparsames Protokoll auf stderr (Zeitpunkt, Werkzeug, Quelle, Kurzstatus; niemals Kundennamen, Texte oder Beträge).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as z from "zod/v4";
import { McpServer } from "@modelcontextprotocol/server";
import { serveStdio } from "@modelcontextprotocol/server/stdio";
import { checkBmf2026Erechnung } from "./bmf2026.js";
import { checkZugferdPdfa3Xmp } from "./pdfa3Xmp.js";
import { checkShopwareStornoMath } from "./shopwareStorno.js";
import { parseGaebXml } from "./gaebParser.js";
import { centsAlsDeutsch } from "./math.js";
export const SERVER_NAME = "fudaut-erechnung-bmf-mcp";
export const SERVER_VERSION = "1.0.0";
const MAX_FILE_SIZE = 20 * 1024 * 1024;
function schreibeProtokoll(werkzeug, quelle, ergebnis) {
    console.error(JSON.stringify({
        zeit: new Date().toISOString(),
        werkzeug,
        quelle,
        ergebnis,
    }));
}
/** Löst einen relativen Pfad sicher innerhalb von basisOrdner auf; weist Ausbrüche und Symlinks/Junctions nach draussen ab. */
export function sichereDateiImOrdner(basisReal, pfadEingabe) {
    const voll = path.resolve(basisReal, String(pfadEingabe));
    const pruefeDrinnen = (zielPfad) => {
        const rel = path.relative(basisReal, zielPfad);
        if (rel === "" || rel.startsWith("..") || path.isAbsolute(rel)) {
            throw new Error(`Der Pfad "${pfadEingabe}" liegt nicht im freigegebenen Ordner.`);
        }
    };
    pruefeDrinnen(voll);
    if (!fs.existsSync(voll)) {
        throw new Error(`Die Datei "${pfadEingabe}" existiert im freigegebenen Ordner nicht.`);
    }
    const echt = fs.realpathSync(voll);
    pruefeDrinnen(echt);
    const stat = fs.statSync(echt);
    if (!stat.isFile()) {
        throw new Error(`"${pfadEingabe}" ist keine reguläre Datei.`);
    }
    if (stat.size > MAX_FILE_SIZE) {
        throw new Error(`"${pfadEingabe}" ist größer als 20 MB und wird nicht geladen.`);
    }
    return {
        vollPfad: echt,
        relativ: path.relative(basisReal, echt).replaceAll("\\", "/"),
        bytes: fs.readFileSync(echt),
    };
}
export function formatiereBmfBericht(r) {
    const kopf = [
        `Status: ${r.ok ? "BESTANDEN (0 Fehler)" : `NICHT BESTANDEN (${r.fehlerAnzahl} Fehler, ${r.warnungAnzahl} Warnungen)`}`,
        `Format: ${r.syntax ?? "unbekannt"} (${r.quelleTyp}), Typcode BT-3: ${r.typcode ?? "?"}, Positionen: ${r.positionenAnzahl}, Anhänge BG-24: ${r.anhaengeAnzahl}`,
        `Summen: Netto BT-109 = ${r.summen.bt109SteuerbasisCent !== null ? centsAlsDeutsch(r.summen.bt109SteuerbasisCent, r.waehrung) : "?"}, Brutto BT-112 = ${r.summen.bt112BruttoCent !== null ? centsAlsDeutsch(r.summen.bt112BruttoCent, r.waehrung) : "?"}, Vorausgezahlt BT-113 = ${centsAlsDeutsch(r.summen.bt113VorausbezahltCent, r.waehrung)}, Zahlbetrag BT-115 = ${r.summen.zahlbetragDeutsch ?? "?"}`,
    ];
    if (r.befunde.length > 0) {
        kopf.push(...r.befunde.map((b) => `[${b.stufe.toUpperCase()}] ${b.code} (${b.feld}, Zeile ${b.zeile}): ${b.meldung}`));
    }
    return kopf.join("\n");
}
export function formatiereXmpBericht(r) {
    const kopf = [
        `Status: ${r.ok ? "BESTANDEN (PDF/A-3 XMP & XML konsistent)" : `NICHT BESTANDEN (${r.fehlerAnzahl} Fehler, ${r.warnungAnzahl} Warnungen)`}`,
        `WAWI-86919 betroffen: ${r.wawi86919Betroffen ? "JA" : "nein"} | PDF/A: ${r.pdfa.part ?? "?"}${r.pdfa.conformance ?? ""} | Extension-Schema deklariert: ${r.zugferdXmp.extensionSchemaDeklariert ? "ja" : "nein"}`,
        `XMP: DocumentType=${r.zugferdXmp.documentType ?? "fehlt"}, DocumentFileName=${r.zugferdXmp.documentFileName ?? "fehlt"}, Version=${r.zugferdXmp.version ?? "fehlt"}, ConformanceLevel=${r.zugferdXmp.conformanceLevel ?? "fehlt"}`,
        `Eingebettetes XML: ${r.eingebettetesXml.vorhanden ? `ja (${r.eingebettetesXml.dateinamenImPdf.join(", ") || "inline"}, Zahlbetrag ${r.eingebettetesXml.zahlbetragCent !== null ? centsAlsDeutsch(r.eingebettetesXml.zahlbetragCent, r.eingebettetesXml.waehrung ?? "EUR") : "?"})` : "FEHLT"}`,
    ];
    if (r.befunde.length > 0) {
        kopf.push(...r.befunde.map((b) => `[${b.stufe.toUpperCase()}] ${b.code} (${b.feld}, Zeile ${b.zeile}): ${b.meldung}`));
    }
    return kopf.join("\n");
}
export function formatiereStornoBericht(r) {
    const kopf = [
        `Status: ${r.ok ? "BESTANDEN (0 Vorzeichen- und Rundungsfehler)" : `NICHT BESTANDEN (${r.fehlerAnzahl} Fehler: ${r.vorzeichenfehlerAnzahl} Vorzeichen, ${r.rundungsfehlerAnzahl} Rundung > 0,01 EUR)`}`,
        `Format: ${r.syntax ?? "unbekannt"}, Typcode: ${r.typcode ?? "?"}, Bezugsrechnungen BT-25: ${r.bezugsrechnungen.length > 0 ? r.bezugsrechnungen.join(", ") : "keine"}, Max. Rundungsdrift: ${centsAlsDeutsch(r.maxRundungsdriftCent, r.waehrung)}`,
    ];
    if (r.befunde.length > 0) {
        kopf.push(...r.befunde.map((b) => `[${b.stufe.toUpperCase()}] ${b.code} (${b.feld}, Zeile ${b.zeile}): ${b.meldung}`));
    }
    return kopf.join("\n");
}
export function formatiereGaebBericht(r) {
    const kopf = [
        `Status: ${r.ok ? "BESTANDEN" : `ABWEICHUNG / FEHLER (${r.fehlerAnzahl} Fehler, ${r.warnungAnzahl} Warnungen)`}`,
        `GAEB-Phase: ${r.kopf.dateiphase} (${r.kopf.phasenBezeichnung}), Version ${r.kopf.gaebVersion ?? "?"}, Projekt: ${r.kopf.projektname ?? r.kopf.projektnummer ?? "?"}`,
        `Positionen: ${r.summen.positionenGesamt} gesamt (${r.summen.bepreistePositionen} bepreist), Berechnet Netto: ${r.summen.berechneteNettoDeutsch}, Ausgewiesen Netto: ${r.summen.ausgewieseneNettoDeutsch ?? "nicht ausgewiesen"}${r.summen.abweichungNettoCent !== null ? `, Differenz: ${centsAlsDeutsch(r.summen.abweichungNettoCent, r.kopf.waehrung)}` : ""}`,
    ];
    if (r.befunde.length > 0) {
        kopf.push(...r.befunde.map((b) => `[${b.stufe.toUpperCase()}] ${b.code}${b.oz ? ` (OZ ${b.oz})` : ""} (Zeile ${b.zeile}): ${b.meldung}`));
    }
    return kopf.join("\n");
}
const STUFE_ENUM = z.enum(["fehler", "warnung", "hinweis"]);
export function createErechnungMcpServer(customRootDir) {
    const basisReal = fs.realpathSync(path.resolve(customRootDir ?? process.env.ERECHNUNG_ORDNER ?? process.cwd()));
    const server = new McpServer({ name: SERVER_NAME, version: SERVER_VERSION });
    // Werkzeug 1: check_bmf_2026_erechnung
    server.registerTool("check_bmf_2026_erechnung", {
        title: "BMF 15.10.2026 & EN 16931 E-Rechnung prüfen",
        description: "Prüft XRechnung 3.0 und ZUGFeRD 2.3 (UBL 2.1 Invoice/CreditNote, UN/CEFACT CII XML oder hybride PDF/A-3) deterministisch auf EN-16931-Kernarithmetik (BT-106, BT-109, BT-110, BT-112, BT-115), die Sonderregeln des BMF-Schreibens vom 15.10.2026 für Bau-/SHK-Abschlags- und Schlussrechnungen (BT-113 Vorauszahlung, Einzelaufstellung in BT-22/BT-25 oder Anhang BG-24, konkrete Leistungsbeschreibung BT-153/BT-154 bzw. LV-Anhang BG-24) sowie Storno-/Gutschrifts-Typcodes (381/384/389) und Rabatt-Vorzeichenfehler. Rein lokal, keine externen APIs.",
        inputSchema: z.object({
            pfad: z
                .string()
                .min(1)
                .optional()
                .describe("Relativer Dateipfad innerhalb von ERECHNUNG_ORDNER (.xml oder hybrides .pdf)"),
            xml: z
                .string()
                .min(1)
                .optional()
                .describe("Direkter XML-Inhalt (UBL 2.1 oder UN/CEFACT CII), falls keine Datei über pfad gelesen wird"),
        }),
        outputSchema: z.object({
            ok: z.boolean(),
            quelleTyp: z.enum(["XML", "PDF_HYBRID"]),
            syntax: z.string().nullable(),
            profilId: z.string().nullable(),
            rechnungsnummer: z.string().nullable(),
            ausstellungsdatum: z.string().nullable(),
            typcode: z.string().nullable(),
            istBauOderAbschlagKontext: z.boolean(),
            istSchlussrechnung: z.boolean(),
            istKorrekturOderGutschrift: z.boolean(),
            waehrung: z.string(),
            summen: z.object({
                bt106PositionenNettoCent: z.number().nullable(),
                bt107NachlaesseCent: z.number(),
                bt108ZuschlaegeCent: z.number(),
                bt109SteuerbasisCent: z.number().nullable(),
                bt110SteuerCent: z.number().nullable(),
                bt112BruttoCent: z.number().nullable(),
                bt113VorausbezahltCent: z.number(),
                bt115ZahlbetragCent: z.number().nullable(),
                zahlbetragDeutsch: z.string().nullable(),
                zahlbetragIso: z.string().nullable(),
            }),
            positionenAnzahl: z.number(),
            anhaengeAnzahl: z.number(),
            fehlerAnzahl: z.number(),
            warnungAnzahl: z.number(),
            befunde: z.array(z.object({
                stufe: STUFE_ENUM,
                code: z.string(),
                feld: z.string(),
                zeile: z.number(),
                meldung: z.string(),
            })),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ pfad, xml }) => {
        const quelleLabel = pfad ? pfad : "inline-xml";
        try {
            if (!pfad && !xml) {
                throw new Error("Bitte entweder 'pfad' (Datei im freigegebenen Ordner) oder 'xml' angeben.");
            }
            let result;
            let logQuelle = "inline-xml";
            if (pfad) {
                const datei = sichereDateiImOrdner(basisReal, pfad);
                logQuelle = datei.relativ;
                const istPdf = datei.bytes.subarray(0, 5).toString("latin1") === "%PDF-" || /\.pdf$/i.test(pfad);
                result = istPdf
                    ? checkBmf2026Erechnung({ pdfBytes: datei.bytes })
                    : checkBmf2026Erechnung({ xml: datei.bytes.toString("utf8") });
            }
            else {
                result = checkBmf2026Erechnung({ xml });
            }
            schreibeProtokoll("check_bmf_2026_erechnung", logQuelle, result.ok ? "ok" : `${result.fehlerAnzahl} Fehler, ${result.warnungAnzahl} Warnungen`);
            return {
                content: [{ type: "text", text: formatiereBmfBericht(result) }],
                structuredContent: result,
            };
        }
        catch (err) {
            schreibeProtokoll("check_bmf_2026_erechnung", quelleLabel, "Aufruffehler");
            return {
                content: [{ type: "text", text: `Fehler: ${err.message}` }],
                isError: true,
            };
        }
    });
    // Werkzeug 2: check_zugferd_pdfa3_xmp
    server.registerTool("check_zugferd_pdfa3_xmp", {
        title: "ZUGFeRD / Factur-X PDF/A-3 XMP & JTL WAWI-86919 prüfen",
        description: "Analysiert rohe PDF/A-3-Dateien oder XMP-Metadaten gezielt auf den JTL-Wawi-Fehler WAWI-86919 (leeres oder fehlerhaftes fx:Version / zf:Version-Feld, fehlendes pdfaExtension:schemas für Factur-X/ZUGFeRD, fehlendes eingebettetes factur-x.xml/zugferd-invoice.xml) sowie Dokumenttyp- und Summenabweichungen zwischen XMP, eingebettetem XML und optionalen Referenzbeträgen.",
        inputSchema: z.object({
            pfad: z
                .string()
                .min(1)
                .optional()
                .describe("Relativer Pfad zu einer .pdf- oder .xmp/.xml-Metadatendatei im freigegebenen Ordner"),
            pdfBase64: z
                .string()
                .min(1)
                .optional()
                .describe("Base64-kodierte PDF/A-3-Bytes (falls kein Dateipfad genutzt wird)"),
            xmpXml: z
                .string()
                .min(1)
                .optional()
                .describe("Direkter XMP-Metadaten-XML-Text (falls separat ohne PDF geprüft wird)"),
            embeddedXml: z
                .string()
                .min(1)
                .optional()
                .describe("Optionales eingebettetes Rechnungs-XML zum Abgleich bei reiner XMP-Prüfung"),
            erwartetNettoCent: z.number().int().optional().describe("Optionaler erwarteter Nettobetrag in Cent (z. B. aus Belegbild/ERP)"),
            erwartetBruttoCent: z.number().int().optional().describe("Optionaler erwarteter Bruttobetrag in Cent"),
            erwartetZahlbetragCent: z.number().int().optional().describe("Optionaler erwarteter Zahlbetrag in Cent"),
        }),
        outputSchema: z.object({
            ok: z.boolean(),
            wawi86919Betroffen: z.boolean(),
            eingabeTyp: z.enum(["PDF", "XMP_XML"]),
            pdfa: z.object({
                part: z.string().nullable(),
                conformance: z.string().nullable(),
                hatGtsPdfa1: z.boolean().nullable(),
                hatAfArray: z.boolean().nullable(),
            }),
            zugferdXmp: z.object({
                erkanntesSchemaUri: z.string().nullable(),
                documentType: z.string().nullable(),
                documentFileName: z.string().nullable(),
                version: z.string().nullable(),
                conformanceLevel: z.string().nullable(),
                extensionSchemaDeklariert: z.boolean(),
                deklarierteProperties: z.array(z.string()),
            }),
            eingebettetesXml: z.object({
                vorhanden: z.boolean(),
                dateinamenImPdf: z.array(z.string()),
                rechnungsnummer: z.string().nullable(),
                typcode: z.string().nullable(),
                waehrung: z.string().nullable(),
                nettoCent: z.number().nullable(),
                bruttoCent: z.number().nullable(),
                zahlbetragCent: z.number().nullable(),
            }),
            fehlerAnzahl: z.number(),
            warnungAnzahl: z.number(),
            befunde: z.array(z.object({
                stufe: STUFE_ENUM,
                code: z.string(),
                feld: z.string(),
                zeile: z.number(),
                meldung: z.string(),
            })),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ pfad, pdfBase64, xmpXml, embeddedXml, erwartetNettoCent, erwartetBruttoCent, erwartetZahlbetragCent }) => {
        const quelleLabel = pfad ? pfad : pdfBase64 ? "inline-pdf-base64" : "inline-xmp";
        try {
            if (!pfad && !pdfBase64 && !xmpXml) {
                throw new Error("Bitte 'pfad', 'pdfBase64' oder 'xmpXml' angeben.");
            }
            let logQuelle = quelleLabel;
            let result;
            if (pfad) {
                const datei = sichereDateiImOrdner(basisReal, pfad);
                logQuelle = datei.relativ;
                const istPdf = datei.bytes.subarray(0, 5).toString("latin1") === "%PDF-" || /\.pdf$/i.test(pfad);
                result = istPdf
                    ? checkZugferdPdfa3Xmp({
                        pdfBytes: datei.bytes,
                        embeddedXml,
                        erwartetNettoCent,
                        erwartetBruttoCent,
                        erwartetZahlbetragCent,
                    })
                    : checkZugferdPdfa3Xmp({
                        xmpXml: datei.bytes.toString("utf8"),
                        embeddedXml,
                        erwartetNettoCent,
                        erwartetBruttoCent,
                        erwartetZahlbetragCent,
                    });
            }
            else if (pdfBase64) {
                const buf = Buffer.from(pdfBase64, "base64");
                if (buf.length > MAX_FILE_SIZE)
                    throw new Error("Dekodierte PDF überschreitet 20 MB.");
                result = checkZugferdPdfa3Xmp({
                    pdfBytes: buf,
                    embeddedXml,
                    erwartetNettoCent,
                    erwartetBruttoCent,
                    erwartetZahlbetragCent,
                });
            }
            else {
                result = checkZugferdPdfa3Xmp({
                    xmpXml,
                    embeddedXml,
                    erwartetNettoCent,
                    erwartetBruttoCent,
                    erwartetZahlbetragCent,
                });
            }
            schreibeProtokoll("check_zugferd_pdfa3_xmp", logQuelle, result.ok ? "ok" : `wawi86919=${result.wawi86919Betroffen}, ${result.fehlerAnzahl} Fehler`);
            return {
                content: [{ type: "text", text: formatiereXmpBericht(result) }],
                structuredContent: result,
            };
        }
        catch (err) {
            schreibeProtokoll("check_zugferd_pdfa3_xmp", quelleLabel, "Aufruffehler");
            return {
                content: [{ type: "text", text: `Fehler: ${err.message}` }],
                isError: true,
            };
        }
    });
    // Werkzeug 3: check_shopware_storno_math
    server.registerTool("check_shopware_storno_math", {
        title: "Shopware 6 B2B Storno-, Gutschrifts- & Rundungspruefung",
        description: "Prüft B2B-Gutschriften (381), Rechnungskorrekturen (384), Stornos, Positionen und Dokument-/Positionsnachlaesse (BG-20/BG-21, BG-27/BG-28) in UBL 2.1 und UN/CEFACT CII auf Vorzeichenumkehr, negative Einzelpreise (BR-27), fehlende Bezugsrechnungen (BT-25) und Brutto-zu-Netto-Rundungsdrift > 0,01 EUR.",
        inputSchema: z.object({
            pfad: z.string().min(1).optional().describe("Relativer Pfad zur Rechnungs-/Gutschrifts-XML-Datei im freigegebenen Ordner"),
            xml: z.string().min(1).optional().describe("Direkter XML-Inhalt (UBL 2.1 oder UN/CEFACT CII)"),
        }),
        outputSchema: z.object({
            ok: z.boolean(),
            syntax: z.string().nullable(),
            rechnungsnummer: z.string().nullable(),
            typcode: z.string().nullable(),
            istStornoOderGutschrift: z.boolean(),
            bezugsrechnungen: z.array(z.string()),
            waehrung: z.string(),
            maxRundungsdriftCent: z.number(),
            vorzeichenfehlerAnzahl: z.number(),
            rundungsfehlerAnzahl: z.number(),
            fehlerAnzahl: z.number(),
            warnungAnzahl: z.number(),
            positionenPruefung: z.array(z.object({
                id: z.string(),
                zeile: z.number(),
                menge: z.string().nullable(),
                einzelpreisNetto: z.string().nullable(),
                ausgewiesenNettoCent: z.number().nullable(),
                berechnetNettoCent: z.number().nullable(),
                abweichungCent: z.number(),
            })),
            summen: z.object({
                bt106AusgewiesenCent: z.number().nullable(),
                bt106BerechnetCent: z.number(),
                bt107NachlaesseCent: z.number(),
                bt108ZuschlaegeCent: z.number(),
                bt109AusgewiesenCent: z.number().nullable(),
                bt109BerechnetCent: z.number(),
                bt110AusgewiesenCent: z.number().nullable(),
                bt110BerechnetCent: z.number(),
                bt112AusgewiesenCent: z.number().nullable(),
                bt115AusgewiesenCent: z.number().nullable(),
            }),
            befunde: z.array(z.object({
                stufe: STUFE_ENUM,
                code: z.string(),
                feld: z.string(),
                zeile: z.number(),
                abweichungCent: z.number(),
                meldung: z.string(),
            })),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ pfad, xml }) => {
        const quelleLabel = pfad ? pfad : "inline-xml";
        try {
            if (!pfad && !xml) {
                throw new Error("Bitte entweder 'pfad' oder 'xml' angeben.");
            }
            let logQuelle = "inline-xml";
            let xmlText = xml ?? "";
            if (pfad) {
                const datei = sichereDateiImOrdner(basisReal, pfad);
                logQuelle = datei.relativ;
                xmlText = datei.bytes.toString("utf8");
            }
            const result = checkShopwareStornoMath(xmlText);
            schreibeProtokoll("check_shopware_storno_math", logQuelle, result.ok ? "ok" : `${result.vorzeichenfehlerAnzahl} Vorzeichen-, ${result.rundungsfehlerAnzahl} Rundungsfehler`);
            return {
                content: [{ type: "text", text: formatiereStornoBericht(result) }],
                structuredContent: result,
            };
        }
        catch (err) {
            schreibeProtokoll("check_shopware_storno_math", quelleLabel, "Aufruffehler");
            return {
                content: [{ type: "text", text: `Fehler: ${err.message}` }],
                isError: true,
            };
        }
    });
    // Werkzeug 4: parse_gaeb_xml
    const GAEB_CATEGORY_SCHEMA = z.lazy(() => z.object({
        id: z.string().nullable(),
        ozTeil: z.string(),
        pfadOz: z.string(),
        bezeichnung: z.string(),
        positionenAnzahl: z.number(),
        berechneteSummeCent: z.number(),
        ausgewieseneSummeCent: z.number().nullable(),
        abweichungCent: z.number().nullable(),
        untergruppen: z.array(GAEB_CATEGORY_SCHEMA),
    }));
    server.registerTool("parse_gaeb_xml", {
        title: "GAEB DA XML (X83/X84/X86) nach ERP-JSON parsen",
        description: "Parst GAEB DA XML Leistungsverzeichnisse (X83 Angebotsaufforderung, X84 Angebotsabgabe, X86 Auftragserteilung; Versionen 3.2 und 3.3) in sauberes, strukturiertes ERP-JSON inklusive Projekt-/Vergabekopf, Los-/Titel-Hierarchie, Ordnungszahl (OZ), Menge, Einheit, Einheitspreis (EP), Gesamtpreis (GP) sowie exaktem Abgleich zwischen berechneter und ausgewiesener Gesamtsumme.",
        inputSchema: z.object({
            pfad: z
                .string()
                .min(1)
                .optional()
                .describe("Relativer Pfad zur GAEB-Datei (.x83, .x84, .x86, .xml) im freigegebenen Ordner"),
            xml: z.string().min(1).optional().describe("Direkter GAEB-DA-XML-Inhalt"),
            dateiname: z.string().optional().describe("Optionaler Dateiname als Phasen-Hinweis (z. B. angebot.x84) bei direkter XML-Übergabe"),
        }),
        outputSchema: z.object({
            ok: z.boolean(),
            kopf: z.object({
                dateiphase: z.string(),
                phasenBezeichnung: z.string(),
                gaebVersion: z.string().nullable(),
                datum: z.string().nullable(),
                waehrung: z.string(),
                projektnummer: z.string().nullable(),
                projektname: z.string().nullable(),
                vergabenummer: z.string().nullable(),
                lvBezeichnung: z.string().nullable(),
                auftraggeber: z.string().nullable(),
                auftragnehmer: z.string().nullable(),
                ozEbenenLaengen: z.array(z.number()),
            }),
            gruppen: z.array(GAEB_CATEGORY_SCHEMA),
            positionen: z.array(z.object({
                id: z.string().nullable(),
                zeile: z.number(),
                oz: z.string(),
                gruppeOz: z.string(),
                gruppeBezeichnung: z.string(),
                positionsart: z.enum(["Normalposition", "Bedarfsposition", "BedarfspositionMitSumme", "Alternativposition"]),
                zaehltInGesamtsumme: z.boolean(),
                kurztext: z.string(),
                langtext: z.string().nullable(),
                menge: z.string().nullable(),
                einheit: z.string().nullable(),
                epText: z.string().nullable(),
                epCent: z.number().nullable(),
                gpAusgewiesenCent: z.number().nullable(),
                gpAusgewiesenIso: z.string().nullable(),
                gpBerechnetCent: z.number().nullable(),
                gpBerechnetIso: z.string().nullable(),
                abweichungCent: z.number().nullable(),
                nurEinheitspreis: z.boolean(),
                steuersatzProzent: z.string().nullable(),
            })),
            summen: z.object({
                positionenGesamt: z.number(),
                bepreistePositionen: z.number(),
                preiseErwartet: z.boolean(),
                berechneteNettoCent: z.number(),
                berechneteNettoIso: z.string(),
                berechneteNettoDeutsch: z.string(),
                ausgewieseneNettoCent: z.number().nullable(),
                ausgewieseneNettoIso: z.string().nullable(),
                ausgewieseneNettoDeutsch: z.string().nullable(),
                abweichungNettoCent: z.number().nullable(),
                steuersatzProzent: z.string().nullable(),
                ausgewieseneBruttoCent: z.number().nullable(),
                berechneteBruttoCent: z.number().nullable(),
            }),
            fehlerAnzahl: z.number(),
            warnungAnzahl: z.number(),
            befunde: z.array(z.object({
                stufe: STUFE_ENUM,
                code: z.string(),
                oz: z.string().nullable(),
                zeile: z.number(),
                meldung: z.string(),
            })),
        }),
        annotations: { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
    }, async ({ pfad, xml, dateiname }) => {
        const quelleLabel = pfad ? pfad : (dateiname ?? "inline-gaeb");
        try {
            if (!pfad && !xml) {
                throw new Error("Bitte entweder 'pfad' oder 'xml' angeben.");
            }
            let logQuelle = quelleLabel;
            let xmlText = xml ?? "";
            let hintName = dateiname;
            if (pfad) {
                const datei = sichereDateiImOrdner(basisReal, pfad);
                logQuelle = datei.relativ;
                xmlText = datei.bytes.toString("utf8");
                hintName = pfad;
            }
            const result = parseGaebXml(xmlText, hintName);
            schreibeProtokoll("parse_gaeb_xml", logQuelle, result.ok ? `${result.summen.positionenGesamt} Positionen` : `${result.fehlerAnzahl} Fehler`);
            return {
                content: [{ type: "text", text: formatiereGaebBericht(result) }],
                structuredContent: result,
            };
        }
        catch (err) {
            schreibeProtokoll("parse_gaeb_xml", quelleLabel, "Aufruffehler");
            return {
                content: [{ type: "text", text: `Fehler: ${err.message}` }],
                isError: true,
            };
        }
    });
    return server;
}
export function startStdioServer(customRootDir) {
    const basisReal = fs.realpathSync(path.resolve(customRootDir ?? process.env.ERECHNUNG_ORDNER ?? process.cwd()));
    const handle = serveStdio(() => createErechnungMcpServer(basisReal));
    console.error(`${SERVER_NAME}: bereit auf stdio, Ordner ${basisReal}, Modus lesend`);
    process.on("SIGINT", () => {
        void handle.close();
    });
}
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(thisFile)) {
    startStdioServer();
}
