#!/usr/bin/env node
/**
 * cli.ts: Kommandozeilen-Werkzeug UND stdio-MCP-Starter für fudaut-erechnung-bmf-mcp.
 * - Ohne Argumente (oder mit "serve" / "mcp"): startet den MCP-Server auf stdio (kompatibel mit npx in Claude/Cursor/Windsurf).
 * - Mit Unterbefehl (check-bmf, check-xmp, check-storno, parse-gaeb): prüft/parst Dateien lokal und setzt Exit-Code 0/1/2.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { checkBmf2026Erechnung } from "./bmf2026.js";
import { checkZugferdPdfa3Xmp } from "./pdfa3Xmp.js";
import { checkShopwareStornoMath } from "./shopwareStorno.js";
import { parseGaebXml } from "./gaebParser.js";
import { SERVER_NAME, SERVER_VERSION, formatiereBmfBericht, formatiereGaebBericht, formatiereStornoBericht, formatiereXmpBericht, startStdioServer, } from "./server.js";
const HILFE = `${SERVER_NAME} v${SERVER_VERSION}
Lokaler MCP-Server (stdio) und CLI für BMF 15.10.2026 E-Rechnungen, JTL WAWI-86919 PDF/A-3 XMP, Shopware 6 Stornos und GAEB DA XML.

Verwendung:
  fudaut-erechnung-bmf-mcp                         Startet den MCP-Server über stdio
  fudaut-erechnung-bmf-mcp serve                   Startet den MCP-Server über stdio
  fudaut-erechnung-bmf-mcp check-bmf <datei> [--json]
  fudaut-erechnung-bmf-mcp check-xmp <datei> [--xml <rechnungs.xml>] [--brutto-cent <n>] [--json]
  fudaut-erechnung-bmf-mcp check-storno <datei> [--json]
  fudaut-erechnung-bmf-mcp parse-gaeb <datei> [--json]
  fudaut-erechnung-bmf-mcp --version | --help

Exit-Codes im CLI-Modus:
  0  Prüfung / Parsing ohne Fehler bestanden
  1  Fachlicher oder struktureller Befund in der geprüften Datei (ok = false)
  2  Aufruf- oder Dateifehler
`;
function leseOption(args, flag) {
    const idx = args.indexOf(flag);
    if (idx >= 0 && idx + 1 < args.length)
        return args[idx + 1];
    return undefined;
}
export function runCli(argv) {
    if (argv.length === 0 || argv[0] === "serve" || argv[0] === "mcp") {
        startStdioServer();
        return 0;
    }
    const cmd = argv[0];
    if (cmd === "--help" || cmd === "-h" || cmd === "help") {
        process.stdout.write(HILFE);
        return 0;
    }
    if (cmd === "--version" || cmd === "-v") {
        process.stdout.write(`${SERVER_VERSION}\n`);
        return 0;
    }
    const alsJson = argv.includes("--json");
    const posArgs = argv.slice(1).filter((a, idx, arr) => {
        if (a.startsWith("--"))
            return false;
        const prev = idx > 0 ? arr[idx - 1] : "";
        if (prev === "--xml" || prev === "--netto-cent" || prev === "--brutto-cent" || prev === "--zahlbetrag-cent") {
            return false;
        }
        return true;
    });
    const dateiArg = posArgs[0];
    if (!dateiArg) {
        process.stderr.write(`Fehler: Dateipfad fehlt für "${cmd}". Hilfe mit --help.\n`);
        return 2;
    }
    const vollPfad = path.resolve(process.cwd(), dateiArg);
    if (!fs.existsSync(vollPfad) || !fs.statSync(vollPfad).isFile()) {
        process.stderr.write(`Fehler: Datei "${dateiArg}" nicht gefunden.\n`);
        return 2;
    }
    try {
        const bytes = fs.readFileSync(vollPfad);
        if (cmd === "check-bmf" || cmd === "check_bmf_2026_erechnung") {
            const istPdf = bytes.subarray(0, 5).toString("latin1") === "%PDF-" || /\.pdf$/i.test(vollPfad);
            const res = istPdf ? checkBmf2026Erechnung({ pdfBytes: bytes }) : checkBmf2026Erechnung({ xml: bytes.toString("utf8") });
            process.stdout.write(alsJson ? `${JSON.stringify(res, null, 2)}\n` : `${formatiereBmfBericht(res)}\n`);
            return res.ok ? 0 : 1;
        }
        if (cmd === "check-xmp" || cmd === "check_zugferd_pdfa3_xmp") {
            const xmlOpt = leseOption(argv, "--xml");
            const embeddedXml = xmlOpt ? fs.readFileSync(path.resolve(process.cwd(), xmlOpt), "utf8") : undefined;
            const nettoOpt = leseOption(argv, "--netto-cent");
            const bruttoOpt = leseOption(argv, "--brutto-cent");
            const zahlOpt = leseOption(argv, "--zahlbetrag-cent");
            const istPdf = bytes.subarray(0, 5).toString("latin1") === "%PDF-" || /\.pdf$/i.test(vollPfad);
            const res = checkZugferdPdfa3Xmp({
                ...(istPdf ? { pdfBytes: bytes } : { xmpXml: bytes.toString("utf8") }),
                embeddedXml,
                erwartetNettoCent: nettoOpt !== undefined ? Number.parseInt(nettoOpt, 10) : undefined,
                erwartetBruttoCent: bruttoOpt !== undefined ? Number.parseInt(bruttoOpt, 10) : undefined,
                erwartetZahlbetragCent: zahlOpt !== undefined ? Number.parseInt(zahlOpt, 10) : undefined,
            });
            process.stdout.write(alsJson ? `${JSON.stringify(res, null, 2)}\n` : `${formatiereXmpBericht(res)}\n`);
            return res.ok ? 0 : 1;
        }
        if (cmd === "check-storno" || cmd === "check_shopware_storno_math") {
            const res = checkShopwareStornoMath(bytes.toString("utf8"));
            process.stdout.write(alsJson ? `${JSON.stringify(res, null, 2)}\n` : `${formatiereStornoBericht(res)}\n`);
            return res.ok ? 0 : 1;
        }
        if (cmd === "parse-gaeb" || cmd === "parse_gaeb_xml") {
            const res = parseGaebXml(bytes.toString("utf8"), path.basename(vollPfad));
            process.stdout.write(alsJson ? `${JSON.stringify(res, null, 2)}\n` : `${formatiereGaebBericht(res)}\n`);
            return res.ok ? 0 : 1;
        }
        process.stderr.write(`Fehler: Unbekannter Befehl "${cmd}". Hilfe mit --help.\n`);
        return 2;
    }
    catch (err) {
        process.stderr.write(`Fehler: ${err.message}\n`);
        return 2;
    }
}
const thisFile = fileURLToPath(import.meta.url);
if (process.argv[1] && fs.existsSync(process.argv[1]) && fs.realpathSync(process.argv[1]) === fs.realpathSync(thisFile)) {
    const code = runCli(process.argv.slice(2));
    if (process.argv.slice(2).length > 0 && process.argv[2] !== "serve" && process.argv[2] !== "mcp") {
        process.exitCode = code;
    }
}
