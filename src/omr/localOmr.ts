const PDFJS_URL = "https://cdn.jsdelivr.net/npm/pdfjs-dist@6.4.299/build/";
const MAX_PDF_BYTES = 20 * 1024 * 1024;

export type OmrProgress = (percent: number, message: string) => void;

type WorkerMessage =
  | { type: "progress"; stage: string; name?: string; loaded?: number; total?: number; attempt?: number }
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
    if (sourceParts.length !== targetParts.length) throw new Error(`${pageIndex + 2}페이지에서 파트 수가 달라 자동으로 합칠 수 없습니다.`);

    sourceParts.forEach((sourcePart, partIndex) => {
      const targetPart = targetParts[partIndex]!;
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

async function renderPdf(file: File, onProgress: OmrProgress): Promise<ArrayBuffer[]> {
  const pdfjs = await import(/* @vite-ignore */ `${PDFJS_URL}pdf.min.mjs`);
  pdfjs.GlobalWorkerOptions.workerSrc = `${PDFJS_URL}pdf.worker.min.mjs`;
  const task = pdfjs.getDocument({ data: new Uint8Array(await file.arrayBuffer()) });
  const document = await task.promise;
  const rendered: ArrayBuffer[] = [];
  try {
    for (let pageNumber = 1; pageNumber <= document.numPages; pageNumber += 1) {
      onProgress(5 + Math.round((pageNumber / document.numPages) * 10), `PDF ${pageNumber}/${document.numPages}페이지 준비 중`);
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
      page.cleanup();
    }
  } finally {
    await task.destroy();
  }
  return rendered;
}

export async function convertPdfLocally(file: File, onProgress: OmrProgress): Promise<string> {
  if (file.size > MAX_PDF_BYTES) throw new Error("기기 내 변환 안정성을 위해 PDF는 20MB 이하만 지원합니다.");
  if (typeof Worker === "undefined" || typeof caches === "undefined") throw new Error("이 브라우저는 기기 내 악보 변환을 지원하지 않습니다.");

  const worker = new Worker(new URL("omr-loader.js", document.baseURI), { type: "module" });
  const pending = new Map<number, { resolve: (xml: string) => void; reject: (error: Error) => void }>();
  const downloads = new Map<string, number>();
  let nextId = 0;
  let readyResolve!: () => void;
  let readyReject!: (error: Error) => void;
  const ready = new Promise<void>((resolve, reject) => { readyResolve = resolve; readyReject = reject; });

  worker.onmessage = ({ data }: MessageEvent<WorkerMessage>) => {
    if (data.type === "ready") readyResolve();
    else if (data.type === "progress" && data.stage === "download") {
      downloads.set(data.name ?? "model", data.loaded ?? 0);
      const loaded = [...downloads.values()].reduce((sum, bytes) => sum + bytes, 0);
      const ratio = loaded / Math.max(1, data.total ?? 1);
      onProgress(15 + Math.round(ratio * 35), `무료 인식 모델 받는 중 · ${Math.round(loaded / 1e6)}/${Math.round((data.total ?? 0) / 1e6)}MB`);
    } else if (data.type === "progress" && data.stage === "retry") onProgress(20, `연결을 다시 시도하는 중 · ${data.attempt ?? 1}회`);
    else if (data.type === "progress" && data.stage === "python") onProgress(15, "기기 내 악보 인식기 시작 중");
    else if (data.type === "result" || data.type === "error") {
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

  try {
    onProgress(3, "PDF를 기기에서 여는 중");
    worker.postMessage({ type: "init" });
    const images = await renderPdf(file, onProgress);
    onProgress(15, "무료 인식 엔진 준비 중 · 첫 실행은 시간이 걸릴 수 있어요");
    await ready;
    const pages: string[] = [];
    for (let index = 0; index < images.length; index += 1) {
      onProgress(50 + Math.round((index / images.length) * 42), `악보 ${index + 1}/${images.length}페이지 인식 중`);
      pages.push(await recognise(images[index]!));
    }
    onProgress(94, "페이지를 하나의 MusicXML로 합치는 중");
    return mergeMusicXmlPages(pages);
  } catch (reason) {
    const message = reason instanceof Error ? reason.message : String(reason);
    if (/WebAssembly JSPI/i.test(message)) throw new Error("무료 변환은 최신 Chrome 또는 Edge가 필요합니다.");
    throw reason;
  } finally {
    worker.terminate();
  }
}
