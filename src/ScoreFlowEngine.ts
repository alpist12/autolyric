import { AutoPageTurn, type PageTurnDecision } from "./navigation/AutoPageTurn";
import { ScoreFollower, type FollowerOptions } from "./tracking/ScoreFollower";
import type { NoteObservation, Score, TrackingState } from "./types";

export interface EngineUpdate {
  tracking: TrackingState;
  pageTurn: PageTurnDecision;
}

export class ScoreFlowEngine extends EventTarget {
  readonly follower: ScoreFollower;
  readonly pageTurn: AutoPageTurn;
  autoTurnEnabled = true;

  constructor(readonly score: Score, followerOptions?: FollowerOptions) {
    super();
    this.follower = new ScoreFollower(score, followerOptions);
    this.pageTurn = new AutoPageTurn(score);
  }

  accept(observation: NoteObservation): EngineUpdate {
    const tracking = this.follower.observe(observation);
    const pageTurn = this.pageTurn.evaluate(tracking, this.autoTurnEnabled);
    const update = { tracking, pageTurn };
    this.dispatchEvent(new CustomEvent<EngineUpdate>("update", { detail: update }));
    return update;
  }

  goToMeasure(measureIndex: number): TrackingState {
    const measure = this.score.measures[Math.max(0, Math.min(measureIndex, this.score.measures.length - 1))]!;
    this.pageTurn.setPage(measure.page);
    return this.follower.reset(measure.startEventIndex);
  }
}
