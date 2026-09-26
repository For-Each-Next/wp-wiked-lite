/** Structured, privacy-conscious console logging for wikEd Lite. */

export type LogLevel = "silent" | "error" | "warn" | "info" | "debug";

type ActiveLogLevel = Exclude<LogLevel, "silent">;

type LogDetails = unknown;

type StopTimer = (details?: LogDetails) => void;

export interface Logger {
    child(scope: string): Logger;

    debug(event: string, details?: LogDetails): void;

    error(event: string, details?: LogDetails): void;

    info(event: string, details?: LogDetails): void;

    startTimer(event: string, details?: LogDetails): StopTimer;

    warn(event: string, details?: LogDetails): void;
}

export interface LogOutput {
    debug(...values: unknown[]): void;

    error(...values: unknown[]): void;

    info(...values: unknown[]): void;

    warn(...values: unknown[]): void;
}

export interface LoggerOptions {
    level?: LogLevel;
    now?: () => number;
    output?: LogOutput;
}

interface LoggerState {
    gadgetId: string;
    level: LogLevel;
    now: () => number;
    output: LogOutput;
}

const LEVEL_PRIORITY: Readonly<Record<LogLevel, number>> = Object.freeze({
    debug: 4,
    error: 1,
    info: 3,
    silent: 0,
    warn: 2,
});
const REDACTED = "[redacted]";
const CIRCULAR = "[circular]";
const TRUNCATED = "[truncated]";
const UNAVAILABLE = "[unavailable]";
const MAX_DEPTH = 4;
const MAX_ITEMS = 20;
const MAX_KEYS = 25;
const MAX_STRING_LENGTH = 200;
const SECRET_KEY_PATTERN =
    /(?:auth|cookie|credential|csrf|password|secret|token)/iu;
