import { describe, expect, it } from "vitest";
import { retainBandKey } from "./FirebaseSync";

describe("retainBandKey", () => {
  it("stores a valid shared band key and removes it from the visible URL", () => {
    const values = new Map<string, string>();
    const result = retainBandKey(new URL("https://example.com/app/?key=sf-7k9m2x8p#home"), {
      getItem: (key) => values.get(key) ?? null,
      setItem: (key, value) => { values.set(key, value); },
    });
    expect(result).toEqual({ key: "sf-7k9m2x8p", cleanUrl: "/app/#home" });
    expect(values.get("scoreflow-band-key")).toBe("sf-7k9m2x8p");
  });

  it("rejects malformed band keys", () => {
    expect(retainBandKey(new URL("https://example.com/?key=public"), { getItem: () => null, setItem: () => {} })).toBeNull();
  });
});
