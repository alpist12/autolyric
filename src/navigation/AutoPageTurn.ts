import type { Score, TrackingState } from "../types";

export interface PageTurnDecision {
  page: number;
  changed: boolean;
  reason: "stable-target" | "disabled" | "low-confidence" | "not-ready";
}

export class AutoPageTurn {
  private candidatePage: number | undefined;
  private candidateSince = 0;

  constructor(
    private readonly score: Score,
    private currentPage = 1,
    private readonly minimumConfidence = 0.68,
    private readonly stableForMs = 450,
  ) {}

  evaluate(state: TrackingState, enabled = true): PageTurnDecision {
    if (!enabled) return { page: this.currentPage, changed: false, reason: "disabled" };
    if (state.confidence < this.minimumConfidence || state.status === "uncertain") {
      this.candidatePage = undefined;
      return { page: this.currentPage, changed: false, reason: "low-confidence" };
    }
    const target = Math.max(1, Math.min(state.page, this.score.pageCount));
    if (target <= this.currentPage) return { page: this.currentPage, changed: false, reason: "not-ready" };
    if (this.candidatePage !== target) {
      this.candidatePage = target;
      this.candidateSince = state.lastUpdateMs;
      return { page: this.currentPage, changed: false, reason: "not-ready" };
    }
    if (state.lastUpdateMs - this.candidateSince < this.stableForMs) {
      return { page: this.currentPage, changed: false, reason: "not-ready" };
    }
    this.currentPage = target;
    this.candidatePage = undefined;
    return { page: target, changed: true, reason: "stable-target" };
  }

  setPage(page: number): void {
    this.currentPage = Math.max(1, Math.min(page, this.score.pageCount));
    this.candidatePage = undefined;
  }

  get page(): number {
    return this.currentPage;
  }
}
