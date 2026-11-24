/**
 * Ende-zu-Ende-Tests für den MCP-Server über stdio (@modelcontextprotocol/client), das CLI-Werkzeug
 * (Exit-Codes 0/1/2 + --json), die Ordnergrenze (inklusive Symlink-/Junction-Ausbruch) und die Repo-Hygiene.
 */

import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { Client } from "@modelcontextprotocol/client";
import { StdioClientTransport } from "@modelcontextprotocol/client/stdio";

const ROOT_DIR = fileURLToPath(new URL("../", import.meta.url));
const CLI_ENTRY = fileURLToPath(new URL("../dist/cli.js", import.meta.url));
const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));

let sandboxDir;
let outsideDir;
let mcpClient;
let stderrLog = "";

before(async () => {
  sandboxDir = fs.mkdtempSync(path.join(os.tmpdir(), "erechnung-mcp-sandbox-"));
  outsideDir = fs.mkdtempSync(path.join(os.tmpdir(), "erechnung-mcp-outside-"));

  for (const name of fs.readdirSync(FIXTURES)) {
    fs.copyFileSync(path.join(FIXTURES, name), path.join(sandboxDir, name));
  }
  fs.copyFileSync(
    path.join(FIXTURES, "bmf-schlussrechnung-valide-ubl.xml"),
    path.join(outsideDir, "geheim-draussen.xml"),
  );
  // Verknüpfung aus dem erlaubten Ordner hinaus anlegen (Junction unter Windows)
  fs.symlinkSync(outsideDir, path.join(sandboxDir, "ausbruch-link"), "junction");

  // Starte exakt dist/cli.js ohne Argumente (wie npx in Claude Desktop / Cursor / Windsurf)
  const transport = new StdioClientTransport({
    command: process.execPath,
    args: [CLI_ENTRY],
    env: { ...process.env, ERECHNUNG_ORDNER: sandboxDir },
    stderr: "pipe",
  });
  transport.stderr?.on("data", (chunk) => {
    stderrLog += chunk.toString("utf8");
  });

  mcpClient = new Client({ name: "e2e-test-client", version: "1.0.0" });
  await mcpClient.connect(transport);
});

after(async () => {
  await mcpClient?.close();
  fs.rmSync(path.join(sandboxDir, "ausbruch-link"), { force: true });
  fs.rmSync(sandboxDir, { recursive: true, force: true });
  fs.rmSync(outsideDir, { recursive: true, force: true });
});

test("MCP stdio: Server meldet sich korrekt und registriert alle 4 Werkzeuge mit Schema und readOnlyHint", async () => {
  assert.deepEqual(mcpClient.getServerVersion(), {
    name: "fudaut-erechnung-bmf-mcp",
    version: "1.0.0",
  });

  const { tools } = await mcpClient.listTools();
  assert.deepEqual(
    tools.map((t) => t.name),
    [
      "check_bmf_2026_erechnung",
      "check_zugferd_pdfa3_xmp",
      "check_shopware_storno_math",
      "parse_gaeb_xml",
    ],
  );

  for (const t of tools) {
    assert.ok(t.description && t.description.length > 80, `${t.name}: Beschreibung zu kurz`);
    assert.equal(t.inputSchema.type, "object");
    assert.ok(t.outputSchema, `${t.name}: outputSchema fehlt`);
    assert.equal(t.annotations?.readOnlyHint, true, `${t.name}: readOnlyHint muss true sein`);
  }
});

test("MCP stdio: alle 4 Werkzeuge liefern strukturierte Ergebnisse für valide und defekte Dateien", async () => {
  const bmfOk = await mcpClient.callTool({
    name: "check_bmf_2026_erechnung",
    arguments: { pfad: "bmf-schlussrechnung-valide-ubl.xml" },
  });
  assert.equal(bmfOk.isError ?? false, false);
  assert.equal(bmfOk.structuredContent.ok, true);

  const bmfBad = await mcpClient.callTool({
    name: "check_bmf_2026_erechnung",
    arguments: { pfad: "bmf-schlussrechnung-defekt-bt113-cii.xml" },
  });
  assert.equal(bmfBad.isError ?? false, false);
  assert.equal(bmfBad.structuredContent.ok, false);
  assert.ok(bmfBad.structuredContent.fehlerAnzahl >= 2);

  const xmpBad = await mcpClient.callTool({
    name: "check_zugferd_pdfa3_xmp",
    arguments: { pfad: "jtl-wawi-86919-defekt-pdfa3.pdf" },
  });
  assert.equal(xmpBad.isError ?? false, false);
  assert.equal(xmpBad.structuredContent.ok, false);
  assert.equal(xmpBad.structuredContent.wawi86919Betroffen, true);

  const swBad = await mcpClient.callTool({
    name: "check_shopware_storno_math",
    arguments: { pfad: "shopware-storno-defekt-cii.xml" },
  });
  assert.equal(swBad.isError ?? false, false);
  assert.equal(swBad.structuredContent.ok, false);

  const gaebOk = await mcpClient.callTool({
    name: "parse_gaeb_xml",
    arguments: { pfad: "gaeb-angebot-valide.x84" },
  });
  assert.equal(gaebOk.isError ?? false, false);
  assert.equal(gaebOk.structuredContent.ok, true);
  assert.equal(gaebOk.structuredContent.summen.berechneteNettoCent, 2566750);
});

