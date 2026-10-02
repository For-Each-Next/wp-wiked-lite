/**
 * @file src/domain/inline-style-formatting.ts
 * Purpose: Conservative whitespace normalization for inline CSS declaration lists.
 *
 * Table of contents:
 * 1. Declaration
 * 2. Constants and state
 * 3. normalizeInlineStyle
 * 4. scanDeclarations
 * 5. skipQuotedValue
 * 6. normalizeDeclaration
 * 7. skipTrivia
 * 8. trimWhitespace
 * 9. trimValueWhitespace
 */

interface Declaration {
    colon: number;
    text: string;
}

const CSS_WHITESPACE = /[\t\n\f\r ]/u;
const PROPERTY_NAME =
    /^(?:--[-_a-zA-Z0-9\u0080-\u{10ffff}]+|-?[_a-zA-Z\u0080-\u{10ffff}][-_a-zA-Z0-9\u0080-\u{10ffff}]*)$/u;
const CLOSING_DELIMITERS: Readonly<Record<string, string>> = {
    "(": ")",
    "[": "]",
    "{": "}",
};

/** Keeps values intact and leaves uncertain or incomplete CSS unchanged. */
export function normalizeInlineStyle(source: string): string {
    if (
        /\{\{|\}\}|\[\[|\]\]|-\{|\}-|<!--|-->/u.test(source) ||
        /&(?:#[xX]?[0-9A-Fa-f]+;?|[A-Za-z][A-Za-z0-9]*;)/u.test(source)
    ) {
        // Wikitext expansion and HTML character references can introduce CSS
        // delimiters that are not present in this source representation.
        return source;
    }
    const declarations = scanDeclarations(source);
    if (declarations == null) {
        return source;
    }
    const formatted: string[] = [];
    for (const declaration of declarations) {
        const result = normalizeDeclaration(declaration);
        if (result == null) {
            return source;
        }
        if (result !== "") {
            formatted.push(result);
        }
    }
    return formatted.join(" ");
}

function scanDeclarations(source: string): Declaration[] | null {
    const declarations: Declaration[] = [];
    const closing: string[] = [];
    let start = 0;
    let colon = -1;
    for (let index = 0; index < source.length; index += 1) {
        const character = source[index];
        if (character === '"' || character === "'") {
            const end = skipQuotedValue(source, index);
            if (end == null) {
                return null;
            }
            index = end - 1;
        } else if (source.startsWith("/*", index)) {
            const end = source.indexOf("*/", index + 2);
            if (end < 0) {
                return null;
            }
            index = end + 1;
        } else if (character === "\\") {
            if (
                index + 1 >= source.length ||
                /[\n\f\r]/u.test(source[index + 1])
            ) {
                return null;
            }
            index += 1;
        } else if (Object.hasOwn(CLOSING_DELIMITERS, character)) {
            closing.push(CLOSING_DELIMITERS[character]);
        } else if (/^[)\]}]$/u.test(character)) {
            if (closing.pop() !== character) {
                return null;
            }
        } else if (closing.length === 0 && character === ":" && colon < 0) {
            colon = index - start;
        } else if (closing.length === 0 && character === ";") {
            declarations.push({ colon, text: source.slice(start, index) });
            start = index + 1;
            colon = -1;
        }
    }
    if (closing.length > 0) {
        return null;
    }
    declarations.push({ colon, text: source.slice(start) });
    return declarations;
}

function skipQuotedValue(source: string, start: number): number | null {
    const quote = source[start];
    for (let index = start + 1; index < source.length; index += 1) {
        const character = source[index];
        if (character === quote) {
            return index + 1;
        }
        if (character === "\\") {
            index += 1;
            if (source[index] === "\r" && source[index + 1] === "\n") {
                index += 1;
            }
        } else if (/[\n\f\r]/u.test(character)) {
            return null;
        }
    }
    return null;
}

function normalizeDeclaration(declaration: Declaration): string | null {
    const { colon, text } = declaration;
    const propertyStart = skipTrivia(text, 0);
    const prefix = trimWhitespace(text.slice(0, propertyStart));
    if (propertyStart === text.length) {
        return prefix;
    }
    if (colon < propertyStart) {
        return null;
    }
    const property = trimWhitespace(text.slice(propertyStart, colon));
    if (!PROPERTY_NAME.test(property)) {
        return null;
    }
    const value = text.slice(colon + 1);
    const custom = property.startsWith("--");
    if (!custom && skipTrivia(value, 0) === value.length) {
        return null;
    }
    // Whitespace can be the entire custom-property value. Preserve that token
    // stream, including leading/trailing whitespace, rather than trimming it.
    const formattedValue = custom ? value : ` ${trimValueWhitespace(value)}`;
    return `${prefix === "" ? "" : `${prefix} `}${property}:${formattedValue};`;
}

function skipTrivia(source: string, start: number): number {
    let index = start;
    while (index < source.length) {
        if (CSS_WHITESPACE.test(source[index])) {
            index += 1;
        } else if (source.startsWith("/*", index)) {
            const end = source.indexOf("*/", index + 2);
            if (end < 0) {
                return index;
            }
            index = end + 2;
        } else {
            break;
        }
    }
    return index;
}

function trimWhitespace(source: string): string {
    return source.replace(/^[\t\n\f\r ]+|[\t\n\f\r ]+$/gu, "");
}

function trimValueWhitespace(source: string): string {
    // A CSS escape can consume trailing whitespace. Keep that value intact so
    // an appended declaration delimiter never becomes the escaped character.
    return source.includes("\\")
        ? source.replace(/^[\t\n\f\r ]+/u, "")
        : trimWhitespace(source);
}
