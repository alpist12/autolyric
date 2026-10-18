import { describe, expect, it } from "vitest";
import { mergeScoreSets, retainBandKey } from "./FirebaseSync";
import type { StoredScore } from "../types";

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

describe("mergeScoreSets", () => {
  const score = (id: string, updatedAt: number) => ({ id, updatedAt, savedAt: 1 } as StoredScore);

  it("adds remote scores and keeps the newest copy", () => {
    expect(mergeScoreSets([score("local", 2), score("shared", 5)], [score("remote", 3), score("shared", 8)]))
      .toEqual([score("local", 2), score("shared", 8), score("remote", 3)]);
  });
});
