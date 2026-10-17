const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/legacy/build/";
const MAX_PDF_BYTES = 20 * 1024 * 1024;

export type OmrProgressDetails = {
  setupPercent: number;
  setupText: string;
  setupMeta?: string;
};

export type OmrProgress = (percent: number, message: string, details?: OmrProgressDetails) => void;

export function ensurePdfjsPolyfills(): void {
  const proto = Uint8Array.prototype as Uint8Array & { toHex?: () => string };
  if (typeof proto.toHex !== "function") {
    Object.defineProperty(proto, "toHex", {
      value(this: Uint8Array): string {
        let hex = "";
        for (let i = 0; i < this.length; i += 1) {
          hex += this[i]!.toString(16).padStart(2, "0");
        }
        return hex;
      },
      configurable: true,
      writable: true,
    });
  }
}

export function formatLocalOmrError(reason: unknown): Error {
  const message = reason instanceof Error ? reason.message : String(reason);
  if (/invalid (?:root reference|pdf structure)/i.test(message)) {
    return new Error("PDF 내부 구조가 손상되었거나 표준 형식이 아닙니다. 브라우저에서 인쇄 → PDF로 저장한 새 파일을 다시 선택해 주세요.");
  }
  if (/WebAssembly JSPI/i.test(message)) {
    return new Error("이 브라우저 버전은 기기 내 무료 변환(WebAssembly JSPI)을 지원하지 않습니다. 태블릿의 Chrome 앱(최신 버전)으로 열어 주세요.");
  }
  return reason instanceof Error ? reason : new Error(message);
}

type WorkerMessage =
  | {
      type: "progress";
      stage: string;
      step?: string;
      percent?: number;
      detail?: string;
      name?: string;
      loaded?: number;
      total?: number;
      attempt?: number;
      model?: string;
      index?: number;
      calls?: number;
      staff?: number;
      tokens?: number;
    }
  | { type: "loaded" }
  | { type: "ready" }
  | { type: "result"; id: number; xml: string }
  | { type: "error"; id?: number; msg: string }
  | { type: "log"; msg: string };

function directChildren(element: Element, tag: string): Element[] {
  return Array.from(element.childNodes).filter((child): child is Element => child.nodeType === 1 && (child as Element).tagName === tag);
}

export function mergeMusicXmlPages(pages: string[]): string {
  if (!pages.length) throw new Error("변환된 악보 페이지가 없습니다.");
  const parser = new DOMParser();
  const target = parser.parseFromString(pages[0]!, "application/xml");
  if (target.getElementsByTagName("parsererror").length) throw new Error("첫 페이지의 MusicXML이 올바르지 않습니다.");
  const targetParts = directChildren(target.documentElement, "part");

  pages.slice(1).forEach((xml, pageIndex) => {
    const source = parser.parseFromString(xml, "application/xml");
    if (source.getElementsByTagName("parsererror").length) throw new Error(`${pageIndex + 2}페이지의 MusicXML이 올바르지 않습니다.`);
    const sourceParts = directChildren(source.documentElement, "part");
    if (!sourceParts.length) return;

    targetParts.forEach((targetPart, partIndex) => {
      const sourcePart = sourceParts[Math.min(partIndex, sourceParts.length - 1)]!;
      const measures = directChildren(sourcePart, "measure");
      measures.forEach((measure, measureIndex) => {
        const imported = target.importNode(measure, true) as Element;
        imported.setAttribute("number", String(directChildren(targetPart, "measure").length + 1));
        if (measureIndex === 0) {
          const print = directChildren(imported, "print")[0] ?? imported.insertBefore(target.createElement("print"), imported.firstChild) as Element;
          print.setAttribute("new-page", "yes");
        }
        targetPart.appendChild(imported);
      });
    });
  });

  return new XMLSerializer().serializeToString(target);
}

export async function getPdfPageCount(file: File): Promise<number> {
  ensurePdfjsPolyfills();
  const pdfjs = await import(/* @vite-ignore */ `${PDFJS_URL}pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_URL}pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  try {
    return doc.numPages;
  } finally {
    await task.destroy();
  }
}

export async function renderPdfPageToCanvas(file: File, pageNumber: number, canvas: HTMLCanvasElement, maxWidth = 1080): Promise<void> {
  ensurePdfjsPolyfills();
  const pdfjs = await import(/* @vite-ignore */ `${PDFJS_URL}pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_URL}pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const doc = await task.promise;
  const offscreen = window.document.createElement("canvas");
  try {
    const page = await doc.getPage(Math.min(Math.max(1, pageNumber), doc.numPages));
    const base = page.getViewport({ scale: 1 });
    const scale = Math.min(maxWidth / base.width, 2.2);
    const viewport = page.getViewport({ scale });
    const width = Math.round(viewport.width);
    const height = Math.round(viewport.height);
    offscreen.width = width;
    offscreen.height = height;
    await page.render({ canvas: offscreen, viewport, background: "#ffffff" }).promise;
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.drawImage(offscreen, 0, 0);
    page.cleanup();
  } finally {
    offscreen.width = 0;
    offscreen.height = 0;
    await task.destroy();
  }
}

