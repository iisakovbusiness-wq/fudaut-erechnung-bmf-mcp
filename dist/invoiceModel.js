/**
 * Kanonisches EN-16931-Rechnungsmodell für UBL 2.1 (Invoice & CreditNote) und UN/CEFACT CII (CrossIndustryInvoice).
 * Extrahiert alle Geschäftsbegriffe (BT/BG) samt Zeilennummern und Festkomma-Werten.
 */
import { SCALE, parseXmlAmount, parseXmlScaled } from "./math.js";
import { childByLocal, childrenByLocal, pathByLocal, textAtPath } from "./xml.js";
function normalisiereDatum(raw) {
    if (!raw)
        return null;
    const t = raw.trim();
    if (/^\d{8}$/.test(t)) {
        return `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}`;
    }
    return t || null;
}
function leseBetragFeld(knoten, feldName, ungueltige) {
    if (!knoten)
        return { cents: null, scaled: null, zeile: 1 };
    const parsed = parseXmlAmount(knoten.text);
    if (!parsed) {
        ungueltige.push({ feld: feldName, wert: knoten.text, zeile: knoten.line });
        return { cents: null, scaled: null, zeile: knoten.line };
    }
    return { cents: parsed.cents, scaled: parsed.scaled, zeile: knoten.line };
}
function parseUblAllowanceCharges(parent, ungueltige, kontext) {
    const nachlaesse = [];
    const zuschlaege = [];
    for (const ac of childrenByLocal(parent, "AllowanceCharge")) {
        const indTxt = (textAtPath(ac, "ChargeIndicator") ?? "false").trim().toLowerCase();
        const istZuschlag = indTxt === "true" || indTxt === "1";
        const amtNode = childByLocal(ac, "Amount");
        const amt = leseBetragFeld(amtNode, `${kontext}/Amount`, ungueltige);
        const baseNode = childByLocal(ac, "BaseAmount");
        const base = baseNode ? leseBetragFeld(baseNode, `${kontext}/BaseAmount`, ungueltige).cents : null;
        const pctTxt = textAtPath(ac, "MultiplierFactorNumeric");
        const pct = pctTxt !== null ? parseXmlScaled(pctTxt) : null;
        const taxCat = childByLocal(ac, "TaxCategory");
        const steuerKategorie = textAtPath(taxCat, "ID");
        const satzTxt = textAtPath(taxCat, "Percent");
        const steuersatzScaled = satzTxt !== null ? parseXmlScaled(satzTxt) : null;
        const entry = {
            istZuschlag,
            betragCent: amt.cents ?? 0,
            betragScaled: amt.scaled ?? 0n,
            betragRaw: amtNode?.text ?? "",
            basisBetragCent: base,
            prozentScaled: pct,
            grund: textAtPath(ac, "AllowanceChargeReason"),
            steuerKategorie,
            steuersatzScaled,
            zeile: ac.line,
        };
        if (istZuschlag)
            zuschlaege.push(entry);
        else
            nachlaesse.push(entry);
    }
    return { nachlaesse, zuschlaege };
}
function parseCiiAllowanceCharges(parent, ungueltige, kontext) {
    const nachlaesse = [];
    const zuschlaege = [];
    if (!parent)
        return { nachlaesse, zuschlaege };
    for (const ac of childrenByLocal(parent, "SpecifiedTradeAllowanceCharge")) {
        const indTxt = (textAtPath(ac, "ChargeIndicator", "Indicator") ?? "false").trim().toLowerCase();
        const istZuschlag = indTxt === "true" || indTxt === "1";
        const amtNode = childByLocal(ac, "ActualAmount");
        const amt = leseBetragFeld(amtNode, `${kontext}/ActualAmount`, ungueltige);
        const baseNode = childByLocal(ac, "BasisAmount");
        const base = baseNode ? leseBetragFeld(baseNode, `${kontext}/BasisAmount`, ungueltige).cents : null;
        const pctTxt = textAtPath(ac, "CalculationPercent");
        const pct = pctTxt !== null ? parseXmlScaled(pctTxt) : null;
        const taxCat = childByLocal(ac, "CategoryTradeTax");
        const steuerKategorie = textAtPath(taxCat, "CategoryCode");
        const satzTxt = textAtPath(taxCat, "RateApplicablePercent");
        const steuersatzScaled = satzTxt !== null ? parseXmlScaled(satzTxt) : null;
        const entry = {
            istZuschlag,
            betragCent: amt.cents ?? 0,
            betragScaled: amt.scaled ?? 0n,
            betragRaw: amtNode?.text ?? "",
            basisBetragCent: base,
            prozentScaled: pct,
            grund: textAtPath(ac, "Reason"),
            steuerKategorie,
            steuersatzScaled,
            zeile: ac.line,
        };
        if (istZuschlag)
            zuschlaege.push(entry);
        else
            nachlaesse.push(entry);
    }
    return { nachlaesse, zuschlaege };
}
function extractUbl(root, isCreditNote) {
    const ungueltige = [];
    const typNode = childByLocal(root, isCreditNote ? "CreditNoteTypeCode" : "InvoiceTypeCode") ?? childByLocal(root, "InvoiceTypeCode");
    const typcode = typNode?.text?.trim() || (isCreditNote ? "381" : null);
    const waehrung = textAtPath(root, "DocumentCurrencyCode");
    const notizen = childrenByLocal(root, "Note").map((n) => ({
        subjectCode: n.attrs["languageID"] ?? null,
        text: n.text,
        zeile: n.line,
    }));
    const vorherigeRechnungen = [];
    for (const br of childrenByLocal(root, "BillingReference")) {
        const ref = childByLocal(br, "InvoiceDocumentReference");
        const nummer = textAtPath(ref, "ID");
        if (nummer) {
            vorherigeRechnungen.push({
                nummer,
                datum: normalisiereDatum(textAtPath(ref, "IssueDate")),
                zeile: ref?.line ?? br.line,
            });
        }
    }
    const anhaenge = [];
    for (const adr of childrenByLocal(root, "AdditionalDocumentReference")) {
        const att = childByLocal(adr, "Attachment");
        const bin = childByLocal(att, "EmbeddedDocumentBinaryObject");
        const extUri = textAtPath(att, "ExternalReference", "URI");
        anhaenge.push({
            id: textAtPath(adr, "ID"),
            typcode: textAtPath(adr, "DocumentTypeCode"),
            beschreibung: textAtPath(adr, "DocumentDescription"),
            dateiname: bin?.attrs["filename"] ?? null,
            mimeCode: bin?.attrs["mimeCode"] ?? null,
            hatEingebettetesObjekt: Boolean(bin && bin.text.trim().length > 0),
            uri: extUri,
            zeile: adr.line,
        });
    }
    // Verkäufer & Käufer
    const sellerParty = pathByLocal(root, "AccountingSupplierParty", "Party");
    const verkaeuferName = textAtPath(sellerParty, "PartyLegalEntity", "RegistrationName") ??
        textAtPath(sellerParty, "PartyName", "Name");
    let verkaeuferUstId = null;
    let verkaeuferSteuernummer = null;
    for (const ts of childrenByLocal(sellerParty, "PartyTaxScheme")) {
        const cid = textAtPath(ts, "CompanyID");
        const scheme = textAtPath(ts, "TaxScheme", "ID");
        if (cid) {
            if (scheme === "VAT" || /^[A-Z]{2}/i.test(cid))
                verkaeuferUstId = cid;
            else
                verkaeuferSteuernummer = cid;
        }
    }
    const buyerParty = pathByLocal(root, "AccountingCustomerParty", "Party");
    const kaeuferName = textAtPath(buyerParty, "PartyLegalEntity", "RegistrationName") ??
        textAtPath(buyerParty, "PartyName", "Name");
    const kaeuferUstId = textAtPath(buyerParty, "PartyTaxScheme", "CompanyID");
    // Lieferung & Abrechnungszeitraum
    const lieferdatum = normalisiereDatum(textAtPath(root, "Delivery", "ActualDeliveryDate"));
    const invPeriod = childByLocal(root, "InvoicePeriod") ?? pathByLocal(root, "Delivery", "InvoicePeriod");
    const abrechnungszeitraumVon = normalisiereDatum(textAtPath(invPeriod, "StartDate"));
    const abrechnungszeitraumBis = normalisiereDatum(textAtPath(invPeriod, "EndDate"));
    const docAc = parseUblAllowanceCharges(root, ungueltige, "BG-20/BG-21");
    // Steueraufschluesselung (BG-23) + BT-110 in Dokumentwaehrung
    const taxTotals = childrenByLocal(root, "TaxTotal");
    let primaryTaxTotal = taxTotals[0];
    if (waehrung && taxTotals.length > 1) {
        const matching = taxTotals.find((tt) => childByLocal(tt, "TaxAmount")?.attrs["currencyID"] === waehrung);
        if (matching)
            primaryTaxTotal = matching;
    }
    const bt110Node = childByLocal(primaryTaxTotal, "TaxAmount");
    const bt110 = leseBetragFeld(bt110Node, "BT-110 (TaxAmount)", ungueltige);
    const steuerAufschluesselung = [];
    for (const st of childrenByLocal(primaryTaxTotal, "TaxSubtotal")) {
        const basis = leseBetragFeld(childByLocal(st, "TaxableAmount"), "BT-116 (TaxableAmount)", ungueltige);
        const steuer = leseBetragFeld(childByLocal(st, "TaxAmount"), "BT-117 (Subtotal TaxAmount)", ungueltige);
        const cat = childByLocal(st, "TaxCategory");
        const satzRaw = textAtPath(cat, "Percent");
        steuerAufschluesselung.push({
            kategorie: textAtPath(cat, "ID"),
            satzScaled: satzRaw !== null ? parseXmlScaled(satzRaw) : null,
            satzRaw,
            basisCent: basis.cents,
            basisScaled: basis.scaled,
            steuerCent: steuer.cents,
            steuerScaled: steuer.scaled,
            befreiungsgrund: textAtPath(cat, "TaxExemptionReason"),
            zeile: st.line,
        });
    }
    // Summen (BG-22)
    const lmt = childByLocal(root, "LegalMonetaryTotal");
    const bt106 = leseBetragFeld(childByLocal(lmt, "LineExtensionAmount"), "BT-106 (LineExtensionAmount)", ungueltige);
    const bt107 = leseBetragFeld(childByLocal(lmt, "AllowanceTotalAmount"), "BT-107 (AllowanceTotalAmount)", ungueltige);
    const bt108 = leseBetragFeld(childByLocal(lmt, "ChargeTotalAmount"), "BT-108 (ChargeTotalAmount)", ungueltige);
    const bt109 = leseBetragFeld(childByLocal(lmt, "TaxExclusiveAmount"), "BT-109 (TaxExclusiveAmount)", ungueltige);
    const bt112 = leseBetragFeld(childByLocal(lmt, "TaxInclusiveAmount"), "BT-112 (TaxInclusiveAmount)", ungueltige);
    const bt113 = leseBetragFeld(childByLocal(lmt, "PrepaidAmount"), "BT-113 (PrepaidAmount)", ungueltige);
    const bt114 = leseBetragFeld(childByLocal(lmt, "PayableRoundingAmount"), "BT-114 (PayableRoundingAmount)", ungueltige);
    const bt115 = leseBetragFeld(childByLocal(lmt, "PayableAmount"), "BT-115 (PayableAmount)", ungueltige);
    // Positionen (BG-25)
    const lineTag = isCreditNote ? "CreditNoteLine" : "InvoiceLine";
    const lineNodes = childrenByLocal(root, lineTag);
    const positionen = lineNodes.map((ln, idx) => {
        const qtyNode = childByLocal(ln, isCreditNote ? "CreditedQuantity" : "InvoicedQuantity") ?? childByLocal(ln, "InvoicedQuantity");
        const mengeRaw = qtyNode?.text ?? null;
        const mengeScaled = mengeRaw !== null ? parseXmlScaled(mengeRaw) : null;
        if (mengeRaw !== null && mengeScaled === null) {
            ungueltige.push({ feld: `Position ${idx + 1} Menge (BT-129)`, wert: mengeRaw, zeile: qtyNode?.line ?? ln.line });
        }
        const lineNetNode = childByLocal(ln, "LineExtensionAmount");
        const lineNet = leseBetragFeld(lineNetNode, `Position ${idx + 1} BT-131`, ungueltige);
        const lineAc = parseUblAllowanceCharges(ln, ungueltige, `Position ${idx + 1} BG-27/BG-28`);
        const item = childByLocal(ln, "Item");
        const taxCat = childByLocal(item, "ClassifiedTaxCategory");
        const satzTxt = textAtPath(taxCat, "Percent");
        const price = childByLocal(ln, "Price");
        const priceAmtNode = childByLocal(price, "PriceAmount");
        const einzelpreisRaw = priceAmtNode?.text ?? null;
        const einzelpreisNettoScaled = einzelpreisRaw !== null ? parseXmlScaled(einzelpreisRaw) : null;
        if (einzelpreisRaw !== null && einzelpreisNettoScaled === null) {
            ungueltige.push({ feld: `Position ${idx + 1} Einzelpreis (BT-146)`, wert: einzelpreisRaw, zeile: priceAmtNode?.line ?? ln.line });
        }
        const baseQtyRaw = textAtPath(price, "BaseQuantity");
        const basismengeScaled = (baseQtyRaw !== null ? parseXmlScaled(baseQtyRaw) : null) ?? SCALE;
        return {
            id: textAtPath(ln, "ID") ?? String(idx + 1),
            zeile: ln.line,
            name: textAtPath(item, "Name"),
            beschreibung: textAtPath(item, "Description"),
            mengeScaled,
            mengeRaw,
            einheit: qtyNode?.attrs["unitCode"] ?? null,
            einzelpreisNettoScaled,
            einzelpreisRaw,
            basismengeScaled: basismengeScaled === 0n ? SCALE : basismengeScaled,
            zeilenNettoCent: lineNet.cents,
            zeilenNettoScaled: lineNet.scaled,
            zeilenNettoRaw: lineNetNode?.text ?? null,
            zeilenNettoZeile: lineNet.zeile,
            nachlaesse: lineAc.nachlaesse,
            zuschlaege: lineAc.zuschlaege,
            steuerKategorie: textAtPath(taxCat, "ID"),
            steuersatzScaled: satzTxt !== null ? parseXmlScaled(satzTxt) : null,
        };
    });
    return {
        syntax: isCreditNote ? "UBL_CREDIT_NOTE" : "UBL_INVOICE",
        wurzelZeile: root.line,
        profilId: textAtPath(root, "CustomizationID"),
        geschaeftsprozessId: textAtPath(root, "ProfileID"),
        rechnungsnummer: textAtPath(root, "ID"),
        ausstellungsdatum: normalisiereDatum(textAtPath(root, "IssueDate")),
        typcode,
        typcodeZeile: typNode?.line ?? root.line,
        waehrung,
        kaeuferreferenz: textAtPath(root, "BuyerReference"),
        lieferdatum,
        abrechnungszeitraumVon,
        abrechnungszeitraumBis,
        verkaeuferName,
        verkaeuferUstId,
        verkaeuferSteuernummer,
        kaeuferName,
        kaeuferUstId,
        notizen,
        vorherigeRechnungen,
        anhaenge,
        dokumentNachlaesse: docAc.nachlaesse,
        dokumentZuschlaege: docAc.zuschlaege,
        steuerAufschluesselung,
        positionen,
        summen: {
            positionenNettoSummeCent: bt106.cents,
            positionenNettoZeile: bt106.zeile,
            nachlaesseSummeCent: bt107.cents,
            nachlaesseZeile: bt107.zeile,
            zuschlaegeSummeCent: bt108.cents,
            zuschlaegeZeile: bt108.zeile,
            steuerbasisSummeCent: bt109.cents,
            steuerbasisZeile: bt109.zeile,
            steuerSummeCent: bt110.cents,
            steuerSummeZeile: bt110.zeile,
            bruttoSummeCent: bt112.cents,
            bruttoZeile: bt112.zeile,
            vorausbezahltCent: bt113.cents,
            vorausbezahltZeile: bt113.zeile,
            rundungsbetragCent: bt114.cents,
            rundungZeile: bt114.zeile,
            zahlbetragCent: bt115.cents,
            zahlbetragZeile: bt115.zeile,
            ungueltigeZahlenfelder: ungueltige,
        },
    };
}
function extractCii(root) {
    const ungueltige = [];
    const ctx = childByLocal(root, "ExchangedDocumentContext");
    const doc = childByLocal(root, "ExchangedDocument");
    const tx = childByLocal(root, "SupplyChainTradeTransaction");
    const agreement = childByLocal(tx, "ApplicableHeaderTradeAgreement");
    const delivery = childByLocal(tx, "ApplicableHeaderTradeDelivery");
    const settlement = childByLocal(tx, "ApplicableHeaderTradeSettlement");
    const typNode = childByLocal(doc, "TypeCode");
    const waehrung = textAtPath(settlement, "InvoiceCurrencyCode");
    const notizen = childrenByLocal(doc, "IncludedNote").map((n) => ({
        subjectCode: textAtPath(n, "SubjectCode"),
        text: textAtPath(n, "Content") ?? n.text,
        zeile: n.line,
    }));
    const vorherigeRechnungen = [];
    for (const ir of childrenByLocal(settlement, "InvoiceReferencedDocument")) {
        const nummer = textAtPath(ir, "IssuerAssignedID");
        const dt = textAtPath(ir, "FormattedIssueDateTime", "DateTimeString") ??
            textAtPath(ir, "IssueDateTime", "DateTimeString");
        if (nummer) {
            vorherigeRechnungen.push({
                nummer,
                datum: normalisiereDatum(dt),
                zeile: ir.line,
            });
        }
    }
    const anhaenge = [];
    for (const ard of [
        ...childrenByLocal(agreement, "AdditionalReferencedDocument"),
        ...childrenByLocal(settlement, "AdditionalReferencedDocument"),
    ]) {
        const bin = childByLocal(ard, "AttachmentBinaryObject");
        anhaenge.push({
            id: textAtPath(ard, "IssuerAssignedID"),
            typcode: textAtPath(ard, "TypeCode") ?? textAtPath(ard, "ReferenceTypeCode"),
            beschreibung: textAtPath(ard, "Name"),
            dateiname: bin?.attrs["filename"] ?? null,
            mimeCode: bin?.attrs["mimeCode"] ?? null,
            hatEingebettetesObjekt: Boolean(bin && bin.text.trim().length > 0),
            uri: textAtPath(ard, "URIID"),
            zeile: ard.line,
        });
    }
    // Verkäufer & Käufer
    const seller = childByLocal(agreement, "SellerTradeParty");
    const verkaeuferName = textAtPath(seller, "Name");
    let verkaeuferUstId = null;
    let verkaeuferSteuernummer = null;
    for (const reg of childrenByLocal(seller, "SpecifiedTaxRegistration")) {
        const idNode = childByLocal(reg, "ID");
        if (idNode?.text) {
            const scheme = idNode.attrs["schemeID"] ?? "";
            if (scheme === "VA" || /^[A-Z]{2}/i.test(idNode.text.trim()))
                verkaeuferUstId = idNode.text.trim();
            else
                verkaeuferSteuernummer = idNode.text.trim();
        }
    }
    const buyer = childByLocal(agreement, "BuyerTradeParty");
    const kaeuferName = textAtPath(buyer, "Name");
    const kaeuferUstId = textAtPath(buyer, "SpecifiedTaxRegistration", "ID");
    const lieferdatum = normalisiereDatum(textAtPath(delivery, "ActualDeliverySupplyChainEvent", "OccurrenceDateTime", "DateTimeString"));
    const period = childByLocal(settlement, "BillingSpecifiedPeriod");
    const abrechnungszeitraumVon = normalisiereDatum(textAtPath(period, "StartDateTime", "DateTimeString"));
    const abrechnungszeitraumBis = normalisiereDatum(textAtPath(period, "EndDateTime", "DateTimeString"));
    const docAc = parseCiiAllowanceCharges(settlement, ungueltige, "BG-20/BG-21");
    const steuerAufschluesselung = [];
    for (const tt of childrenByLocal(settlement, "ApplicableTradeTax")) {
        const basis = leseBetragFeld(childByLocal(tt, "BasisAmount"), "BT-116 (BasisAmount)", ungueltige);
        const steuer = leseBetragFeld(childByLocal(tt, "CalculatedAmount"), "BT-117 (CalculatedAmount)", ungueltige);
        const satzRaw = textAtPath(tt, "RateApplicablePercent");
        steuerAufschluesselung.push({
            kategorie: textAtPath(tt, "CategoryCode"),
            satzScaled: satzRaw !== null ? parseXmlScaled(satzRaw) : null,
            satzRaw,
            basisCent: basis.cents,
            basisScaled: basis.scaled,
            steuerCent: steuer.cents,
            steuerScaled: steuer.scaled,
            befreiungsgrund: textAtPath(tt, "ExemptionReason"),
            zeile: tt.line,
        });
    }
    const hms = childByLocal(settlement, "SpecifiedTradeSettlementHeaderMonetarySummation");
    const bt106 = leseBetragFeld(childByLocal(hms, "LineTotalAmount"), "BT-106 (LineTotalAmount)", ungueltige);
    const bt107 = leseBetragFeld(childByLocal(hms, "AllowanceTotalAmount"), "BT-107 (AllowanceTotalAmount)", ungueltige);
    const bt108 = leseBetragFeld(childByLocal(hms, "ChargeTotalAmount"), "BT-108 (ChargeTotalAmount)", ungueltige);
    const bt109 = leseBetragFeld(childByLocal(hms, "TaxBasisTotalAmount"), "BT-109 (TaxBasisTotalAmount)", ungueltige);
    const taxTotalNodes = childrenByLocal(hms, "TaxTotalAmount");
    let bt110Node = taxTotalNodes[0];
    if (waehrung && taxTotalNodes.length > 1) {
        const matching = taxTotalNodes.find((n) => n.attrs["currencyID"] === waehrung);
        if (matching)
            bt110Node = matching;
    }
    const bt110 = leseBetragFeld(bt110Node, "BT-110 (TaxTotalAmount)", ungueltige);
    const bt112 = leseBetragFeld(childByLocal(hms, "GrandTotalAmount"), "BT-112 (GrandTotalAmount)", ungueltige);
    const bt113 = leseBetragFeld(childByLocal(hms, "TotalPrepaidAmount"), "BT-113 (TotalPrepaidAmount)", ungueltige);
    const bt114 = leseBetragFeld(childByLocal(hms, "RoundingAmount"), "BT-114 (RoundingAmount)", ungueltige);
    const bt115 = leseBetragFeld(childByLocal(hms, "DuePayableAmount"), "BT-115 (DuePayableAmount)", ungueltige);
    const lineNodes = childrenByLocal(tx, "IncludedSupplyChainTradeLineItem");
    const positionen = lineNodes.map((ln, idx) => {
        const lineId = textAtPath(ln, "AssociatedDocumentLineDocument", "LineID") ?? String(idx + 1);
        const prod = childByLocal(ln, "SpecifiedTradeProduct");
        const lineAgr = childByLocal(ln, "SpecifiedLineTradeAgreement");
        const netPrice = childByLocal(lineAgr, "NetPriceProductTradePrice");
        const chargeAmtNode = childByLocal(netPrice, "ChargeAmount");
        const einzelpreisRaw = chargeAmtNode?.text ?? null;
        const einzelpreisNettoScaled = einzelpreisRaw !== null ? parseXmlScaled(einzelpreisRaw) : null;
        if (einzelpreisRaw !== null && einzelpreisNettoScaled === null) {
            ungueltige.push({ feld: `Position ${idx + 1} Einzelpreis (BT-146)`, wert: einzelpreisRaw, zeile: chargeAmtNode?.line ?? ln.line });
        }
        const baseQtyRaw = textAtPath(netPrice, "BasisQuantity");
        const basismengeScaled = (baseQtyRaw !== null ? parseXmlScaled(baseQtyRaw) : null) ?? SCALE;
        const lineDel = childByLocal(ln, "SpecifiedLineTradeDelivery");
        const qtyNode = childByLocal(lineDel, "BilledQuantity");
        const mengeRaw = qtyNode?.text ?? null;
        const mengeScaled = mengeRaw !== null ? parseXmlScaled(mengeRaw) : null;
        if (mengeRaw !== null && mengeScaled === null) {
            ungueltige.push({ feld: `Position ${idx + 1} Menge (BT-129)`, wert: mengeRaw, zeile: qtyNode?.line ?? ln.line });
        }
        const lineSet = childByLocal(ln, "SpecifiedLineTradeSettlement");
        const lineTax = childByLocal(lineSet, "ApplicableTradeTax");
        const satzTxt = textAtPath(lineTax, "RateApplicablePercent");
        const lineAc = parseCiiAllowanceCharges(lineSet, ungueltige, `Position ${idx + 1} BG-27/BG-28`);
        const lineSumNode = pathByLocal(lineSet, "SpecifiedTradeSettlementLineMonetarySummation", "LineTotalAmount");
        const lineNet = leseBetragFeld(lineSumNode, `Position ${idx + 1} BT-131`, ungueltige);
        return {
            id: lineId,
            zeile: ln.line,
            name: textAtPath(prod, "Name"),
            beschreibung: textAtPath(prod, "Description"),
            mengeScaled,
            mengeRaw,
            einheit: qtyNode?.attrs["unitCode"] ?? null,
            einzelpreisNettoScaled,
            einzelpreisRaw,
            basismengeScaled: basismengeScaled === 0n ? SCALE : basismengeScaled,
            zeilenNettoCent: lineNet.cents,
            zeilenNettoScaled: lineNet.scaled,
            zeilenNettoRaw: lineSumNode?.text ?? null,
            zeilenNettoZeile: lineNet.zeile,
            nachlaesse: lineAc.nachlaesse,
            zuschlaege: lineAc.zuschlaege,
            steuerKategorie: textAtPath(lineTax, "CategoryCode"),
            steuersatzScaled: satzTxt !== null ? parseXmlScaled(satzTxt) : null,
        };
    });
    return {
        syntax: "CII",
        wurzelZeile: root.line,
        profilId: textAtPath(ctx, "GuidelineSpecifiedDocumentContextParameter", "ID"),
        geschaeftsprozessId: textAtPath(ctx, "BusinessProcessSpecifiedDocumentContextParameter", "ID"),
        rechnungsnummer: textAtPath(doc, "ID"),
        ausstellungsdatum: normalisiereDatum(textAtPath(doc, "IssueDateTime", "DateTimeString")),
        typcode: typNode?.text?.trim() || null,
        typcodeZeile: typNode?.line ?? root.line,
        waehrung,
        kaeuferreferenz: textAtPath(agreement, "BuyerReference"),
        lieferdatum,
        abrechnungszeitraumVon,
        abrechnungszeitraumBis,
        verkaeuferName,
        verkaeuferUstId,
        verkaeuferSteuernummer,
        kaeuferName,
        kaeuferUstId,
        notizen,
        vorherigeRechnungen,
        anhaenge,
        dokumentNachlaesse: docAc.nachlaesse,
        dokumentZuschlaege: docAc.zuschlaege,
        steuerAufschluesselung,
        positionen,
        summen: {
            positionenNettoSummeCent: bt106.cents,
            positionenNettoZeile: bt106.zeile,
            nachlaesseSummeCent: bt107.cents,
            nachlaesseZeile: bt107.zeile,
            zuschlaegeSummeCent: bt108.cents,
            zuschlaegeZeile: bt108.zeile,
            steuerbasisSummeCent: bt109.cents,
            steuerbasisZeile: bt109.zeile,
            steuerSummeCent: bt110.cents,
            steuerSummeZeile: bt110.zeile,
            bruttoSummeCent: bt112.cents,
            bruttoZeile: bt112.zeile,
            vorausbezahltCent: bt113.cents,
            vorausbezahltZeile: bt113.zeile,
            rundungsbetragCent: bt114.cents,
            rundungZeile: bt114.zeile,
            zahlbetragCent: bt115.cents,
            zahlbetragZeile: bt115.zeile,
            ungueltigeZahlenfelder: ungueltige,
        },
    };
}
/** Erkennt UBL 2.1 (Invoice / CreditNote) oder UN/CEFACT CII anhand des Wurzelelements und extrahiert das Modell. */
export function extractInvoiceModel(root) {
    if (root.localName === "Invoice")
        return extractUbl(root, false);
    if (root.localName === "CreditNote")
        return extractUbl(root, true);
    if (root.localName === "CrossIndustryInvoice")
        return extractCii(root);
    throw new Error(`Unbekanntes Rechnungs-Wurzelelement <${root.name}> in Zeile ${root.line}. Erwartet wird UBL <Invoice>, UBL <CreditNote> oder UN/CEFACT <CrossIndustryInvoice>.`);
}
