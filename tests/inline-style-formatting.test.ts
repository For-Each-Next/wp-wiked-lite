/**
 * @file tests/inline-style-formatting.test.ts
 * Purpose: tests / inline style formatting.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Test scenarios
 */

import assert from "node:assert/strict";
import test from "node:test";
import { normalizeInlineStyle } from "../src/domain/inline-style-formatting.ts";

test("inline CSS normalizes declaration spacing and the final semicolon", () => {
    assert.equal(
        normalizeInlineStyle("key1 : a; key2:b "),
        "key1: a; key2: b;",
    );
    assert.equal(
        normalizeInlineStyle(" COLOR \t: red;\n-webkit-transform: none;; "),
        "COLOR: red; -webkit-transform: none;",
    );
    assert.equal(normalizeInlineStyle(" \t\n"), "");
});

test("quoted strings, escapes, data URLs and nested functions keep their values", () => {
    const cases = [
        [
            "content : 'a; b:c \\' d';font-family:\"A;B:C\"",
            "content: 'a; b:c \\' d'; font-family: \"A;B:C\";",
        ],
        [
            "background :url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 1 1'></svg>\");color:red",
            "background: url(\"data:image/svg+xml;utf8,<svg viewBox='0 0 1 1'></svg>\"); color: red;",
        ],
        [
            "background:url(data:image/png;base64,aBcd==);width :calc(100% - var(--gutter, 1px));color :red !important",
            "background: url(data:image/png;base64,aBcd==); width: calc(100% - var(--gutter, 1px)); color: red !important;",
        ],
        ["content:foo\\;bar;color:red", "content: foo\\;bar; color: red;"],
        [
            "grid-template-columns:[main:start] 1fr [end];color:red",
            "grid-template-columns: [main:start] 1fr [end]; color: red;",
        ],
    ];
    for (const [source, expected] of cases) {
        assert.equal(normalizeInlineStyle(source), expected);
    }
});

test("custom properties retain their complete values including empty whitespace", () => {
    const source =
        "--space : ;--empty:;--tokens :  {a:b;c:d}  ;--列表: [one;two];color:red";
    assert.equal(
        normalizeInlineStyle(source),
        "--space: ; --empty:; --tokens:  {a:b;c:d}  ; --列表: [one;two]; color: red;",
    );
});

test("escaped trailing whitespace remains part of the CSS value", () => {
    for (const value of ["A\\ ", "A\\\t", "\\31 ", "\\31\r\n"]) {
        const source = `font-family : ${value}`;
        const expected = `font-family: ${value};`;
        assert.equal(normalizeInlineStyle(source), expected);
        assert.equal(normalizeInlineStyle(expected), expected);
    }
});

test("CSS comments retain their content and shield embedded delimiters", () => {
    assert.equal(
        normalizeInlineStyle(
            " /* lead ; : */ color :red/* in ; : */; /* between */ margin: 0 ; /* tail */ ",
        ),
        "/* lead ; : */ color: red/* in ; : */; /* between */ margin: 0; /* tail */",
    );
    assert.equal(
        normalizeInlineStyle("--blank: /* keep */ ;color:red"),
        "--blank: /* keep */ ; color: red;",
    );
});

test("ambiguous, incomplete or malformed declarations keep the entire source", () => {
    const sources = [
        "color :red; broken",
        "color :red; width:",
        "color : /* no value */; width:0",
        "color :red; content:'unfinished",
        'color :red; content:"line\nbreak"',
        "color :red; width:calc(100% - 1px",
        "color :red; width:calc([1px)]",
        "color :red; background:url(data:a;b",
        "color :red; /* unfinished",
        "color :red; padding:1px\\",
        "color :red; padding:1px\\\n",
        "col/**/or :red; margin:0",
        "color :red; @unknown(foo)",
        "-- : red; color:blue",
    ];
    for (const source of sources) {
        assert.equal(normalizeInlineStyle(source), source);
    }
});

test("dynamic wikitext and character references remain unmodified", () => {
    const sources = [
        "color : {{color}}; width:1px",
        "color : {{{color|red}}}; width:1px",
        "content : '-{zh:字;en:word}-'; color:red",
        "content : [[A|B]]; color:red",
        "color :red<!-- hidden -->; width:1px",
        "font-family :&quot;A;B&quot;;color:red",
        "color : red&#59; width:0",
        "color : red&#x3b; width:0",
        "background :url('https://example.test/?a=1&amp;b=2');color:red",
    ];
    for (const source of sources) {
        assert.equal(normalizeInlineStyle(source), source);
    }
});

test("inline CSS normalization is idempotent across preserved value syntax", () => {
    const sources = [
        "color:red; font-weight:bold",
        "--space : ;content:'a; b:c';width:calc(1px + var(--space))",
        "/* first */ color:red; /* last */",
        "background:url(data:image/png;base64,aBcd==);color:red",
        "color:{{dynamic}};margin:0",
    ];
    for (const source of sources) {
        const formatted = normalizeInlineStyle(source);
        assert.equal(normalizeInlineStyle(formatted), formatted);
    }
});
