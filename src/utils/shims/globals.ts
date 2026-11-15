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
