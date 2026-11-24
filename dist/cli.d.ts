#!/usr/bin/env node
/**
 * cli.ts: Kommandozeilen-Werkzeug UND stdio-MCP-Starter für fudaut-erechnung-bmf-mcp.
 * - Ohne Argumente (oder mit "serve" / "mcp"): startet den MCP-Server auf stdio (kompatibel mit npx in Claude/Cursor/Windsurf).
 * - Mit Unterbefehl (check-bmf, check-xmp, check-storno, parse-gaeb): prüft/parst Dateien lokal und setzt Exit-Code 0/1/2.
 */
export declare function runCli(argv: string[]): number;
