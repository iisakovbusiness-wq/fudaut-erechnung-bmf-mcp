/**
 * Deterministischer PDF/A-3-Container-Inspektor für hybride ZUGFeRD- und Factur-X-Dokumente.
 * Extrahiert XMP-Metadaten-Streams, eingebettete XML-Dateien (/Filespec -> /EF), /GTS_PDFA1 und /AF.
 * Unterstützt unkomprimierte sowie /FlateDecode-komprimierte PDF-Streams über node:zlib.
 */
import zlib from "node:zlib";
const MAX_INFLATED_BYTES = 20 * 1024 * 1024;
function decodePdfLiteralString(raw) {
    let out = "";
    for (let i = 0; i < raw.length; i++) {
        const ch = raw[i];
        if (ch === "\\" && i + 1 < raw.length) {
            const next = raw[++i];
            if (next === "n")
                out += "\n";
            else if (next === "r")
                out += "\r";
            else if (next === "t")
                out += "\t";
            else if (next === "(" || next === ")" || next === "\\")
                out += next;
            else
                out += next;
        }
        else {
            out += ch;
        }
    }
    return out;
}
function decodePdfHexString(hexRaw) {
    const clean = hexRaw.replace(/\s+/g, "");
    const padded = clean.length % 2 === 1 ? clean + "0" : clean;
    const buf = Buffer.from(padded, "hex");
    if (buf.length >= 2 && buf[0] === 0xfe && buf[1] === 0xff) {
        // UTF-16BE mit BOM
        let str = "";
        for (let i = 2; i + 1 < buf.length; i += 2) {
            str += String.fromCharCode((buf[i] << 8) | buf[i + 1]);
        }
        return str;
    }
    return buf.toString("utf8");
}
function extractPdfStringField(dict, key) {
    const litRe = new RegExp(`\\/${key}\\s*\\(([^)]*)\\)`);
    const litMatch = litRe.exec(dict);
    if (litMatch)
        return decodePdfLiteralString(litMatch[1]);
    const hexRe = new RegExp(`\\/${key}\\s*<([0-9A-Fa-f\\s]+)>`);
    const hexMatch = hexRe.exec(dict);
    if (hexMatch)
        return decodePdfHexString(hexMatch[1]);
    return null;
}
function decodeStream(dictText, streamBytes, warnungen, objNum) {
    if (/\/FlateDecode\b/.test(dictText)) {
        try {
            return zlib.inflateSync(streamBytes, { maxOutputLength: MAX_INFLATED_BYTES });
        }
        catch {
            try {
                return zlib.inflateRawSync(streamBytes, { maxOutputLength: MAX_INFLATED_BYTES });
            }
            catch (err) {
                warnungen.push(`Stream in PDF-Objekt ${objNum} konnte trotz /FlateDecode nicht entpackt werden: ${err.message}`);
                return null;
            }
        }
    }
    return streamBytes;
}
/** Inspiziert einen PDF-Puffer auf PDF/A-3-Merkmale, XMP-Metadaten und eingebettete XML-Rechnungen. */
export function inspectPdfContainer(pdfBytes) {
    const warnungen = [];
    const headAscii = pdfBytes.subarray(0, Math.min(pdfBytes.length, 64)).toString("latin1");
    const verMatch = /%PDF-(\d+\.\d+)/.exec(headAscii);
    if (!verMatch) {
        return {
            istPdf: false,
            pdfVersion: null,
            hatGtsPdfa1: false,
            hatAfArray: false,
            xmpXml: null,
            anhaenge: [],
            warnungen: ["Kein gültiger %PDF-Header am Dateianfang gefunden."],
        };
    }
    const latin1 = pdfBytes.toString("latin1");
    const hatGtsPdfa1 = /\/GTS_PDFA1\b/.test(latin1);
    const hatAfArray = /\/AF\s*(?:\[|\d+\s+\d+\s+R)/.test(latin1);
    const objects = new Map();
    const objRegex = /(\d+)\s+(\d+)\s+obj\b/g;
    let match;
    while ((match = objRegex.exec(latin1)) !== null) {
        const objNum = Number(match[1]);
        const genNum = Number(match[2]);
        const bodyStart = match.index + match[0].length;
        const endObjIdx = latin1.indexOf("endobj", bodyStart);
        if (endObjIdx < 0)
            continue;
        const objBody = latin1.slice(bodyStart, endObjIdx);
        const streamMarker = /stream(?:\r\n|\n|\r)/.exec(objBody);
        if (streamMarker) {
            const dictText = objBody.slice(0, streamMarker.index);
            const streamByteStart = bodyStart + streamMarker.index + streamMarker[0].length;
            const endStreamRel = objBody.indexOf("endstream", streamMarker.index + streamMarker[0].length);
            if (endStreamRel > 0) {
                let streamByteEnd = bodyStart + endStreamRel;
                if (pdfBytes[streamByteEnd - 1] === 0x0a)
                    streamByteEnd--;
                if (pdfBytes[streamByteEnd - 1] === 0x0d)
                    streamByteEnd--;
                const streamBytes = pdfBytes.subarray(streamByteStart, Math.max(streamByteStart, streamByteEnd));
                objects.set(objNum, { objNum, genNum, dictText, streamBytes });
            }
        }
        else {
            objects.set(objNum, { objNum, genNum, dictText: objBody, streamBytes: null });
        }
    }
    // 1. XMP-Metadaten finden (bevorzugt über /Type /Metadata oder /Subtype /XML, sonst direkter xmpmeta-Scan)
    let xmpXml = null;
    for (const obj of objects.values()) {
        if (obj.streamBytes && (/\/Type\s*\/Metadata\b/.test(obj.dictText) || /\/Subtype\s*\/XML\b/.test(obj.dictText))) {
            const decoded = decodeStream(obj.dictText, obj.streamBytes, warnungen, obj.objNum);
            if (decoded) {
                const text = decoded.toString("utf8");
                if (text.includes("xmpmeta") || text.includes("rdf:RDF")) {
                    xmpXml = text;
                    break;
                }
            }
        }
    }
    if (!xmpXml) {
        // Fallback: unkomprimiertes XMP-Paket im Gesamtpuffer suchen
        const utf8All = pdfBytes.toString("utf8");
        const xmpStart = utf8All.indexOf("<x:xmpmeta");
        if (xmpStart >= 0) {
            const xmpEnd = utf8All.indexOf("</x:xmpmeta>", xmpStart);
            if (xmpEnd > xmpStart) {
                xmpXml = utf8All.slice(xmpStart, xmpEnd + "</x:xmpmeta>".length);
            }
        }
        else {
            const rdfStart = utf8All.indexOf("<rdf:RDF");
            if (rdfStart >= 0) {
                const rdfEnd = utf8All.indexOf("</rdf:RDF>", rdfStart);
                if (rdfEnd > rdfStart) {
                    xmpXml = utf8All.slice(rdfStart, rdfEnd + "</rdf:RDF>".length);
                }
            }
        }
    }
    // 2. Eingebettete Dateien (/Filespec -> /EF << /F X 0 R >>) extrahieren
    const anhaenge = [];
    for (const obj of objects.values()) {
        const hasFilespec = /\/Type\s*\/Filespec\b/.test(obj.dictText) || /\/EF\s*<</.test(obj.dictText);
        if (!hasFilespec)
            continue;
        const ufName = extractPdfStringField(obj.dictText, "UF");
        const fName = extractPdfStringField(obj.dictText, "F");
        const dateiname = ufName ?? fName;
        if (!dateiname)
            continue;
        const afMatch = /\/AFRelationship\s*\/([A-Za-z0-9_.-]+)/.exec(obj.dictText);
        const afRelationship = afMatch ? afMatch[1] : null;
        const efMatch = /\/EF\s*<<([\s\S]*?)>>/.exec(obj.dictText);
        if (!efMatch)
            continue;
        const efBody = efMatch[1];
        const refMatch = /\/(?:UF|F)\s+(\d+)\s+\d+\s+R/.exec(efBody);
        if (!refMatch)
            continue;
        const streamObjNum = Number(refMatch[1]);
        const streamObj = objects.get(streamObjNum);
        if (!streamObj || !streamObj.streamBytes) {
            warnungen.push(`Eingebettete Datei "${dateiname}" verweist auf fehlendes Stream-Objekt ${streamObjNum}.`);
            continue;
        }
        const mimeMatch = /\/Subtype\s*\/([A-Za-z0-9#2F_.-]+)/i.exec(streamObj.dictText);
        const rawMime = mimeMatch ? mimeMatch[1].replace(/#2F/gi, "/") : null;
        const decoded = decodeStream(streamObj.dictText, streamObj.streamBytes, warnungen, streamObj.objNum);
        if (!decoded)
            continue;
        anhaenge.push({
            dateiname,
            afRelationship,
            mimeType: rawMime,
            inhaltUtf8: decoded.toString("utf8"),
            bytes: decoded.length,
        });
    }
    return {
        istPdf: true,
        pdfVersion: verMatch[1],
        hatGtsPdfa1,
        hatAfArray,
        xmpXml,
        anhaenge,
        warnungen,
    };
}
