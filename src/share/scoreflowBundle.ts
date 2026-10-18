import type { StoredScore } from "../types";

export const SCOREFLOW_BUNDLE_FORMAT = "scoreflow-band";

export type SharedScore = Pick<StoredScore, "name" | "xml" | "savedAt"> & { displayName?: string; note: string; annotations: string[] };

export function createScoreflowBundle(scores: StoredScore[], readNote?: (id: string) => string): string {
  return JSON.stringify({
    format: SCOREFLOW_BUNDLE_FORMAT,
    version: 3,
    exportedAt: new Date().toISOString(),
    scores: scores.map(({ id, name, displayName, xml, savedAt, note, annotations }) => ({ name, ...(displayName ? { displayName } : {}), xml, savedAt, note: note ?? readNote?.(id) ?? "", annotations: annotations ?? [] })),
  });
}

export function readScoreflowBundle(text: string): SharedScore[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error("ScoreFlow 공유 파일이 올바르지 않습니다."); }
  if (!data || typeof data !== "object") throw new Error("ScoreFlow 공유 파일이 올바르지 않습니다.");
  const bundle = data as { format?: unknown; version?: unknown; scores?: unknown };
  if (bundle.format !== SCOREFLOW_BUNDLE_FORMAT || (bundle.version !== 1 && bundle.version !== 2 && bundle.version !== 3) || !Array.isArray(bundle.scores)) throw new Error("지원하지 않는 ScoreFlow 공유 파일입니다.");
  return bundle.scores.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`${index + 1}번째 악보 정보가 올바르지 않습니다.`);
    const score = item as Partial<SharedScore>;
    if (typeof score.name !== "string" || typeof score.xml !== "string" || typeof score.savedAt !== "number") throw new Error(`${index + 1}번째 악보 정보가 올바르지 않습니다.`);
    return { name: score.name, ...(typeof score.displayName === "string" && score.displayName.trim() ? { displayName: score.displayName.trim().slice(0, 120) } : {}), xml: score.xml, savedAt: score.savedAt, note: typeof score.note === "string" ? score.note : "", annotations: Array.isArray(score.annotations) && score.annotations.every((line) => typeof line === "string") ? score.annotations : [] };
  });
}
