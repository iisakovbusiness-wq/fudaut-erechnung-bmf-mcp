/**
 * Werkzeug 3: check_shopware_storno_math
 * Prüft B2B-Gutschriften, Storno-/Korrekturrechnungen (381/384), Positionen und Nachlässe/Zuschläge
 * (BG-20/BG-21 sowie BG-27/BG-28) auf Vorzeichenfehler, fehlende Bezugsrechnungen, BR-27-Verstöße
 * und Brutto-zu-Netto-Rundungsdrift > 0,01 EUR (bekannte Shopware-6-Sonderfälle).
 */

import { ValidationSeverity } from "./bmf2026.js";
import { NormalizedInvoice, extractInvoiceModel } from "./invoiceModel.js";
import {
  CENT_FACTOR,
  centsAlsDeutsch,
  divScaled,
  mulScaled,
  prozentAufCent,
  scaledToCents,
} from "./math.js";
import { XmlParseError, parseXmlDocument } from "./xml.js";

export interface StornoMathFinding {
  stufe: ValidationSeverity;
  code: string;
  feld: string;
  zeile: number;
  abweichungCent: number;
  meldung: string;
}

export interface LineMathAudit {
  id: string;
  zeile: number;
  menge: string | null;
  einzelpreisNetto: string | null;
  ausgewiesenNettoCent: number | null;
  berechnetNettoCent: number | null;
  abweichungCent: number;
}

export interface ShopwareStornoCheckResult {
  ok: boolean;
  syntax: string | null;
  rechnungsnummer: string | null;
  typcode: string | null;
  istStornoOderGutschrift: boolean;
  bezugsrechnungen: string[];
  waehrung: string;
  maxRundungsdriftCent: number;
  vorzeichenfehlerAnzahl: number;
  rundungsfehlerAnzahl: number;
  fehlerAnzahl: number;
  warnungAnzahl: number;
  positionenPruefung: LineMathAudit[];
  summen: {
    bt106AusgewiesenCent: number | null;
    bt106BerechnetCent: number;
    bt107NachlaesseCent: number;
    bt108ZuschlaegeCent: number;
    bt109AusgewiesenCent: number | null;
    bt109BerechnetCent: number;
    bt110AusgewiesenCent: number | null;
    bt110BerechnetCent: number;
    bt112AusgewiesenCent: number | null;
    bt115AusgewiesenCent: number | null;
  };
  befunde: StornoMathFinding[];
}

