import { useEffect, useState } from 'react';
import { resolveConfirm, subscribeConfirm, type ConfirmState } from '../confirmBus';

// Mounted once at the app root (see App.tsx) — renders whatever
// requestConfirm() from confirmBus.ts is currently asking about.
export default function ConfirmDialog() {
  const [state, setState] = useState<ConfirmState | null>(null);

  useEffect(() => subscribeConfirm(setState), []);

  if (!state) return null;

  return (
    <div className="modal-overlay" onClick={() => resolveConfirm(false)}>
      <div className="modal confirm-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-body confirm-body">{state.message}</div>
        <div className="modal-footer">
          <button onClick={() => resolveConfirm(false)}>Cancel</button>
          <button className="danger" onClick={() => resolveConfirm(true)}>
            {state.confirmLabel ?? 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}
