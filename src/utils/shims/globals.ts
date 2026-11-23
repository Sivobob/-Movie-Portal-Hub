import { Buffer } from 'buffer';

const g = globalThis as any;
if (!g.Buffer) {
  g.Buffer = Buffer;
}
if (!g.global) {
  g.global = g;
}
if (!g.process) {
  g.process = {
    env: {},
    version: '',
    platform: 'browser',
    nextTick: (cb: (...args: any[]) => void, ...args: any[]) => Promise.resolve().then(() => cb(...args)),
  };
}

// Suppress blocking GramJS `alert("Missing MTProto Entity: ...")` popups in Android WebView & browsers
try {
  const originalAlert = typeof g.alert === 'function' ? g.alert.bind(g) : null;
  const wrappedAlert = (message?: any) => {
    const text = String(message ?? '');
    if (/Missing MTProto Entity/i.test(text)) {
      console.warn('[TelegramNotice] Suppressed MTProto warning:', text);
      return;
    }
    if (originalAlert) {
      return originalAlert(message);
    }
  };
  g.alert = wrappedAlert;
  if (typeof window !== 'undefined' && (window as any).alert !== wrappedAlert) {
    (window as any).alert = wrappedAlert;
  }
} catch {}

