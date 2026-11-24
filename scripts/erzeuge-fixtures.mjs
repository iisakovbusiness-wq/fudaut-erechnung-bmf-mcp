/**
 * Erzeugt deterministische, synthetische PDF/A-3-Testdateien unter fixtures/ (ohne externe Abhängigkeiten):
 *   1. zugferd-valide-pdfa3.pdf         (100 % konformes Factur-X 1.0 / ZUGFeRD 2.3 PDF/A-3b mit FlateDecode-XML)
 *   2. jtl-wawi-86919-defekt-pdfa3.pdf  (JTL-Wawi WAWI-86919 Defekt: leeres fx:Version + fehlendes pdfaExtension:schemas)
 *   3. zugferd-defekt-ohne-xml.pdf      (XMP vorhanden, aber eingebettetes factur-x.xml fehlt im PDF)
 * Alle enthaltenen Stammdaten sind rein fiktive .example-Musterdaten.
 */

import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import { fileURLToPath } from "node:url";

const FIXTURES_DIR = fileURLToPath(new URL("../fixtures/", import.meta.url));

const FACTURX_VALID_XML = `<?xml version="1.0" encoding="UTF-8"?>
<rsm:CrossIndustryInvoice xmlns:rsm="urn:un:unece:uncefact:data:standard:CrossIndustryInvoice:100"
                          xmlns:ram="urn:un:unece:uncefact:data:standard:ReusableAggregateBusinessInformationEntity:100"
                          xmlns:udt="urn:un:unece:uncefact:data:standard:UnqualifiedDataType:100">
  <rsm:ExchangedDocumentContext>
    <ram:GuidelineSpecifiedDocumentContextParameter>
      <ram:ID>urn:cen.eu:en16931:2017#compliant#urn:factur-x.eu:1p0:en16931</ram:ID>
    </ram:GuidelineSpecifiedDocumentContextParameter>
  </rsm:ExchangedDocumentContext>
  <rsm:ExchangedDocument>
    <ram:ID>FX-2026-1001</ram:ID>
    <ram:TypeCode>380</ram:TypeCode>
    <ram:IssueDateTime>
      <udt:DateTimeString format="102">20261120</udt:DateTimeString>
    </ram:IssueDateTime>
  </rsm:ExchangedDocument>
  <rsm:SupplyChainTradeTransaction>
    <ram:IncludedSupplyChainTradeLineItem>
      <ram:AssociatedDocumentLineDocument>
        <ram:LineID>1</ram:LineID>
      </ram:AssociatedDocumentLineDocument>
      <ram:SpecifiedTradeProduct>
        <ram:Name>Edelstahl-Kugelhahn DN 40 PN 63 Flanschausführung</ram:Name>
      </ram:SpecifiedTradeProduct>
      <ram:SpecifiedLineTradeAgreement>
        <ram:NetPriceProductTradePrice>
          <ram:ChargeAmount>250.00</ram:ChargeAmount>
        </ram:NetPriceProductTradePrice>
      </ram:SpecifiedLineTradeAgreement>
      <ram:SpecifiedLineTradeDelivery>
        <ram:BilledQuantity unitCode="H87">5.00</ram:BilledQuantity>
      </ram:SpecifiedLineTradeDelivery>
      <ram:SpecifiedLineTradeSettlement>
        <ram:ApplicableTradeTax>
          <ram:TypeCode>VAT</ram:TypeCode>
          <ram:CategoryCode>S</ram:CategoryCode>
          <ram:RateApplicablePercent>19.00</ram:RateApplicablePercent>
        </ram:ApplicableTradeTax>
        <ram:SpecifiedTradeSettlementLineMonetarySummation>
          <ram:LineTotalAmount>1250.00</ram:LineTotalAmount>
        </ram:SpecifiedTradeSettlementLineMonetarySummation>
      </ram:SpecifiedLineTradeSettlement>
    </ram:IncludedSupplyChainTradeLineItem>
    <ram:ApplicableHeaderTradeAgreement>
      <ram:BuyerReference>BEST-2026-501</ram:BuyerReference>
      <ram:SellerTradeParty>
        <ram:Name>Beispiel Industriehandel GmbH</ram:Name>
        <ram:SpecifiedTaxRegistration>
          <ram:ID schemeID="VA">DE111222333</ram:ID>
        </ram:SpecifiedTaxRegistration>
      </ram:SellerTradeParty>
      <ram:BuyerTradeParty>
        <ram:Name>Muster Anlagenbau GmbH</ram:Name>
      </ram:BuyerTradeParty>
    </ram:ApplicableHeaderTradeAgreement>
    <ram:ApplicableHeaderTradeDelivery>
      <ram:ActualDeliverySupplyChainEvent>
        <ram:OccurrenceDateTime>
          <udt:DateTimeString format="102">20261119</udt:DateTimeString>
        </ram:OccurrenceDateTime>
      </ram:ActualDeliverySupplyChainEvent>
    </ram:ApplicableHeaderTradeDelivery>
    <ram:ApplicableHeaderTradeSettlement>
      <ram:InvoiceCurrencyCode>EUR</ram:InvoiceCurrencyCode>
      <ram:ApplicableTradeTax>
        <ram:CalculatedAmount>237.50</ram:CalculatedAmount>
        <ram:TypeCode>VAT</ram:TypeCode>
        <ram:BasisAmount>1250.00</ram:BasisAmount>
        <ram:CategoryCode>S</ram:CategoryCode>
        <ram:RateApplicablePercent>19.00</ram:RateApplicablePercent>
      </ram:ApplicableTradeTax>
      <ram:SpecifiedTradeSettlementHeaderMonetarySummation>
        <ram:LineTotalAmount>1250.00</ram:LineTotalAmount>
        <ram:TaxBasisTotalAmount>1250.00</ram:TaxBasisTotalAmount>
        <ram:TaxTotalAmount currencyID="EUR">237.50</ram:TaxTotalAmount>
        <ram:GrandTotalAmount>1487.50</ram:GrandTotalAmount>
        <ram:DuePayableAmount>1487.50</ram:DuePayableAmount>
      </ram:SpecifiedTradeSettlementHeaderMonetarySummation>
    </ram:ApplicableHeaderTradeSettlement>
  </rsm:SupplyChainTradeTransaction>
</rsm:CrossIndustryInvoice>
`;

