const API = "https://api.flat.io/v2";

type OmrJob = {
  id: string;
  status: "draft" | "processing" | "awaitingInput" | "done" | "error" | "canceled";
  progress?: { percent?: number; text?: string };
  errorMessage?: string;
};

async function fileToBase64(file: File): Promise<string> {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return btoa(binary);
}

async function request<T>(path: string, token: string, fetcher: typeof fetch, init?: RequestInit): Promise<T> {
  const response = await fetcher(`${API}${path}`, {
    ...init,
    headers: { Authorization: `Bearer ${token}`, ...(init?.body ? { "Content-Type": "application/json" } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({})) as { message?: string; errorMessage?: string };
    if (response.status === 401 || response.status === 403) throw new Error("Flat OMR 토큰이 올바르지 않거나 omr 권한이 없습니다.");
    if (response.status === 402) throw new Error("Flat OMR 크레딧이 부족합니다.");
    throw new Error(body.errorMessage || body.message || `PDF 변환 요청에 실패했습니다. (${response.status})`);
  }
  return response.json() as Promise<T>;
}

export async function convertPdfToMusicXml(file: File, token: string, onProgress: (percent: number, message: string) => void, fetcher: typeof fetch = fetch): Promise<string> {
  if (file.size > 20 * 1024 * 1024) throw new Error("모바일 변환 안정성을 위해 PDF는 20MB 이하만 지원합니다.");
  onProgress(5, "PDF 준비 중");
  const encoded = await fileToBase64(file);
  onProgress(12, "변환 작업 등록 중");
  let job = await request<OmrJob>("/omr/jobs", token, fetcher, {
    method: "POST",
    body: JSON.stringify({ output: "musicxml", autoStart: true, autoRotate: true, locales: ["ko", "en"], files: [{ file: encoded, filename: file.name, mimeType: "application/pdf" }] }),
  });
  while (job.status === "processing" || job.status === "draft") {
    onProgress(Math.max(15, Math.min(94, job.progress?.percent ?? 15)), job.progress?.text || "악보 인식 중");
    job = await request<OmrJob>(`/omr/jobs/${encodeURIComponent(job.id)}?wait=25`, token, fetcher);
  }
  if (job.status === "awaitingInput") throw new Error("Flat에서 악기 확인이 필요합니다. Flat 작업 화면에서 확인 후 다시 시도해 주세요.");
  if (job.status !== "done") throw new Error(job.errorMessage || "PDF에서 악보를 인식하지 못했습니다.");
  onProgress(96, "MusicXML 내려받는 중");
  const response = await fetcher(`${API}/omr/jobs/${encodeURIComponent(job.id)}/exports/musicxml`, { headers: { Authorization: `Bearer ${token}` } });
  if (!response.ok) throw new Error("변환된 MusicXML을 내려받지 못했습니다.");
  return response.text();
}
