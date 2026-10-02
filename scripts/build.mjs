/**
 * @file scripts/build.mjs
 * Purpose: Build standalone MediaWiki gadget and userscript artifacts.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. Initialization and execution
 * 4. extractReferenceIcon
 * 5. extractIconPath
 * 6. cssText
 * 7. vueTemplate
 * 8. bundleSource
 * 9. wrapReadableProgram
 * 10. documentationHeader
 * 11. mediaWikiArtifact
 * 12. thirdPartyIconNotice
 * 13. wrapHeaderParagraph
 * 14. userscriptArtifact
 */

import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { Script } from "node:vm";
import { parse } from "@vue/compiler-sfc";
import {
    cdxIconAdd,
    cdxIconAlert,
    cdxIconEdit,
    cdxIconEditUndo,
    cdxIconUndo,
} from "@wikimedia/codex-icons";
import { build, transform } from "esbuild";
import { minify as minifyHtml } from "html-minifier-terser";
import { minify as minifyJavaScript } from "terser";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const manifest = JSON.parse(await readFile(join(root, "package.json"), "utf8"));
const outputDir = join(root, "dist");
const iconManifest = JSON.parse(
    await readFile(
        join(root, "node_modules/@wikimedia/codex-icons/package.json"),
        "utf8",
    ),
);
const iconAttribution = [
    `MIT source: @wikimedia/codex-icons ${iconManifest.version} (SVG icon paths).`,
    "Upstream: https://gerrit.wikimedia.org/g/design/codex/",
    "Project-owned code: CC0-1.0. Full MIT notice follows below.",
];
const referenceIcons = Object.fromEntries(
    Object.entries({
        cdxIconEdit,
        cdxIconEditUndo,
        cdxIconAdd,
        cdxIconAlert,
        cdxIconUndo,
    }).map(([name, icon]) => [name, extractReferenceIcon(name, icon)]),
);
const iconLicense = (
    await readFile(
        join(root, "node_modules/@wikimedia/codex-icons/LICENSE"),
        "utf8",
    )
).trim();
if (!iconLicense.startsWith("MIT License") || iconLicense.includes("*/")) {
    throw new Error("The Codex icon license cannot be embedded safely.");
}

function extractReferenceIcon(name, icon) {
    if (typeof icon === "string") {
        return { path: extractIconPath(name, icon), flipInRtl: false };
    }
    if (icon == null || typeof icon !== "object") {
        throw new Error(`${name} has an unsupported icon representation.`);
    }
    const { ltr, rtl, shouldFlip = false, ...unsupported } = icon;
    if (
        typeof shouldFlip !== "boolean" ||
        (rtl !== undefined && typeof rtl !== "string") ||
        Object.keys(unsupported).length > 0
    ) {
        throw new Error(`${name} has unsupported directional icon metadata.`);
    }
    return {
        path: extractIconPath(name, ltr),
        flipInRtl: shouldFlip,
        ...(rtl == null
            ? {}
            : { rtlPath: extractIconPath(`${name} RTL`, rtl) }),
    };
}

function extractIconPath(name, markup) {
    const match =
        typeof markup === "string"
            ? markup.match(
                  /^<path d="([MmZzLlHhVvCcSsQqTtAa0-9eE.+,\s-]+)"\/>$/u,
              )
            : null;
    if (match == null) {
        throw new Error(
            `${name} must contain one SVG path with only path data.`,
        );
    }
    return match[1];
}

const description = [
    "Based on [[w:en:User:Cacycle|Cacycle]]'s [[w:en:User:Cacycle/wikEd|wikEd]].",
    "Provides synchronized live syntax highlighting, deterministic wikitext formatting, and optional citation and page-summary previews. For non-wikitext page models, the gadget uses CodeMirror instead.",
];

const userscriptMatches = [
    "https://*.wikipedia.org/*",
    "https://*.wiktionary.org/*",
    "https://*.wikibooks.org/*",
    "https://*.wikiquote.org/*",
    "https://*.wikinews.org/*",
    "https://*.wikisource.org/*",
    "https://*.wikiversity.org/*",
    "https://*.wikivoyage.org/*",
    "https://*.wikimedia.org/*",
    "https://*.wikidata.org/*",
    "https://*.wikifunctions.org/*",
    "https://*.mediawiki.org/*",
];

async function cssText(relativePath, compact) {
    const source = await readFile(join(root, relativePath), "utf8");
    if (!compact) {
        return source;
    }
    const result = await transform(source, { loader: "css", minify: true });
    return result.code.trim();
}

async function vueTemplate(relativePath, compact) {
    const filename = join(root, relativePath);
    const source = await readFile(filename, "utf8");
    const result = parse(source, { filename });
    const { descriptor } = result;
    if (
        result.errors.length > 0 ||
        descriptor.template == null ||
        descriptor.script != null ||
        descriptor.scriptSetup != null ||
        descriptor.styles.length > 0 ||
        descriptor.customBlocks.length > 0
    ) {
        throw new Error(`${relativePath} must contain one template only.`);
    }
    const template = descriptor.template.content.trim();
    return compact
        ? minifyHtml(template, {
              caseSensitive: true,
              collapseInlineTagWhitespace: true,
              collapseWhitespace: true,
              customAttrCollapse: /.*/u,
              keepClosingSlash: true,
          })
        : template;
}