const XMP_VALID = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about=""
      xmlns:pdfaExtension="http://www.aiim.org/pdfa/ns/extension/"
      xmlns:pdfaSchema="http://www.aiim.org/pdfa/ns/schema#"
      xmlns:pdfaProperty="http://www.aiim.org/pdfa/ns/property#">
      <pdfaExtension:schemas>
        <rdf:Bag>
          <rdf:li rdf:parseType="Resource">
            <pdfaSchema:schema>Factur-X PDFA Extension Schema</pdfaSchema:schema>
            <pdfaSchema:namespaceURI>urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#</pdfaSchema:namespaceURI>
            <pdfaSchema:prefix>fx</pdfaSchema:prefix>
            <pdfaSchema:property>
              <rdf:Seq>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentFileName</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The name of the embedded XML document</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>DocumentType</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The type of the hybrid document</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>Version</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The actual version of the standard</pdfaProperty:description>
                </rdf:li>
                <rdf:li rdf:parseType="Resource">
                  <pdfaProperty:name>ConformanceLevel</pdfaProperty:name>
                  <pdfaProperty:valueType>Text</pdfaProperty:valueType>
                  <pdfaProperty:category>external</pdfaProperty:category>
                  <pdfaProperty:description>The conformance level of the embedded XML</pdfaProperty:description>
                </rdf:li>
              </rdf:Seq>
            </pdfaSchema:property>
          </rdf:li>
        </rdf:Bag>
      </pdfaExtension:schemas>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
      <fx:Version>1.0</fx:Version>
      <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

const XMP_WAWI_86919_DEFECT = `<?xpacket begin="\uFEFF" id="W5M0MpCehiHzreSzNTczkc9d"?>
<x:xmpmeta xmlns:x="adobe:ns:meta/">
  <rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#">
    <rdf:Description rdf:about="" xmlns:pdfaid="http://www.aiim.org/pdfa/ns/id/">
      <pdfaid:part>3</pdfaid:part>
      <pdfaid:conformance>B</pdfaid:conformance>
    </rdf:Description>
    <rdf:Description rdf:about="" xmlns:fx="urn:factur-x:pdfa:CrossIndustryDocument:invoice:1p0#">
      <fx:DocumentType>INVOICE</fx:DocumentType>
      <fx:DocumentFileName>factur-x.xml</fx:DocumentFileName>
      <fx:Version></fx:Version>
      <fx:ConformanceLevel>EN 16931</fx:ConformanceLevel>
    </rdf:Description>
  </rdf:RDF>
</x:xmpmeta>
<?xpacket end="w"?>`;

