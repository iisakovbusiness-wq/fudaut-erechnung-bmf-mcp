/**
 * Fachliche Unit- und Positivkontroll-Tests für alle vier Werkzeuge von fudaut-erechnung-bmf-mcp.
 * Beweist für jedes Werkzeug sowohl 0 Fehlalarme auf validen Referenzdateien als auch die sichere
 * Erkennung jedes gezielt eingebauten Praxisfehlers (BMF 15.10.2026, WAWI-86919, Shopware 6, GAEB).
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  checkBmf2026Erechnung,
  checkZugferdPdfa3Xmp,
  checkShopwareStornoMath,
  parseGaebXml,
  parseXmlScaled,
  scaledToCents,
  mulScaled,
} from "../dist/index.js";

const FIXTURES = fileURLToPath(new URL("../fixtures/", import.meta.url));
const readUtf8 = (name) => fs.readFileSync(path.join(FIXTURES, name), "utf8");
const readBytes = (name) => fs.readFileSync(path.join(FIXTURES, name));

test("Festkomma-Arithmetik (BigInt): frei von IEEE-754-Rundungsfehlern", () => {
  // Klassische IEEE-754-Falle: 1.005 * 100 === 100.49999999999999 in Float, kaufmännisch aber 1,01 EUR (101 Cent)
  const s = parseXmlScaled("1.005");
  assert.equal(scaledToCents(s), 101);
  const neg = parseXmlScaled("-1.005");
  assert.equal(scaledToCents(neg), -101);

  const qty = parseXmlScaled("125.500");
  const up = parseXmlScaled("50.00");
  assert.equal(scaledToCents(mulScaled(qty, up)), 627500);
});

test("check_bmf_2026_erechnung: valide Bau-Schlussrechnung (UBL 2.1, BT-113 + BT-22 + BG-24) besteht mit 0 Fehlern", () => {
  const xml = readUtf8("bmf-schlussrechnung-valide-ubl.xml");
  const res = checkBmf2026Erechnung({ xml });
  assert.equal(res.ok, true);
  assert.equal(res.fehlerAnzahl, 0);
  assert.equal(res.warnungAnzahl, 0);
  assert.equal(res.syntax, "UBL_INVOICE");
  assert.equal(res.typcode, "877");
  assert.equal(res.istSchlussrechnung, true);
  assert.equal(res.istBauOderAbschlagKontext, true);
  assert.equal(res.summen.bt109SteuerbasisCent, 2500000);
  assert.equal(res.summen.bt112BruttoCent, 2975000);
  assert.equal(res.summen.bt113VorausbezahltCent, 1190000);
  assert.equal(res.summen.bt115ZahlbetragCent, 1785000);
});

test("check_bmf_2026_erechnung: liest und prüft auch hybride ZUGFeRD-PDF/A-3 direkt ohne Fehlalarm", () => {
  const pdfBytes = readBytes("zugferd-valide-pdfa3.pdf");
  const res = checkBmf2026Erechnung({ pdfBytes });
  assert.equal(res.ok, true);
  assert.equal(res.quelleTyp, "PDF_HYBRID");
  assert.equal(res.syntax, "CII");
  assert.equal(res.fehlerAnzahl, 0);
  assert.equal(res.summen.bt112BruttoCent, 148750);
});

test("Positivkontrolle BMF 15.10.2026: erkennt fehlendes BT-113 bei Minus-Abschlagsposition UND pauschale Leistungsbeschreibung", () => {
  const xml = readUtf8("bmf-schlussrechnung-defekt-bt113-cii.xml");
  const res = checkBmf2026Erechnung({ xml });
  assert.equal(res.ok, false);
  const codes = res.befunde.map((b) => b.code);
  assert.ok(codes.includes("BMF_2026_BT113_FEHLT_BEI_ABSCHLAGSABZUG"), `Erwartet BT-113-Fehler, erhalten: ${codes.join(", ")}`);
  assert.ok(codes.includes("BMF_2026_LEISTUNGSBESCHREIBUNG_PAUSCHAL"), `Erwartet Pauschalfehler, erhalten: ${codes.join(", ")}`);
});

test("Positivkontrolle BMF 15.10.2026: erkennt fehlenden BG-24-LV-Anhang bei LV-Verweis sowie gebrochene Bruttosumme BT-112", () => {
  const xml = readUtf8("bmf-lv-pauschal-defekt-ohne-bg24.xml");
  const res = checkBmf2026Erechnung({ xml });
  assert.equal(res.ok, false);
  const codes = res.befunde.map((b) => b.code);
  assert.ok(codes.includes("BMF_2026_BG24_LV_ANHANG_FEHLT"), `Erwartet BG-24-Fehler, erhalten: ${codes.join(", ")}`);
  assert.ok(codes.includes("EN16931_BR_CO_15_BT112_BRUTTO"), `Erwartet BT-112-Arithmetikfehler, erhalten: ${codes.join(", ")}`);
});

test("Positivkontrolle BMF 15.10.2026: erkennt unkommentierten BT-113-Abzug ohne Aufstellung in BT-22/BT-25/BG-24", () => {
  const valide = readUtf8("bmf-schlussrechnung-valide-ubl.xml");
  const ohneAufstellung = valide
    .replace(/<cbc:Note>[\s\S]*?<\/cbc:Note>/, "<cbc:Note>Vielen Dank</cbc:Note>")
    .replace(/<cac:BillingReference>[\s\S]*?<\/cac:BillingReference>/, "")
    .replace(/<cac:AdditionalDocumentReference>[\s\S]*?<\/cac:AdditionalDocumentReference>/, "");
  const res = checkBmf2026Erechnung({ xml: ohneAufstellung });
  assert.equal(res.ok, false);
  assert.ok(res.befunde.some((b) => b.code === "BMF_2026_ABSCHLAG_AUFSTELLUNG_FEHLT"));
});

test("Positivkontrolle Sicherheit: XXE / <!ENTITY-Deklaration wird deterministisch blockiert", () => {
  const xxeXml = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE foo [ <!ENTITY xxe SYSTEM "file:///etc/passwd"> ]>
<Invoice><cbc:ID>&xxe;</cbc:ID></Invoice>`;
  const res = checkBmf2026Erechnung({ xml: xxeXml });
  assert.equal(res.ok, false);
  assert.equal(res.befunde[0]?.code, "XML_SICHERHEIT_ENTITY_VERBOTEN");
});

test("check_zugferd_pdfa3_xmp: valides Factur-X PDF/A-3 besteht vollständig (0 Fehler, WAWI-86919 = false)", () => {
  const pdfBytes = readBytes("zugferd-valide-pdfa3.pdf");
  const res = checkZugferdPdfa3Xmp({ pdfBytes, erwartetBruttoCent: 148750 });
  assert.equal(res.ok, true);
  assert.equal(res.wawi86919Betroffen, false);
  assert.equal(res.fehlerAnzahl, 0);
  assert.equal(res.pdfa.part, "3");
  assert.equal(res.pdfa.conformance, "B");
  assert.equal(res.zugferdXmp.version, "1.0");
  assert.equal(res.zugferdXmp.extensionSchemaDeklariert, true);
  assert.equal(res.eingebettetesXml.vorhanden, true);
  assert.equal(res.eingebettetesXml.bruttoCent, 148750);
});

test("check_zugferd_pdfa3_xmp: akzeptiert auch RDF-Attribut-Kurzschreibweise auf rdf:Description ohne Fehlalarm", () => {
  const shorthandXmp = `<x:xmpmeta xmlns:x="adobe:ns:meta/">
    <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
      <rdf:Description rdf:about=""
        xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/"
        pdfaid:part="3"
        pdfaid:conformance="B"
        xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"
        fx:DocumentType="INVOICE"
        fx:DocumentFileName="factur-x.xml"
        fx:Version="1.0"
        fx:ConformanceLevel="EN 16931"
        xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
        xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
        xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
        <pdfaExtension:schemas>
          <rdf:Bag>
            <rdf:li rdf:parseType="Resource"
              pdfaSchema:namespaceURI="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#"
              pdfaSchema:prefix="fx">
              <pdfaSchema:property>
                <rdf:Seq>
                  <rdf:li rdf:parseType="Resource" pdfaProperty:name="DocumentFileName"/>
                  <rdf:li rdf:parseType="Resource" pdfaProperty:name="DocumentType"/>
                  <rdf:li rdf:parseType="Resource" pdfaProperty:name="Version"/>
                  <rdf:li rdf:parseType="Resource" pdfaProperty:name="ConformanceLevel"/>
                </rdf:Seq>
              </pdfaSchema:property>
            </rdf:li>
          </rdf:Bag>
        </pdfaExtension:schemas>
      </rdf:Description>
    </rdf:RDF>
  </x:xmpmeta>`;
  const res = checkZugferdPdfa3Xmp({ xmpXml: shorthandXmp });
  assert.equal(res.ok, true);
  assert.equal(res.wawi86919Betroffen, false);
});

test("Positivkontrolle JTL WAWI-86919: erkennt leeres fx:Version und fehlendes pdfaExtension:schemas im PDF/A-3", () => {
  const pdfBytes = readBytes("jtl-wawi-86919-defekt-pdfa3.pdf");
  const res = checkZugferdPdfa3Xmp({ pdfBytes });
  assert.equal(res.ok, false);
  assert.equal(res.wawi86919Betroffen, true);
  const codes = res.befunde.map((b) => b.code);
  assert.ok(codes.includes("JTL_WAWI_86919_XMP_VERSION_FEHLT"), `Erwartet Version-Fehler, erhalten: ${codes.join(", ")}`);
  assert.ok(codes.includes("JTL_WAWI_86919_EXTENSION_SCHEMA_FEHLT"), `Erwartet ExtensionSchema-Fehler, erhalten: ${codes.join(", ")}`);
});

test("Positivkontrolle PDF/A-3: erkennt fehlendes eingebettetes XML sowie Summenabweichung zwischen PDF und XML", () => {
  const ohneXml = checkZugferdPdfa3Xmp({ pdfBytes: readBytes("zugferd-defekt-ohne-xml.pdf") });
  assert.equal(ohneXml.ok, false);
  assert.ok(ohneXml.befunde.some((b) => b.code === "PDFA3_EMBEDDED_XML_FEHLT"));

  const abweichendeSumme = checkZugferdPdfa3Xmp({
    pdfBytes: readBytes("zugferd-valide-pdfa3.pdf"),
    erwartetBruttoCent: 150000,
  });
  assert.equal(abweichendeSumme.ok, false);
  assert.ok(abweichendeSumme.befunde.some((b) => b.code === "PDFA3_SUMMEN_ABWEICHUNG_BRUTTO"));
});

test("check_shopware_storno_math: valide B2B-Gutschrift mit BG-20-Rabatt besteht mit 0 Cent Drift", () => {
  const xml = readUtf8("shopware-gutschrift-valide-ubl.xml");
  const res = checkShopwareStornoMath(xml);
  assert.equal(res.ok, true);
  assert.equal(res.fehlerAnzahl, 0);
  assert.equal(res.vorzeichenfehlerAnzahl, 0);
  assert.equal(res.rundungsfehlerAnzahl, 0);
  assert.equal(res.maxRundungsdriftCent, 0);
  assert.deepEqual(res.bezugsrechnungen, ["RE-2026-4410"]);
});

test("Positivkontrolle Shopware 6 Storno: erkennt Vorzeichenumkehr in BG-20, negativen Einzelpreis BR-27, fehlende BT-25 und Rundungsdrift > 0,01 EUR", () => {
  const xml = readUtf8("shopware-storno-defekt-cii.xml");
  const res = checkShopwareStornoMath(xml);
  assert.equal(res.ok, false);
  assert.ok(res.vorzeichenfehlerAnzahl >= 2);
  assert.ok(res.rundungsfehlerAnzahl >= 2);
  assert.ok(res.maxRundungsdriftCent >= 5);
  const codes = res.befunde.map((b) => b.code);
  assert.ok(codes.includes("SHOPWARE_STORNO_BEZUGSRECHNUNG_FEHLT"), `Fehlende BT-25 nicht erkannt: ${codes.join(", ")}`);
  assert.ok(codes.includes("SHOPWARE_BG20_VORZEICHEN_INVERTIERT"), `BG-20 Vorzeichen nicht erkannt: ${codes.join(", ")}`);
  assert.ok(codes.includes("SHOPWARE_NETTOPREIS_NEGATIV_BR27"), `BR-27 nicht erkannt: ${codes.join(", ")}`);
  assert.ok(codes.includes("SHOPWARE_POSITIONS_RUNDUNGSDRIFT"), `Positionsdrift nicht erkannt: ${codes.join(", ")}`);
  assert.ok(codes.includes("SHOPWARE_STEUER_RUNDUNGSDRIFT"), `Steuerdrift nicht erkannt: ${codes.join(", ")}`);
});

test("parse_gaeb_xml: parst unbepreistes X83-LV und bepreistes X84-Angebot (inkl. Bedarfsposition) fehlerfrei nach ERP-JSON", () => {
  const x83 = parseGaebXml(readUtf8("gaeb-ausschreibung-valide.x83"), "gaeb-ausschreibung-valide.x83");
  assert.equal(x83.ok, true);
  assert.equal(x83.fehlerAnzahl, 0);
  assert.equal(x83.kopf.dateiphase, "X83");
  assert.equal(x83.summen.positionenGesamt, 4);
  assert.equal(x83.summen.bepreistePositionen, 0);
  assert.deepEqual(
    x83.positionen.map((p) => p.oz),
    ["01.01.0010", "01.01.0020", "02.01.0010", "02.01.0020"],
  );
  assert.equal(x83.positionen[3]?.positionsart, "Bedarfsposition");
  assert.equal(x83.positionen[3]?.zaehltInGesamtsumme, false);

  const x84 = parseGaebXml(readUtf8("gaeb-angebot-valide.x84"), "gaeb-angebot-valide.x84");
  assert.equal(x84.ok, true);
  assert.equal(x84.fehlerAnzahl, 0);
  assert.equal(x84.kopf.dateiphase, "X84");
  assert.equal(x84.summen.berechneteNettoCent, 2566750);
  assert.equal(x84.summen.ausgewieseneNettoCent, 2566750);
  assert.equal(x84.summen.abweichungNettoCent, 0);
  assert.equal(x84.summen.ausgewieseneBruttoCent, 3054433);
});

test("Positivkontrolle GAEB X86: erkennt manipulierte Positions-GP und abweichende LV-Gesamtsumme zuverlässig", () => {
  const x86 = parseGaebXml(readUtf8("gaeb-auftrag-defekt-summe.x86"), "gaeb-auftrag-defekt-summe.x86");
  assert.equal(x86.ok, false);
  assert.equal(x86.kopf.dateiphase, "X86");
  assert.equal(x86.summen.berechneteNettoCent, 1550000); // 3*4100 + 80*40 = 12300 + 3200 = 15500 EUR
  assert.equal(x86.summen.ausgewieseneNettoCent, 1595000);
  assert.equal(x86.summen.abweichungNettoCent, 45000); // +450,00 EUR Abweichung
  const codes = x86.befunde.map((b) => b.code);
  assert.ok(codes.includes("GAEB_POSITIONS_GP_ABWEICHUNG"), `Erwartet Positions-Abweichung, erhalten: ${codes.join(", ")}`);
  assert.ok(codes.includes("GAEB_TITEL_SUMMEN_ABWEICHUNG"), `Erwartet Titel-Abweichung, erhalten: ${codes.join(", ")}`);
  assert.ok(codes.includes("GAEB_GESAMTSUMMEN_ABWEICHUNG"), `Erwartet Gesamtsummen-Abweichung, erhalten: ${codes.join(", ")}`);
});