async function bundleSource(compact) {
    const [styles, dialogStyles, dialogTemplate] = await Promise.all([
        cssText("src/features/editor/styles.css", compact),
        cssText("src/features/formatter/dialog.css", compact),
        vueTemplate("src/features/formatter/dialog.vue", compact),
    ]);
    const bundle = await build({
        absWorkingDir: root,
        bundle: true,
        define: {
            __WIKED_LITE_STYLES__: JSON.stringify(styles),
            __WIKED_LITE_FORMATTER_DIALOG_STYLES__:
                JSON.stringify(dialogStyles),
            __WIKED_LITE_FORMATTER_DIALOG_TEMPLATE__:
                JSON.stringify(dialogTemplate),
            __WIKED_LITE_REFERENCE_ICONS__: JSON.stringify(referenceIcons),
        },
        entryPoints: ["src/app/browser.ts"],
        format: "iife",
        logLevel: "silent",
        metafile: true,
        target: "es2024",
        write: false,
    });
    const dependencies = Object.keys(bundle.metafile.inputs).filter((input) =>
        input.includes("node_modules/"),
    );
    if (dependencies.length > 0) {
        throw new Error(
            `Browser dependencies must be supplied by MediaWiki ResourceLoader: ${dependencies.join(", ")}`,
        );
    }
    const code = bundle.outputFiles?.[0]?.text;
    if (code == null) {
        throw new Error("esbuild did not return the browser bundle.");
    }
    return code;
}

const [readableCode, compactCode] = await Promise.all([
    bundleSource(false),
    bundleSource(true),
]);
const minified = await minifyJavaScript(compactCode, {
    ecma: 2024,
    compress: { ecma: 2024, passes: 2 },
    format: { comments: false, ecma: 2024 },
    mangle: true,
});
if (minified.code == null) {
    throw new Error("Terser did not return minified JavaScript.");
}
const artifacts = new Map([
    ["wiked_lite.min.js", mediaWikiArtifact(minified.code)],
    [
        "wiked_lite.user.js",
        userscriptArtifact(wrapReadableProgram(readableCode)),
    ],
]);

// Parse both complete deliverables before replacing the previous build.
for (const [filename, source] of artifacts) {
    new Script(source, { filename });
}
await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });
await Promise.all(
    Array.from(artifacts, ([filename, source]) =>
        writeFile(join(outputDir, filename), source),
    ),
);
for (const [filename, source] of artifacts) {
    console.log(`Built dist/${filename} (${Buffer.byteLength(source)} bytes)`);
}

function wrapReadableProgram(source) {
    const indented = source
        .trim()
        .replace(/^"use strict";\s*/u, "")
        .split("\n")
        .map((line) => `    ${line}`)
        .join("\n");
    return [
        "(async function () {",
        '    "use strict";',
        "    let mw = window.mw;",
        "    for (let attempt = 0; attempt < 200; attempt += 1) {",
        '        if (typeof mw?.config?.get === "function" &&',
        '            typeof mw?.loader?.using === "function") {',
        "            break;",
        "        }",
        "        await new Promise((resolve) => window.setTimeout(resolve, 50));",
        "        mw = window.mw;",
        "    }",
        '    if (typeof mw?.config?.get !== "function" ||',
        '        typeof mw?.loader?.using !== "function") {',
        "        return;",
        "    }",
        indented,
        "})();",
    ].join("\n");
}

function documentationHeader() {
    return [
        "/**",
        " * wikEd Lite",
        " *",
        ...wrapHeaderParagraph(`Purpose: ${manifest.description}`),
        " *",
        ` * @name ${manifest.name}`,
        ` * @version ${manifest.version}`,
        " * @license CC0-1.0 AND MIT",
        " *",
        " * Table of contents:",
        " * 1. Metadata and license notices",
        " * 2. MediaWiki bootstrap and browser program",
        " */",
        "",
        "/**",
        ...description.flatMap((paragraph) => wrapHeaderParagraph(paragraph)),
        " *",
        ...iconAttribution.map((line) => ` * ${line}`),
        " */",
    ].join("\n");
}

function mediaWikiArtifact(program) {
    return [
        documentationHeader(),
        "",
        thirdPartyIconNotice(),
        "",
        "//<nowiki>",
        program,
        "//</nowiki>",
        "",
    ].join("\n");
}

function thirdPartyIconNotice() {
    return [
        "/*!",
        " * Project-owned code is dedicated under CC0-1.0.",
        " * Bundled Codex icon paths retain their MIT license:",
        " *",
        ...iconLicense.split(/\r?\n/u).map((line) => ` * ${line}`),
        " */",
    ].join("\n");
}

function wrapHeaderParagraph(paragraph) {
    const lines = [];
    let line = "";
    for (const word of paragraph.trim().match(/\[\[[^\]]+\]\]\S*|\S+/gu) ??
        []) {
        const candidate = line === "" ? word : `${line} ${word}`;
        if ([...candidate].length > 75 && line !== "") {
            lines.push(` * ${line}`);
            line = word;
        } else {
            line = candidate;
        }
    }
    if (line !== "") {
        lines.push(` * ${line}`);
    }
    return lines;
}

function userscriptArtifact(program) {
    return [
        "// ==UserScript==",
        "// @name         wikEd Lite",
        "// @namespace    wiked-lite",
        "// @homepageURL  https://github.com/For-Each-Next/wp-wiked-lite",
        "// @downloadURL  https://github.com/For-Each-Next/wp-wiked-lite/releases/latest/download/wiked_lite.user.js",
        "// @updateURL    https://github.com/For-Each-Next/wp-wiked-lite/releases/latest/download/wiked_lite.user.js",
        `// @version      ${manifest.version}`,
        `// @description  ${manifest.description}`,
        "// @license      CC0-1.0 AND MIT",
        ...iconAttribution.map((line) => `// ${line}`),
        ...userscriptMatches.map((match) => `// @match        ${match}`),
        "// @grant        none",
        "// @run-at       document-end",
        "// ==/UserScript==",
        "",
        documentationHeader(),
        "",
        thirdPartyIconNotice(),
        "",
        program,
        "",
    ].join("\n");
}
