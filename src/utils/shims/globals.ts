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

// When Android APK loads live remote HTTPS URLs inside WebView, preserve Capacitor native platform detection
try {
  if (
    typeof window !== 'undefined' &&
    ((g as any).AndroidPlayerBridge || (g as any).AndroidStreamBridge) &&
    !(g as any).androidBridge &&
    !(g as any).CapacitorCustomPlatform
  ) {
    (g as any).CapacitorCustomPlatform = { name: 'android' };
  }
} catch {}

