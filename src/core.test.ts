import { DOMParser } from "@xmldom/xmldom";
import { describe, expect, it } from "vitest";
import { AutoPageTurn } from "./navigation/AutoPageTurn";
import { parseMusicXml } from "./musicxml/parseMusicXml";
import { ScoreFollower } from "./tracking/ScoreFollower";
import { detectPitchYin } from "./audio/yin";

const xml = `<?xml version="1.0"?>
<score-partwise version="4.0">
  <work><work-title>테스트 곡</work-title></work>
  <identification><creator type="composer">작곡가</creator></identification>
  <part-list><score-part id="P1"><part-name>Flute</part-name></score-part></part-list>
  <part id="P1">
    <measure number="1"><attributes><divisions>2</divisions></attributes><sound tempo="90"/>
      <note><pitch><step>C</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
      <note><pitch><step>D</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
    </measure>
    <measure number="2"><print new-page="yes"/>
      <note><pitch><step>E</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
      <note><pitch><step>F</step><octave>4</octave></pitch><duration>2</duration><voice>1</voice></note>
    </measure>
  </part>
</score-partwise>`;

describe("MusicXML parser", () => {
  it("extracts normalized notes, measures and page breaks", () => {
    const score = parseMusicXml(xml, DOMParser as unknown as new () => DOMParser);
    expect(score.title).toBe("테스트 곡");
    expect(score.events.map((event) => event.midiPitches)).toEqual([[60], [62], [64], [65]]);
    expect(score.events.map((event) => event.beat)).toEqual([0, 1, 0, 1]);
    expect(score.pageCount).toBe(2);
    expect(score.initialTempo).toBe(90);
  });

  it("rejects XML entities", () => {
    expect(() => parseMusicXml("<!DOCTYPE x [<!ENTITY y 'x'>]><score-partwise/>", DOMParser as unknown as new () => DOMParser)).toThrow(/DTD/);
  });
});

describe("YIN pitch detector", () => {
  it("detects a 440 Hz sine wave", () => {
    const sampleRate = 48_000;
    const samples = Float32Array.from({ length: 4096 }, (_, index) => 0.4 * Math.sin((2 * Math.PI * 440 * index) / sampleRate));
    const result = detectPitchYin(samples, sampleRate);
    expect(result?.frequency).toBeCloseTo(440, 0);
    expect(result?.midi).toBeCloseTo(69, 0);
  });
});

describe("score following and page turns", () => {
  it("tracks a melody and turns only after the target page is stable", () => {
    const score = parseMusicXml(xml, DOMParser as unknown as new () => DOMParser);
    const follower = new ScoreFollower(score);
    follower.observe({ midi: 60, timestampMs: 0, confidence: 1, source: "midi" });
    follower.observe({ midi: 62, timestampMs: 600, confidence: 1, source: "midi" });
    const pageTwo = follower.observe({ midi: 64, timestampMs: 1200, confidence: 1, source: "midi" });
    expect(pageTwo.eventIndex).toBe(2);
    expect(pageTwo.page).toBe(2);

    const turner = new AutoPageTurn(score, 1, 0.5, 400);
    expect(turner.evaluate(pageTwo).changed).toBe(false);
    const stable = { ...pageTwo, lastUpdateMs: 1700 };
    expect(turner.evaluate(stable)).toMatchObject({ changed: true, page: 2 });
  });

  it("holds position while confidence is low", () => {
    const score = parseMusicXml(xml, DOMParser as unknown as new () => DOMParser);
    const turner = new AutoPageTurn(score);
    const decision = turner.evaluate({
      status: "uncertain",
      eventIndex: 2,
      measureIndex: 1,
      page: 2,
      confidence: 0.2,
      estimatedTempo: 90,
      lastUpdateMs: 1000,
    });
    expect(decision).toMatchObject({ changed: false, page: 1, reason: "low-confidence" });
  });
});
