import type { NoteObservation, Score, TrackingState } from "../types";

export interface FollowerOptions {
  searchAhead?: number;
  searchBehind?: number;
  uncertainThreshold?: number;
  pauseAfterMs?: number;
}

export class ScoreFollower {
  private stateValue: TrackingState;
  private lastTimestamp: number | undefined;
  private intervals: number[] = [];
  private uncertainCount = 0;
  private readonly options: Required<FollowerOptions>;

  constructor(private readonly score: Score, options: FollowerOptions = {}) {
    this.options = {
      searchAhead: options.searchAhead ?? 8,
      searchBehind: options.searchBehind ?? 2,
      uncertainThreshold: options.uncertainThreshold ?? 0.5,
      pauseAfterMs: options.pauseAfterMs ?? 2500,
    };
    this.stateValue = this.makeState(0, "idle", 0, 0);
  }

  get state(): Readonly<TrackingState> {
    return this.stateValue;
  }

  reset(eventIndex = 0): TrackingState {
    const safeIndex = Math.max(0, Math.min(eventIndex, this.score.events.length - 1));
    this.lastTimestamp = undefined;
    this.intervals = [];
    this.uncertainCount = 0;
    this.stateValue = this.makeState(safeIndex, "idle", 0, 0);
    return this.stateValue;
  }

  pause(timestampMs = performance.now()): TrackingState {
    this.stateValue = { ...this.stateValue, status: "paused", lastUpdateMs: timestampMs };
    return this.stateValue;
  }

  observe(observation: NoteObservation): TrackingState {
    const current = this.stateValue.eventIndex;
    const globallySearch = this.uncertainCount >= 3;
    const start = globallySearch ? 0 : Math.max(0, current - this.options.searchBehind);
    const end = globallySearch
      ? this.score.events.length - 1
      : Math.min(this.score.events.length - 1, current + this.options.searchAhead);

    const candidates: Array<{ index: number; score: number; pitchScore: number }> = [];
    for (let index = start; index <= end; index += 1) {
      const event = this.score.events[index]!;
      const distance = Math.min(...event.midiPitches.map((pitch) => Math.abs(pitch - observation.midi)));
      const pitchScore = Math.exp(-0.75 * distance);
      const jump = index - current;
      let transition = jump === 1 ? 0.24 : jump === 0 ? 0.08 : -0.13 * Math.abs(jump);
      if (jump < 0) transition -= 0.35;
      if (globallySearch) transition = -0.018 * Math.abs(jump);
      candidates.push({ index, pitchScore, score: pitchScore * observation.confidence + transition });
    }
    candidates.sort((a, b) => b.score - a.score);
    const best = candidates[0]!;
    const second = candidates[1];
    const separation = second ? best.score - second.score : best.score;
    const confidence = Math.max(0, Math.min(1, 0.65 * best.pitchScore + 0.35 * (1 / (1 + Math.exp(-4 * separation)))));

    const gap = this.lastTimestamp === undefined ? 0 : observation.timestampMs - this.lastTimestamp;
    if (gap > 80 && gap < this.options.pauseAfterMs) {
      this.intervals.push(gap);
      if (this.intervals.length > 8) this.intervals.shift();
    }
    this.lastTimestamp = observation.timestampMs;
    const event = this.score.events[best.index]!;
    const averageInterval = this.intervals.length
      ? this.intervals.reduce((sum, value) => sum + value, 0) / this.intervals.length
      : 0;
    const estimatedTempo = averageInterval > 0 ? Math.max(20, Math.min(300, 60000 / averageInterval)) : this.score.initialTempo;
    const status = confidence >= this.options.uncertainThreshold ? "tracking" : "uncertain";
    this.uncertainCount = status === "uncertain" ? this.uncertainCount + 1 : 0;
    this.stateValue = {
      status: best.index === this.score.events.length - 1 && status === "tracking" ? "finished" : status,
      eventIndex: best.index,
      measureIndex: event.measureIndex,
      page: event.page,
      confidence,
      estimatedTempo,
      lastUpdateMs: observation.timestampMs,
    };
    return this.stateValue;
  }

  updateClock(timestampMs = performance.now()): TrackingState {
    if (this.lastTimestamp !== undefined && timestampMs - this.lastTimestamp >= this.options.pauseAfterMs) {
      this.stateValue = { ...this.stateValue, status: "paused", lastUpdateMs: timestampMs };
    }
    return this.stateValue;
  }

  private makeState(eventIndex: number, status: TrackingState["status"], confidence: number, time: number): TrackingState {
    const event = this.score.events[eventIndex]!;
    return {
      status,
      eventIndex,
      measureIndex: event.measureIndex,
      page: event.page,
      confidence,
      estimatedTempo: this.score.initialTempo,
      lastUpdateMs: time,
    };
  }
}
