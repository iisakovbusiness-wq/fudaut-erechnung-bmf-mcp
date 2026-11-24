/**
 * Werkzeug 1: check_bmf_2026_erechnung
 * Prüft XRechnung 3.0 und ZUGFeRD 2.3 (UBL 2.1 & UN/CEFACT CII, optional direkt aus PDF/A-3) auf:
 * - EN 16931 Kern-Arithmetik (BT-106, BT-109, BT-110, BT-112, BT-115, BR-CO-10..16, BR-S-08/09)
 * - BMF-Schreiben vom 15.10.2026: Bau-/SHK-Abschlags- & Schlussrechnungen (BT-113 Vorauszahlung,
 *   Einzelaufstellung in BT-22/BT-25 oder eingebettetem Anhang BG-24), Leistungsbeschreibung (BT-153/BT-154
 *   bzw. referenzierter LV-Anhang in BG-24) sowie Leistungsdatum/-zeitraum (BT-72 / BG-14)
 * - Storno- und Gutschrifts-Typcodes (381 / 384 / 389) samt Bezugsrechnung (BT-25) und Vorzeichenlogik.
 */
import { extractInvoiceModel } from "./invoiceModel.js";
import { centsAlsDeutsch, centsAlsIso, prozentAufCent } from "./math.js";
import { inspectPdfContainer } from "./pdfContainer.js";
import { XmlParseError, parseXmlDocument } from "./xml.js";
const VALID_TYPE_CODES = new Set([
    "326", // Teilrechnung / Partial invoice
    "380", // Handelsrechnung / Commercial invoice
    "381", // Gutschrift (kaufmännisch) / Credit note
    "384", // Rechnungskorrektur / Corrected invoice
    "389", // Selbstfaktura (umsatzsteuerliche Gutschrift § 14 Abs. 2 S. 2 UStG)
    "875", // Teilbauabrechnung / Partial construction invoice
    "876", // Teil-Schlussbauabrechnung / Partial final construction invoice
    "877", // Schlussbauabrechnung / Final construction invoice
]);
const GENERIC_ITEM_NAMES = new Set([
    "beratung",
    "beratungsleistung",
    "beratungsleistungen",
    "dienstleistung",
    "dienstleistungen",
    "bauleistung",
    "bauleistungen",
    "handwerkerleistung",
    "handwerksleistung",
    "montage",
    "arbeiten",
    "lohnarbeiten",
    "pauschale",
    "pauschal",
    "sonstiges",
    "diverse",
    "diverses",
    "laut angebot",
    "lt. angebot",
    "siehe anlage",
    "siehe anhang",
]);
const LV_REFERENCE_PATTERN = /\b(?:gem(?:\u0061\u0065|ä)(?:\u0073\u0073|ß)\s+lv|lt\.\s*lv|laut\s+lv|leistungsverzeichnis|gaeb|siehe\s+lv|aufma(?:\u0073\u0073|ß)liste)\b/i;
const SCHLUSSRECHNUNG_PATTERN = /\b(?:schlussrechnung|endrechnung|schlussabrechnung|gesamtabrechnung)\b/i;
const ABSCHLAG_PATTERN = /\b(?:abschlagsrechnung|abschlag\s*nr|(?:\d+\.)\s*abschlag|teilrechnung|a-rechnung|anzahlungsrechnung)\b/i;
const NEGATIVE_ABSCHLAG_LINE_PATTERN = /\b(?:abzgl\.?|abz\u0075\u0065glich|abzüglich|verrechnung|bereits\s+gezahlt|vorauszahlung|abschlag|anzahlung|teilzahlung)\b/i;
function istKonkreteLeistungsbeschreibung(name, beschreibung) {
    const n = (name ?? "").trim();
    const b = (beschreibung ?? "").trim();
    if (!n)
        return false;
    const lower = n.toLowerCase().replace(/[:.!?,;]+$/g, "").trim();
    if (GENERIC_ITEM_NAMES.has(lower) && b.length < 12) {
        return false;
    }
    if (n.length < 4 && b.length < 10) {
        return false;
    }
    return true;
}
export function validateInvoiceAgainstBmf2026(inv, quelleTyp = "XML") {
    const befunde = [];
    const waehrung = inv.waehrung ?? "EUR";
    // 0. Ungueltige Zahlenformate (z. B. Komma statt Punkt)
    for (const ung of inv.summen.ungueltigeZahlenfelder) {
        befunde.push({
            stufe: "fehler",
            code: "EN16931_UNGUELTIGES_ZAHLENFORMAT",
            feld: ung.feld,
            zeile: ung.zeile,
            meldung: `Feld ${ung.feld} enthält keinen gültigen XML-Dezimalwert ("${ung.wert}"). EN 16931 verlangt Ziffern mit Punkt als Dezimaltrennzeichen.`,
        });
    }
    // 1. Pflichtkopfdaten (BT-1, BT-2, BT-3, BT-5, BT-24, Positionen)
    if (!inv.rechnungsnummer) {
        befunde.push({
            stufe: "fehler",
            code: "EN16931_BT1_FEHLT",
            feld: "BT-1",
            zeile: inv.wurzelZeile,
            meldung: "Rechnungsnummer (BT-1) fehlt.",
        });
    }
    if (!inv.ausstellungsdatum || !/^\d{4}-\d{2}-\d{2}$/.test(inv.ausstellungsdatum)) {
        befunde.push({
            stufe: "fehler",
            code: "EN16931_BT2_UNGUELTIG",
            feld: "BT-2",
            zeile: inv.wurzelZeile,
            meldung: `Ausstellungsdatum (BT-2) fehlt oder ist kein gültiges Kalenderdatum ("${inv.ausstellungsdatum ?? ""}").`,
        });
    }
    if (!inv.typcode) {
        befunde.push({
            stufe: "fehler",
            code: "EN16931_BT3_FEHLT",
            feld: "BT-3",
            zeile: inv.typcodeZeile,
            meldung: "Rechnungsart-Code (BT-3) fehlt.",
        });
    }
    else if (!VALID_TYPE_CODES.has(inv.typcode)) {
        befunde.push({
            stufe: "warnung",
            code: "BMF_2026_UNUEBLICHER_TYPCODE",
            feld: "BT-3",
            zeile: inv.typcodeZeile,
            meldung: `Rechnungsart-Code "${inv.typcode}" liegt außerhalb der üblichen deutschen EN-16931-Kernmenge (326, 380, 381, 384, 389, 875, 876, 877).`,
        });
    }
    if (!inv.profilId) {
        befunde.push({
            stufe: "warnung",
            code: "EN16931_BT24_FEHLT",
            feld: "BT-24",
            zeile: inv.wurzelZeile,
            meldung: "Spezifikationskennung (BT-24 CustomizationID / GuidelineID) fehlt.",
        });
    }
    if (inv.positionen.length === 0) {
        befunde.push({
            stufe: "fehler",
            code: "EN16931_BR16_KEINE_POSITIONEN",
            feld: "BG-25",
            zeile: inv.wurzelZeile,
            meldung: "Die Rechnung enthält keine Rechnungspositionen (BG-25, Regel BR-16).",
        });
    }
    if (!inv.verkaeuferUstId && !inv.verkaeuferSteuernummer) {
        befunde.push({
            stufe: "fehler",
            code: "USTG_STEUERNUMMER_FEHLT",
            feld: "BT-31/BT-32",
            zeile: inv.wurzelZeile,
            meldung: "Weder USt-IdNr. (BT-31) noch Steuernummer (BT-32) des Leistenden angegeben (§ 14 Abs. 4 Nr. 2 UStG).",
        });
    }
    // Leistungsdatum / Leistungszeitraum (§ 14 Abs. 4 Nr. 6 UStG / BR-DE-16)
    if (!inv.lieferdatum && !inv.abrechnungszeitraumVon && !inv.abrechnungszeitraumBis) {
        befunde.push({
            stufe: "warnung",
            code: "BMF_2026_LEISTUNGSDATUM_FEHLT",
            feld: "BT-72/BG-14",
            zeile: inv.wurzelZeile,
            meldung: "Weder Liefer-/Leistungsdatum (BT-72) noch Abrechnungszeitraum (BT-73/BT-74) im strukturierten Kopfteil angegeben (§ 14 Abs. 4 Nr. 6 UStG).",
        });
    }
    // 2. EN 16931 Kern-Arithmetik (BT-106, BT-109, BT-110, BT-112, BT-115)
    const s = inv.summen;
    const bt107 = s.nachlaesseSummeCent ?? 0;
    const bt108 = s.zuschlaegeSummeCent ?? 0;
    const bt113 = s.vorausbezahltCent ?? 0;
    const bt114 = s.rundungsbetragCent ?? 0;
    if (s.positionenNettoSummeCent === null) {
        befunde.push({ stufe: "fehler", code: "EN16931_BT106_FEHLT", feld: "BT-106", zeile: inv.wurzelZeile, meldung: "Summe der Positionsnettobeträge (BT-106) fehlt." });
    }
    if (s.steuerbasisSummeCent === null) {
        befunde.push({ stufe: "fehler", code: "EN16931_BT109_FEHLT", feld: "BT-109", zeile: inv.wurzelZeile, meldung: "Gesamtbetrag ohne Umsatzsteuer (BT-109) fehlt." });
    }
    if (s.bruttoSummeCent === null) {
        befunde.push({ stufe: "fehler", code: "EN16931_BT112_FEHLT", feld: "BT-112", zeile: inv.wurzelZeile, meldung: "Gesamtbetrag mit Umsatzsteuer (BT-112) fehlt." });
    }
    if (s.zahlbetragCent === null) {
        befunde.push({ stufe: "fehler", code: "EN16931_BT115_FEHLT", feld: "BT-115", zeile: inv.wurzelZeile, meldung: "Fälliger Zahlbetrag (BT-115) fehlt." });
    }
    // BR-CO-10: Summe der BT-131 == BT-106
    const berechneteBt106 = inv.positionen.reduce((acc, p) => acc + (p.zeilenNettoCent ?? 0), 0);
    if (s.positionenNettoSummeCent !== null && berechneteBt106 !== s.positionenNettoSummeCent) {
        befunde.push({
            stufe: "fehler",
            code: "EN16931_BR_CO_10_BT106_SUMME",
            feld: "BT-106",
            zeile: s.positionenNettoZeile,
            meldung: `BT-106 (${centsAlsDeutsch(s.positionenNettoSummeCent, waehrung)}) weicht von der Summe der Positionsnettobeträge BT-131 (${centsAlsDeutsch(berechneteBt106, waehrung)}) ab.`,
        });
    }
    // Dokumentnachlaesse / Zuschläge Vorzeichen & Summe (BR-CO-11 / BR-CO-12)
    for (const dn of inv.dokumentNachlaesse) {
        if (dn.betragCent < 0) {
            befunde.push({
                stufe: "fehler",
                code: "VORZEICHEN_RABATT_NEGATIV",
                feld: "BG-20",
                zeile: dn.zeile,
                meldung: `Dokumenten-Nachlass (BG-20) hat negativen Betrag (${centsAlsDeutsch(dn.betragCent, waehrung)}). Nachlässe müssen positiv eingetragen werden, da sie von BT-106 abgezogen werden.`,
            });
        }
    }
    if (bt107 < 0) {
        befunde.push({
            stufe: "fehler",
            code: "VORZEICHEN_BT107_NEGATIV",
            feld: "BT-107",
            zeile: s.nachlaesseZeile,
            meldung: `Summe der Nachlässe BT-107 ist negativ (${centsAlsDeutsch(bt107, waehrung)}); doppelte Negation erhöht die Steuerbasis statt sie zu mindern.`,
        });
    }
    const summeBg20 = inv.dokumentNachlaesse.reduce((a, x) => a + x.betragCent, 0);
    if (s.nachlaesseSummeCent !== null && inv.dokumentNachlaesse.length > 0 && summeBg20 !== s.nachlaesseSummeCent) {
        befunde.push({
            stufe: "fehler",
            code: "EN16931_BR_CO_11_BT107_SUMME",
            feld: "BT-107",
            zeile: s.nachlaesseZeile,
            meldung: `BT-107 (${centsAlsDeutsch(s.nachlaesseSummeCent, waehrung)}) stimmt nicht mit der Summe der BG-20-Nachlässe (${centsAlsDeutsch(summeBg20, waehrung)}) überein.`,
        });
    }
    const summeBg21 = inv.dokumentZuschlaege.reduce((a, x) => a + x.betragCent, 0);
    if (s.zuschlaegeSummeCent !== null && inv.dokumentZuschlaege.length > 0 && summeBg21 !== s.zuschlaegeSummeCent) {
        befunde.push({
            stufe: "fehler",
            code: "EN16931_BR_CO_12_BT108_SUMME",
            feld: "BT-108",
            zeile: s.zuschlaegeZeile,
            meldung: `BT-108 (${centsAlsDeutsch(s.zuschlaegeSummeCent, waehrung)}) stimmt nicht mit der Summe der BG-21-Zuschläge (${centsAlsDeutsch(summeBg21, waehrung)}) überein.`,
        });
    }
    // BR-CO-13: BT-109 == BT-106 - BT-107 + BT-108
    if (s.positionenNettoSummeCent !== null && s.steuerbasisSummeCent !== null) {
        const erwartetBt109 = s.positionenNettoSummeCent - bt107 + bt108;
        if (erwartetBt109 !== s.steuerbasisSummeCent) {
            befunde.push({
                stufe: "fehler",
                code: "EN16931_BR_CO_13_BT109_ARITHMETIK",
                feld: "BT-109",
                zeile: s.steuerbasisZeile,
                meldung: `BT-109 (${centsAlsDeutsch(s.steuerbasisSummeCent, waehrung)}) entspricht nicht BT-106 minus BT-107 plus BT-108 (${centsAlsDeutsch(erwartetBt109, waehrung)}).`,
            });
        }
    }
    // BR-CO-14 & Steuerkategorien: Summe BT-117 == BT-110 sowie BT-117 == round(BT-116 * Satz)
    const summeBt117 = inv.steuerAufschluesselung.reduce((a, t) => a + (t.steuerCent ?? 0), 0);
    const bt110 = s.steuerSummeCent ?? 0;
    if (s.steuerSummeCent !== null && inv.steuerAufschluesselung.length > 0 && summeBt117 !== s.steuerSummeCent) {
        befunde.push({
            stufe: "fehler",
            code: "EN16931_BR_CO_14_BT110_STEUERSUMME",
            feld: "BT-110",
            zeile: s.steuerSummeZeile,
            meldung: `Steuergesamtbetrag BT-110 (${centsAlsDeutsch(s.steuerSummeCent, waehrung)}) weicht von der Summe der Steuerteilbeträge BT-117 (${centsAlsDeutsch(summeBt117, waehrung)}) ab.`,
        });
    }
    for (const st of inv.steuerAufschluesselung) {
        if (st.basisCent !== null && st.steuerCent !== null && st.satzScaled !== null) {
            const erwartetSteuer = prozentAufCent(st.basisCent, st.satzScaled);
            const diff = Math.abs(erwartetSteuer - st.steuerCent);
            if (diff > 1) {
                befunde.push({
                    stufe: "fehler",
                    code: "EN16931_STEUERBETRAG_RECHENFEHLER",
                    feld: "BT-117",
                    zeile: st.zeile,
                    meldung: `Steuerbetrag BT-117 (${centsAlsDeutsch(st.steuerCent, waehrung)}) weicht um ${centsAlsDeutsch(diff, waehrung)} vom rechnerischen Steuerbetrag (${centsAlsDeutsch(erwartetSteuer, waehrung)}) auf Basis ${centsAlsDeutsch(st.basisCent, waehrung)} ab.`,
                });
            }
        }
    }
    // BR-CO-15: BT-112 == BT-109 + BT-110
    if (s.steuerbasisSummeCent !== null && s.bruttoSummeCent !== null) {
        const erwartetBt112 = s.steuerbasisSummeCent + bt110;
        if (erwartetBt112 !== s.bruttoSummeCent) {
            befunde.push({
                stufe: "fehler",
                code: "EN16931_BR_CO_15_BT112_BRUTTO",
                feld: "BT-112",
                zeile: s.bruttoZeile,
                meldung: `Bruttogesamtbetrag BT-112 (${centsAlsDeutsch(s.bruttoSummeCent, waehrung)}) entspricht nicht BT-109 plus BT-110 (${centsAlsDeutsch(erwartetBt112, waehrung)}).`,
            });
        }
    }
    // BR-CO-16: BT-115 == BT-112 - BT-113 + BT-114
    if (s.bruttoSummeCent !== null && s.zahlbetragCent !== null) {
        const erwartetBt115 = s.bruttoSummeCent - bt113 + bt114;
        if (erwartetBt115 !== s.zahlbetragCent) {
            befunde.push({
                stufe: "fehler",
                code: "EN16931_BR_CO_16_BT115_ZAHLBETRAG",
                feld: "BT-115",
                zeile: s.zahlbetragZeile,
                meldung: `Zahlbetrag BT-115 (${centsAlsDeutsch(s.zahlbetragCent, waehrung)}) entspricht nicht BT-112 (${centsAlsDeutsch(s.bruttoSummeCent, waehrung)}) minus Vorauszahlung BT-113 (${centsAlsDeutsch(bt113, waehrung)}) plus Rundung BT-114 (${centsAlsDeutsch(bt114, waehrung)}) = ${centsAlsDeutsch(erwartetBt115, waehrung)}.`,
            });
        }
    }
    // 3. BMF-Schreiben 15.10.2026: Bau-/SHK-Abschlagsrechnungen & Schlussrechnungen (BT-113, BT-22, BT-25, BG-24)
    const alleNotizenText = inv.notizen.map((n) => n.text).join("\n");
    const allePosText = inv.positionen.map((p) => `${p.name ?? ""} ${p.beschreibung ?? ""}`).join("\n");
    const volltextKontext = `${alleNotizenText}\n${allePosText}`;
    const istSchlussrechnung = inv.typcode === "877" ||
        inv.typcode === "876" ||
        SCHLUSSRECHNUNG_PATTERN.test(volltextKontext) ||
        bt113 > 0;
    const istBauOderAbschlagKontext = istSchlussrechnung ||
        inv.typcode === "326" ||
        inv.typcode === "875" ||
        ABSCHLAG_PATTERN.test(volltextKontext) ||
        LV_REFERENCE_PATTERN.test(volltextKontext);
    // Pruefe unzulaessige Minus-Positionen zur Abschlagsverrechnung statt BT-113 / Anhang
    const negativeAbschlagPositionen = inv.positionen.filter((p) => (p.zeilenNettoCent ?? 0) < 0 && NEGATIVE_ABSCHLAG_LINE_PATTERN.test(`${p.name ?? ""} ${p.beschreibung ?? ""}`));
    if (negativeAbschlagPositionen.length > 0 && bt113 === 0) {
        const erste = negativeAbschlagPositionen[0];
        befunde.push({
            stufe: "fehler",
            code: "BMF_2026_BT113_FEHLT_BEI_ABSCHLAGSABZUG",
            feld: "BT-113",
            zeile: erste.zeile,
            meldung: `Position "${erste.id}" zieht vereinnahmte Abschläge als Minusposition (${centsAlsDeutsch(erste.zeilenNettoCent ?? 0, waehrung)}) ab, während BT-113 (Paid amount) auf 0,00 steht. Laut BMF-Schreiben vom 15.10.2026 (Übergangsregelung bis 30.06.2030) gehört der Abzug vereinnahmter Teilentgelte in BT-113 samt Einzelaufstellung in BT-22 oder als referenzierter Anhang in BG-24.`,
        });
    }
    // Schlussrechnung erwaehnt Abschläge, hat aber weder BT-113 > 0 noch Vorrechnungs-/Anhang-Aufstellung
    if ((inv.typcode === "877" || SCHLUSSRECHNUNG_PATTERN.test(alleNotizenText)) &&
        bt113 === 0 &&
        negativeAbschlagPositionen.length === 0 &&
        ABSCHLAG_PATTERN.test(volltextKontext)) {
        befunde.push({
            stufe: "fehler",
            code: "BMF_2026_BT113_FEHLT",
            feld: "BT-113",
            zeile: s.zahlbetragZeile,
            meldung: "Schlussrechnung verweist auf vorangegangene Abschläge, weist aber keinen vorausbezahlten Betrag in BT-113 (PrepaidAmount / TotalPrepaidAmount) aus.",
        });
    }
    // Wenn BT-113 > 0 gesetzt ist: BMF 15.10.2026 verlangt Variante 1 (Details in BT-22 / BT-25) ODER Variante 2 (eingebetteter/referenzierter Anhang BG-24)
    if (bt113 > 0) {
        const hatAufstellungInBt22 = inv.notizen.some((n) => /(?:abschlag|teilrechnung|anzahlung|rechnungs?-?nr|vom\s+\d|ust|mwst|\d+[.,]\d{2})/i.test(n.text) && n.text.length >= 20);
        const hatVorrechnungenBt25 = inv.vorherigeRechnungen.length > 0;
        const hatAufstellungsAnhangBg24 = inv.anhaenge.some((a) => a.hatEingebettetesObjekt || Boolean(a.dateiname) || Boolean(a.id));
        if (!hatAufstellungInBt22 && !hatVorrechnungenBt25 && !hatAufstellungsAnhangBg24) {
            befunde.push({
                stufe: "fehler",
                code: "BMF_2026_ABSCHLAG_AUFSTELLUNG_FEHLT",
                feld: "BT-22/BG-24",
                zeile: s.vorausbezahltZeile,
                meldung: `BT-113 setzt ${centsAlsDeutsch(bt113, waehrung)} ab, aber es fehlt sowohl die Einzelaufstellung der Teilentgelte in BT-22/BT-25 als auch ein referenzierter Anhang in BG-24 (BMF-Schreiben vom 15.10.2026, § 14 Abs. 5 UStG).`,
            });
        }
    }
    // 4. BMF-Schreiben 15.10.2026: Strukturierte Leistungsbeschreibung (BT-153 / BT-154 / BG-24 LV-Anhang)
    const hatLvAnhangBg24 = inv.anhaenge.some((a) => a.hatEingebettetesObjekt || Boolean(a.dateiname) || Boolean(a.uri) || Boolean(a.id));
    for (const pos of inv.positionen) {
        const kombiText = `${pos.name ?? ""} ${pos.beschreibung ?? ""}`;
        const verweistAufLv = LV_REFERENCE_PATTERN.test(kombiText);
        if (verweistAufLv && !hatLvAnhangBg24) {
            befunde.push({
                stufe: "fehler",
                code: "BMF_2026_BG24_LV_ANHANG_FEHLT",
                feld: "BG-24",
                zeile: pos.zeile,
                meldung: `Position "${pos.id}" verweist auf ein externes Leistungsverzeichnis/Aufmaß ("${(pos.name ?? "").trim()}"), aber BG-24 (AdditionalDocumentReference / AdditionalReferencedDocument) enthält keinen LV-Anhang. BMF 15.10.2026 laesst Gewerke-Hauptsummen im XML nur mit klar referenziertem LV-Anhang zu.`,
            });
        }
        if (!istKonkreteLeistungsbeschreibung(pos.name, pos.beschreibung) && !hatLvAnhangBg24) {
            befunde.push({
                stufe: "fehler",
                code: "BMF_2026_LEISTUNGSBESCHREIBUNG_PAUSCHAL",
                feld: "BT-153",
                zeile: pos.zeile,
                meldung: `Position "${pos.id}" enthält eine pauschale oder leere Leistungsbezeichnung ("${(pos.name ?? "").trim()}") ohne Detailbeschreibung (BT-154) und ohne referenzierten Anhang (BG-24). Nach BMF-Schreiben vom 15.10.2026 reichen unkonkrete Sammelbegriffe ab 01.01.2027 für den automatisierten Vorsteuercheck nicht aus.`,
            });
        }
        if (pos.einzelpreisNettoScaled !== null && pos.einzelpreisNettoScaled < 0n) {
            befunde.push({
                stufe: "fehler",
                code: "EN16931_BR27_NETTOPREIS_NEGATIV",
                feld: "BT-146",
                zeile: pos.zeile,
                meldung: `Position "${pos.id}" hat einen negativen Netto-Einzelpreis (${pos.einzelpreisRaw}). Nach EN 16931 Regel BR-27 darf BT-146 niemals negativ sein.`,
            });
        }
    }
    // 5. Storno- und Gutschrifts-Logik (381 / 384 / 389 vs. 380 mit negativem Gesamtbetrag)
    const istKorrekturOderGutschrift = inv.typcode === "381" || inv.typcode === "384" || inv.typcode === "389" || inv.syntax === "UBL_CREDIT_NOTE";
    if ((inv.typcode === "381" || inv.typcode === "384") && inv.vorherigeRechnungen.length === 0) {
        befunde.push({
            stufe: "fehler",
            code: "BMF_2026_STORNO_BEZUGSRECHNUNG_FEHLT",
            feld: "BT-25",
            zeile: inv.typcodeZeile,
            meldung: `Korrekturrechnung / Gutschrift (Typcode ${inv.typcode}) enthält keine Referenz auf die ursprüngliche Rechnung in BT-25 (Preceding Invoice Reference, BMF 15.10.2026).`,
        });
    }
    if (inv.typcode === "380" && (s.bruttoSummeCent ?? 0) < 0) {
        befunde.push({
            stufe: "fehler",
            code: "BMF_2026_STORNO_TYPCODE_FALSCH",
            feld: "BT-3",
            zeile: inv.typcodeZeile,
            meldung: `Rechnung mit Typcode 380 (Handelsrechnung) weist einen negativen Bruttogesamtbetrag (${centsAlsDeutsch(s.bruttoSummeCent ?? 0, waehrung)}) aus. Stornos und Rechnungskorrekturen müssen Typcode 381 oder 384 samt Bezugsrechnung (BT-25) verwenden.`,
        });
    }
    if (inv.typcode === "389" && /storno|korrektur|gutschrift\s+zu\s+rechnung/i.test(volltextKontext)) {
        befunde.push({
            stufe: "warnung",
            code: "BMF_2026_TYPCODE_389_VERWECHSLUNG",
            feld: "BT-3",
            zeile: inv.typcodeZeile,
            meldung: "Typcode 389 bezeichnet die umsatzsteuerliche Gutschrift (Abrechnung durch den Leistungsempfaenger nach § 14 Abs. 2 S. 2 UStG), nicht die kaufmännische Rechnungskorrektur/Storno (381 oder 384).",
        });
    }
    const fehlerAnzahl = befunde.filter((b) => b.stufe === "fehler").length;
    const warnungAnzahl = befunde.filter((b) => b.stufe === "warnung").length;
    return {
        ok: fehlerAnzahl === 0,
        quelleTyp,
        syntax: inv.syntax,
        profilId: inv.profilId,
        rechnungsnummer: inv.rechnungsnummer,
        ausstellungsdatum: inv.ausstellungsdatum,
        typcode: inv.typcode,
        istBauOderAbschlagKontext,
        istSchlussrechnung,
        istKorrekturOderGutschrift,
        waehrung,
        summen: {
            bt106PositionenNettoCent: s.positionenNettoSummeCent,
            bt107NachlaesseCent: bt107,
            bt108ZuschlaegeCent: bt108,
            bt109SteuerbasisCent: s.steuerbasisSummeCent,
            bt110SteuerCent: s.steuerSummeCent,
            bt112BruttoCent: s.bruttoSummeCent,
            bt113VorausbezahltCent: bt113,
            bt115ZahlbetragCent: s.zahlbetragCent,
            zahlbetragDeutsch: s.zahlbetragCent !== null ? centsAlsDeutsch(s.zahlbetragCent, waehrung) : null,
            zahlbetragIso: s.zahlbetragCent !== null ? centsAlsIso(s.zahlbetragCent) : null,
        },
        positionenAnzahl: inv.positionen.length,
        anhaengeAnzahl: inv.anhaenge.length,
        fehlerAnzahl,
        warnungAnzahl,
        befunde,
    };
}
/** Einstiegspunkt für XML-String oder hybriden PDF/A-3-Puffer. */
export function checkBmf2026Erechnung(input) {
    let xmlContent = input.xml;
    let quelleTyp = "XML";
    if (!xmlContent && input.pdfBytes) {
        quelleTyp = "PDF_HYBRID";
        const pdfInfo = inspectPdfContainer(input.pdfBytes);
        if (!pdfInfo.istPdf) {
            return {
                ok: false,
                quelleTyp,
                syntax: null,
                profilId: null,
                rechnungsnummer: null,
                ausstellungsdatum: null,
                typcode: null,
                istBauOderAbschlagKontext: false,
                istSchlussrechnung: false,
                istKorrekturOderGutschrift: false,
                waehrung: "EUR",
                summen: {
                    bt106PositionenNettoCent: null,
                    bt107NachlaesseCent: 0,
                    bt108ZuschlaegeCent: 0,
                    bt109SteuerbasisCent: null,
                    bt110SteuerCent: null,
                    bt112BruttoCent: null,
                    bt113VorausbezahltCent: 0,
                    bt115ZahlbetragCent: null,
                    zahlbetragDeutsch: null,
                    zahlbetragIso: null,
                },
                positionenAnzahl: 0,
                anhaengeAnzahl: 0,
                fehlerAnzahl: 1,
                warnungAnzahl: 0,
                befunde: [{ stufe: "fehler", code: "PDF_KEIN_GUELTIGES_DOKUMENT", feld: "PDF", zeile: 1, meldung: "Die übergebene PDF-Datei besitzt keinen gültigen %PDF-Header." }],
            };
        }
        const rechnungsAnhang = pdfInfo.anhaenge.find((a) => /\.xml$/i.test(a.dateiname)) ?? pdfInfo.anhaenge[0];
        if (!rechnungsAnhang) {
            return {
                ok: false,
                quelleTyp,
                syntax: null,
                profilId: null,
                rechnungsnummer: null,
                ausstellungsdatum: null,
                typcode: null,
                istBauOderAbschlagKontext: false,
                istSchlussrechnung: false,
                istKorrekturOderGutschrift: false,
                waehrung: "EUR",
                summen: {
                    bt106PositionenNettoCent: null,
                    bt107NachlaesseCent: 0,
                    bt108ZuschlaegeCent: 0,
                    bt109SteuerbasisCent: null,
                    bt110SteuerCent: null,
                    bt112BruttoCent: null,
                    bt113VorausbezahltCent: 0,
                    bt115ZahlbetragCent: null,
                    zahlbetragDeutsch: null,
                    zahlbetragIso: null,
                },
                positionenAnzahl: 0,
                anhaengeAnzahl: 0,
                fehlerAnzahl: 1,
                warnungAnzahl: 0,
                befunde: [{ stufe: "fehler", code: "PDFA3_EMBEDDED_XML_FEHLT", feld: "PDF/EmbeddedFiles", zeile: 1, meldung: "Im hybriden PDF wurde keine eingebettete E-Rechnungs-XML-Datei gefunden." }],
            };
        }
        xmlContent = rechnungsAnhang.inhaltUtf8;
    }
    if (!xmlContent || !xmlContent.trim()) {
        throw new Error("Weder XML-Inhalt noch hybride PDF-Datei zum Prüfen übergeben.");
    }
    try {
        const root = parseXmlDocument(xmlContent);
        const model = extractInvoiceModel(root);
        return validateInvoiceAgainstBmf2026(model, quelleTyp);
    }
    catch (err) {
        const line = err instanceof XmlParseError ? err.line : 1;
        const code = err instanceof XmlParseError ? err.code : "XML_STRUKTUR_FEHLER";
        return {
            ok: false,
            quelleTyp,
            syntax: null,
            profilId: null,
            rechnungsnummer: null,
            ausstellungsdatum: null,
            typcode: null,
            istBauOderAbschlagKontext: false,
            istSchlussrechnung: false,
            istKorrekturOderGutschrift: false,
            waehrung: "EUR",
            summen: {
                bt106PositionenNettoCent: null,
                bt107NachlaesseCent: 0,
                bt108ZuschlaegeCent: 0,
                bt109SteuerbasisCent: null,
                bt110SteuerCent: null,
                bt112BruttoCent: null,
                bt113VorausbezahltCent: 0,
                bt115ZahlbetragCent: null,
                zahlbetragDeutsch: null,
                zahlbetragIso: null,
            },
            positionenAnzahl: 0,
            anhaengeAnzahl: 0,
            fehlerAnzahl: 1,
            warnungAnzahl: 0,
            befunde: [{ stufe: "fehler", code, feld: "XML", zeile: line, meldung: err.message }],
        };
    }
}
