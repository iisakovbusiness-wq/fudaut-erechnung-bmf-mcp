# fudaut-erechnung-bmf-mcp

**MIT-licensed Model Context Protocol (MCP) server and CLI for deterministic German B2B e-invoicing validation (BMF circular of 15.10.2026, EN 16931, XRechnung 3.0, ZUGFeRD 2.3), JTL-Wawi `WAWI-86919` PDF/A-3 XMP inspection, Shopware 6 B2B credit note math, and GAEB DA XML (`X83`/`X84`/`X86`) to ERP-JSON parsing.**

[English](#english) | [Deutsch](#deutsch)

[![Glama MCP Server](https://glama.ai/mcp/servers/iisakovbusiness-wq/fudaut-erechnung-bmf-mcp/badges/score.svg)](https://glama.ai/mcp/servers/iisakovbusiness-wq/fudaut-erechnung-bmf-mcp)

> **Free Browser Validator (100 % client-side, zero upload, `0 EUR`):** Test XRechnung, ZUGFeRD `PDF/A-3` (`WAWI-86919`), Shopware credit notes, and GAEB `X83`/`X84`/`X86` directly in the browser without installing Node.js:
> https://www.fudaut.com/en/e-rechnung-check
>
> **Kostenloser Browser-Prüfer (100 % lokal im Browser, null Upload, `0 €`):** XRechnung, ZUGFeRD `PDF/A-3` (`WAWI-86919`), Shopware-Gutschriften und GAEB `X83`/`X84`/`X86` sofort ohne Installation im Browser prüfen:
> https://www.fudaut.com/de/e-rechnung-check

---

## English

`fudaut-erechnung-bmf-mcp` gives MCP-compatible AI assistants (Claude Desktop, Claude Code, Cursor, Windsurf, custom MCP hosts) and CI pipelines four deterministic local tools for the exact technical edge cases where German B2B e-invoicing and construction/wholesale ERP handoffs fail ahead of the mandatory issuance deadline on `01.01.2027` (for companies above `800,000 EUR` prior-year revenue).

It runs 100 % locally over `stdio` or as a CLI binary, makes zero network calls, uses `BigInt` fixed-point decimal arithmetic (`10^8` scale, zero IEEE-754 float drift), blocks XML External Entity (`<!ENTITY` / XXE) attacks, and enforces strict single-folder path isolation (`ERECHNUNG_ORDNER`). Both users and maintainer Ilia Isakov (Fudaut) pay `0 EUR` in license or external API fees.

**Scope & Legal Boundary (German StBerG):** This software is a purely technical format, metadata, and arithmetic verification utility (`§ 2 Abs. 3 Nr. 2 StBerG`). It provides **no tax advice** (*keine Steuerberatung*, `§ 5 StBerG`) and **no legal advice**. Tax rates, tax exemptions, account assignments, and final commercial release always remain with the operating business and its tax advisor (*Steuerberater*).

### Four MCP Tools & CLI Commands

| MCP Tool | CLI Subcommand | What It Checks / Produces | Modifies Disk |
|---|---|---|---|
| `check_bmf_2026_erechnung` | `check-bmf` | Validates XRechnung 3.0 and ZUGFeRD 2.3 (`UBL 2.1 Invoice/CreditNote`, `UN/CEFACT CII`, or hybrid `PDF/A-3`) for EN 16931 core totals (`BT-106`, `BT-109`, `BT-110`, `BT-112`, `BT-115`), **BMF circular of `15.10.2026`** construction/SHK partial & final invoice rules (`BT-113` prepaid deduction vs. improper negative lines, itemized breakdown in `BT-22`/`BT-25` or attachment `BG-24`, specific line descriptions in `BT-153`/`BT-154` or referenced bill-of-quantities attachment `BG-24`), and credit note / correction type codes (`381`/`384`/`389`) | No (`readOnlyHint: true`) |
| `check_zugferd_pdfa3_xmp` | `check-xmp` | Inspects raw `PDF/A-3` files (including `/FlateDecode` streams) or standalone XMP packets specifically for the **JTL-Wawi `WAWI-86919`** metadata defect (missing/empty/mismatched `fx:Version` or `zf:Version`, missing `pdfaExtension:schemas` declaration for the Factur-X/ZUGFeRD namespace, missing embedded `factur-x.xml`/`zugferd-invoice.xml`), document type mismatches (`INVOICE` vs. `381`), and total deviations | No (`readOnlyHint: true`) |
| `check_shopware_storno_math` | `check-storno` | Audits B2B credit notes (`381`), corrected invoices (`384`), cancellations, line items, and document/line allowances & charges (`BG-20`/`BG-21`, `BG-27`/`BG-28`) for sign inversions (e.g., negative `BG-20` allowances increasing `BT-109`), `BR-27` violations (`BT-146 < 0`), missing preceding invoice references (`BT-25`), and gross-to-net rounding drift `> 0.01 EUR` | No (`readOnlyHint: true`) |
| `parse_gaeb_xml` | `parse-gaeb` | Parses **GAEB DA XML (`X83` tender request, `X84` bid, `X86` contract award; versions `3.2` and `3.3`)** bills of quantities into clean ERP-JSON: project/award header, hierarchical lot/title structure (`BoQCtgy`), full item numbering (`OZ`), quantity, unit, unit price (`EP`), item total (`GP`), optional/contingent item flags (`Provis`), and exact comparison of calculated vs. declared totals | No (`readOnlyHint: true`) |

### Server-Enforced Safety Boundaries

1. **Single-Folder Isolation (`ERECHNUNG_ORDNER`):** All file paths passed to MCP tools are resolved against `ERECHNUNG_ORDNER` (defaults to `process.cwd()`). Parent traversal (`..`), outside paths, and symlinks or Windows junctions pointing outside the root are rejected via `fs.realpathSync`. Files above `20 MB` are refused.
2. **Read-Only & Offline:** Every tool is strictly read-only (`readOnlyHint: true`), writes nothing to disk, and opens zero network connections.
3. **XXE & Zip-Bomb Protection:** `<!ENTITY` declarations in XML `DOCTYPE` blocks are rejected deterministically; `/FlateDecode` PDF streams enforce a hard `20 MB` decompression ceiling.
4. **Redacted Audit Log on `stderr`:** Each MCP call logs one compact JSON line to `stderr` (`zeit`, `werkzeug`, `quelle`, `ergebnis`) without company names, item texts, or monetary amounts.
5. **Exact `BigInt` Fixed-Point Math:** Quantities, unit prices, discounts, and VAT amounts are computed at `10^8` fixed-point precision and commercially rounded half-away-from-zero to integer cents.

### Quickstart & Installation

**Prerequisite:** Node.js `>= 20`.

#### 1. Run Directly via `npx` (Claude Desktop, Claude Code, Cursor, Windsurf)

Works immediately from GitHub without requiring a local clone (and via npm once published):

```json
{
  "mcpServers": {
    "erechnung-bmf": {
      "command": "npx",
      "args": ["-y", "github:iisakovbusiness-wq/fudaut-erechnung-bmf-mcp"],
      "env": {
        "ERECHNUNG_ORDNER": "/absolute/path/to/invoices-and-gaeb"
      }
    }
  }
}
```

Or from a local checkout (recommended for deterministic production environments):

```bash
git clone https://github.com/iisakovbusiness-wq/fudaut-erechnung-bmf-mcp.git
cd fudaut-erechnung-bmf-mcp
npm ci
npm test
```

```json
{
  "mcpServers": {
    "erechnung-bmf": {
      "command": "node",
      "args": ["/absolute/path/to/fudaut-erechnung-bmf-mcp/dist/cli.js"],
      "env": {
        "ERECHNUNG_ORDNER": "/absolute/path/to/invoices-and-gaeb"
      }
    }
  }
}
```

Where to place this JSON snippet:
- **Claude Desktop:** `claude_desktop_config.json`
- **Claude Code:** `.mcp.json` in your project root or `~/.claude.json`
- **Cursor:** `.cursor/mcp.json`
- **Windsurf:** `~/.codeium/windsurf/mcp_config.json`

#### 2. Command-Line Interface (CLI & CI Gate)

When called with a subcommand, `fudaut-erechnung-bmf-mcp` runs as a deterministic CLI validator (`Exit 0` when `ok = true`, `Exit 1` when defects are detected, `Exit 2` on I/O or usage errors):

```bash
# 1. Validate a construction final invoice against BMF 15.10.2026 & EN 16931
npx -y github:iisakovbusiness-wq/fudaut-erechnung-bmf-mcp check-bmf fixtures/bmf-schlussrechnung-valide-ubl.xml

# 2. Detect JTL-Wawi WAWI-86919 PDF/A-3 XMP defects as structured JSON
npx -y github:iisakovbusiness-wq/fudaut-erechnung-bmf-mcp check-xmp fixtures/jtl-wawi-86919-defekt-pdfa3.pdf --json

# 3. Audit a Shopware 6 B2B credit note for BG-20 sign errors and > 0.01 EUR drift
npx -y github:iisakovbusiness-wq/fudaut-erechnung-bmf-mcp check-storno fixtures/shopware-storno-defekt-cii.xml

# 4. Parse a GAEB X84 bid into structured ERP-JSON
npx -y github:iisakovbusiness-wq/fudaut-erechnung-bmf-mcp parse-gaeb fixtures/gaeb-angebot-valide.x84 --json
```

#### 3. Docker Container

```bash
docker build -t fudaut-erechnung-bmf-mcp .
docker run -i --rm -v /path/to/files:/data:ro -e ERECHNUNG_ORDNER=/data fudaut-erechnung-bmf-mcp
```

### Positive-Control Test Suite (`fixtures/` & `test/`)

`npm test` compiles the TypeScript sources (`strict: true`) and runs automated tests (`node --test`) across **11 synthetic reference and defect fixtures** (using strictly fictional `.example` company data):
- **Valid baselines (`0` false positives):** `bmf-schlussrechnung-valide-ubl.xml`, `zugferd-valide-pdfa3.pdf`, `shopware-gutschrift-valide-ubl.xml`, `gaeb-ausschreibung-valide.x83`, `gaeb-angebot-valide.x84`.
- **Injected real-world failure modes (verified `ok: false`):** `bmf-schlussrechnung-defekt-bt113-cii.xml` (missing `BT-113` + generic description), `bmf-lv-pauschal-defekt-ohne-bg24.xml` (missing `BG-24` LV attachment + broken `BT-112`), `jtl-wawi-86919-defekt-pdfa3.pdf` (empty `fx:Version` + missing `pdfaExtension:schemas`), `zugferd-defekt-ohne-xml.pdf` (missing XML attachment), `shopware-storno-defekt-cii.xml` (`BG-20` sign inversion + `BR-27` + rounding drift `> 0.01 EUR`), `gaeb-auftrag-defekt-summe.x86` (item and total sum mismatch).

### Production E-Invoicing & ERP Integration (Fudaut)

This open-source MCP server and CLI remain permanently free (`0 EUR` license and API cost; users pay `0 EUR`, maintainer Ilia Isakov / Fudaut pays `0 EUR` external API fees).

If your business needs an automated production bridge between legacy ERPs, JTL-Wawi, Shopware 6, weclapp, Sage, or GAEB bills of quantities and BMF-compliant e-invoicing before `01.01.2027`, Fudaut builds and operates turnkey pipelines at fixed prices (final prices under `§ 19 UStG`, paid by the direct client to Fudaut):

- **48h Handoff Bridge (`48h-Übergabe-Brücke`):** **`1,450 EUR` fixed price** (direct client pays `725 EUR` at start and `725 EUR` after acceptance on real sample data, 100 % credited toward an implementation package).
- **Turnkey E-Invoicing & ERP Packages:** **`3,900 EUR`** (Package S: single outbound/partial invoice or JTL/Shopware repair bridge), **`7,900 EUR`** (Package M: multi-route pipeline including GAEB/PDF bill-of-quantities extraction and validation), **`12,900 EUR`** (Package L: full end-to-end ERP/DMS integration), paid by the direct client to Fudaut.

Overview (German):
https://www.fudaut.com/de/e-rechnung-automatisieren

Overview (English):
https://www.fudaut.com/en/e-rechnung-automatisieren

---

## Deutsch

`fudaut-erechnung-bmf-mcp` ist ein lokal über `stdio` laufender Open-Source-MCP-Server und Kommandozeilen-Prüfer (MIT-Lizenz, TypeScript / Node.js) für genau die technischen Sonderfälle, an denen deutsche B2B-E-Rechnungen und Bau-/Großhandels-Schnittstellen vor dem gesetzlichen Ausstellungs-Stichtag am `01.01.2027` (für Unternehmen über `800.000 €` Vorjahresumsatz) in der Praxis scheitern.

Der Server arbeitet zu 100 % lokal ohne externe Netzwerk- oder API-Aufrufe, rechnet exakt mit `BigInt`-Festkomma-Arithmetik (`10^8`-Skalierung ohne IEEE-754-Rundungsfehler), blockiert `<!ENTITY`-Angriffe (XXE) und erzwingt eine harte Einzelordner-Grenze (`ERECHNUNG_ORDNER`). Anwender zahlen `0 €` Lizenz- oder API-Kosten, Ilia Isakov (Fudaut) zahlt `0 €` laufende Drittanbieter-API-Kosten.

### Rechtliche Abgrenzung (StBerG) & Systemgrenze

Dieses Projekt ist ein **reines technisches Format-, Metadaten- und Rechenprüfwerkzeug** (`§ 2 Abs. 3 Nr. 2 StBerG`). Es leistet **keine Steuerberatung** (`§ 5 StBerG`), **keine Rechtsberatung** und **keine Kontierung**. Steuersätze, Steuerbefreiungen, Rechnungsfreigaben und Buchungsentscheidungen liegen ausschließlich beim anwendenden Unternehmen und seiner Steuerkanzlei.

### Die vier MCP-Werkzeuge & CLI-Befehle

| MCP-Werkzeug | CLI-Befehl | Geprüfte Regeln & Ergebnis | Schreibt auf Platte |
|---|---|---|---|
| `check_bmf_2026_erechnung` | `check-bmf` | Prüft XRechnung 3.0 und ZUGFeRD 2.3 (`UBL 2.1 Invoice/CreditNote`, `UN/CEFACT CII` sowie hybride `PDF/A-3`-Dateien) auf EN-16931-Kernarithmetik (`BT-106`, `BT-109`, `BT-110`, `BT-112`, `BT-115`), die Vorgaben des **BMF-Schreibens vom `15.10.2026`** zu Bau-/SHK-Abschlags- und Schlussrechnungen (`BT-113` vorausbezahlter Betrag statt bloßer Minusposition, Einzelaufstellung in `BT-22`/`BT-25` oder eingebetteter Anlage `BG-24`, konkrete Leistungsbeschreibung in `BT-153`/`BT-154` bzw. referenzierter LV-Anhang `BG-24`) sowie Storno-/Gutschrifts-Typcodes (`381`/`384`/`389`) und Rabatt-Vorzeichenfehler | nein (`readOnlyHint: true`) |
| `check_zugferd_pdfa3_xmp` | `check-xmp` | Prüft rohe `PDF/A-3`-Dateien (inklusive `/FlateDecode`-komprimierter Streams) oder XMP-Metadaten gezielt auf den offenen **JTL-Wawi-Fehler `WAWI-86919`** (leeres oder unzulässiges `fx:Version`- bzw. `zf:Version`-Feld, fehlendes `pdfaExtension:schemas` für den Factur-X-/ZUGFeRD-Namensraum, fehlendes eingebettetes `factur-x.xml`/`zugferd-invoice.xml`), Dokumenttyp-Widersprüche (`INVOICE` gegen `381`) und Summenabweichungen | nein (`readOnlyHint: true`) |
| `check_shopware_storno_math` | `check-storno` | Prüft B2B-Gutschriften (`381`), Rechnungskorrekturen (`384`), Stornos, Positionen sowie Dokument- und Positionsnachlässe (`BG-20`/`BG-21`, `BG-27`/`BG-28`) auf Vorzeichenumkehr (etwa negative `BG-20`-Rabatte, die `BT-109` erhöhen statt mindern), `BR-27`-Verstöße (`BT-146 < 0`), fehlende Bezugsrechnungen (`BT-25`) und Brutto-zu-Netto-Rundungsdrift `> 0,01 €` | nein (`readOnlyHint: true`) |
| `parse_gaeb_xml` | `parse-gaeb` | Parst **GAEB DA XML (`X83` Angebotsaufforderung, `X84` Angebotsabgabe, `X86` Auftragserteilung; Versionen `3.2` und `3.3`)** Leistungsverzeichnisse in strukturiertes ERP-JSON: Projekt- und Vergabekopf, Los-/Titel-Hierarchie (`BoQCtgy`), vollständige Ordnungszahl (`OZ`), Menge, Einheit, Einheitspreis (`EP`), Gesamtpreis (`GP`), Bedarfspositionen (`Provis`) sowie Abgleich zwischen berechneter und ausgewiesener Gesamtsumme | nein (`readOnlyHint: true`) |

### Installation & Einbindung in MCP-Clients

Voraussetzung: Node.js ab Version `20`.

#### 1. Direktstart über `npx` (Claude Desktop, Claude Code, Cursor, Windsurf)

Sofort ohne lokalen Klon direkt von GitHub nutzbar:

```json
{
  "mcpServers": {
    "erechnung-bmf": {
      "command": "npx",
      "args": ["-y", "github:iisakovbusiness-wq/fudaut-erechnung-bmf-mcp"],
      "env": {
        "ERECHNUNG_ORDNER": "/absoluter/pfad/zum/beleg-und-gaeb-ordner"
      }
    }
  }
}
```

Oder aus einem lokalen Klon für feste Produktionsumgebungen:

```bash
git clone https://github.com/iisakovbusiness-wq/fudaut-erechnung-bmf-mcp.git
cd fudaut-erechnung-bmf-mcp
npm ci
npm test
```

```json
{
  "mcpServers": {
    "erechnung-bmf": {
      "command": "node",
      "args": ["/absoluter/pfad/zu/fudaut-erechnung-bmf-mcp/dist/cli.js"],
      "env": {
        "ERECHNUNG_ORDNER": "/absoluter/pfad/zum/beleg-und-gaeb-ordner"
      }
    }
  }
}
```

Konfigurationsorte der gängigen Clients:
- **Claude Desktop:** `claude_desktop_config.json`
- **Claude Code:** `.mcp.json` im Projektordner oder `~/.claude.json`
- **Cursor:** `.cursor/mcp.json`
- **Windsurf:** `~/.codeium/windsurf/mcp_config.json`

#### 2. Nutzung als CLI und in CI/CD-Pipelines

Mit Unterbefehl arbeitet `fudaut-erechnung-bmf-mcp` als schneller Kommandozeilen-Prüfer (`Exit 0` bei fehlerfreier Datei, `Exit 1` bei fachlichem Befund, `Exit 2` bei Dateifehler):

```bash
# Bau-Schlussrechnung gegen BMF-Schreiben vom 15.10.2026 prüfen
node dist/cli.js check-bmf fixtures/bmf-schlussrechnung-valide-ubl.xml

# Hybride ZUGFeRD-PDF auf JTL WAWI-86919 XMP-Fehler prüfen (JSON-Ausgabe)
node dist/cli.js check-xmp fixtures/jtl-wawi-86919-defekt-pdfa3.pdf --json

# Shopware-6-Storno auf Vorzeichenumkehr und Rundungsdrift > 0,01 EUR prüfen
node dist/cli.js check-storno fixtures/shopware-storno-defekt-cii.xml

# GAEB-X84-Angebot in strukturiertes ERP-JSON umwandeln
node dist/cli.js parse-gaeb fixtures/gaeb-angebot-valide.x84 --json
```

### Projektstruktur & Registry-Metadaten

```text
src/math.ts              Exakte BigInt-Festkomma-Arithmetik (Skalierung 10^8, kaufmännische Rundung)
src/xml.ts               Deterministischer XML-Parser mit Zeilennummern, xmlns und XXE-Sperre
src/invoiceModel.ts      Kanonisches EN-16931-Modell für UBL 2.1 (Invoice/CreditNote) und UN/CEFACT CII
src/pdfContainer.ts      PDF/A-3-Container-Leser (/Metadata, /Filespec, /FlateDecode via node:zlib)
src/bmf2026.ts           Werkzeug 1: BMF-Schreiben 15.10.2026, EN 16931 & Storno-Prüfung
src/pdfa3Xmp.ts          Werkzeug 2: ZUGFeRD / Factur-X PDF/A-3 XMP & JTL WAWI-86919
src/shopwareStorno.ts    Werkzeug 3: Shopware 6 B2B Gutschrifts-, BG-20/21- & Rundungsprüfung
src/gaebParser.ts        Werkzeug 4: GAEB DA XML (X83, X84, X86) nach ERP-JSON samt Summenabgleich
src/server.ts            MCP-Server (stdio), Einzelordner-Grenze (ERECHNUNG_ORDNER), stderr-Protokoll
src/cli.ts               Kombinierter MCP-Starter (0 Argumente) und CLI-Runner
fixtures/                11 synthetische Positiv- und Defekt-Musterdateien (nur .example-Daten)
test/                    Automatisierte Unit-, Positivkontroll-, MCP-stdio- und CLI-Tests (node --test)
server.json              Metadaten nach Official MCP Registry Schema (2025-12-11)
glama.json               Glama-Maintainer-Metadaten
Dockerfile               Mehrstufiges Node-22-Alpine-Image (non-root USER node)
```

### Produktive E-Rechnungs- & ERP-Strecke aufbauen lassen (Fudaut)

Dieses Open-Source-Paket ist unter der MIT-Lizenz dauerhaft kostenlos (`0 €` Lizenz- und API-Kosten; Anwender zahlen `0 €`, Ilia Isakov / Fudaut zahlt `0 €` externe API-Gebühren).

Wenn Ihr Betrieb vor dem `01.01.2027` eine durchgehend automatisierte Brücke zwischen bestehendem ERP, JTL-Wawi, Shopware 6, weclapp, Sage oder GAEB-Leistungsverzeichnissen und BMF-konformen E-Rechnungen benötigt, setzt Fudaut die produktive Strecke zum klaren Festpreis um (Endpreise nach `§ 19 UStG`, jeweils gezahlt vom Direktkunden an Fudaut):

- **48h-Übergabe-Brücke:** **`1.450 €` Festpreis** (Direktkunde zahlt `725 €` bei Start und `725 €` erst nach Abnahme an echten Musterdaten, zu 100 % anrechenbar auf ein Umsetzungspaket).
- **Schlüsselfertige E-Rechnungs- & ERP-Pakete:** **`3.900 €`** (Paket S: BMF-konforme Ausgangs-/Abschlagsrechnung oder JTL-/Shopware-Reparaturbrücke), **`7.900 €`** (Paket M: Mehrstrecken-Prüfung inklusive GAEB-/PDF-LV-Extraktion und ERP-Übergabe), **`12.900 €`** (Paket L: vollständige ERP-/DMS-Integration inklusive Sonderfall-Workflows), jeweils gezahlt vom Direktkunden an Fudaut.

Alle Details und Ablauf:
https://www.fudaut.com/de/e-rechnung-automatisieren

---

## Marken- und Lizenzhinweis / Trademarks & License

- **Markenhinweis / Trademarks:** JTL und JTL-Wawi sind Marken der JTL-Software-GmbH. Shopware ist eine Marke der shopware AG. DATEV ist eine eingetragene Marke der DATEV eG. ZUGFeRD ist eine Marke des Forums elektronische Rechnung Deutschland (FeRD) / AWV e.V. GAEB ist eine Bezeichnung des Gemeinsamen Ausschusses Elektronik im Bauwesen. Dieses Open-Source-Projekt steht in keiner gesellschaftsrechtlichen oder vertraglichen Verbindung zu den genannten Rechteinhabern und ist von ihnen weder geprüft noch zertifiziert. Alle Firmen-, Projekt- und Rechnungsangaben unter `fixtures/` sind frei erfunden (`.example`).
- **Lizenz / License:** Veröffentlicht unter der **MIT-Lizenz** (siehe [`LICENSE`](LICENSE)).