test("MCP Sicherheitsgrenze: blockiert Pfadausbruch (.., absoluter Fremdpfad und Junction nach draußen) auf allen 4 Werkzeugen", async () => {
  const verbotenePfade = [
    `../${path.basename(outsideDir)}/geheim-draussen.xml`,
    path.join(outsideDir, "geheim-draussen.xml"),
    "ausbruch-link/geheim-draussen.xml",
    ".",
  ];
  const toolNamen = [
    "check_bmf_2026_erechnung",
    "check_zugferd_pdfa3_xmp",
    "check_shopware_storno_math",
    "parse_gaeb_xml",
  ];

  for (const pfad of verbotenePfade) {
    for (const name of toolNamen) {
      const res = await mcpClient.callTool({ name, arguments: { pfad } });
      assert.equal(res.isError, true, `${name} hätte Pfad "${pfad}" abweisen müssen`);
      assert.match(res.content[0].text, /nicht im freigegebenen Ordner/);
    }
  }
});

test("MCP Protokoll auf stderr: strukturierte JSON-Zeilen ohne Firmennamen, Positionstexte oder Beträge", async () => {
  await new Promise((r) => setTimeout(r, 100));
  const lines = stderrLog.trim().split("\n");
  assert.match(lines[0], /^fudaut-erechnung-bmf-mcp: bereit auf stdio/);
  const jsonLines = lines.slice(1).map((l) => JSON.parse(l));
  assert.ok(jsonLines.length >= 8);
  for (const entry of jsonLines) {
    assert.deepEqual(Object.keys(entry), ["zeit", "werkzeug", "quelle", "ergebnis"]);
  }
  assert.doesNotMatch(stderrLog, /Beispiel SHK|Wärmepumpe|29750|17850|25667/);
});

test("CLI-Modus: Exit-Code 0 bei validen Dateien, Exit-Code 1 bei Defekten, Exit-Code 2 bei fehlender Datei", () => {
  const run = (args) =>
    spawnSync(process.execPath, [CLI_ENTRY, ...args], {
      cwd: ROOT_DIR,
      encoding: "utf8",
      windowsHide: true,
    });

  const ver = run(["--version"]);
  assert.equal(ver.status, 0);
  assert.equal(ver.stdout.trim(), "1.0.0");

  const okBmf = run(["check-bmf", "fixtures/bmf-schlussrechnung-valide-ubl.xml", "--json"]);
  assert.equal(okBmf.status, 0);
  assert.equal(JSON.parse(okBmf.stdout).ok, true);

  const badBmf = run(["check-bmf", "fixtures/bmf-schlussrechnung-defekt-bt113-cii.xml"]);
  assert.equal(badBmf.status, 1);
  assert.match(badBmf.stdout, /BMF_2026_BT113_FEHLT_BEI_ABSCHLAGSABZUG/);

  const okXmp = run(["check-xmp", "fixtures/zugferd-valide-pdfa3.pdf"]);
  assert.equal(okXmp.status, 0);

  const badXmp = run(["check-xmp", "fixtures/jtl-wawi-86919-defekt-pdfa3.pdf", "--json"]);
  assert.equal(badXmp.status, 1);
  assert.equal(JSON.parse(badXmp.stdout).wawi86919Betroffen, true);

  const badStorno = run(["check-storno", "fixtures/shopware-storno-defekt-cii.xml"]);
  assert.equal(badStorno.status, 1);

  const okGaeb = run(["parse-gaeb", "fixtures/gaeb-angebot-valide.x84", "--json"]);
  assert.equal(okGaeb.status, 0);
  assert.equal(JSON.parse(okGaeb.stdout).kopf.dateiphase, "X84");

  const badGaeb = run(["parse-gaeb", "fixtures/gaeb-auftrag-defekt-summe.x86"]);
  assert.equal(badGaeb.status, 1);

  const missing = run(["check-bmf", "fixtures/gibt-es-nicht.xml"]);
  assert.equal(missing.status, 2);
});

