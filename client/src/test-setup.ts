/**
 * Browser globals that modules touch while they are still being imported.
 *
 * Vitest runs these suites without a DOM. A few modules reach for `localStorage`
 * or `window` at module scope (`const/host.ts` reads a stored host), and without
 * a stub the import fails before a single test runs.
 *
 * These are stubs, not an environment: anything that genuinely needs a browser
 * (layout, events, IndexedDB beyond `fake-indexeddb`) still belongs in a real
 * browser. `requestIdleCallback` is deliberately left absent so the callers'
 * fallback path is the one exercised here.
 */
class MemoryStorage implements Storage {
  private store = new Map<string, string>();

  get length(): number {
    return this.store.size;
  }

  clear(): void {
    this.store.clear();
  }

  getItem(key: string): string | null {
    return this.store.get(key) ?? null;
  }

  key(index: number): string | null {
    return [...this.store.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.store.delete(key);
  }

  setItem(key: string, value: string): void {
    this.store.set(key, String(value));
  }
}

const globalScope = globalThis as unknown as Record<string, unknown>;

if (!globalScope.localStorage) {
  globalScope.localStorage = new MemoryStorage();
}

if (!globalScope.sessionStorage) {
  globalScope.sessionStorage = new MemoryStorage();
}

// `NoteDocument` schedules through `window.setTimeout` so the handle type stays
// consistent across environments.
if (!globalScope.window) {
  globalScope.window = globalThis;
}