export function auditShopwareStornoInvoice(inv: NormalizedInvoice): ShopwareStornoCheckResult {
  const befunde: StornoMathFinding[] = [];
  const waehrung = inv.waehrung ?? "EUR";
  let maxRundungsdriftCent = 0;
  let vorzeichenfehlerAnzahl = 0;
  let rundungsfehlerAnzahl = 0;

  const merkeDrift = (diffAbsCent: number): void => {
    if (diffAbsCent > maxRundungsdriftCent) maxRundungsdriftCent = diffAbsCent;
  };

  for (const ung of inv.summen.ungueltigeZahlenfelder) {
    befunde.push({
      stufe: "fehler",
      code: "SHOPWARE_UNGUELTIGES_ZAHLENFORMAT",
      feld: ung.feld,
      zeile: ung.zeile,
      abweichungCent: 0,
      meldung: `Ungültiger Dezimalwert "${ung.wert}" in ${ung.feld}.`,
    });
  }

  const istStornoOderGutschrift =
    inv.typcode === "381" ||
    inv.typcode === "384" ||
    inv.syntax === "UBL_CREDIT_NOTE" ||
    (inv.summen.bruttoSummeCent ?? 0) < 0;

  // 1. Dokumenttyp & Vorzeichen-Kohärenz bei Gutschrift / Storno
  if (inv.typcode === "380" && (inv.summen.bruttoSummeCent ?? 0) < 0) {
    vorzeichenfehlerAnzahl++;
    befunde.push({
      stufe: "fehler",
      code: "SHOPWARE_STORNO_FALSCHER_TYPCODE",
      feld: "BT-3",
      zeile: inv.typcodeZeile,
      abweichungCent: 0,
      meldung: `Storno mit negativem Bruttobetrag (${centsAlsDeutsch(inv.summen.bruttoSummeCent ?? 0, waehrung)}) wurde als Typcode 380 (Rechnung) statt 381 (Gutschrift) oder 384 (Rechnungskorrektur) exportiert.`,
    });
  }

  if ((inv.typcode === "381" || inv.typcode === "384" || inv.syntax === "UBL_CREDIT_NOTE") && inv.vorherigeRechnungen.length === 0) {
    befunde.push({
      stufe: "fehler",
      code: "SHOPWARE_STORNO_BEZUGSRECHNUNG_FEHLT",
      feld: "BT-25",
      zeile: inv.typcodeZeile,
      abweichungCent: 0,
      meldung: `B2B-Gutschrift/Korrektur (Typcode ${inv.typcode ?? "381"}) verweist in BT-25 nicht auf die ursprüngliche Rechnungsnummer.`,
    });
  }

  // Bei UBL CreditNote (381) oder CII 381 kehrt ein negativer Gesamtbetrag die Gutschrift in eine Forderung um!
  if (
    (inv.syntax === "UBL_CREDIT_NOTE" || inv.typcode === "381") &&
    (inv.summen.steuerbasisSummeCent ?? 0) < 0
  ) {
    vorzeichenfehlerAnzahl++;
    befunde.push({
      stufe: "fehler",
      code: "SHOPWARE_GUTSCHRIFT_VORZEICHEN_INVERTIERT",
      feld: "BT-109/BT-112",
      zeile: inv.summen.steuerbasisZeile,
      abweichungCent: Math.abs(inv.summen.steuerbasisSummeCent ?? 0) * 2,
      meldung: `Vorzeichenumkehr in Gutschrift (Typcode 381): Steuerbasis BT-109 ist negativ (${centsAlsDeutsch(inv.summen.steuerbasisSummeCent ?? 0, waehrung)}). In einer EN-16931-Gutschrift (381) müssen gutgeschriebene Beträge positiv ausgewiesen werden, sonst verbucht das Empfänger-ERP eine Nachbelastung.`,
    });
  }

  // 2. Positionspruefung (Einzelpreis BR-27, Doppel-Negation, BG-27/BG-28 und Rundungsdrift > 0,01 EUR)
  const positionenPruefung: LineMathAudit[] = [];
  for (const pos of inv.positionen) {
    if (pos.einzelpreisNettoScaled !== null && pos.einzelpreisNettoScaled < 0n) {
      vorzeichenfehlerAnzahl++;
      befunde.push({
        stufe: "fehler",
        code: "SHOPWARE_NETTOPREIS_NEGATIV_BR27",
        feld: `Position ${pos.id} BT-146`,
        zeile: pos.zeile,
        abweichungCent: 0,
        meldung: `Position "${pos.id}" exportiert einen negativen Netto-Einzelpreis (${pos.einzelpreisRaw}). EN 16931 Regel BR-27 verbietet negative Netto-Einzelpreise; Rabatte gehören in BG-20/BG-27, Gutschriften über Typcode 381.`,
      });
    }

    if (pos.mengeScaled !== null && pos.mengeScaled < 0n && pos.einzelpreisNettoScaled !== null && pos.einzelpreisNettoScaled < 0n) {
      vorzeichenfehlerAnzahl++;
      befunde.push({
        stufe: "fehler",
        code: "SHOPWARE_DOPPELTE_NEGATION_POSITION",
        zeile: pos.zeile,
        feld: `Position ${pos.id} BT-129/BT-146`,
        abweichungCent: 0,
        meldung: `Position "${pos.id}" kombiniert negative Menge (${pos.mengeRaw}) mit negativem Einzelpreis (${pos.einzelpreisRaw}), wodurch das Vorzeichen kippt.`,
      });
    }

    if (inv.syntax === "UBL_CREDIT_NOTE" && pos.mengeScaled !== null && pos.mengeScaled < 0n) {
      vorzeichenfehlerAnzahl++;
      befunde.push({
        stufe: "fehler",
        code: "SHOPWARE_CREDITNOTE_MENGE_NEGATIV",
        feld: `Position ${pos.id} BT-129`,
        zeile: pos.zeile,
        abweichungCent: 0,
        meldung: `Position "${pos.id}" in UBL CreditNote enthält eine negative Gutschriftsmenge (${pos.mengeRaw}).`,
      });
    }

    for (const la of pos.nachlaesse) {
      if (la.betragCent < 0) {
        vorzeichenfehlerAnzahl++;
        befunde.push({
          stufe: "fehler",
          code: "SHOPWARE_BG27_VORZEICHEN_INVERTIERT",
          feld: `Position ${pos.id} BG-27`,
          zeile: la.zeile,
          abweichungCent: Math.abs(la.betragCent) * 2,
          meldung: `Positionsnachlass (BG-27) in Position "${pos.id}" ist negativ (${centsAlsDeutsch(la.betragCent, waehrung)}) und erhöht dadurch den Positionsnettobetrag statt ihn zu reduzieren.`,
        });
      }
    }
    for (const lc of pos.zuschlaege) {
      if (lc.betragCent < 0) {
        vorzeichenfehlerAnzahl++;
        befunde.push({
          stufe: "fehler",
          code: "SHOPWARE_BG28_VORZEICHEN_INVERTIERT",
          feld: `Position ${pos.id} BG-28`,
          zeile: lc.zeile,
          abweichungCent: Math.abs(lc.betragCent) * 2,
          meldung: `Positionszuschlag (BG-28) in Position "${pos.id}" ist negativ (${centsAlsDeutsch(lc.betragCent, waehrung)}).`,
        });
      }
    }

    let berechnetNettoCent: number | null = null;
    let abweichungCent = 0;
    if (pos.mengeScaled !== null && pos.einzelpreisNettoScaled !== null) {
      const roherZeilenpreis = divScaled(mulScaled(pos.mengeScaled, pos.einzelpreisNettoScaled), pos.basismengeScaled);
      const nachlassScaled = pos.nachlaesse.reduce((a, n) => a + BigInt(n.betragCent) * CENT_FACTOR, 0n);
      const zuschlagScaled = pos.zuschlaege.reduce((a, z) => a + BigInt(z.betragCent) * CENT_FACTOR, 0n);
      berechnetNettoCent = scaledToCents(roherZeilenpreis - nachlassScaled + zuschlagScaled);

      if (pos.zeilenNettoCent !== null) {
        abweichungCent = pos.zeilenNettoCent - berechnetNettoCent;
        const absDiff = Math.abs(abweichungCent);
        merkeDrift(absDiff);

        if (absDiff > 1) {
          rundungsfehlerAnzahl++;
          befunde.push({
            stufe: "fehler",
            code: "SHOPWARE_POSITIONS_RUNDUNGSDRIFT",
            feld: `Position ${pos.id} BT-131`,
            zeile: pos.zeilenNettoZeile,
            abweichungCent,
            meldung: `Position "${pos.id}": Ausgewiesener Positionsnettobetrag (${centsAlsDeutsch(pos.zeilenNettoCent, waehrung)}) weicht um ${centsAlsDeutsch(absDiff, waehrung)} (> 0,01 EUR) vom exakt berechneten Nettobetrag (${centsAlsDeutsch(berechnetNettoCent, waehrung)}) ab.`,
          });
        } else if (absDiff === 1) {
          befunde.push({
            stufe: "warnung",
            code: "SHOPWARE_POSITIONS_EIN_CENT_RUNDUNG",
            feld: `Position ${pos.id} BT-131`,
            zeile: pos.zeilenNettoZeile,
            abweichungCent,
            meldung: `Position "${pos.id}": Brutto-zu-Netto-Einzelpreisrundung von 0,01 EUR zwischen berechnetem Wert (${centsAlsDeutsch(berechnetNettoCent, waehrung)}) und BT-131 (${centsAlsDeutsch(pos.zeilenNettoCent, waehrung)}).`,
          });
        }
      }
    }

    positionenPruefung.push({
      id: pos.id,
      zeile: pos.zeile,
      menge: pos.mengeRaw,
      einzelpreisNetto: pos.einzelpreisRaw,
      ausgewiesenNettoCent: pos.zeilenNettoCent,
      berechnetNettoCent,
      abweichungCent,
    });
  }

  // 3. Dokumentenebene Nachlässe (BG-20) und Zuschläge (BG-21)
  for (const dn of inv.dokumentNachlaesse) {
    if (dn.betragCent < 0) {
      vorzeichenfehlerAnzahl++;
      befunde.push({
        stufe: "fehler",
        code: "SHOPWARE_BG20_VORZEICHEN_INVERTIERT",
        feld: "BG-20",
        zeile: dn.zeile,
        abweichungCent: Math.abs(dn.betragCent) * 2,
        meldung: `Dokumentennachlass BG-20 ("${dn.grund ?? "Rabatt"}") ist mit negativem Betrag (${centsAlsDeutsch(dn.betragCent, waehrung)}) eingetragen. Durch BT-109 = BT-106 - BT-107 wird der Rabatt aufgeschlagen statt abgezogen.`,
      });
    }
    if (!dn.steuerKategorie || (dn.steuerKategorie === "S" && dn.steuersatzScaled === null)) {
      befunde.push({
        stufe: "fehler",
        code: "SHOPWARE_BG20_BG21_STEUERANGABE_FEHLT",
        feld: "BG-20/BT-95/BT-96",
        zeile: dn.zeile,
        abweichungCent: 0,
        meldung: `Dokumentennachlass BG-20 ("${dn.grund ?? "Rabatt"}") hat keine vollständige Umsatzsteuer-Kategorie / Steuersatzangabe.`,
      });
    }
    if (dn.basisBetragCent !== null && dn.prozentScaled !== null && dn.betragCent >= 0) {
      const erwRabatt = prozentAufCent(dn.basisBetragCent, dn.prozentScaled);
      const diff = Math.abs(erwRabatt - dn.betragCent);
      merkeDrift(diff);
      if (diff > 1) {
        rundungsfehlerAnzahl++;
        befunde.push({
          stufe: "fehler",
          code: "SHOPWARE_BG20_PROZENT_RUNDUNGSDRIFT",
          feld: "BG-20/BT-92",
          zeile: dn.zeile,
          abweichungCent: dn.betragCent - erwRabatt,
          meldung: `Nachlass BG-20 (${centsAlsDeutsch(dn.betragCent, waehrung)}) weicht um ${centsAlsDeutsch(diff, waehrung)} (> 0,01 EUR) vom Prozentwert auf Basis ${centsAlsDeutsch(dn.basisBetragCent, waehrung)} (${centsAlsDeutsch(erwRabatt, waehrung)}) ab.`,
        });
      }
    }
  }

  for (const dz of inv.dokumentZuschlaege) {
    if (dz.betragCent < 0) {
      vorzeichenfehlerAnzahl++;
      befunde.push({
        stufe: "fehler",
        code: "SHOPWARE_BG21_VORZEICHEN_INVERTIERT",
        feld: "BG-21",
        zeile: dz.zeile,
        abweichungCent: Math.abs(dz.betragCent) * 2,
        meldung: `Dokumentenzuschlag BG-21 ("${dz.grund ?? "Versand/Nebenkosten"}") hat einen negativen Betrag (${centsAlsDeutsch(dz.betragCent, waehrung)}).`,
      });
    }
    if (!dz.steuerKategorie || (dz.steuerKategorie === "S" && dz.steuersatzScaled === null)) {
      befunde.push({
        stufe: "fehler",
        code: "SHOPWARE_BG20_BG21_STEUERANGABE_FEHLT",
        feld: "BG-21/BT-102/BT-103",
        zeile: dz.zeile,
        abweichungCent: 0,
        meldung: `Dokumentenzuschlag BG-21 ("${dz.grund ?? "Zuschlag"}") hat keine vollständige Umsatzsteuer-Kategorie / Steuersatzangabe.`,
      });
    }
  }

  const s = inv.summen;
  if ((s.nachlaesseSummeCent ?? 0) < 0) {
    vorzeichenfehlerAnzahl++;
    befunde.push({
      stufe: "fehler",
      code: "SHOPWARE_BT107_NEGATIV",
      feld: "BT-107",
      zeile: s.nachlaesseZeile,
      abweichungCent: Math.abs(s.nachlaesseSummeCent ?? 0) * 2,
      meldung: `Nachlasssumme BT-107 ist negativ (${centsAlsDeutsch(s.nachlaesseSummeCent ?? 0, waehrung)}).`,
    });
  }
  if ((s.zuschlaegeSummeCent ?? 0) < 0) {
    vorzeichenfehlerAnzahl++;
    befunde.push({
      stufe: "fehler",
      code: "SHOPWARE_BT108_NEGATIV",
      feld: "BT-108",
      zeile: s.zuschlaegeZeile,
      abweichungCent: Math.abs(s.zuschlaegeSummeCent ?? 0) * 2,
      meldung: `Zuschlagssumme BT-108 ist negativ (${centsAlsDeutsch(s.zuschlaegeSummeCent ?? 0, waehrung)}).`,
    });
  }

  // 4. Kopfsummen & Umsatzsteuer-Rundungsdrift
  const bt106BerechnetCent = inv.positionen.reduce((a, p) => a + (p.zeilenNettoCent ?? 0), 0);
  const sumBg20 = inv.dokumentNachlaesse.reduce((a, x) => a + x.betragCent, 0);
  const sumBg21 = inv.dokumentZuschlaege.reduce((a, x) => a + x.betragCent, 0);
  const bt107Effektiv = inv.dokumentNachlaesse.length > 0 ? sumBg20 : (s.nachlaesseSummeCent ?? 0);
  const bt108Effektiv = inv.dokumentZuschlaege.length > 0 ? sumBg21 : (s.zuschlaegeSummeCent ?? 0);

  if (s.nachlaesseSummeCent !== null && inv.dokumentNachlaesse.length > 0 && s.nachlaesseSummeCent !== sumBg20) {
    const diff = Math.abs(s.nachlaesseSummeCent - sumBg20);
    merkeDrift(diff);
    rundungsfehlerAnzahl++;
    befunde.push({
      stufe: "fehler",
      code: "SHOPWARE_BG20_BG21_SUMMENFEHLER",
      feld: "BT-107",
      zeile: s.nachlaesseZeile,
      abweichungCent: s.nachlaesseSummeCent - sumBg20,
      meldung: `BT-107 (${centsAlsDeutsch(s.nachlaesseSummeCent, waehrung)}) weicht von der Summe der BG-20-Nachlässe (${centsAlsDeutsch(sumBg20, waehrung)}) ab.`,
    });
  }

  if (s.zuschlaegeSummeCent !== null && inv.dokumentZuschlaege.length > 0 && s.zuschlaegeSummeCent !== sumBg21) {
    const diff = Math.abs(s.zuschlaegeSummeCent - sumBg21);
    merkeDrift(diff);
    rundungsfehlerAnzahl++;
    befunde.push({
      stufe: "fehler",
      code: "SHOPWARE_BG20_BG21_SUMMENFEHLER",
      feld: "BT-108",
      zeile: s.zuschlaegeZeile,
      abweichungCent: s.zuschlaegeSummeCent - sumBg21,
      meldung: `BT-108 (${centsAlsDeutsch(s.zuschlaegeSummeCent, waehrung)}) weicht von der Summe der BG-21-Zuschläge (${centsAlsDeutsch(sumBg21, waehrung)}) ab.`,
    });
  }

  if (s.positionenNettoSummeCent !== null && s.positionenNettoSummeCent !== bt106BerechnetCent) {
    const diff = Math.abs(s.positionenNettoSummeCent - bt106BerechnetCent);
    merkeDrift(diff);
    if (diff > 1) {
      rundungsfehlerAnzahl++;
      befunde.push({
        stufe: "fehler",
        code: "SHOPWARE_BT106_RUNDUNGSDRIFT",
        feld: "BT-106",
        zeile: s.positionenNettoZeile,
        abweichungCent: s.positionenNettoSummeCent - bt106BerechnetCent,
        meldung: `Positionsnettosumme BT-106 (${centsAlsDeutsch(s.positionenNettoSummeCent, waehrung)}) weicht um ${centsAlsDeutsch(diff, waehrung)} (> 0,01 EUR) von der Summe der BT-131-Positionen (${centsAlsDeutsch(bt106BerechnetCent, waehrung)}) ab.`,
      });
    } else {
      befunde.push({
        stufe: "warnung",
        code: "SHOPWARE_BT106_EIN_CENT_ABWEICHUNG",
        feld: "BT-106",
        zeile: s.positionenNettoZeile,
        abweichungCent: s.positionenNettoSummeCent - bt106BerechnetCent,
        meldung: `BT-106 weicht um 0,01 EUR von der Summe der Positionsnettobeträge ab.`,
      });
    }
  }

  const bt109BerechnetCent = bt106BerechnetCent - bt107Effektiv + bt108Effektiv;
  if (s.steuerbasisSummeCent !== null && s.steuerbasisSummeCent !== bt109BerechnetCent) {
    const diff = Math.abs(s.steuerbasisSummeCent - bt109BerechnetCent);
    merkeDrift(diff);
    if (diff > 1) {
      rundungsfehlerAnzahl++;
      befunde.push({
        stufe: "fehler",
        code: "SHOPWARE_BT109_STEUERBASIS_DRIFT",
        feld: "BT-109",
        zeile: s.steuerbasisZeile,
        abweichungCent: s.steuerbasisSummeCent - bt109BerechnetCent,
        meldung: `Steuerbasis BT-109 (${centsAlsDeutsch(s.steuerbasisSummeCent, waehrung)}) weicht um ${centsAlsDeutsch(diff, waehrung)} (> 0,01 EUR) von BT-106 minus Nachlässe plus Zuschläge (${centsAlsDeutsch(bt109BerechnetCent, waehrung)}) ab.`,
      });
    } else {
      befunde.push({
        stufe: "warnung",
        code: "SHOPWARE_BT109_EIN_CENT_ABWEICHUNG",
        feld: "BT-109",
        zeile: s.steuerbasisZeile,
        abweichungCent: s.steuerbasisSummeCent - bt109BerechnetCent,
        meldung: `Steuerbasis BT-109 weicht um 0,01 EUR vom berechneten Nettobetrag ab.`,
      });
    }
  }

  // Umsatzsteuer je Steuersatz prüfen
  let bt110BerechnetCent = 0;
  for (const st of inv.steuerAufschluesselung) {
    if (st.basisCent !== null && st.satzScaled !== null) {
      const erwSteuer = prozentAufCent(st.basisCent, st.satzScaled);
      bt110BerechnetCent += erwSteuer;
      if (st.steuerCent !== null) {
        const diff = Math.abs(st.steuerCent - erwSteuer);
        merkeDrift(diff);
        if (diff > 1) {
          rundungsfehlerAnzahl++;
          befunde.push({
            stufe: "fehler",
            code: "SHOPWARE_STEUER_RUNDUNGSDRIFT",
            feld: "BT-117",
            zeile: st.zeile,
            abweichungCent: st.steuerCent - erwSteuer,
            meldung: `Umsatzsteuer BT-117 (${centsAlsDeutsch(st.steuerCent, waehrung)}) weicht um ${centsAlsDeutsch(diff, waehrung)} (> 0,01 EUR) vom rechnerischen Steuerwert (${centsAlsDeutsch(erwSteuer, waehrung)}) auf Basis ${centsAlsDeutsch(st.basisCent, waehrung)} ab (typische Shopware-Bruttopreis-Summenrundung).`,
          });
        } else if (diff === 1) {
          befunde.push({
            stufe: "warnung",
            code: "SHOPWARE_STEUER_EIN_CENT_RUNDUNG",
            feld: "BT-117",
            zeile: st.zeile,
            abweichungCent: st.steuerCent - erwSteuer,
            meldung: `Umsatzsteuer BT-117 weicht um 0,01 EUR vom rechnerischen Netto-Steuerbetrag ab.`,
          });
        }
      }
    }
  }

  if (s.steuerSummeCent !== null && inv.steuerAufschluesselung.length > 0) {
    const sumAusgewieseneSteuer = inv.steuerAufschluesselung.reduce((a, t) => a + (t.steuerCent ?? 0), 0);
    const diff = Math.abs(s.steuerSummeCent - sumAusgewieseneSteuer);
    merkeDrift(diff);
    if (diff > 1) {
      rundungsfehlerAnzahl++;
      befunde.push({
        stufe: "fehler",
        code: "SHOPWARE_BT110_STEUERSUMMEN_DRIFT",
        feld: "BT-110",
        zeile: s.steuerSummeZeile,
        abweichungCent: s.steuerSummeCent - sumAusgewieseneSteuer,
        meldung: `Steuergesamtbetrag BT-110 (${centsAlsDeutsch(s.steuerSummeCent, waehrung)}) weicht um ${centsAlsDeutsch(diff, waehrung)} von der Summe der Steuerteilbeträge (${centsAlsDeutsch(sumAusgewieseneSteuer, waehrung)}) ab.`,
      });
    }
  }

  if (s.steuerbasisSummeCent !== null && s.steuerSummeCent !== null && s.bruttoSummeCent !== null) {
    const erwBrutto = s.steuerbasisSummeCent + s.steuerSummeCent;
    const diff = Math.abs(s.bruttoSummeCent - erwBrutto);
    merkeDrift(diff);
    if (diff > 1) {
      rundungsfehlerAnzahl++;
      befunde.push({
        stufe: "fehler",
        code: "SHOPWARE_GESAMTSUMMEN_RUNDUNGSDRIFT",
        feld: "BT-112",
        zeile: s.bruttoZeile,
        abweichungCent: s.bruttoSummeCent - erwBrutto,
        meldung: `Bruttobetrag BT-112 (${centsAlsDeutsch(s.bruttoSummeCent, waehrung)}) weicht um ${centsAlsDeutsch(diff, waehrung)} (> 0,01 EUR) von Netto plus Steuer (${centsAlsDeutsch(erwBrutto, waehrung)}) ab.`,
      });
    } else if (diff === 1) {
      befunde.push({
        stufe: "warnung",
        code: "SHOPWARE_BRUTTO_EIN_CENT_ABWEICHUNG",
        feld: "BT-112",
        zeile: s.bruttoZeile,
        abweichungCent: s.bruttoSummeCent - erwBrutto,
        meldung: `Bruttobetrag BT-112 weicht um 0,01 EUR von Netto plus Steuer ab.`,
      });
    }
  }

  if (s.bruttoSummeCent !== null && s.zahlbetragCent !== null) {
    const erwZahl = s.bruttoSummeCent - (s.vorausbezahltCent ?? 0) + (s.rundungsbetragCent ?? 0);
    const diff = Math.abs(s.zahlbetragCent - erwZahl);
    merkeDrift(diff);
    if (diff > 1) {
      rundungsfehlerAnzahl++;
      befunde.push({
        stufe: "fehler",
        code: "SHOPWARE_ZAHLBETRAG_DRIFT",
        feld: "BT-115",
        zeile: s.zahlbetragZeile,
        abweichungCent: s.zahlbetragCent - erwZahl,
        meldung: `Zahlbetrag BT-115 (${centsAlsDeutsch(s.zahlbetragCent, waehrung)}) weicht um ${centsAlsDeutsch(diff, waehrung)} (> 0,01 EUR) vom erwarteten Zahlbetrag (${centsAlsDeutsch(erwZahl, waehrung)}) ab.`,
      });
    }
  }

  const fehlerAnzahl = befunde.filter((b) => b.stufe === "fehler").length;
  const warnungAnzahl = befunde.filter((b) => b.stufe === "warnung").length;

  return {
    ok: fehlerAnzahl === 0,
    syntax: inv.syntax,
    rechnungsnummer: inv.rechnungsnummer,
    typcode: inv.typcode,
    istStornoOderGutschrift,
    bezugsrechnungen: inv.vorherigeRechnungen.map((r) => r.nummer),
    waehrung,
    maxRundungsdriftCent,
    vorzeichenfehlerAnzahl,
    rundungsfehlerAnzahl,
    fehlerAnzahl,
    warnungAnzahl,
    positionenPruefung,
    summen: {
      bt106AusgewiesenCent: s.positionenNettoSummeCent,
      bt106BerechnetCent,
      bt107NachlaesseCent: bt107Effektiv,
      bt108ZuschlaegeCent: bt108Effektiv,
      bt109AusgewiesenCent: s.steuerbasisSummeCent,
      bt109BerechnetCent,
      bt110AusgewiesenCent: s.steuerSummeCent,
      bt110BerechnetCent,
      bt112AusgewiesenCent: s.bruttoSummeCent,
      bt115AusgewiesenCent: s.zahlbetragCent,
    },
    befunde,
  };
}

