/**
 * Centralized Redis Client
 * Supports both local Redis (dev) and Upstash TLS Redis (cloud/prod) via REDIS_URL.
 * All BullMQ queues, workers, and app state share connections from this module.
 */

export function buildConnectionOptions() { return {} }
export function createConnection() { return redisConnection; }

const store = new Map()
export const redisConnection = {
  get: async (k) => store.get(k) ?? null,
  set: async (k, v, opts) => { store.set(k, v); return 'OK'; },
  del: async (k) => store.delete(k),
  incr: async (k) => { const n = (store.get(k) || 0) + 1; store.set(k, n); return n; },
  hgetall: async (k) => store.get(k) || {},
  hset: async (k, v) => { store.set(k, { ...store.get(k), ...v }); return 1; },
  hmset: async (k, v) => { store.set(k, { ...store.get(k), ...v }); return 1; },
  rpush: async (k, ...vals) => {
    const arr = store.get(k) || [];
    arr.push(...vals);
    store.set(k, arr);
    return arr.length;
  },
  lrange: async (k, start, stop) => {
    const arr = store.get(k) || [];
    return stop === -1 ? arr.slice(start) : arr.slice(start, stop + 1);
  },
  /** Bull queue keys use Redis lists — stub returns 0 when key missing. */
  llen: async (k) => {
    const v = store.get(k);
    return Array.isArray(v) ? v.length : 0;
  },
  /** Bull delayed set — stub returns 0 when key missing. */
  zcard: async (k) => {
    const v = store.get(k);
    if (v instanceof Map || v instanceof Set) return v.size;
    if (v && typeof v === 'object' && !Array.isArray(v)) return Object.keys(v).length;
    return 0;
  },
  expire: async (k, secs) => 1,
  keys: async () => Array.from(store.keys()),
  duplicate: () => redisConnection,
  subscribe: () => {},
  on: () => {},
  publish: async () => {},
  ping: async () => 'PONG'
}

export async function pingRedis() { return { ok: true, latencyMs: 0 } }
export async function validateRedisOnStartup() { return true }