test("Metadaten-Konsistenz (package.json, server.json, glama.json, Dockerfile, LICENSE)", () => {
  const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "package.json"), "utf8"));
  const srv = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "server.json"), "utf8"));
  const glama = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, "glama.json"), "utf8"));

  assert.equal(pkg.name, "fudaut-erechnung-bmf-mcp");
  assert.equal(pkg.license, "MIT");
  assert.equal(pkg.mcpName, srv.name);
  assert.equal(srv.version, pkg.version);
  assert.ok(srv.description.length <= 100, `server.json description zu lang (${srv.description.length} > 100)`);
  assert.deepEqual(glama.maintainers, ["iisakovbusiness-wq"]);
  assert.ok(fs.existsSync(path.join(ROOT_DIR, "Dockerfile")));
  assert.ok(fs.existsSync(path.join(ROOT_DIR, "LICENSE")));
});

test("Repo-Hygiene: 0 Gedankenstriche, 0 Emojis, 0 CRLF, 0 lokale Pfade/Secrets und 0 Sperrbegriffe", () => {
  const walk = (dir) => {
    const entries = [];
    for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
      if (item.name === "node_modules" || item.name === ".git") continue;
      const full = path.join(dir, item.name);
      if (item.isDirectory()) entries.push(...walk(full));
      else entries.push(full);
    }
    return entries;
  };

  // Hex-kodierte Sperrmuster, damit im Klartext des Repos selbst 0 Sperrwoerter stehen,
  // die Pruefung aber jeden echten Treffer sofort erkennt.
  const fromHex = (h) => Buffer.from(h, "hex").toString("utf8");
  const bannedPatterns = [
    new RegExp(fromHex("5c62283f3a696f6e6f737c73747261746f7c676d787c7765625c2e64657c6d61696c5c2e636f6d7c7365646f7c756e697465642d646f6d61696e737c766572736174656c295c62"), "i"),
    new RegExp(fromHex("756e697465645c732b696e7465726e6574"), "i"),
    new RegExp(fromHex("312631")),
    new RegExp(fromHex("23283f3a3132327c363536295c62")),
    new RegExp(`\\b(?:${fromHex("313230")}|${fromHex("313130")})\\s*(?:€|EUR|Euro)\\b`, "i"),
    new RegExp(`#(?:${fromHex("643937373537")}|${fromHex("643935303261")}|${fromHex("653035333262")})\\b`, "i"),
    new RegExp(fromHex("717569726d62616368"), "i"),
    new RegExp(fromHex("283f3a433a5c5c55736572737c463a5c5c435553544f4d7c6672657a7a657c6768705f5b412d5a612d7a302d395d2b7c6769746875625f7061745f5b412d5a612d7a302d395f5d2b7c424547494e205253412050524956415445204b455929"), "i"),
  ];
  // Positivkontrolle des Scanners selbst:
  assert.match(fromHex("696f6e6f73"), bannedPatterns[0]);
  assert.match(fromHex("31323020455552"), bannedPatterns[4]);

  const allFiles = walk(ROOT_DIR);
  assert.ok(allFiles.length >= 25, "Zu wenige Projektdateien gefunden");

  for (const fp of allFiles) {
    const rel = path.relative(ROOT_DIR, fp).replaceAll("\\", "/");
    const raw = fs.readFileSync(fp);
    const isPdf = fp.endsWith(".pdf");
    const text = raw.toString(isPdf ? "latin1" : "utf8");

    for (const rx of bannedPatterns) {
      assert.doesNotMatch(text, rx, `Verbotenes Muster ${rx} in ${rel}`);
    }

    if (!isPdf) {
      assert.equal(raw.includes(0x0d), false, `CRLF gefunden in ${rel}`);
      assert.doesNotMatch(text, /[\u2013\u2014]/, `Gedankenstrich gefunden in ${rel}`);
      assert.doesNotMatch(text, /\p{Extended_Pictographic}/u, `Emoji/Piktogramm gefunden in ${rel}`);
    }
  }
});