const PRIVATE_KEY_PATTERN = new RegExp(
    "(?:article|body|content|edit.?summary|email|html|request|response|" +
        "session|source|text|title|user|wikitext)",
    "iu",
);
const URL_KEY_PATTERN = /(?:href|uri|url)/iu;
const URL_PATTERN = /(?:https?:\/\/|\/\/)[^\s"'<>]+/giu;

/** Creates a consistently prefixed logger for one gadget. */
export function createLogger(
    gadgetId: string,
    options: LoggerOptions = {},
): Logger {
    const state: LoggerState = {
        gadgetId: normalizeIdentifier(gadgetId),
        level: isLogLevel(options.level) ? options.level : "warn",
        now: options.now ?? Date.now,
        output: options.output ?? console,
    };
    return createScopedLogger(state, []);
}

function createScopedLogger(
    state: LoggerState,
    scopes: readonly string[],
): Logger {
    function child(scope: string): Logger {
        const normalizedScope = normalizeIdentifier(scope);
        return createScopedLogger(state, [...scopes, normalizedScope]);
    }

    function debug(event: string, details?: LogDetails): void {
        emit(state, scopes, "debug", event, details);
    }

    function error(event: string, details?: LogDetails): void {
        emit(state, scopes, "error", event, details);
    }

    function info(event: string, details?: LogDetails): void {
        emit(state, scopes, "info", event, details);
    }

    function warn(event: string, details?: LogDetails): void {
        emit(state, scopes, "warn", event, details);
    }

    function startTimer(event: string, details?: LogDetails): StopTimer {
        return createTimer(state, scopes, event, details);
    }

    return Object.freeze({
        child,
        debug,
        error,
        info,
        startTimer,
        warn,
    });
}

function createTimer(
    state: LoggerState,
    scopes: readonly string[],
    event: string,
    initialDetails: LogDetails,
): StopTimer {
    if (!isLevelEnabled(state.level, "debug")) {
        return function stopDisabledTimer(): void {};
    }
    const startedAt = state.now();
    let stopped = false;
    return function stopTimer(completionDetails?: LogDetails): void {
        if (stopped) {
            return;
        }
        stopped = true;
        const durationMs = Math.max(0, Math.round(state.now() - startedAt));
        emit(state, scopes, "debug", `${event}.completed`, {
            completion: completionDetails,
            durationMs,
            initial: initialDetails,
        });
    };
}

function emit(
    state: LoggerState,
    scopes: readonly string[],
    level: ActiveLogLevel,
    event: string,
    details: LogDetails,
): void {
    if (!isLevelEnabled(state.level, level)) {
        return;
    }
    const prefix = buildPrefix(state.gadgetId, scopes);
    const eventName = normalizeEvent(event);
    const message = `${prefix} ${eventName}`;
    if (details === undefined) {
        state.output[level](message);
        return;
    }
    state.output[level](message, sanitize(details));
}

function isLogLevel(value: unknown): value is LogLevel {
    return typeof value === "string" && Object.hasOwn(LEVEL_PRIORITY, value);
}

function isLevelEnabled(
    configured: LogLevel,
    requested: ActiveLogLevel,
): boolean {
    return LEVEL_PRIORITY[requested] <= LEVEL_PRIORITY[configured];
}

function buildPrefix(gadgetId: string, scopes: readonly string[]): string {
    const root = `[${gadgetId}]`;
    return scopes.length === 0 ? root : `${root}[${scopes.join(".")}]`;
}

function normalizeIdentifier(value: string): string {
    const normalized = String(value)
        .trim()
        .toLocaleLowerCase()
        .replace(/[^a-z0-9]+/gu, "-")
        .replace(/^-|-$/gu, "");
    return normalized || "unknown";
}

function normalizeEvent(value: string): string {
    const normalized = String(value)
        .trim()
        .toLocaleLowerCase()
        .replace(/[^a-z0-9.]+/gu, ".")
        .replace(/\.{2,}/gu, ".")
        .replace(/^\.|\.$/gu, "");
    return normalized || "unknown.event";
}

function sanitize(value: unknown): unknown {
    try {
        return sanitizeValue(value, "", 0, new WeakSet<object>());
    } catch {
        return UNAVAILABLE;
    }
}

function sanitizeValue(
    value: unknown,
    key: string,
    depth: number,
    seen: WeakSet<object>,
): unknown {
    if (isPrivateKey(key)) {
        return REDACTED;
    }
    if (typeof value === "string") {
        return sanitizeString(value);
    }
    if (value instanceof Error) {
        return sanitizeError(value);
    }
    if (
        value == null ||
        typeof value === "number" ||
        typeof value === "boolean"
    ) {
        return value;
    }
    if (typeof value !== "object") {
        return `[${typeof value}]`;
    }
    return sanitizeObject(value, depth, seen);
}

function isPrivateKey(key: string): boolean {
    return (
        SECRET_KEY_PATTERN.test(key) ||
        PRIVATE_KEY_PATTERN.test(key) ||
        URL_KEY_PATTERN.test(key)
    );
}

function sanitizeString(value: string): string {
    const withoutUrls = value.replace(URL_PATTERN, "[url]");
    if (withoutUrls.length <= MAX_STRING_LENGTH) {
        return withoutUrls;
    }
    return `${withoutUrls.slice(0, MAX_STRING_LENGTH)}…${TRUNCATED}`;
}

function sanitizeError(
    error: Error & { code?: unknown },
): Readonly<Record<string, unknown>> {
    return Object.freeze({
        ...(typeof error.code === "string" || typeof error.code === "number"
            ? { code: sanitizeValue(error.code, "", 0, new WeakSet()) }
            : {}),
        // Error messages can interpolate titles, source text, or remote
        // response details. Log safe fields separately.
        // Do not rely on free-form exception prose.
        message: REDACTED,
        name: sanitizeString(error.name),
    });
}

function sanitizeObject(
    value: object,
    depth: number,
    seen: WeakSet<object>,
): unknown {
    if (seen.has(value)) {
        return CIRCULAR;
    }
    if (depth >= MAX_DEPTH) {
        return TRUNCATED;
    }
    seen.add(value);
    if (Array.isArray(value)) {
        return sanitizeArray(value, depth, seen);
    }
    return sanitizeRecord(value, depth, seen);
}

function sanitizeArray(
    values: readonly unknown[],
    depth: number,
    seen: WeakSet<object>,
): unknown[] {
    const result = values
        .slice(0, MAX_ITEMS)
        .map((value) => sanitizeValue(value, "", depth + 1, seen));
    if (values.length > MAX_ITEMS) {
        result.push(TRUNCATED);
    }
    return result;
}

function sanitizeRecord(
    value: object,
    depth: number,
    seen: WeakSet<object>,
): Readonly<Record<string, unknown>> {
    const result: Record<string, unknown> = {};
    const entries = Object.entries(value).slice(0, MAX_KEYS);
    for (const [key, child] of entries) {
        result[key] = sanitizeValue(child, key, depth + 1, seen);
    }
    if (Object.keys(value).length > MAX_KEYS) {
        result[TRUNCATED] = true;
    }
    return Object.freeze(result);
}
