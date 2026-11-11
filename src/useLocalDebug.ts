import { useEffect } from 'react';

/** Best-effort local snapshots; no model calls and no effect on editing.
 * Production bundles skip the request. The server also drops it when APP_ENV=production.
 */
export function useLocalDebug(area: 'research' | 'builder', state: unknown, enabled = true) {
  const body = JSON.stringify({ area, state });
  useEffect(() => {
    if (!enabled || import.meta.env?.PROD) return;
    const send = () => {
      void fetch('/api/debug/snapshot', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body,
        signal: AbortSignal.timeout(3000),
      }).catch(() => { /* An unavailable logger must not interrupt the app. */ });
    };
    const timer = window.setTimeout(send, 800);
    window.addEventListener('focus', send);
    return () => { window.clearTimeout(timer); window.removeEventListener('focus', send); };
  }, [area, body, enabled]);
}
