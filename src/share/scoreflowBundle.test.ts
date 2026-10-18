import { describe, expect, it } from "vitest";
import { createScoreflowBundle, readScoreflowBundle } from "./scoreflowBundle";
import type { StoredScore } from "../types";

const stored = { id: "score-1", name: "band.musicxml", xml: "<score-partwise/>", savedAt: 7, score: {}, note: "2절부터 작게", annotations: ["M1,2 L3,4"] } as StoredScore;

describe("ScoreFlow share bundle", () => {
  it("round-trips scores and per-score notes", () => {
    const [score] = readScoreflowBundle(createScoreflowBundle([stored]));
    expect(score).toEqual({ name: "band.musicxml", xml: "<score-partwise/>", savedAt: 7, note: "2절부터 작게", annotations: ["M1,2 L3,4"] });
  });

  it("keeps version 1 backups compatible", () => {
    const [score] = readScoreflowBundle('{"format":"scoreflow-band","version":1,"scores":[{"name":"old.xml","xml":"<score-partwise/>","savedAt":1,"note":"old"}]}');
    expect(score?.annotations).toEqual([]);
  });

  it("rejects unrelated JSON", () => {
    expect(() => readScoreflowBundle('{"scores":[]}')).toThrow("지원하지 않는");
  });
});
