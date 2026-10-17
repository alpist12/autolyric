import { describe, expect, it } from "vitest";
import { createScoreflowBundle, readScoreflowBundle } from "./scoreflowBundle";
import type { StoredScore } from "../types";

const stored = { id: "score-1", name: "band.musicxml", xml: "<score-partwise/>", savedAt: 7, score: {} } as StoredScore;

describe("ScoreFlow share bundle", () => {
  it("round-trips scores and per-score notes", () => {
    const [score] = readScoreflowBundle(createScoreflowBundle([stored], () => "2절부터 작게"));
    expect(score).toEqual({ name: "band.musicxml", xml: "<score-partwise/>", savedAt: 7, note: "2절부터 작게" });
  });

  it("rejects unrelated JSON", () => {
    expect(() => readScoreflowBundle('{"scores":[]}')).toThrow("지원하지 않는");
  });
});
