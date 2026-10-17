import type { StoredScore } from "../types";

export const SCOREFLOW_BUNDLE_FORMAT = "scoreflow-band";

export type SharedScore = Pick<StoredScore, "name" | "xml" | "savedAt"> & { note: string };

export function createScoreflowBundle(scores: StoredScore[], readNote: (id: string) => string): string {
  return JSON.stringify({
    format: SCOREFLOW_BUNDLE_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    scores: scores.map(({ id, name, xml, savedAt }) => ({ name, xml, savedAt, note: readNote(id) })),
  });
}

export function readScoreflowBundle(text: string): SharedScore[] {
  let data: unknown;
  try { data = JSON.parse(text); } catch { throw new Error("ScoreFlow 공유 파일이 올바르지 않습니다."); }
  if (!data || typeof data !== "object") throw new Error("ScoreFlow 공유 파일이 올바르지 않습니다.");
  const bundle = data as { format?: unknown; version?: unknown; scores?: unknown };
  if (bundle.format !== SCOREFLOW_BUNDLE_FORMAT || bundle.version !== 1 || !Array.isArray(bundle.scores)) throw new Error("지원하지 않는 ScoreFlow 공유 파일입니다.");
  return bundle.scores.map((item, index) => {
    if (!item || typeof item !== "object") throw new Error(`${index + 1}번째 악보 정보가 올바르지 않습니다.`);
    const score = item as Partial<SharedScore>;
    if (typeof score.name !== "string" || typeof score.xml !== "string" || typeof score.savedAt !== "number") throw new Error(`${index + 1}번째 악보 정보가 올바르지 않습니다.`);
    return { name: score.name, xml: score.xml, savedAt: score.savedAt, note: typeof score.note === "string" ? score.note : "" };
  });
}
