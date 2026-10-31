/**
 * Cross-platform dialogs backed by an in-app modal (see components/DialogHost).
 *
 * Why not `Alert.alert` / `window.confirm`?
 *   - `Alert.alert` is a no-op on react-native-web.
 *   - `window.confirm` / `window.alert` are suppressed in iOS "Add to Home
 *     Screen" (standalone) PWAs, so confirmations silently never appear and
 *     actions like Delete look broken.
 * A rendered <Modal> works consistently on web, standalone PWA, and native.
 *
 * The public API (`confirmDialog`, `alertDialog`) is unchanged, so callers
 * don't need to know about any of this.
 */

export type DialogButtonStyle = "default" | "cancel" | "destructive";

export interface DialogButton {
  text: string;
  value: boolean;
  style: DialogButtonStyle;
}

export interface DialogRequest {
  id: number;
  title: string;
  message?: string;
  buttons: DialogButton[];
  resolve: (value: boolean) => void;
}

const listeners = new Set<() => void>();
let queue: DialogRequest[] = [];
let seq = 0;

function emit() {
  listeners.forEach((l) => l());
}

/** For DialogHost to subscribe to changes. */
export function subscribeDialogs(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** The dialog currently being shown (first in the queue), or null. */
export function currentDialog(): DialogRequest | null {
  return queue[0] ?? null;
}

/** Resolve the current dialog with the chosen value and advance the queue. */
export function resolveDialog(id: number, value: boolean): void {
  const idx = queue.findIndex((d) => d.id === id);
  if (idx === -1) return;
  const [req] = queue.splice(idx, 1);
  req.resolve(value);
  emit();
}

/**
 * Confirmation dialog. Resolves true if the user confirms, false otherwise.
 */
export function confirmDialog(
  title: string,
  message?: string,
  opts?: { confirmText?: string; cancelText?: string; destructive?: boolean }
): Promise<boolean> {
  return new Promise((resolve) => {
    queue.push({
      id: ++seq,
      title,
      message,
      buttons: [
        { text: opts?.cancelText ?? "Cancel", value: false, style: "cancel" },
        {
          text: opts?.confirmText ?? "OK",
          value: true,
          style: opts?.destructive ? "destructive" : "default",
        },
      ],
      resolve,
    });
    emit();
  });
}

/** Message dialog with a single OK button. */
export function alertDialog(title: string, message?: string): void {
  queue.push({
    id: ++seq,
    title,
    message,
    buttons: [{ text: "OK", value: true, style: "default" }],
    resolve: () => {},
  });
  emit();
}
