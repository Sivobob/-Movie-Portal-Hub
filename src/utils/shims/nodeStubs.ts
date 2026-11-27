export function inspect(value: unknown): string {
  try {
    if (typeof value === 'string') return value;
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

export function deprecate<T extends Function>(fn: T): T {
  return fn;
}

export function promisify<T extends Function>(fn: T): T {
  return fn;
}

export class LocalStorage {
  getItem(k: string) {
    try { return globalThis.localStorage?.getItem(k) ?? null; } catch { return null; }
  }
  setItem(k: string, v: string) {
    try { globalThis.localStorage?.setItem(k, v); } catch {}
  }
  removeItem(k: string) {
    try { globalThis.localStorage?.removeItem(k); } catch {}
  }
}

export const SocksClient = {};
export const Socket = function () {};
export const connect = function () {};
export const platform = () => 'browser';
export const type = () => 'Browser';
export const release = () => '1.0.0';
export const tmpdir = () => '/tmp';
export const homedir = () => '/';
export const existsSync = () => false;
export const readFileSync = () => '';
export const writeFileSync = () => {};
export const promises = {};

export default {
  inspect,
  deprecate,
  promisify,
  LocalStorage,
  SocksClient,
  Socket,
  connect,
  platform,
  type,
  release,
  tmpdir,
  homedir,
  existsSync,
  readFileSync,
  writeFileSync,
  promises,
};
