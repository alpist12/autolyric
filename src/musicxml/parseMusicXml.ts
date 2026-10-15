import type { Score, ScoreEvent, ScoreMeasure } from "../types";

type ParserFactory = new () => Pick<DOMParser, "parseFromString">;

const STEP_TO_SEMITONE: Record<string, number> = {
  C: 0,
  D: 2,
  E: 4,
  F: 5,
  G: 7,
  A: 9,
  B: 11,
};

function text(parent: Element | Document, tag: string): string {
  return parent.getElementsByTagName(tag)[0]?.textContent?.trim() ?? "";
}

function directChildren(parent: Element, tag: string): Element[] {
  return Array.from(parent.childNodes).filter(
    (node): node is Element => node.nodeType === 1 && (node as Element).tagName.split(":").at(-1) === tag,
  );
}

function pitchToMidi(note: Element): number | null {
  const pitch = directChildren(note, "pitch")[0];
  if (!pitch) return null;
  const step = text(pitch, "step").toUpperCase();
  const octave = Number(text(pitch, "octave"));
  const alter = Number(text(pitch, "alter") || 0);
  if (!(step in STEP_TO_SEMITONE) || !Number.isFinite(octave) || !Number.isFinite(alter)) return null;
  return (octave + 1) * 12 + STEP_TO_SEMITONE[step]! + alter;
}

function getParser(factory?: ParserFactory): Pick<DOMParser, "parseFromString"> {
  const Constructor = factory ?? globalThis.DOMParser;
  if (!Constructor) throw new Error("이 환경에는 DOMParser가 없습니다.");
  return new Constructor();
}

export function parseMusicXml(xml: string, parserFactory?: ParserFactory): Score {
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) throw new Error("보안을 위해 DTD 또는 ENTITY가 포함된 XML은 열 수 없습니다.");
  const document = getParser(parserFactory).parseFromString(xml, "application/xml");
  if (document.getElementsByTagName("parsererror").length > 0) throw new Error("올바른 MusicXML 파일이 아닙니다.");

  const root = document.documentElement;
  if (!root || !root.tagName.endsWith("score-partwise")) {
    throw new Error("현재는 score-partwise 형식의 MusicXML만 지원합니다.");
  }

  const part = document.getElementsByTagName("part")[0];
  if (!part) throw new Error("연주 파트가 없는 MusicXML입니다.");

  const title = text(document, "work-title") || text(document, "movement-title") || "제목 없는 악보";
  const creators = Array.from(document.getElementsByTagName("creator"));
  const composer = creators.find((node) => node.getAttribute("type") === "composer")?.textContent?.trim() ?? "";
  const tempoValue = Number(Array.from(document.getElementsByTagName("sound")).find((node) => node.hasAttribute("tempo"))?.getAttribute("tempo"));

  const events: ScoreEvent[] = [];
  const measures: ScoreMeasure[] = [];
  let divisions = 1;
  let page = 1;

  for (const [measureIndex, measure] of directChildren(part, "measure").entries()) {
    const print = directChildren(measure, "print")[0];
    if (measureIndex > 0 && print?.getAttribute("new-page") === "yes") page += 1;
    const nextDivisions = Number(text(measure, "divisions"));
    if (nextDivisions > 0) divisions = nextDivisions;

    const raw: Array<{ start: number; duration: number; pitch: number; voice: string }> = [];
    let cursor = 0;
    let lastNoteStart = 0;
    for (const child of Array.from(measure.childNodes)) {
      if (child.nodeType !== 1) continue;
      const element = child as Element;
      const tag = element.tagName.split(":").at(-1);
      if (tag === "backup") {
        cursor = Math.max(0, cursor - Number(text(element, "duration") || 0));
        continue;
      }
      if (tag === "forward") {
        cursor += Number(text(element, "duration") || 0);
        continue;
      }
      if (tag !== "note" || directChildren(element, "grace").length > 0) continue;
      const duration = Number(text(element, "duration") || 0);
      const chord = directChildren(element, "chord").length > 0;
      const start = chord ? lastNoteStart : cursor;
      const pitch = pitchToMidi(element);
      if (pitch !== null) raw.push({ start, duration, pitch, voice: text(element, "voice") || "1" });
      if (!chord) {
        lastNoteStart = cursor;
        cursor += duration;
      }
    }

    const voice = raw.some((note) => note.voice === "1") ? "1" : raw[0]?.voice;
    const grouped = new Map<number, { duration: number; pitches: number[] }>();
    for (const note of raw.filter((candidate) => candidate.voice === voice)) {
      const entry = grouped.get(note.start) ?? { duration: note.duration, pitches: [] };
      entry.duration = Math.max(entry.duration, note.duration);
      entry.pitches.push(note.pitch);
      grouped.set(note.start, entry);
    }

    const startEventIndex = events.length;
    for (const [start, event] of [...grouped.entries()].sort((a, b) => a[0] - b[0])) {
      events.push({
        index: events.length,
        measureIndex,
        measureNumber: measure.getAttribute("number") ?? String(measureIndex + 1),
        page,
        beat: start / divisions,
        durationBeats: Math.max(event.duration / divisions, 0.0625),
        midiPitches: [...new Set(event.pitches)].sort((a, b) => a - b),
      });
    }
    measures.push({
      index: measureIndex,
      number: measure.getAttribute("number") ?? String(measureIndex + 1),
      page,
      startEventIndex,
      endEventIndex: Math.max(startEventIndex, events.length - 1),
    });
  }

  if (events.length === 0) throw new Error("추적할 수 있는 음표가 없습니다.");
  const stableId = `${title}:${composer}:${events.length}:${events.map((event) => event.midiPitches.join(".")).join("-")}`;
  let hash = 2166136261;
  for (let index = 0; index < stableId.length; index += 1) hash = Math.imul(hash ^ stableId.charCodeAt(index), 16777619);

  return {
    id: `score-${(hash >>> 0).toString(36)}`,
    title,
    composer,
    fileType: "musicxml",
    pageCount: page,
    measures,
    events,
    initialTempo: Number.isFinite(tempoValue) && tempoValue > 0 ? tempoValue : 120,
  };
}
