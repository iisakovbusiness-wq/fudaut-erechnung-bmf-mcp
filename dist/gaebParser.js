/**
 * Werkzeug 4: parse_gaeb_xml
 * Parst GAEB DA XML (X83 Angebotsaufforderung, X84 Angebotsabgabe, X86 Auftragserteilung; Versionen 3.2 & 3.3)
 * in sauberes, deterministisches ERP-JSON:
 * - Kopfdaten (Dateiphase, Projekt, Vergabe, Auftraggeber, Auftragnehmer, Währung, OZ-Maske)
 * - Hierarchische Los-/Titel-Struktur (BoQCtgy)
 * - Alle Positionen (OZ, Menge, Einheit, EP, ausgewiesener GP, exakt berechneter GP, Kurz-/Langtext, Bedarfsstatus)
 * - Automatischer Summenabgleich je Position, je Los/Titel und für das gesamte Leistungsverzeichnis.
 */
import { centsAlsDeutsch, centsAlsIso, mulScaled, parseXmlAmount, parseXmlScaled, prozentAufCent, scaledAlsText, scaledToCents, } from "./math.js";
import { XmlParseError, childByLocal, childrenByLocal, collectPlainText, pathByLocal, parseXmlDocument, textAtPath, } from "./xml.js";
const PHASE_NAMES = {
    X81: "Leistungsbeschreibung",
    X82: "Kostenansatz",
    X83: "Angebotsaufforderung",
    X84: "Angebotsabgabe",
    X85: "Nebenangebot",
    X86: "Auftragserteilung",
    X89: "Rechnung / Abrechnung",
};
function bestimmeDateiphase(root, awardNode, dateiname) {
    const dpText = textAtPath(awardNode, "DP")?.trim().toUpperCase();
    if (dpText) {
        if (/^X8\d$/.test(dpText))
            return dpText;
        if (/^8\d$/.test(dpText))
            return `X${dpText}`;
    }
    const nsMatch = /DA(8\d)\b/i.exec(root.ns);
    if (nsMatch)
        return `X${nsMatch[1]}`;
    if (dateiname) {
        const extMatch = /\.(x8\d)$/i.exec(dateiname.trim());
        if (extMatch)
            return extMatch[1].toUpperCase();
    }
    return "X83";
}
function leseAdresseName(partyNode) {
    if (!partyNode)
        return null;
    const addr = childByLocal(partyNode, "Address") ?? partyNode;
    const parts = ["Name1", "Name2", "Name3", "Name4"]
        .map((k) => textAtPath(addr, k)?.trim())
        .filter((x) => Boolean(x));
    if (parts.length > 0)
        return parts.join(" ");
    return textAtPath(partyNode, "Name")?.trim() ?? null;
}
function extrahiereItemTexte(itemNode) {
    const desc = childByLocal(itemNode, "Description");
    if (!desc)
        return { kurztext: "", langtext: null };
    const complete = childByLocal(desc, "CompleteText");
    const outlineNode = childByLocal(complete, "OutlineText") ??
        childByLocal(desc, "OutlineText");
    const outlTxtNode = pathByLocal(outlineNode, "OutlTxt", "TextOutlTxt") ??
        childByLocal(outlineNode, "OutlTxt") ??
        outlineNode;
    const detailNode = pathByLocal(complete, "DetailTxt", "Text") ??
        childByLocal(complete, "DetailTxt") ??
        childByLocal(desc, "DetailTxt");
    const kurztext = collectPlainText(outlTxtNode).replace(/\s*\n\s*/g, " ").trim();
    const langRaw = collectPlainText(detailNode).trim();
    const langtext = langRaw.length > 0 ? langRaw : null;
    return {
        kurztext: kurztext || (langtext ? langtext.split("\n")[0].slice(0, 120) : ""),
        langtext,
    };
}
export function parseGaebXml(xml, dateiname) {
    if (!xml || !xml.trim()) {
        throw new Error("Kein XML-Inhalt für parse_gaeb_xml übergeben.");
    }
    let root;
    try {
        root = parseXmlDocument(xml);
    }
    catch (err) {
        const line = err instanceof XmlParseError ? err.line : 1;
        const code = err instanceof XmlParseError ? err.code : "GAEB_XML_DEFEKT";
        return {
            ok: false,
            kopf: {
                dateiphase: "UNBEKANNT",
                phasenBezeichnung: "Unbekannt",
                gaebVersion: null,
                datum: null,
                waehrung: "EUR",
                projektnummer: null,
                projektname: null,
                vergabenummer: null,
                lvBezeichnung: null,
                auftraggeber: null,
                auftragnehmer: null,
                ozEbenenLaengen: [],
            },
            gruppen: [],
            positionen: [],
            summen: {
                positionenGesamt: 0,
                bepreistePositionen: 0,
                preiseErwartet: false,
                berechneteNettoCent: 0,
                berechneteNettoIso: "0.00",
                berechneteNettoDeutsch: "0,00 EUR",
                ausgewieseneNettoCent: null,
                ausgewieseneNettoIso: null,
                ausgewieseneNettoDeutsch: null,
                abweichungNettoCent: null,
                steuersatzProzent: null,
                ausgewieseneBruttoCent: null,
                berechneteBruttoCent: null,
            },
            fehlerAnzahl: 1,
            warnungAnzahl: 0,
            befunde: [{ stufe: "fehler", code, oz: null, zeile: line, meldung: err.message }],
        };
    }
    const befunde = [];
    if (root.localName !== "GAEB") {
        befunde.push({
            stufe: "fehler",
            code: "GAEB_FALSCHES_WURZELELEMENT",
            oz: null,
            zeile: root.line,
            meldung: `Unerwartetes Wurzelelement <${root.name}>; erwartet wird <GAEB> nach GAEB DA XML.`,
        });
    }
    const gaebInfo = childByLocal(root, "GAEBInfo");
    const prjInfo = childByLocal(root, "PrjInfo");
    const award = childByLocal(root, "Award") ?? childByLocal(root, "BoQ")?.children ? root : undefined;
    const awardNode = childByLocal(root, "Award");
    const awardInfo = childByLocal(awardNode, "AwardInfo");
    const boq = childByLocal(awardNode, "BoQ") ?? childByLocal(root, "BoQ");
    const boqInfo = childByLocal(boq, "BoQInfo");
    const dateiphase = bestimmeDateiphase(root, awardNode, dateiname);
    const phasenBezeichnung = PHASE_NAMES[dateiphase] ?? "GAEB-Austauschdatei";
    const preiseErwartet = dateiphase === "X84" || dateiphase === "X85" || dateiphase === "X86" || dateiphase === "X89";
    const waehrung = textAtPath(prjInfo, "Cur")?.trim() ||
        textAtPath(awardInfo, "Cur")?.trim() ||
        "EUR";
    const ozEbenenLaengen = childrenByLocal(boqInfo, "BoQBkdn")
        .map((b) => Number.parseInt(textAtPath(b, "BoQLevelLength") ?? textAtPath(b, "Length") ?? "", 10))
        .filter((n) => Number.isFinite(n) && n > 0);
    const kopf = {
        dateiphase,
        phasenBezeichnung,
        gaebVersion: textAtPath(gaebInfo, "Version"),
        datum: textAtPath(gaebInfo, "Date") ?? textAtPath(awardInfo, "OpenDate"),
        waehrung,
        projektnummer: textAtPath(awardInfo, "Prj") ?? textAtPath(prjInfo, "NamePrj"),
        projektname: textAtPath(prjInfo, "LblPrj") ?? textAtPath(prjInfo, "NamePrj"),
        vergabenummer: textAtPath(awardInfo, "AwardNo") ?? textAtPath(boqInfo, "Name"),
        lvBezeichnung: textAtPath(boqInfo, "LblBoQ") ?? textAtPath(boqInfo, "Name"),
        auftraggeber: leseAdresseName(childByLocal(awardNode, "OWN")),
        auftragnehmer: leseAdresseName(childByLocal(awardNode, "CTR")),
        ozEbenenLaengen,
    };
    const positionen = [];
    function verarbeiteItem(itemNode, gruppeOz, gruppeBezeichnung, indexInGruppe) {
        const rno = itemNode.attrs["RNoPart"]?.trim() || String(indexInGruppe + 1).padStart(4, "0");
        const oz = gruppeOz ? `${gruppeOz}.${rno}` : rno;
        const provisNode = childByLocal(itemNode, "Provis");
        const provisVal = provisNode?.text?.trim() ?? (provisNode ? "WithoutTotal" : null);
        const alnGroup = textAtPath(itemNode, "ALNGroupNo");
        const upOnlyTxt = (textAtPath(itemNode, "UPBkdn") ?? itemNode.attrs["UPOnly"] ?? "").toLowerCase();
        const nurEinheitspreis = childByLocal(itemNode, "HourIt") !== undefined || upOnlyTxt === "true" || upOnlyTxt === "yes";
        let positionsart = "Normalposition";
        let zaehltInGesamtsumme = true;
        if (provisVal !== null) {
            if (/withtotal/i.test(provisVal)) {
                positionsart = "BedarfspositionMitSumme";
                zaehltInGesamtsumme = true;
            }
            else {
                positionsart = "Bedarfsposition";
                zaehltInGesamtsumme = false;
            }
        }
        else if (alnGroup !== null && textAtPath(itemNode, "ALNSerNo") && textAtPath(itemNode, "ALNSerNo") !== "1") {
            positionsart = "Alternativposition";
            zaehltInGesamtsumme = false;
        }
        const qtyRaw = textAtPath(itemNode, "Qty")?.trim() ?? null;
        const mengeScaled = qtyRaw !== null ? parseXmlScaled(qtyRaw) : null;
        if (qtyRaw !== null && mengeScaled === null) {
            befunde.push({
                stufe: "fehler",
                code: "GAEB_UNGUELTIGE_MENGE",
                oz,
                zeile: itemNode.line,
                meldung: `Position ${oz} enthält eine ungültige Mengenangabe ("${qtyRaw}").`,
            });
        }
        const einheit = textAtPath(itemNode, "QU")?.trim() ?? null;
        const upRaw = textAtPath(itemNode, "UP")?.trim() ?? null;
        const upScaled = upRaw !== null && upRaw !== "" ? parseXmlScaled(upRaw) : null;
        if (upRaw !== null && upRaw !== "" && upScaled === null) {
            befunde.push({
                stufe: "fehler",
                code: "GAEB_UNGUELTIGER_EINHEITSPREIS",
                oz,
                zeile: itemNode.line,
                meldung: `Position ${oz} enthält einen ungültigen Einheitspreis ("${upRaw}").`,
            });
        }
        const itRaw = textAtPath(itemNode, "IT")?.trim() ?? null;
        const itParsed = itRaw !== null && itRaw !== "" ? parseXmlAmount(itRaw) : null;
        if (itRaw !== null && itRaw !== "" && itParsed === null) {
            befunde.push({
                stufe: "fehler",
                code: "GAEB_UNGUELTIGER_GESAMTPREIS",
                oz,
                zeile: itemNode.line,
                meldung: `Position ${oz} enthält einen ungültigen Gesamtpreis IT ("${itRaw}").`,
            });
        }
        const epCent = upScaled !== null ? scaledToCents(upScaled) : null;
        const epText = upScaled !== null ? scaledAlsText(upScaled, 2) : null;
        const gpAusgewiesenCent = itParsed ? itParsed.cents : null;
        let gpBerechnetCent = null;
        if (mengeScaled !== null && upScaled !== null && !nurEinheitspreis) {
            gpBerechnetCent = scaledToCents(mulScaled(mengeScaled, upScaled));
        }
        let abweichungCent = null;
        if (gpBerechnetCent !== null && gpAusgewiesenCent !== null) {
            abweichungCent = gpAusgewiesenCent - gpBerechnetCent;
            const absDiff = Math.abs(abweichungCent);
            if (absDiff > 1) {
                befunde.push({
                    stufe: "fehler",
                    code: "GAEB_POSITIONS_GP_ABWEICHUNG",
                    oz,
                    zeile: itemNode.line,
                    meldung: `Position ${oz}: Ausgewiesener Gesamtpreis IT (${centsAlsDeutsch(gpAusgewiesenCent, waehrung)}) weicht um ${centsAlsDeutsch(absDiff, waehrung)} vom Produkt Menge * Einheitspreis (${centsAlsDeutsch(gpBerechnetCent, waehrung)}) ab.`,
                });
            }
            else if (absDiff === 1) {
                befunde.push({
                    stufe: "warnung",
                    code: "GAEB_POSITIONS_EIN_CENT_RUNDUNG",
                    oz,
                    zeile: itemNode.line,
                    meldung: `Position ${oz}: 0,01 EUR Rundungsdifferenz zwischen Menge * EP (${centsAlsDeutsch(gpBerechnetCent, waehrung)}) und IT (${centsAlsDeutsch(gpAusgewiesenCent, waehrung)}).`,
                });
            }
        }
        if (preiseErwartet && upScaled === null && gpAusgewiesenCent === null && zaehltInGesamtsumme) {
            befunde.push({
                stufe: "fehler",
                code: "GAEB_PREISE_FEHLEN_IN_ANGEBOT",
                oz,
                zeile: itemNode.line,
                meldung: `Position ${oz} enthält in Phase ${dateiphase} (${phasenBezeichnung}) weder Einheitspreis (UP) noch Gesamtpreis (IT).`,
            });
        }
        const { kurztext, langtext } = extrahiereItemTexte(itemNode);
        const vatRaw = textAtPath(itemNode, "VAT")?.trim() ?? null;
        positionen.push({
            id: itemNode.attrs["ID"] ?? null,
            zeile: itemNode.line,
            oz,
            gruppeOz,
            gruppeBezeichnung,
            positionsart,
            zaehltInGesamtsumme,
            kurztext,
            langtext,
            menge: qtyRaw,
            einheit,
            epText,
            epCent,
            gpAusgewiesenCent,
            gpAusgewiesenIso: gpAusgewiesenCent !== null ? centsAlsIso(gpAusgewiesenCent) : null,
            gpBerechnetCent,
            gpBerechnetIso: gpBerechnetCent !== null ? centsAlsIso(gpBerechnetCent) : null,
            abweichungCent,
            nurEinheitspreis,
            steuersatzProzent: vatRaw,
        });
        if (!zaehltInGesamtsumme)
            return 0;
        return gpBerechnetCent ?? gpAusgewiesenCent ?? 0;
    }
    function verarbeiteItemlist(itemlistNode, gruppeOz, gruppeBezeichnung) {
        let summeCent = 0;
        let anzahl = 0;
        const items = childrenByLocal(itemlistNode, "Item");
        for (let i = 0; i < items.length; i++) {
            summeCent += verarbeiteItem(items[i], gruppeOz, gruppeBezeichnung, i);
            anzahl++;
        }
        return { summeCent, anzahl };
    }
    function verarbeiteCtgy(ctgyNode, elternOz) {
        const ozTeil = ctgyNode.attrs["RNoPart"]?.trim() || "";
        const pfadOz = elternOz && ozTeil ? `${elternOz}.${ozTeil}` : (ozTeil || elternOz);
        const lblNode = childByLocal(ctgyNode, "LblTx");
        const bezeichnung = collectPlainText(lblNode).replace(/\s*\n\s*/g, " ").trim() || pfadOz;
        let berechneteSummeCent = 0;
        let positionenAnzahl = 0;
        const untergruppen = [];
        // Kinder können direkt unter BoQCtgy oder unter BoQCtgy/BoQBody liegen
        const containerNodes = [ctgyNode, ...childrenByLocal(ctgyNode, "BoQBody")];
        for (const cont of containerNodes) {
            for (const subCtgy of childrenByLocal(cont, "BoQCtgy")) {
                const subSummary = verarbeiteCtgy(subCtgy, pfadOz);
                untergruppen.push(subSummary);
                berechneteSummeCent += subSummary.berechneteSummeCent;
                positionenAnzahl += subSummary.positionenAnzahl;
            }
            for (const il of childrenByLocal(cont, "Itemlist")) {
                const ilRes = verarbeiteItemlist(il, pfadOz, bezeichnung);
                berechneteSummeCent += ilRes.summeCent;
                positionenAnzahl += ilRes.anzahl;
            }
        }
        const totalsNode = childByLocal(ctgyNode, "Totals");
        const totalRaw = textAtPath(totalsNode, "Total")?.trim() ?? null;
        const parsedTotal = totalRaw !== null && totalRaw !== "" ? parseXmlAmount(totalRaw) : null;
        const ausgewieseneSummeCent = parsedTotal ? parsedTotal.cents : null;
        let abweichungCent = null;
        if (ausgewieseneSummeCent !== null) {
            abweichungCent = ausgewieseneSummeCent - berechneteSummeCent;
            const absDiff = Math.abs(abweichungCent);
            if (absDiff > 1) {
                befunde.push({
                    stufe: "fehler",
                    code: "GAEB_TITEL_SUMMEN_ABWEICHUNG",
                    oz: pfadOz,
                    zeile: totalsNode?.line ?? ctgyNode.line,
                    meldung: `Los/Titel ${pfadOz} ("${bezeichnung}"): Ausgewiesene Titelsumme (${centsAlsDeutsch(ausgewieseneSummeCent, waehrung)}) weicht um ${centsAlsDeutsch(absDiff, waehrung)} von der berechneten Positionssumme (${centsAlsDeutsch(berechneteSummeCent, waehrung)}) ab.`,
                });
            }
        }
        return {
            id: ctgyNode.attrs["ID"] ?? null,
            ozTeil,
            pfadOz,
            bezeichnung,
            positionenAnzahl,
            berechneteSummeCent,
            ausgewieseneSummeCent,
            abweichungCent,
            untergruppen,
        };
    }
    const gruppen = [];
    let berechneteNettoCent = 0;
    const boqBody = childByLocal(boq, "BoQBody");
    if (boqBody) {
        for (const ctgy of childrenByLocal(boqBody, "BoQCtgy")) {
            const g = verarbeiteCtgy(ctgy, "");
            gruppen.push(g);
            berechneteNettoCent += g.berechneteSummeCent;
        }
        for (const il of childrenByLocal(boqBody, "Itemlist")) {
            const ilRes = verarbeiteItemlist(il, "", kopf.lvBezeichnung ?? "Hauptverzeichnis");
            berechneteNettoCent += ilRes.summeCent;
        }
    }
    if (positionen.length === 0) {
        befunde.push({
            stufe: "fehler",
            code: "GAEB_KEINE_POSITIONEN",
            oz: null,
            zeile: boq?.line ?? root.line,
            meldung: "Im GAEB-Leistungsverzeichnis wurden keine Leistungspositionen (<Item>) gefunden.",
        });
    }
    const bepreistePositionen = positionen.filter((p) => p.epCent !== null || p.gpAusgewiesenCent !== null).length;
    if (!preiseErwartet && bepreistePositionen === 0 && positionen.length > 0) {
        befunde.push({
            stufe: "hinweis",
            code: "GAEB_X83_UNBEPREISTE_AUSSCHREIBUNG",
            oz: null,
            zeile: boq?.line ?? root.line,
            meldung: `Phase ${dateiphase} (${phasenBezeichnung}): ${positionen.length} Ausschreibungspositionen ohne Einheitspreise gelesen (erwartungsgemäß für X83).`,
        });
    }
    // Gesamtsummen aus BoQInfo/Totals oder BoQ/Totals prüfen
    const boqTotals = childByLocal(boqInfo, "Totals") ?? childByLocal(boq, "Totals");
    const totalNetRaw = textAtPath(boqTotals, "Total")?.trim() ?? textAtPath(boqTotals, "TotalNet")?.trim() ?? null;
    const totalNetParsed = totalNetRaw !== null && totalNetRaw !== "" ? parseXmlAmount(totalNetRaw) : null;
    const ausgewieseneNettoCent = totalNetParsed ? totalNetParsed.cents : null;
    const vatRaw = textAtPath(boqTotals, "VAT")?.trim() ?? null;
    const vatScaled = vatRaw !== null && vatRaw !== "" ? parseXmlScaled(vatRaw) : null;
    const totalGrossRaw = textAtPath(boqTotals, "TotalGross")?.trim() ?? null;
    const totalGrossParsed = totalGrossRaw !== null && totalGrossRaw !== "" ? parseXmlAmount(totalGrossRaw) : null;
    const ausgewieseneBruttoCent = totalGrossParsed ? totalGrossParsed.cents : null;
    const berechneteBruttoCent = vatScaled !== null && (bepreistePositionen > 0 || ausgewieseneNettoCent !== null)
        ? berechneteNettoCent + prozentAufCent(berechneteNettoCent, vatScaled)
        : null;
    let abweichungNettoCent = null;
    if (ausgewieseneNettoCent !== null) {
        abweichungNettoCent = ausgewieseneNettoCent - berechneteNettoCent;
        const absDiff = Math.abs(abweichungNettoCent);
        if (absDiff > 1) {
            befunde.push({
                stufe: "fehler",
                code: "GAEB_GESAMTSUMMEN_ABWEICHUNG",
                oz: null,
                zeile: boqTotals?.line ?? root.line,
                meldung: `Ausgewiesene LV-Gesamtsumme Netto (${centsAlsDeutsch(ausgewieseneNettoCent, waehrung)}) weicht um ${centsAlsDeutsch(absDiff, waehrung)} von der exakt berechneten Positionssumme (${centsAlsDeutsch(berechneteNettoCent, waehrung)}) ab.`,
            });
        }
        else if (absDiff === 1) {
            befunde.push({
                stufe: "warnung",
                code: "GAEB_GESAMTSUMME_EIN_CENT_RUNDUNG",
                oz: null,
                zeile: boqTotals?.line ?? root.line,
                meldung: `Ausgewiesene LV-Gesamtsumme Netto weicht um 0,01 EUR von der berechneten Positionssumme ab.`,
            });
        }
    }
    if (ausgewieseneBruttoCent !== null && ausgewieseneNettoCent !== null && vatScaled !== null) {
        const erwBruttoAusAusgewiesen = ausgewieseneNettoCent + prozentAufCent(ausgewieseneNettoCent, vatScaled);
        const diffGross = Math.abs(ausgewieseneBruttoCent - erwBruttoAusAusgewiesen);
        if (diffGross > 1) {
            befunde.push({
                stufe: "fehler",
                code: "GAEB_BRUTTOSUMMEN_ABWEICHUNG",
                oz: null,
                zeile: boqTotals?.line ?? root.line,
                meldung: `Ausgewiesene LV-Bruttosumme (${centsAlsDeutsch(ausgewieseneBruttoCent, waehrung)}) weicht um ${centsAlsDeutsch(diffGross, waehrung)} von Netto zuzüglich Umsatzsteuer (${centsAlsDeutsch(erwBruttoAusAusgewiesen, waehrung)}) ab.`,
            });
        }
    }
    const fehlerAnzahl = befunde.filter((b) => b.stufe === "fehler").length;
    const warnungAnzahl = befunde.filter((b) => b.stufe === "warnung").length;
    return {
        ok: fehlerAnzahl === 0,
        kopf,
        gruppen,
        positionen,
        summen: {
            positionenGesamt: positionen.length,
            bepreistePositionen,
            preiseErwartet,
            berechneteNettoCent,
            berechneteNettoIso: centsAlsIso(berechneteNettoCent),
            berechneteNettoDeutsch: centsAlsDeutsch(berechneteNettoCent, waehrung),
            ausgewieseneNettoCent,
            ausgewieseneNettoIso: ausgewieseneNettoCent !== null ? centsAlsIso(ausgewieseneNettoCent) : null,
            ausgewieseneNettoDeutsch: ausgewieseneNettoCent !== null ? centsAlsDeutsch(ausgewieseneNettoCent, waehrung) : null,
            abweichungNettoCent,
            steuersatzProzent: vatRaw,
            ausgewieseneBruttoCent,
            berechneteBruttoCent,
        },
        fehlerAnzahl,
        warnungAnzahl,
        befunde,
    };
}
