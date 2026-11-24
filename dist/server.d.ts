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
import { McpServer } from "@modelcontextprotocol/server";
import { BmfCheckResult } from "./bmf2026.js";
import { Pdfa3XmpCheckResult } from "./pdfa3Xmp.js";
import { ShopwareStornoCheckResult } from "./shopwareStorno.js";
import { GaebParseResult } from "./gaebParser.js";
export declare const SERVER_NAME = "fudaut-erechnung-bmf-mcp";
export declare const SERVER_VERSION = "1.0.0";
/** Löst einen relativen Pfad sicher innerhalb von basisOrdner auf; weist Ausbrüche und Symlinks/Junctions nach draussen ab. */
export declare function sichereDateiImOrdner(basisReal: string, pfadEingabe: string): {
    vollPfad: string;
    relativ: string;
    bytes: Buffer;
};
export declare function formatiereBmfBericht(r: BmfCheckResult): string;
export declare function formatiereXmpBericht(r: Pdfa3XmpCheckResult): string;
export declare function formatiereStornoBericht(r: ShopwareStornoCheckResult): string;
export declare function formatiereGaebBericht(r: GaebParseResult): string;
export declare function createErechnungMcpServer(customRootDir?: string): McpServer;
export declare function startStdioServer(customRootDir?: string): void;