async function renderPdf(file: File, onProgress: (pct: number, msg: string) => void): Promise<ArrayBuffer[]> {
  ensurePdfjsPolyfills();
  const pdfjs = await import(/* @vite-ignore */ `${PDFJS_URL}pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_URL}pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await task.promise;
  const rendered: ArrayBuffer[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      onProgress(4 + Math.round((pageNumber / document.numPages) * 10), `PDF ${pageNumber}/${document.numPages}페이지 이미지 변환 중`);
      const page = await document.getPage(pageNumber);
      const base = page.getViewport({ scale: 1 });
      const scale = Math.min(2480 / base.width, 4200 / Math.max(base.width, base.height));
      const viewport = page.getViewport({ scale });
      const canvas = window.document.createElement("canvas");
      canvas.width = Math.round(viewport.width);
      canvas.height = Math.round(viewport.height);
      await page.render({ canvas, viewport, background: "#ffffff" }).promise;
      const blob = await new Promise<Blob>((resolve, reject) => canvas.toBlob((value) => value ? resolve(value) : reject(new Error("PDF 페이지를 이미지로 만들지 못했습니다.")), "image/png"));
      rendered.push(await blob.arrayBuffer());
      canvas.width = 0;
      canvas.height = 0;
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return rendered;
}

type WarmupState = {
  worker: Worker;
  downloads: Map<string, number>;
  pyStagePercent: number;
  dlStagePercent: number;
  setupText: string;
  engineReady: boolean;
  error: Error | null;
  listener: ((event: MessageEvent<WorkerMessage>) => void) | null;
};

let warmupState: WarmupState | null = null;

export function warmupLocalOmrEngine(): void {
  if (typeof Worker === "undefined" || typeof caches === "undefined" || warmupState) return;
  try {
    const worker = new Worker(new URL("omr-loader.js", document.baseURI), { type: "module" });
    const state: WarmupState = {
      worker,
      downloads: new Map<string, number>(),
      pyStagePercent: 0,
      dlStagePercent: 0,
      setupText: "무료 인식 엔진 시작 중",
      engineReady: false,
      error: null,
      listener: null,
    };
    warmupState = state;
    worker.onmessage = (event: MessageEvent<WorkerMessage>) => {
      const { data } = event;
      if (data.type === "loaded") {
        worker.postMessage({ type: "init" });
      } else if (data.type === "ready") {
        state.engineReady = true;
      } else if (data.type === "progress" && data.stage === "setup") {
        state.pyStagePercent = Math.max(state.pyStagePercent, Math.min(48, data.percent ?? state.pyStagePercent));
        if (data.detail) state.setupText = data.detail;
      } else if (data.type === "progress" && data.stage === "download") {
        state.downloads.set(data.name ?? "model", data.loaded ?? 0);
        const loaded = [...state.downloads.values()].reduce((sum, bytes) => sum + bytes, 0);
        const total = Math.max(1, data.total ?? 157482318);
        state.dlStagePercent = Math.max(state.dlStagePercent, Math.round(Math.min(1, loaded / total) * 51));
      } else if (data.type === "error") {
        state.error = new Error(data.msg);
      }
      state.listener?.(event);
    };
    worker.onerror = (event) => {
      state.error = new Error(event.message || "기기 내 악보 인식기가 중지되었습니다.");
      worker.terminate();
      if (warmupState === state) warmupState = null;
    };
    worker.postMessage({ type: "init" });
  } catch {
    warmupState = null;
  }
}

export async function convertPdfLocally(file: File, onProgress: OmrProgress): Promise<string> {
  if (file.size > MAX_PDF_BYTES) throw new Error("기기 내 변환 안정성을 위해 PDF는 20MB 이하만 지원합니다.");
  if (typeof Worker === "undefined" || typeof caches === "undefined") throw new Error("이 브라우저는 기기 내 악보 변환을 지원하지 않습니다.");

  const adopted = warmupState && !warmupState.error ? warmupState : null;
  if (warmupState && warmupState !== adopted) {
    warmupState.worker.terminate();
  }
  warmupState = null;

  const worker = adopted ? adopted.worker : new Worker(new URL("omr-loader.js", document.baseURI), { type: "module" });
  const pending = new Map<number, { resolve: (xml: string) => void; reject: (error: Error) => void }>();
  const downloads = adopted ? new Map(adopted.downloads) : new Map<string, number>();
  let nextId = 0;
  let currentPercent = 2;
  let currentMessage = "PDF를 기기에서 여는 중";
  let pyStagePercent = adopted ? adopted.pyStagePercent : 0; // 0..48
  let dlStagePercent = adopted ? adopted.dlStagePercent : 0; // 0..51
  let setupPercent = Math.max(4, Math.min(99, Math.round(pyStagePercent + dlStagePercent)));
  let setupText = adopted ? adopted.setupText : "무료 인식 엔진 시작 중";
  let engineReady = adopted ? adopted.engineReady : false;
  let pdfRendered = false;
  let pageIndex = 0;
  let totalPages = 1;
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });
  if (engineReady) readyResolve();

  const RUNTIME_TOTAL_MB = 38.0;
  const MODELS_TOTAL_MB = 157.5;
  const COMBINED_TOTAL_MB = RUNTIME_TOTAL_MB + MODELS_TOTAL_MB; // 195.5 MB
  const startTime = performance.now();
  let lastSpeedCheckTime = startTime;
  let lastSpeedCheckMB = 0;
  let smoothedSpeedMBps = 0;
  let setupMeta = `0.0 / ${COMBINED_TOTAL_MB.toFixed(1)} MB 설치됨 · 속도 측정 중…`;

  const updateMeta = () => {
    const pyMB = (pyStagePercent / 48) * RUNTIME_TOTAL_MB;
    const modelBytesLoaded = [...downloads.values()].reduce((sum, bytes) => sum + bytes, 0);
    const modelMB = modelBytesLoaded / 1e6;
    const installedMB = Math.min(COMBINED_TOTAL_MB, pyMB + modelMB);
    const now = performance.now();
    const dt = (now - lastSpeedCheckTime) / 1000;
    if (dt >= 0.35) {
      const instSpeed = Math.max(0, (installedMB - lastSpeedCheckMB) / dt);
      smoothedSpeedMBps = smoothedSpeedMBps === 0 ? instSpeed : smoothedSpeedMBps * 0.65 + instSpeed * 0.35;
      lastSpeedCheckTime = now;
      lastSpeedCheckMB = installedMB;
    }
    const elapsedSec = Math.max(0.5, (now - startTime) / 1000);
    const displaySpeed = smoothedSpeedMBps > 0.05 ? smoothedSpeedMBps : installedMB / elapsedSec;
    setupMeta = `${installedMB.toFixed(1)} / ${COMBINED_TOTAL_MB.toFixed(1)} MB 설치됨 · ${displaySpeed.toFixed(1)} MB/s`;
  };

  const emitProgress = (percent?: number, message?: string, nextSetupText?: string) => {
    if (percent !== undefined) currentPercent = Math.max(currentPercent, Math.min(99, Math.round(percent)));
    if (message) currentMessage = message;
    setupPercent = Math.max(setupPercent, Math.min(99, Math.round(pyStagePercent + dlStagePercent)));
    if (nextSetupText) setupText = nextSetupText;
    updateMeta();
    onProgress(currentPercent, currentMessage, engineReady ? undefined : { setupPercent, setupText, setupMeta });
  };

  worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
    if (data.type === "loaded") {
      worker.postMessage({ type: "init" });
    } else if (data.type === "ready") {
      engineReady = true;
      setupPercent = 100;
      emitProgress(15, "악보 분석 시작 중");
      readyResolve();
    } else if (data.type === "progress" && data.stage === "setup") {
      pyStagePercent = Math.max(pyStagePercent, Math.min(48, data.percent ?? pyStagePercent));
      const st = data.detail ?? "무료 인식 엔진 준비 중";
      const mainMsg = pdfRendered ? "무료 인식 엔진 설치 대기 중" : undefined;
      emitProgress(undefined, mainMsg, st);
    } else if (data.type === "progress" && data.stage === "download") {
      downloads.set(data.name ?? "model", data.loaded ?? 0);
      const loaded = [...downloads.values()].reduce((sum, bytes) => sum + bytes, 0);
      const total = Math.max(1, data.total ?? 157482318);
      const ratio = Math.min(1, loaded / total);
      dlStagePercent = Math.max(dlStagePercent, Math.round(ratio * 51));
      const st = ratio < 1
        ? "AI 신경망 모델(3종) 고속 다운로드 중"
        : pyStagePercent < 48
          ? `모델 다운로드 완료 · ${setupText}`
          : "신경망 모델 준비 완료";
      const mainMsg = pdfRendered ? "무료 인식 엔진 설치 대기 중" : undefined;
      emitProgress(undefined, mainMsg, st);
    } else if (data.type === "progress" && data.stage === "retry") {
      const st = `네트워크 재연결 시도 중 · ${data.attempt ?? 1}회`;
      emitProgress(undefined, undefined, st);
    } else if (data.type === "progress" && data.stage === "infer") {
      const pageSpan = 79 / Math.max(1, totalPages);
      const pageBase = 15 + pageIndex * pageSpan;
      const prefix = `악보 ${pageIndex + 1}/${totalPages}쪽`;
      if (data.step === "session") {
        const sub = ((data.index ?? 1) / Math.max(1, data.total ?? 3)) * 0.15;
        emitProgress(pageBase + pageSpan * sub, `${prefix} · 신경망 모델 메모리에 올리는 중 (${data.index ?? 1}/${data.total ?? 3})`);
      } else if (data.step === "run") {
        if (data.model === "segnet") {
          const sub = 0.15 + Math.min(0.25, (data.calls ?? 1) * 0.06);
          emitProgress(pageBase + pageSpan * sub, `${prefix} · 오선보 및 기호 영역 검출 중 (블록 ${data.calls ?? 1})`);
        } else if (data.model === "encoder") {
          const sub = 0.4 + Math.min(0.2, (data.calls ?? 1) * 0.035);
          emitProgress(pageBase + pageSpan * sub, `${prefix} · 보표 이미지 특징 인코딩 중 (${data.calls ?? 1}번째 보표)`);
        }
      } else if (data.step === "decode") {
        const staffProgress = Math.min(0.38, ((data.staff ?? 1) - 1) * 0.06 + Math.min(0.06, ((data.tokens ?? 0) / 120) * 0.06));
        const sub = 0.6 + staffProgress;
        emitProgress(
          pageBase + pageSpan * sub,
          `${prefix} · ${data.staff ?? 1}번째 보표 음표 해독 중 (${data.tokens ?? 0}개 기호 인식됨)`,
        );
      }
    } else if (data.type === "result" || data.type === "error") {
      const request = data.id === undefined ? undefined : pending.get(data.id);
      if (!request) {
        if (data.type === "error") readyReject(new Error(data.msg));
        return;
      }
      pending.delete(data.id!);
      if (data.type === "result") request.resolve(data.xml); else request.reject(new Error(data.msg));
    }
  };
  worker.onerror = (event) => {
    const error = new Error(event.message || "기기 내 악보 인식기가 중지되었습니다. 메모리가 부족할 수 있습니다.");
    readyReject(error);
    for (const request of pending.values()) request.reject(error);
    pending.clear();
  };

  const recognise = (image: ArrayBuffer) => new Promise<string>((resolve, reject) => {
    const id = ++nextId;
    pending.set(id, { resolve, reject });
    worker.postMessage({ type: "recognise", id, image }, [image]);
  });

  // Gentle ticker during score analysis
  const ticker = setInterval(() => {
    if (engineReady) {
      const pageCeiling = Math.min(93, 15 + Math.round(((pageIndex + 0.9) / Math.max(1, totalPages)) * 79));
      if (currentPercent < pageCeiling) {
        emitProgress(currentPercent + 1);
      }
    }
  }, 1200);

  try {
    emitProgress(3, "PDF를 기기에서 여는 중", setupText);
    if (!adopted) {
      worker.postMessage({ type: "init" });
    }
    const images = await renderPdf(file, (pct, msg) => {
      emitProgress(pct, msg);
    });
    pdfRendered = true;
    totalPages = Math.max(1, images.length);
    if (!engineReady) {
      emitProgress(14, "무료 인식 엔진 설치 대기 중");
    }
    await ready;
    const pages: string[] = [];
    for (let index = 0; index < images.length; index += 1) {
      pageIndex = index;
      const pageStart = 15 + Math.round((index / totalPages) * 79);
      emitProgress(pageStart, `악보 ${index + 1}/${images.length}쪽 분석 시작`);
      pages.push(await recognise(images[index]!));
      const pageDone = 15 + Math.round(((index + 1) / totalPages) * 79);
      emitProgress(pageDone, `악보 ${index + 1}/${images.length}쪽 인식 완료`);
    }
    emitProgress(95, "페이지를 하나의 MusicXML로 합치는 중");
    return mergeMusicXmlPages(pages);
  } catch (reason) {
    throw formatLocalOmrError(reason);
  } finally {
    clearInterval(ticker);
    worker.terminate();
  }
}
