import { describe, expect, it } from "vitest";
import { buildScoreTimeline } from "./PracticeAudio";
import type { Score } from "../types";

describe("buildScoreTimeline", () => {
  it("places later measures after the actual previous measure length", () => {
    const score = {
      measures: [{ index: 0 }, { index: 1 }],
      events: [
        { index: 0, measureIndex: 0, beat: 0, durationBeats: 1 },
        { index: 1, measureIndex: 0, beat: 2, durationBeats: 2 },
        { index: 2, measureIndex: 1, beat: 1, durationBeats: 1 },
      ],
    } as Score;
    expect(buildScoreTimeline(score).map((entry) => entry.startBeat)).toEqual([0, 2, 5]);
  });
});
