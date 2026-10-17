import { describe, expect, it } from "vitest";
import { retainSelectedFile } from "./retainSelectedFile";

describe("retainSelectedFile", () => {
  it("keeps the selected file bytes and metadata in memory", async () => {
    const selected = new File([new Uint8Array([37, 80, 68, 70])], "score.pdf", {
      type: "application/pdf",
      lastModified: 1234,
    });

    const retained = await retainSelectedFile(selected);

    expect(retained).not.toBe(selected);
    expect(retained.name).toBe("score.pdf");
    expect(retained.type).toBe("application/pdf");
    expect(retained.lastModified).toBe(1234);
    expect(new Uint8Array(await retained.arrayBuffer())).toEqual(new Uint8Array([37, 80, 68, 70]));
  });
});
