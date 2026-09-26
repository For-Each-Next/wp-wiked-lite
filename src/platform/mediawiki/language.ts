/** Reads the host's interface language; catalog resolution remains pure. */
export function getInterfaceLanguage(): string {
    return typeof mw === "undefined"
        ? "en"
        : String(mw.config.get("wgUserLanguage") || "en");
}
