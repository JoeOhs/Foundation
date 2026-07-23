// A window.confirm() replacement. This Tauri/WebView2 build doesn't render
// native confirm() dialogs (they resolve/no-op silently instead of
// blocking), so destructive actions need an in-app equivalent. One
// <ConfirmDialog/> is mounted at the app root; call requestConfirm() from
// anywhere to show it and await the user's choice, the same shape as
// window.confirm but async.
type Listener = (state: ConfirmState | null) => void;

export interface ConfirmState {
  message: string;
  confirmLabel?: string;
}

let listener: Listener | null = null;
let resolver: ((v: boolean) => void) | null = null;

export function requestConfirm(message: string, confirmLabel?: string): Promise<boolean> {
  return new Promise((resolve) => {
    // Only one confirmation can be pending at a time — resolve any prior
    // one as cancelled rather than leaving it dangling.
    resolver?.(false);
    resolver = resolve;
    listener?.({ message, confirmLabel });
  });
}

export function subscribeConfirm(l: Listener): () => void {
  listener = l;
  return () => { if (listener === l) listener = null; };
}

export function resolveConfirm(value: boolean): void {
  resolver?.(value);
  resolver = null;
  listener?.(null);
}
