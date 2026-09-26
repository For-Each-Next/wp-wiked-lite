/** Conservative spelling and attribute spacing for existing HTML-like tags. */

import { normalizeInlineStyle } from "./inline-style-formatting.ts";
import { type SourceRange, wikitext } from "./wikitext/index.ts";

interface TagReplacement extends SourceRange {
    text: string;
}

const FORMATTABLE_TAGS = new Set(
    (
        "a abbr area article aside audio b bdi bdo big blockquote br button canvas caption center cite col colgroup dd del details dfn dialog div dl dt em " +
        "fieldset figcaption figure font footer form h1 h2 h3 h4 h5 h6 header hgroup hr i img input ins kbd label legend li main map mark menu meter nav ol optgroup option output p picture progress q rb rp rt rtc ruby " +
        "s samp small span strike strong sub sup table tbody td tfoot th thead " +
        "search section select slot source summary template time tr track tt u ul var video wbr ref references gallery imagemap indicator " +
        "inputbox categorytree charinsert section noinclude includeonly onlyinclude"
    ).split(" "),
);

/** Formats complete recognized tags while preserving their bodies and values. */
export function formatHtmlTags(source: string): string {
    const replacements: TagReplacement[] = [];
    for (const tag of wikitext(source).tag.getAll()) {
        if (
            !tag.closed ||
            tag.protectedContent ||
            !FORMATTABLE_TAGS.has(tag.name)
        ) {
            continue;
        }
        const opening = normalizeOpeningTag(
            source.slice(tag.start, tag.contentStart),
        );
        if (opening == null) {
            continue;
        }
        replacements.push({
            start: tag.start,
            end: tag.contentStart,
            text: opening,
        });
        if (!tag.selfClosing) {
            const closing = source.slice(tag.contentEnd, tag.end);
            const match = /^<\/\s*([A-Za-z][A-Za-z0-9:-]*)\s*>$/u.exec(closing);
            if (match != null) {
                replacements.push({
                    start: tag.contentEnd,
                    end: tag.end,
                    text: `</${match[1]}>`,
                });
            }
        }
    }
    let result = source;
    for (const replacement of replacements.sort(
        (left, right) => right.start - left.start,
    )) {
        result =
            result.slice(0, replacement.start) +
            replacement.text +
            result.slice(replacement.end);
    }
    return result;
}

function normalizeOpeningTag(source: string): string | undefined {
    // Formatter placeholders can hide significant attribute syntax in comments
    // or conversion-rule values, so leave their enclosing tags untouched.
    if (/[\uE000\uE001]/u.test(source)) {
        return undefined;
    }
    const head = /^<\s*([A-Za-z][A-Za-z0-9:-]*)(?=[\s/>])/u.exec(source);
    if (head == null || !source.endsWith(">")) {
        return undefined;
    }
    let tail = source.slice(head[0].length, -1);
    const selfClosing = /\/\s*$/u.test(tail);
    if (selfClosing) {
        tail = tail.replace(/\/\s*$/u, "");
    }
    const attributes = normalizeAttributes(tail);
    if (attributes == null) {
        return undefined;
    }
    return `<${head[1]}${attributes === "" ? "" : ` ${attributes}`}${selfClosing ? " /" : ""}>`;
}

function normalizeAttributes(source: string): string | undefined {
    const attributes: string[] = [];
    let index = 0;
    while (index < source.length) {
        const start = index;
        index = skipWhitespace(source, index);
        if (index === source.length) {
            break;
        }
        if (start === index) {
            return undefined;
        }
        const name = /^[A-Za-z_:][A-Za-z0-9_.:-]*/u.exec(
            source.slice(index),
        )?.[0];
        if (name == null) {
            return undefined;
        }
        index += name.length;
        const nameEnd = index;
        index = skipWhitespace(source, index);
        if (source[index] !== "=") {
            attributes.push(name);
            index = nameEnd;
            continue;
        }
        index = skipWhitespace(source, index + 1);
        const quote =
            source[index] === '"' || source[index] === "'" ? source[index] : "";
        let value: string;
        if (quote !== "") {
            const end = source.indexOf(quote, index + 1);
            if (end < 0) {
                return undefined;
            }
            value = source.slice(index + 1, end);
            index = end + 1;
        } else {
            const match = /^[^\s"'=<>`{}[\]|]+/u.exec(source.slice(index));
            if (match == null) {
                return undefined;
            }
            value = match[0];
            index += value.length;
        }
        if (name.toLowerCase() === "style") {
            value = normalizeInlineStyle(value);
        }
        const delimiter = quote || '"';
        attributes.push(`${name}=${delimiter}${value}${delimiter}`);
    }
    return attributes.join(" ");
}

function skipWhitespace(source: string, start: number): number {
    let index = start;
    while (/\s/u.test(source[index] ?? "")) {
        index += 1;
    }
    return index;
}
