/** Runs Playwright with temporary artifacts, preserving the test exit status. */

import { spawn } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import { constants, tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const playwrightCli = fileURLToPath(
    import.meta.resolve("@playwright/test/cli"),
);
const outputDir = await mkdtemp(join(tmpdir(), "wiked-lite-tests-"));
let removeSignalHandlers = () => undefined;

try {
    const child = spawn(
        process.execPath,
        [
            playwrightCli,
            "test",
            ...process.argv.slice(2),
            "--output",
            outputDir,
            "--last-failed-file",
            join(outputDir, "last-run.json"),
        ],
        {
            cwd: root,
            stdio: "inherit",
            env: {
                ...process.env,
                PLAYWRIGHT_HTML_OUTPUT_DIR: join(outputDir, "html-report"),
                PLAYWRIGHT_HTML_OPEN: "never",
                PLAYWRIGHT_BLOB_OUTPUT_DIR: join(outputDir, "blob-report"),
                PLAYWRIGHT_BLOB_OUTPUT_FILE: join(
                    outputDir,
                    "blob-report/report.zip",
                ),
                PLAYWRIGHT_PERFETTO_OUTPUT_DIR: join(
                    outputDir,
                    "perfetto-report",
                ),
                PLAYWRIGHT_PERFETTO_OUTPUT_FILE: join(
                    outputDir,
                    "perfetto-report/report.json",
                ),
                PLAYWRIGHT_JSON_OUTPUT_FILE: join(outputDir, "results.json"),
                PLAYWRIGHT_JUNIT_OUTPUT_FILE: join(outputDir, "results.xml"),
            },
        },
    );

    let interruptedBy;
    const forwardSignal = (signal) => {
        interruptedBy ??= signal;
        // SIGINT lets Playwright finish worker teardown before files are removed.
        child.kill("SIGINT");
    };
    const onInterrupt = () => forwardSignal("SIGINT");
    const onTerminate = () => forwardSignal("SIGTERM");
    process.on("SIGINT", onInterrupt);
    process.on("SIGTERM", onTerminate);

    removeSignalHandlers = () => {
        process.off("SIGINT", onInterrupt);
        process.off("SIGTERM", onTerminate);
    };
    const { code, signal } = await new Promise((resolveExit, reject) => {
        child.once("error", reject);
        child.once("close", (exitCode, exitSignal) => {
            resolveExit({ code: exitCode, signal: exitSignal });
        });
    });
    process.exitCode = interruptedBy
        ? 128 + constants.signals[interruptedBy]
        : (code ?? 128 + (constants.signals[signal] ?? 1));
} finally {
    try {
        await rm(outputDir, { recursive: true, force: true });
    } finally {
        removeSignalHandlers();
    }
}
