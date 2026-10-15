import { describe, expect, it, vi } from "vitest";
import { convertPdfToMusicXml } from "./flatOmr";

describe("convertPdfToMusicXml", () => {
  it("creates, polls and downloads a MusicXML OMR job", async () => {
    const fetcher = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "processing", progress: { percent: 25 } }), { status: 202 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: "job-1", status: "done" }), { status: 200 }))
      .mockResolvedValueOnce(new Response("<score-partwise/>", { status: 200 }));
    const progress = vi.fn();
    const file = new File(["%PDF-test"], "band.pdf", { type: "application/pdf" });

    await expect(convertPdfToMusicXml(file, "token", progress, fetcher)).resolves.toBe("<score-partwise/>");
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect(String(fetcher.mock.calls[0]![0])).toBe("https://api.flat.io/v2/omr/jobs");
    expect(String(fetcher.mock.calls[2]![0])).toContain("/exports/musicxml");
  });
});
