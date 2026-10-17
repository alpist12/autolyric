import { describe, expect, it } from "vitest";
import { DOMParser, XMLSerializer } from "@xmldom/xmldom";
import { ensurePdfjsPolyfills, formatLocalOmrError, mergeMusicXmlPages } from "./localOmr";

Object.assign(globalThis, { DOMParser, XMLSerializer });

const page = (note: string) => `<?xml version="1.0"?><score-partwise version="4.0"><part-list><score-part id="P1"><part-name>Music</part-name></score-part></part-list><part id="P1"><measure number="1"><attributes><divisions>1</divisions></attributes><note><pitch><step>${note}</step><octave>4</octave></pitch><duration>1</duration></note></measure></part></score-partwise>`;

describe("mergeMusicXmlPages", () => {
  it("keeps page order and marks later pages", () => {
    const merged = new DOMParser().parseFromString(mergeMusicXmlPages([page("C"), page("D")]), "application/xml");
    const measures = Array.from(merged.getElementsByTagName("measure"));
    expect(measures.map((measure) => measure.getAttribute("number"))).toEqual(["1", "2"]);
    expect(Array.from(merged.getElementsByTagName("step")).map((step) => step.textContent)).toEqual(["C", "D"]);
    expect(measures[1]?.getElementsByTagName("print")[0]?.getAttribute("new-page")).toBe("yes");
  });

  it("gracefully merges pages even when a later page has no parts or different part counts", () => {
    const empty = `<?xml version="1.0"?><score-partwise><part-list/></score-partwise>`;
    const merged = new DOMParser().parseFromString(mergeMusicXmlPages([page("C"), empty]), "application/xml");
    const measures = Array.from(merged.getElementsByTagName("measure"));
    expect(measures).toHaveLength(1);
  });
});

describe("formatLocalOmrError", () => {
  it("turns a broken PDF root error into a useful recovery instruction", () => {
    expect(formatLocalOmrError(new Error("Invalid root reference")).message).toContain("인쇄 → PDF로 저장");
    expect(formatLocalOmrError(new Error("Invalid PDF structure.")).message).toContain("인쇄 → PDF로 저장");
  });
});

describe("ensurePdfjsPolyfills", () => {
  it("polyfills Uint8Array.prototype.toHex when missing", () => {
    const proto = Uint8Array.prototype as Uint8Array & { toHex?: () => string };
    const original = proto.toHex;
    try {
      delete proto.toHex;
      ensurePdfjsPolyfills();
      expect(new Uint8Array([0, 15, 16, 255]).toHex?.()).toBe("000f10ff");
    } finally {
      if (original) proto.toHex = original;
    }
  });
});
