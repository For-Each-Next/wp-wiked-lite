/**
 * @file tests/release-notes.test.ts
 * Purpose: tests / release notes.test module.
 *
 * Table of contents:
 * 1. Imports
 * 2. Constants and state
 * 3. Test scenarios
 * 4. extractNotes
 */

import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

const script = await readFile(
    new URL("../scripts/release-notes.mjs", import.meta.url),
    "utf8",
);

test("release notes select only the exact tagged version", async () => {
    const result = await extractNotes(
        [
            "# Changelog",
            "## [Unreleased]",
            "- Future work.",
            "## [0.1.0] - 2026-09-27",
            "### Added",
            "- Initial editor.",
            "## [0.0.1] - 2026-09-26",
            "- Earlier notes.",
        ].join("\n"),
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.notes, "### Added\n- Initial editor.\n");
});

test("release notes accept plain version headings", async () => {
    const result = await extractNotes(
        "# Changelog\n## 0.1.0\n- Initial editor.\n",
    );

    assert.equal(result.status, 0, result.stderr);
    assert.equal(result.notes, "- Initial editor.\n");
});

test("release notes reject missing and empty entries", async () => {
    for (const changelog of [
        "# Changelog\n## [0.1.00]\n- Wrong version.\n",
        "# Changelog\n## [0.1.0]",
        "# Changelog\n## [0.1.0]\n\n## [0.0.1]\n- Old notes.\n",
    ]) {
        const result = await extractNotes(changelog);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /must contain release notes for 0\.1\.0/u);
        assert.equal(result.notes, null);
    }
});

test("release notes reject mismatched tags and nonstable versions", async () => {
    for (const [tag, version] of [
        ["v0.2.0", "0.1.0"],
        ["v0.1.0-beta.1", "0.1.0-beta.1"],
        ["v00.1.0", "00.1.0"],
    ]) {
        const result = await extractNotes("# Changelog", tag, version);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, /must match package version/u);
        assert.equal(result.notes, null);
    }
});

async function extractNotes(
    changelog: string,
    tag = "v0.1.0",
    version = "0.1.0",
): Promise<{ status: number | null; stderr: string; notes: string | null }> {
    const root = await mkdtemp(join(tmpdir(), "wiked-lite-release-"));
    try {
        await mkdir(join(root, "scripts"));
        await mkdir(join(root, "dist"));
        await writeFile(join(root, "scripts/release-notes.mjs"), script);
        await writeFile(
            join(root, "package.json"),
            JSON.stringify({ version }),
        );
        await writeFile(join(root, "CHANGELOG.md"), changelog);
        const result = spawnSync(
            process.execPath,
            [join(root, "scripts/release-notes.mjs"), tag],
            { encoding: "utf8" },
        );
        if (result.error) throw result.error;
        return {
            status: result.status,
            stderr: result.stderr,
            notes:
                result.status === 0
                    ? await readFile(
                          join(root, "dist/release-notes.md"),
                          "utf8",
                      )
                    : null,
        };
    } finally {
        await rm(root, { recursive: true, force: true });
    }
}
