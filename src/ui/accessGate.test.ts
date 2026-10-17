import { describe, expect, it } from "vitest";
import { ACCESS_STORAGE_KEY, ACCESS_TOKEN, checkAndPersistAccess, verifyAccessKey } from "./accessGate";

describe("accessGate", () => {
  it("authorizes and persists when matching key is in query string", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    };

    const result = checkAndPersistAccess(`?key=${ACCESS_TOKEN}`, "#home", storage);
    expect(result.authorized).toBe(true);
    expect(store.get(ACCESS_STORAGE_KEY)).toBe(ACCESS_TOKEN);
    expect(result.cleanedUrl).not.toContain(ACCESS_TOKEN);
  });

  it("remembers authorization on subsequent visits without key in URL", () => {
    const store = new Map<string, string>([[ACCESS_STORAGE_KEY, ACCESS_TOKEN]]);
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    };

    const result = checkAndPersistAccess("", "#home", storage);
    expect(result.authorized).toBe(true);
  });

  it("blocks access when no valid key or stored session is present", () => {
    const store = new Map<string, string>();
    const storage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => { store.set(k, v); },
    };

    expect(checkAndPersistAccess("", "#home", storage).authorized).toBe(false);
    expect(checkAndPersistAccess("?key=wrong", "#home", storage).authorized).toBe(false);
    expect(verifyAccessKey(ACCESS_TOKEN)).toBe(true);
    expect(verifyAccessKey("wrong")).toBe(false);
  });
});
