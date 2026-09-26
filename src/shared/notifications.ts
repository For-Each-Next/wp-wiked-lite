/** User-facing notification port shared by editor features. */

export type ActionNotificationType = "error" | "info" | "success" | "warning";

export interface ActionNotification {
    key: string;
    message: string;
    type: ActionNotificationType;
}

export type ActionNotifier = (notification: ActionNotification) => void;
