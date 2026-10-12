/**
 * Notifications for break end and landing (FR-040, FR-015) through the user's chosen channel:
 * push (browser Notification API), sound, both or none (settings.notifications.channel).
 */
import { playAlert } from "./audio";

export type Channel = "push" | "sound" | "both" | "none";

export function notificationsSupported(): boolean {
  return typeof window !== "undefined" && "Notification" in window;
}

export function notificationPermission(): NotificationPermission | "unsupported" {
  return notificationsSupported() ? Notification.permission : "unsupported";
}

export async function requestNotificationPermission(): Promise<NotificationPermission | "unsupported"> {
  if (!notificationsSupported()) return "unsupported";
  if (Notification.permission !== "default") return Notification.permission;
  try {
    return await Notification.requestPermission();
  } catch {
    return Notification.permission;
  }
}

export function notify(channel: Channel, kind: "break" | "landing" | "boarding", title: string, body: string, volume = 0.6): void {
  if (channel === "none") return;
  if ((channel === "push" || channel === "both") && notificationsSupported() && Notification.permission === "granted") {
    try {
      const n = new Notification(title, { body, tag: `aerofocus-${kind}`, silent: channel === "push" });
      n.onclick = () => {
        window.focus();
        n.close();
      };
    } catch {
      /* ignore */
    }
  }
  if (channel === "sound" || channel === "both") playAlert(kind, volume);
}