function buildMinimalPdfA3({ xmpText, attachmentName, attachmentXml }) {
  const chunks = [];
  let offset = 0;
  const offsets = [0]; // index 0 ist frei

  const pushBuf = (buf) => {
    chunks.push(buf);
    offset += buf.length;
  };
  const pushAscii = (str) => pushBuf(Buffer.from(str, "latin1"));

  pushBuf(Buffer.from("%PDF-1.7\n%\xE2\xE3\xCF\xD3\n", "latin1"));

  const addObject = (num, dictStr, streamBuffer = null) => {
    offsets[num] = offset;
    pushAscii(`${num} 0 obj\n${dictStr}\n`);
    if (streamBuffer !== null) {
      pushAscii("stream\n");
      pushBuf(streamBuffer);
      pushAscii("\nendstream\n");
    }
    pushAscii("endobj\n");
  };

  const hasAttachment = Boolean(attachmentName && attachmentXml);
  const catalogDict = hasAttachment
    ? "<< /Type /Catalog /Pages 2 0 R /Metadata 5 0 R /OutputIntents [6 0 R] /AF [7 0 R] /Names << /EmbeddedFiles << /Names [(factur-x.xml) 7 0 R] >> >> >>"
    : "<< /Type /Catalog /Pages 2 0 R /Metadata 5 0 R /OutputIntents [6 0 R] >>";

  addObject(1, catalogDict);
  addObject(2, "<< /Type /Pages /Kids [3 0 R] /Count 1 >>");
  addObject(3, "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R >>");

  const pageStream = Buffer.from("BT /F1 12 Tf 72 760 Td (Musterrechnung FX-2026-1001 - 1.487,50 EUR) Tj ET", "latin1");
  addObject(4, `<< /Length ${pageStream.length} >>`, pageStream);

  const xmpBytes = Buffer.from(xmpText, "utf8");
  addObject(5, `<< /Type /Metadata /Subtype /XML /Length ${xmpBytes.length} >>`, xmpBytes);

  addObject(6, "<< /Type /OutputIntent /S /GTS_PDFA1 /OutputConditionIdentifier (sRGB IEC61966-2.1) >>");

  let maxObj = 6;
  if (hasAttachment) {
    const compressedXml = zlib.deflateSync(Buffer.from(attachmentXml, "utf8"), { level: 9 });
    addObject(
      7,
      `<< /Type /Filespec /F (${attachmentName}) /UF (${attachmentName}) /AFRelationship /Alternative /EF << /F 8 0 R /UF 8 0 R >> >>`,
    );
    addObject(
      8,
      `<< /Type /EmbeddedFile /Subtype /text#2Fxml /Filter /FlateDecode /Length ${compressedXml.length} >>`,
      compressedXml,
    );
    maxObj = 8;
  }

  const xrefOffset = offset;
  pushAscii(`xref\n0 ${maxObj + 1}\n0000000000 65535 f \n`);
  for (let i = 1; i <= maxObj; i++) {
    pushAscii(`${String(offsets[i]).padStart(10, "0")} 00000 n \n`);
  }
  pushAscii(`trailer\n<< /Size ${maxObj + 1} /Root 1 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`);

  return Buffer.concat(chunks);
}

fs.mkdirSync(FIXTURES_DIR, { recursive: true });

fs.writeFileSync(
  path.join(FIXTURES_DIR, "zugferd-valide-pdfa3.pdf"),
  buildMinimalPdfA3({
    xmpText: XMP_VALID,
    attachmentName: "factur-x.xml",
    attachmentXml: FACTURX_VALID_XML,
  }),
);

fs.writeFileSync(
  path.join(FIXTURES_DIR, "jtl-wawi-86919-defekt-pdfa3.pdf"),
  buildMinimalPdfA3({
    xmpText: XMP_WAWI_86919_DEFECT,
    attachmentName: "factur-x.xml",
    attachmentXml: FACTURX_VALID_XML,
  }),
);

fs.writeFileSync(
  path.join(FIXTURES_DIR, "zugferd-defekt-ohne-xml.pdf"),
  buildMinimalPdfA3({
    xmpText: XMP_VALID,
    attachmentName: null,
    attachmentXml: null,
  }),
);

console.log("3 synthetische PDF/A-3-Fixtures erzeugt.");