export function checkShopwareStornoMath(xml: string): ShopwareStornoCheckResult {
  if (!xml || !xml.trim()) {
    throw new Error("Kein XML-Inhalt für check_shopware_storno_math übergeben.");
  }
  try {
    const root = parseXmlDocument(xml);
    const inv = extractInvoiceModel(root);
    return auditShopwareStornoInvoice(inv);
  } catch (err) {
    const line = err instanceof XmlParseError ? err.line : 1;
    const code = err instanceof XmlParseError ? err.code : "XML_STRUKTUR_FEHLER";
    return {
      ok: false,
      syntax: null,
      rechnungsnummer: null,
      typcode: null,
      istStornoOderGutschrift: false,
      bezugsrechnungen: [],
      waehrung: "EUR",
      maxRundungsdriftCent: 0,
      vorzeichenfehlerAnzahl: 0,
      rundungsfehlerAnzahl: 0,
      fehlerAnzahl: 1,
      warnungAnzahl: 0,
      positionenPruefung: [],
      summen: {
        bt106AusgewiesenCent: null,
        bt106BerechnetCent: 0,
        bt107NachlaesseCent: 0,
        bt108ZuschlaegeCent: 0,
        bt109AusgewiesenCent: null,
        bt109BerechnetCent: 0,
        bt110AusgewiesenCent: null,
        bt110BerechnetCent: 0,
        bt112AusgewiesenCent: null,
        bt115AusgewiesenCent: null,
      },
      befunde: [{ stufe: "fehler", code, feld: "XML", zeile: line, abweichungCent: 0, meldung: (err as Error).message }],
    };
  }
}
