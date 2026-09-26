/** Native MediaWiki action notification adapter. */

import type {
    ActionNotification,
    ActionNotificationType,
    ActionNotifier,
} from "../../shared/notifications.ts";

export interface MediaWikiNotificationOptions {
    autoHide: boolean;
    autoHideSeconds?: "long" | "short";
    tag: string;
    type: "error" | "info" | "success" | "warn";
}

export type MediaWikiNotify = (
    message: string,
    options: MediaWikiNotificationOptions,
) => unknown;

/** Creates a native notification port scoped to one gadget. */
export function createActionNotifier(
    gadgetId: string,
    notify: MediaWikiNotify = notifyWithMediaWiki,
): ActionNotifier {
    const gadgetTag = normalizeTagSegment(gadgetId);
    return function notifyAction(notification: ActionNotification): void {
        const type = toMediaWikiType(notification.type);
        const tagKey = normalizeTagSegment(notification.key);
        const options = createNotificationOptions(type, gadgetTag, tagKey);
        notify(notification.message, options);
    };
}

function createNotificationOptions(
    type: MediaWikiNotificationOptions["type"],
    gadgetId: string,
    key: string,
): MediaWikiNotificationOptions {
    const tag = `${gadgetId}:${key}`;
    if (type === "error") {
        return Object.freeze({ autoHide: false, tag, type });
    }
    const autoHideSeconds = type === "warn" ? "long" : "short";
    return Object.freeze({ autoHide: true, autoHideSeconds, tag, type });
}

function toMediaWikiType(
    type: ActionNotificationType,
): MediaWikiNotificationOptions["type"] {
    return type === "warning" ? "warn" : type;
}

function normalizeTagSegment(value: string): string {
    const normalized = String(value)
        .trim()
        .toLocaleLowerCase()
        .replace(/[^a-z0-9.-]+/gu, "-")
        .replace(/^-|-$/gu, "");
    return normalized || "unknown";
}

function notifyWithMediaWiki(
    message: string,
    options: MediaWikiNotificationOptions,
): unknown {
    if (typeof mw === "undefined") {
        throw new Error("MediaWiki notifications are unavailable.");
    }
    return mw.notify(message, options);
}
