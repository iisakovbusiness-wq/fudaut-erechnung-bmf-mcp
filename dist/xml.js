/**
 * Deterministischer, XXE-sicherer XML-Baum-Parser ohne externe Abhängigkeiten.
 * Bewahrt Zeilennummern, Namensräume (xmlns) und Reihenfolge für UBL 2.1, UN/CEFACT CII, Adobe XMP und GAEB DA XML.
 */
export class XmlParseError extends Error {
    line;
    code;
    constructor(code, message, line) {
        super(message);
        this.name = "XmlParseError";
        this.code = code;
        this.line = line;
    }
}
const MAX_XML_BYTES = 20 * 1024 * 1024;
const MAX_DEPTH = 64;
const PREDEFINED_ENTITIES = {
    amp: "&",
    lt: "<",
    gt: ">",
    quot: "\"",
    apos: "'",
};
export function decodeXmlEntities(input, line = 1) {
    if (!input.includes("&"))
        return input;
    return input.replace(/&(#x[0-9a-fA-F]+|#\d+|[a-zA-Z_][\w.-]*);/g, (full, entity) => {
        if (entity.startsWith("#x") || entity.startsWith("#X")) {
            const code = Number.parseInt(entity.slice(2), 16);
            if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff)
                return full;
            return String.fromCodePoint(code);
        }
        if (entity.startsWith("#")) {
            const code = Number.parseInt(entity.slice(1), 10);
            if (!Number.isFinite(code) || code <= 0 || code > 0x10ffff)
                return full;
            return String.fromCodePoint(code);
        }
        const std = PREDEFINED_ENTITIES[entity];
        if (std !== undefined)
            return std;
        throw new XmlParseError("XML_UNBEKANNTE_ENTITAET", `Nicht vordefinierte XML-Entität "&${entity};" in Zeile ${line} ist aus Sicherheitsgruenden nicht erlaubt.`, line);
    });
}
function splitQName(qname) {
    const idx = qname.indexOf(":");
    if (idx < 0)
        return { prefix: "", localName: qname };
    return { prefix: qname.slice(0, idx), localName: qname.slice(idx + 1) };
}
function countNewlines(str, start, end) {
    let n = 0;
    for (let i = start; i < end; i++) {
        if (str.charCodeAt(i) === 10)
            n++;
    }
    return n;
}
/** Parst ein XML-Dokument in den Wurzelknoten; lehnt <!ENTITY (XXE / Billion Laughs) strikt ab. */
export function parseXmlDocument(rawInput) {
    if (Buffer.byteLength(rawInput, "utf8") > MAX_XML_BYTES) {
        throw new XmlParseError("XML_ZU_GROSS", "XML-Dokument überschreitet die Grenze von 20 MB.", 1);
    }
    const xml = rawInput.startsWith("\uFEFF") ? rawInput.slice(1) : rawInput;
    const len = xml.length;
    let pos = 0;
    let line = 1;
    const stack = [];
    let root = null;
    const baseNs = {
        xml: "http://www.w3.org/XML/1998/namespace",
        xmlns: "http://www.w3.org/2000/xmlns/",
    };
    while (pos < len) {
        const lt = xml.indexOf("<", pos);
        if (lt < 0) {
            const trailing = xml.slice(pos);
            if (stack.length > 0 && trailing.length > 0) {
                stack[stack.length - 1].textParts.push(decodeXmlEntities(trailing, line));
            }
            else if (root === null && trailing.trim().length > 0) {
                throw new XmlParseError("XML_KEIN_WURZELELEMENT", "Kein gültiges XML-Wurzelelement gefunden.", line);
            }
            break;
        }
        if (lt > pos) {
            const chunk = xml.slice(pos, lt);
            if (stack.length > 0) {
                stack[stack.length - 1].textParts.push(decodeXmlEntities(chunk, line));
            }
            line += countNewlines(xml, pos, lt);
            pos = lt;
        }
        // Kommentar <!-- ... -->
        if (xml.startsWith("<!--", pos)) {
            const end = xml.indexOf("-->", pos + 4);
            if (end < 0)
                throw new XmlParseError("XML_KOMMENTAR_OFFEN", `Ungeschlossener XML-Kommentar ab Zeile ${line}.`, line);
            line += countNewlines(xml, pos, end + 3);
            pos = end + 3;
            continue;
        }
        // CDATA <![CDATA[ ... ]]>
        if (xml.startsWith("<![CDATA[", pos)) {
            const end = xml.indexOf("]]>", pos + 9);
            if (end < 0)
                throw new XmlParseError("XML_CDATA_OFFEN", `Ungeschlossener CDATA-Abschnitt ab Zeile ${line}.`, line);
            if (stack.length > 0) {
                stack[stack.length - 1].textParts.push(xml.slice(pos + 9, end));
            }
            line += countNewlines(xml, pos, end + 3);
            pos = end + 3;
            continue;
        }
        // Processing Instruction <? ... ?>
        if (xml.startsWith("<?", pos)) {
            const end = xml.indexOf("?>", pos + 2);
            if (end < 0)
                throw new XmlParseError("XML_PI_OFFEN", `Ungeschlossene Processing Instruction ab Zeile ${line}.`, line);
            line += countNewlines(xml, pos, end + 2);
            pos = end + 2;
            continue;
        }
        // DOCTYPE / Deklarationen <! ... >
        if (xml.startsWith("<!", pos)) {
            // Sicherheitsgrenze: <!ENTITY ist strikt verboten (XXE & Entity-Expansion)
            const headSlice = xml.slice(pos, Math.min(len, pos + 4096));
            if (/<!ENTITY\b/i.test(headSlice)) {
                throw new XmlParseError("XML_SICHERHEIT_ENTITY_VERBOTEN", `XML-DOCTYPE mit <!ENTITY-Deklaration in Zeile ${line} wurde aus Sicherheitsgruenden (XXE-Schutz) abgewiesen.`, line);
            }
            // DOCTYPE kann interne [...] enthalten
            let scan = pos + 2;
            let bracketDepth = 0;
            let inQuote = null;
            while (scan < len) {
                const ch = xml[scan];
                if (inQuote) {
                    if (ch === inQuote)
                        inQuote = null;
                }
                else if (ch === "\"" || ch === "'") {
                    inQuote = ch;
                }
                else if (ch === "[") {
                    bracketDepth++;
                }
                else if (ch === "]") {
                    if (bracketDepth > 0)
                        bracketDepth--;
                }
                else if (ch === ">" && bracketDepth === 0) {
                    break;
                }
                scan++;
            }
            if (scan >= len)
                throw new XmlParseError("XML_DOCTYPE_OFFEN", `Ungeschlossene DOCTYPE-Deklaration ab Zeile ${line}.`, line);
            const doctypeBody = xml.slice(pos, scan + 1);
            if (/<!ENTITY\b/i.test(doctypeBody)) {
                throw new XmlParseError("XML_SICHERHEIT_ENTITY_VERBOTEN", `XML-DOCTYPE mit <!ENTITY-Deklaration in Zeile ${line} wurde aus Sicherheitsgruenden (XXE-Schutz) abgewiesen.`, line);
            }
            line += countNewlines(xml, pos, scan + 1);
            pos = scan + 1;
            continue;
        }
        // Schließendes Tag </name>
        if (xml.startsWith("</", pos)) {
            const gt = xml.indexOf(">", pos + 2);
            if (gt < 0)
                throw new XmlParseError("XML_SCHLUSSTAG_OFFEN", `Ungeschlossenes End-Tag ab Zeile ${line}.`, line);
            const closeName = xml.slice(pos + 2, gt).trim();
            const top = stack.pop();
            if (!top) {
                throw new XmlParseError("XML_UNERWARTETES_SCHLUSSTAG", `Unerwartetes schließendes Tag </${closeName}> in Zeile ${line}.`, line);
            }
            if (top.node.name !== closeName) {
                throw new XmlParseError("XML_TAG_WIDERSPRUCH", `Tag <${top.node.name}> (Zeile ${top.node.line}) wurde mit </${closeName}> (Zeile ${line}) geschlossen.`, line);
            }
            top.node.text = top.textParts.join("").trim();
            line += countNewlines(xml, pos, gt + 1);
            pos = gt + 1;
            continue;
        }
        // Öffnendes oder selbstschliessendes Tag <name attr="val" ...>
        const tagStartLine = line;
        let cursor = pos + 1;
        let quote = null;
        while (cursor < len) {
            const ch = xml[cursor];
            if (quote) {
                if (ch === quote)
                    quote = null;
            }
            else if (ch === "\"" || ch === "'") {
                quote = ch;
            }
            else if (ch === ">") {
                break;
            }
            cursor++;
        }
        if (cursor >= len) {
            throw new XmlParseError("XML_STARTTAG_OFFEN", `Ungeschlossenes Start-Tag ab Zeile ${tagStartLine}.`, tagStartLine);
        }
        let rawTag = xml.slice(pos + 1, cursor);
        line += countNewlines(xml, pos, cursor + 1);
        pos = cursor + 1;
        let selfClosing = false;
        if (rawTag.endsWith("/")) {
            selfClosing = true;
            rawTag = rawTag.slice(0, -1);
        }
        const trimmedTag = rawTag.trim();
        if (!trimmedTag) {
            throw new XmlParseError("XML_LEERES_TAG", `Leeres Tag <> in Zeile ${tagStartLine}.`, tagStartLine);
        }
        const nameMatch = /^([^\s=/]+)(.*)$/s.exec(trimmedTag);
        if (!nameMatch) {
            throw new XmlParseError("XML_UNGUELTIGER_TAGNAME", `Ungültiger Tagname in Zeile ${tagStartLine}.`, tagStartLine);
        }
        const tagName = nameMatch[1];
        const attrString = nameMatch[2] ?? "";
        const parentNs = stack.length > 0 ? stack[stack.length - 1].nsMap : baseNs;
        const currentNs = { ...parentNs };
        const rawAttrs = [];
        const attrRegex = /([^\s=/>]+)\s*=\s*(?:"([^"]*)"|'([^']*)')/g;
        let m;
        while ((m = attrRegex.exec(attrString)) !== null) {
            const aName = m[1];
            const aRawVal = m[2] !== undefined ? m[2] : (m[3] ?? "");
            const aVal = decodeXmlEntities(aRawVal, tagStartLine);
            rawAttrs.push({ name: aName, value: aVal });
            if (aName === "xmlns") {
                currentNs[""] = aVal;
            }
            else if (aName.startsWith("xmlns:")) {
                currentNs[aName.slice(6)] = aVal;
            }
        }
        const { prefix, localName } = splitQName(tagName);
        const elemNs = prefix ? (currentNs[prefix] ?? "") : (currentNs[""] ?? "");
        const attrs = {};
        const attrList = [];
        for (const ra of rawAttrs) {
            attrs[ra.name] = ra.value;
            const ap = splitQName(ra.name);
            const aNs = ap.prefix ? (currentNs[ap.prefix] ?? "") : "";
            attrList.push({
                name: ra.name,
                prefix: ap.prefix,
                localName: ap.localName,
                ns: aNs,
                value: ra.value,
            });
        }
        const node = {
            name: tagName,
            prefix,
            localName,
            ns: elemNs,
            attrs,
            attrList,
            children: [],
            text: "",
            line: tagStartLine,
        };
        if (stack.length > 0) {
            stack[stack.length - 1].node.children.push(node);
        }
        else {
            if (root !== null) {
                throw new XmlParseError("XML_MEHRERE_WURZELN", `Mehrere Wurzelelemente in Zeile ${tagStartLine}.`, tagStartLine);
            }
            root = node;
        }
        if (!selfClosing) {
            if (stack.length + 1 > MAX_DEPTH) {
                throw new XmlParseError("XML_ZU_TIEF", `XML-Verschachtelungstiefe überschreitet ${MAX_DEPTH} in Zeile ${tagStartLine}.`, tagStartLine);
            }
            stack.push({ node, nsMap: currentNs, textParts: [] });
        }
    }
    if (stack.length > 0) {
        const unclosed = stack[stack.length - 1].node;
        throw new XmlParseError("XML_NICHT_GESCHLOSSEN", `Element <${unclosed.name}> aus Zeile ${unclosed.line} wurde nicht geschlossen.`, unclosed.line);
    }
    if (!root) {
        throw new XmlParseError("XML_LEER", "Das XML-Dokument enthaelt kein Wurzelelement.", 1);
    }
    return root;
}
/** Erstes direktes Kind mit passendem localName. */
export function childByLocal(node, localName) {
    if (!node)
        return undefined;
    return node.children.find((c) => c.localName === localName);
}
/** Alle direkten Kinder mit passendem localName. */
export function childrenByLocal(node, localName) {
    if (!node)
        return [];
    return node.children.filter((c) => c.localName === localName);
}
/** Pfad aus mehreren localNames nacheinander auflösen. */
export function pathByLocal(node, ...localNames) {
    let cur = node ?? undefined;
    for (const name of localNames) {
        if (!cur)
            return undefined;
        cur = cur.children.find((c) => c.localName === name);
    }
    return cur;
}
/** Textinhalt entlang eines localName-Pfads (oder null). */
export function textAtPath(node, ...localNames) {
    const target = pathByLocal(node, ...localNames);
    return target ? target.text : null;
}
/** Alle Nachfahren mit passendem localName in Dokumentreihenfolge. */
export function descendantsByLocal(node, localName) {
    if (!node)
        return [];
    const out = [];
    const visit = (n) => {
        for (const c of n.children) {
            if (c.localName === localName)
                out.push(c);
            visit(c);
        }
    };
    visit(node);
    return out;
}
/** Sammelt gesamten sichtbaren Text eines Teilbaums (z. B. für HTML-artige GAEB-Langtexte). */
export function collectPlainText(node) {
    if (!node)
        return "";
    if (node.children.length === 0)
        return node.text;
    const parts = [];
    if (node.text)
        parts.push(node.text);
    for (const c of node.children) {
        const childTxt = collectPlainText(c);
        if (childTxt) {
            const blockTag = c.localName === "p" || c.localName === "br" || c.localName === "div" || c.localName === "li";
            parts.push(blockTag ? `${childTxt}\n` : childTxt);
        }
    }
    return parts
        .join(" ")
        .replace(/[ \t]+/g, " ")
        .replace(/ *\n */g, "\n")
        .trim();
}
/** Attributwert anhand localName (optional gefiltert nach Namespace-URI). */
export function attrByLocal(node, localName, nsUri) {
    if (!node)
        return null;
    for (const a of node.attrList) {
        if (a.localName === localName && (nsUri === undefined || a.ns === nsUri)) {
            return a.value;
        }
    }
    return null;
}
