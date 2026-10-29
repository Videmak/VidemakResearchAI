'use client';

import { useEffect, useRef } from 'react';

/** Cloudflare Turnstile (only when Admin › Sign-in has its keys): each answer is good for one request. */

type TurnstileApi = {
  render: (container: HTMLElement, options: Record<string, unknown>) => string;
  remove: (widgetId: string) => void;
};
declare global {
  interface Window { turnstile?: TurnstileApi }
}

let script: Promise<void> | null = null;
function loadScript() {
  script ||= new Promise<void>((resolve, reject) => {
    if (window.turnstile) { resolve(); return; }
    const tag = document.createElement('script');
    tag.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    tag.async = true;
    tag.onload = () => resolve();
    tag.onerror = () => { script = null; reject(new Error('The security check could not load.')); };
    document.head.appendChild(tag);
  });
  return script;
}

export function Turnstile({ siteKey, onToken, onError }: { siteKey: string; onToken: (token: string | null) => void; onError: (message: string) => void }) {
  const box = useRef<HTMLDivElement>(null);
  const handlers = useRef({ onToken, onError });
  handlers.current = { onToken, onError };

  useEffect(() => {
    let widget: string | null = null;
    let live = true;
    loadScript().then(() => {
      if (!live || !box.current || !window.turnstile) return;
      widget = window.turnstile.render(box.current, {
        sitekey: siteKey,
        theme: 'light',
        'refresh-expired': 'auto',
        callback: (token: string) => handlers.current.onToken(token),
        'expired-callback': () => handlers.current.onToken(null),
        'error-callback': () => { handlers.current.onToken(null); handlers.current.onError('The security check failed. Reload the page and try again.'); },
      });
    }).catch((error: Error) => handlers.current.onError(error.message));
    return () => {
      live = false;
      if (widget && window.turnstile) window.turnstile.remove(widget);
    };
  }, [siteKey]);

  return <div ref={box} className="flex min-h-[65px] justify-center" />;
}
