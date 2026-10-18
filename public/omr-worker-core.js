// Generated from Partsong 18b38f2602ec5a4cf6230ebee391595a4d18d9fd (AGPL-3.0).
// Regenerate with: npm run omr:vendor
// Module worker. Runs homr (Python, via Pyodide) with its ONNX models on onnxruntime-web.
// Python blocks on model calls through JSPI, so this needs a JSPI-capable
// browser (Chrome/Edge 137+).

const PYODIDE_URL = "https://cdn.jsdelivr.net/pyodide/v314.0.7/full/";
const ORT_URL = "https://cdn.jsdelivr.net/npm/onnxruntime-web@1.30.0/dist/";
const MODEL_CACHE = "partscanner-models-v1";
const MODELS = [
  "segnet_308-3296ccd40960f90ca6ab9c035cca945675d30a0f.onnx",
  "encoder_pytorch_model_465-597144cab54c8f6d0f6c9619df5c5312694eadd6.onnx",
  "decoder_pytorch_model_465-597144cab54c8f6d0f6c9619df5c5312694eadd6.onnx",
];
// Uncompressed total, for progress: servers may gzip, so content-length
// doesn't match the bytes received.
const MODELS_TOTAL_BYTES = 157482318;
// The decoder runs hundreds of tiny steps per staff, where WebGPU's per-call
// overhead loses to WASM; the big convolutional models gain from the GPU.
const GPU_MODELS = new Set([MODELS[0], MODELS[1]]);
const isAppleMobile = /iPad|iPhone|iPod/i.test(navigator.userAgent)
  || (/Macintosh/i.test(navigator.userAgent) && /Mobile/i.test(navigator.userAgent));

let ort;

const post = (msg) => self.postMessage(msg);
const sessions = [];
const sessionNames = []; // id -> model name
const onGpu = new Set(); // ids of sessions created on WebGPU
const sessionIds = new Map();
let useGpu = false;

// Models are fetched over standard CORS-safe GET requests (cross-origin Range
// headers trigger an OPTIONS preflight that GitHub Pages rejects with 405)
// and streamed via ReadableStream for real-time MB & MB/s reporting.
const STALL_MS = 45000;
const MODEL_SIZES = {
  [MODELS[0]]: 57311361,
  [MODELS[1]]: 52861122,
  [MODELS[2]]: 47309835,
};
const modelUrl = (name) => new URL("models/" + name, self.location.href).href;
const fallbackModelUrl = (name) => new URL("models/" + name, "https://partsong.app/").href;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function fetchWholeModelWithProgress(url, expectedSize, onProgress) {
  const abort = new AbortController();
  let timer = setTimeout(() => abort.abort(), STALL_MS);
  const resetTimer = () => {
    clearTimeout(timer);
    timer = setTimeout(() => abort.abort(), STALL_MS);
  };
  try {
    const res = await fetch(url, { signal: abort.signal });
    if (!res.ok) throw new Error(`unexpected response ${res.status}`);
    if (!res.body) {
      const buf = await res.arrayBuffer();
      if (onProgress) onProgress(buf.byteLength);
      return buf;
    }
    const reader = res.body.getReader();
    const out = new Uint8Array(expectedSize);
    let chunks = null;
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      resetTimer();
      if (!chunks && total + value.byteLength <= expectedSize) {
        out.set(value, total);
      } else {
        if (!chunks) {
          chunks = [out.slice(0, total)];
        }
        chunks.push(value);
      }
      total += value.byteLength;
      if (onProgress) onProgress(total);
    }
    if (!chunks && total === expectedSize) return out.buffer;
    if (!chunks) return out.slice(0, total).buffer;
    const merged = new Uint8Array(total);
    let offset = 0;
    for (const c of chunks) {
      merged.set(c, offset);
      offset += c.byteLength;
    }
    return merged.buffer;
  } finally {
    clearTimeout(timer);
  }
}

async function downloadModel(name) {
  const cache = await caches.open(MODEL_CACHE);
  const size = MODEL_SIZES[name];
  const keyUrl = modelUrl(name);
  if ((await cache.match(keyUrl)) || (await cache.match(fallbackModelUrl(name)))) {
    post({ type: "progress", stage: "download", name, loaded: size, total: MODELS_TOTAL_BYTES, cached: true });
    return;
  }
  let useFallback = false;
  for (let attempt = 1; ; attempt++) {
    try {
      let lastPost = 0;
      const targetUrl = useFallback ? fallbackModelUrl(name) : keyUrl;
      const buf = await fetchWholeModelWithProgress(targetUrl, size, (loadedBytes) => {
        const now = performance.now();
        if (now - lastPost >= 100 || loadedBytes >= size) {
          lastPost = now;
          post({
            type: "progress",
            stage: "download",
            name,
            loaded: Math.min(size, loadedBytes),
            total: MODELS_TOTAL_BYTES,
          });
        }
      });
      if (buf.byteLength !== size) throw new Error(`short read (${buf.byteLength}/${size})`);
      await cache.put(keyUrl, new Response(buf));
      post({ type: "progress", stage: "download", name, loaded: size, total: MODELS_TOTAL_BYTES });
      return;
    } catch (e) {
      if (!useFallback) {
        useFallback = true;
        attempt--;
        continue;
      }
      if (attempt >= 6) {
        throw new Error(`모델 다운로드 연결이 불안정합니다 (${e.message}). 와이파이 연결을 확인한 뒤 다시 시도해 주세요.`);
      }
      post({ type: "progress", stage: "retry", name, attempt });
      await sleep(Math.min(15000, 1500 * attempt));
    }
  }
}

async function modelBytes(name) {
  const cache = await caches.open(MODEL_CACHE);
  const whole = (await cache.match(modelUrl(name))) || (await cache.match(fallbackModelUrl(name)));
  if (whole) return new Uint8Array(await whole.arrayBuffer());
  await downloadModel(name);
  const retryWhole = (await cache.match(modelUrl(name))) || (await cache.match(fallbackModelUrl(name)));
  if (!retryWhole) throw new Error(`model missing in cache: ${name}`);
  return new Uint8Array(await retryWhole.arrayBuffer());
}

const TYPED = {
  float32: Float32Array,
  int64: BigInt64Array,
  int32: Int32Array,
  uint8: Uint8Array,
  bool: Uint8Array,
};

const kept = new Map(); // handle -> ort.Tensor
let lastKept = 0;

async function newSession(id) {
  const name = sessionNames[id];
  const gpu = useGpu && GPU_MODELS.has(name);
  const eps = gpu ? ["webgpu", "wasm"] : ["wasm"];
  const t0 = performance.now();
  const started = performance.now();
  const heartbeat = setInterval(() => post({
    type: "progress", stage: "infer", step: "session", model: name.split("_")[0],
    index: id + 1, total: MODELS.length, elapsed: Math.round((performance.now() - started) / 1000),
  }), 2000);
  let session;
  try {
    session = await ort.InferenceSession.create(await modelBytes(name), {
      executionProviders: eps,
      graphOptimizationLevel: isAppleMobile ? "basic" : "all",
    });
  } finally {
    clearInterval(heartbeat);
  }
  if (gpu) onGpu.add(id);
  else onGpu.delete(id);
  post({ type: "log", msg: `Loaded ${name} on ${eps[0]} in ${Math.round(performance.now() - t0)} ms` });
  return session;
}

// Called from omr/onnxruntime.py.
self.omrOrt = {
  async create(name) {
    if (!sessionIds.has(name)) {
      const id = sessions.length;
      sessionNames[id] = name;
      post({ type: "progress", stage: "infer", step: "session", model: name.split("_")[0], index: id + 1, total: MODELS.length });
      sessions[id] = await newSession(id);
      sessionIds.set(name, id);
    }
    const s = sessions[sessionIds.get(name)];
    return { id: sessionIds.get(name), inputNames: s.inputNames, outputNames: s.outputNames };
  },

  // feeds: [name, type, dims, bytes], or [name, "kept", handle] for an output
  // kept from an earlier run. Outputs named in `keep` stay here as handles
  // (homr's decoder cache: Python only passes it back in on the next step, so
  // copying it across every step was most of the decoder's time). A kept
  // tensor is released once it has been passed back in.
  async run(id, names, feeds, keep = []) {
    const t0 = performance.now();
    const modelTag = (sessionNames[id] || "").split("_")[0];
    const callNum = (runTimes[id]?.calls ?? 0) + 1;
    post({ type: "progress", stage: "infer", step: "run", model: modelTag, calls: callNum });
    const inputs = {};
    const used = [];
    for (const [name, type, dims, bytes] of feeds) {
      if (type === "kept") {
        inputs[name] = kept.get(dims);
        used.push(dims);
      } else inputs[name] = new ort.Tensor(type, new TYPED[type](bytes.slice().buffer), dims);
    }
    let out;
    try {
      out = await sessions[id].run(inputs, names);
    } catch (e) {
      // The phone's GPU can go away (e.g. under memory pressure); onnxruntime's
      // WebGPU backend then fails every run. Carry on without the GPU.
      if (!onGpu.has(id)) throw e;
      post({ type: "log", msg: `WebGPU run failed (${e.message}); using WASM from now on` });
      useGpu = false;
      for (const other of [...onGpu]) {
        const old = sessions[other];
        Promise.resolve().then(() => old.release()).catch(() => {});
        sessions[other] = await newSession(other);
      }
      out = await sessions[id].run(inputs, names);
    }
    for (const h of used) kept.delete(h);
    const t = (runTimes[id] ??= { calls: 0, ms: 0 });
    t.calls++;
    t.ms += performance.now() - t0;
    return names.map((n) => {
      const t = out[n];
      if (keep.includes(n)) {
        kept.set(++lastKept, t);
        return { type: t.type, dims: t.dims, handle: lastKept };
      }
      const d = t.data;
      return { type: t.type, dims: t.dims, data: new Uint8Array(d.buffer, d.byteOffset, d.byteLength), handle: 0 };
    });
  },

  // homr's greedy decoding loop for one staff (homr/transformer/
  // decoder_inference.py ScoreDecoder.generate), run here so the hundreds of
  // steps per staff don't each cross into Python and back. Returns, per step,
  // the chosen token of each head (rhythm, pitch, lift, position, articulation,
  // slur) and the attention output; the step whose rhythm is EOS isn't included.
  async generate(id, contextDims, contextBytes, start, nonote, eos, maxLen, heads, headDim, caches) {
    const t0 = performance.now();
    const staffNum = ++staffCount;
    post({ type: "progress", stage: "infer", step: "decode", staff: staffNum, tokens: 0 });
    const session = sessions[id];
    const context = new ort.Tensor("float32", new Float32Array(contextBytes.slice().buffer), contextDims);
    // After the first step homr passes only the context's first position.
    const reduced = new ort.Tensor("float32", context.data.slice(0, contextDims[2]), [contextDims[0], 1, contextDims[2]]);
    const token = (v) => new ort.Tensor("int64", BigInt64Array.of(BigInt(v)), [1, 1]);
    const heads6 = ["out_rhythms", "out_pitchs", "out_lifts", "out_positions", "out_articulations", "out_slurs"];
    const names = [...heads6, "attention", ...Array.from({ length: caches }, (_, i) => `cache_out${i}`)];
    let cache = Array.from({ length: caches }, () => new ort.Tensor("float32", new Float32Array(0), [1, heads, 0, headDim]));
    let last = { rhythm: start, pitch: nonote, lift: nonote, articulation: nonote, slur: nonote };
    const tokens = [];
    const attention = [];
    let attentionDims = [];
    let steps = 0;
    for (let step = 0; step < maxLen; step++) {
      const feeds = {
        rhythms: token(last.rhythm),
        pitchs: token(last.pitch),
        lifts: token(last.lift),
        articulations: token(last.articulation),
        slurs: token(last.slur),
        context: step === 0 ? context : reduced,
        cache_len: new ort.Tensor("int64", BigInt64Array.of(BigInt(step)), [1]),
      };
      cache.forEach((t, i) => (feeds[`cache_in${i}`] = t));
      const out = await session.run(feeds, names);
      steps++;
      if (steps % 4 === 0) {
        post({ type: "progress", stage: "infer", step: "decode", staff: staffNum, tokens: steps });
      }
      cache = names.slice(7).map((n) => out[n]);
      // Greedy: the most likely token at the last position of each head.
      const pick = (n) => {
        const t = out[n];
        const size = t.dims.at(-1);
        const d = t.data;
        let best = d.length - size;
        for (let k = best + 1; k < d.length; k++) if (d[k] > d[best]) best = k;
        return best - (d.length - size);
      };
      const chosen = heads6.map(pick);
      if (chosen[0] === eos) break;
      tokens.push(...chosen);
      const a = out.attention;
      attentionDims = a.dims;
      attention.push(Float32Array.from(a.data));
      last = { rhythm: chosen[0], pitch: chosen[1], lift: chosen[2], articulation: chosen[4], slur: chosen[5] };
    }
    post({ type: "progress", stage: "infer", step: "decode", staff: staffNum, tokens: steps });
    const t = (runTimes[id] ??= { calls: 0, ms: 0 });
    t.calls += steps;
    t.ms += performance.now() - t0;
    const flat = new Float32Array(attention.reduce((n, a) => n + a.length, 0));
    attention.reduce((at, a) => (flat.set(a, at), at + a.length), 0);
    return { tokens: Int32Array.from(tokens), attention: new Uint8Array(flat.buffer), attentionDims };
  },

  // The contents of a kept output, if Python does want to read one.
  data(handle) {
    const d = kept.get(handle).data;
    return new Uint8Array(d.buffer, d.byteOffset, d.byteLength);
  },
};

let pyodide;
let recognise;
let recogniseProfiled;
// Per page: time inside each model (session id -> { calls, ms }); the rest of
// the page's time is homr's Python (image processing, decoding) in Pyodide.
let runTimes = [];
let staffCount = 0;

async function init() {
  if (typeof WebAssembly.Suspending !== "function") {
    throw new Error("This browser lacks WebAssembly JSPI. Use an up-to-date Chrome.");
  }
  post({ type: "progress", stage: "setup", percent: 4, detail: "WebAssembly 추론 엔진 및 모델 다운로드 시작" });

  // Stream the 3 ONNX models (157.5MB total) alongside Python setup without allocating 3x55MB in RAM at once
  const modelsTask = (async () => {
    for (const name of MODELS) {
      await downloadModel(name);
    }
  })();

  const pythonTask = (async () => {
    // ONNX Runtime's JSEP/WebGPU bundle has severe memory overhead on iOS.
    ort = await import(ORT_URL + (isAppleMobile ? "ort.min.mjs" : "ort.webgpu.min.mjs"));
    ort.env.wasm.wasmPaths = ORT_URL;
    ort.env.wasm.numThreads = self.crossOriginIsolated
      ? Math.min(4, navigator.hardwareConcurrency || 1)
      : 1;
    post({ type: "log", msg: `WASM threads: ${ort.env.wasm.numThreads}` });
    post({ type: "progress", stage: "setup", percent: 9, detail: "Pyodide 런타임 모듈 불러오는 중" });
    const { loadPyodide } = await import(PYODIDE_URL + "pyodide.mjs");
    post({ type: "progress", stage: "setup", percent: 12, detail: "기기 그래픽 가속(WebGPU) 지원 확인 중" });
    try {
      useGpu = !isAppleMobile && !!(
        self.navigator.gpu &&
        (await Promise.race([
          navigator.gpu.requestAdapter(),
          sleep(2500).then(() => null),
        ]))
      );
    } catch {
      useGpu = false;
    }

    post({ type: "progress", stage: "setup", percent: 15, detail: "Python 가상환경 초기화 중" });
    pyodide = await loadPyodide({ indexURL: PYODIDE_URL });
    pyodide.setStderr({ batched: (msg) => post({ type: "log", msg }) });
    pyodide.setStdout({ batched: (msg) => post({ type: "log", msg }) });

    const pkgs = [
      ["typing-extensions", "기본 타입 확장 모듈", 22],
      ["numpy", "수치 연산 엔진 (NumPy)", 28],
      ["pillow", "이미지 처리 엔진 (Pillow)", 34],
      ["opencv-python", "컴퓨터 비전 엔진 (OpenCV)", 42],
    ];
    for (let i = 0; i < pkgs.length; i++) {
      const [pkg, label, pct] = pkgs[i];
      post({ type: "progress", stage: "setup", percent: pct - 4, detail: `패키지 설치 중 (${i + 1}/${pkgs.length}) · ${label}` });
      await pyodide.loadPackage([pkg]);
      post({ type: "progress", stage: "setup", percent: pct, detail: `패키지 설치 완료 (${i + 1}/${pkgs.length}) · ${label}` });
    }

    const lib = "/home/pyodide/lib";
    pyodide.FS.mkdirTree(lib);
    post({ type: "progress", stage: "setup", percent: 45, detail: "악보 인식 라이브러리(HOMR) 압축 해제 중" });
    const homrUrl = new URL("vendor/homr.zip", self.location.href).href;
    const homrZip = await (await fetch(homrUrl)).arrayBuffer();
    pyodide.unpackArchive(homrZip, "zip", { extractDir: lib });
    for (const f of ["onnxruntime.py", "runner.py"]) {
      const pyUrl = new URL(`omr/${f}`, self.location.href).href;
      const text = await (await fetch(pyUrl)).text();
      pyodide.FS.writeFile(`${lib}/${f}`, text);
    }
    post({ type: "progress", stage: "setup", percent: 48, detail: "Python 악보 인식 모듈 컴파일 중" });
    pyodide.runPython(`import sys; sys.path.insert(0, "${lib}")`);
    // Use async Python entrypoints directly. In Safari, wrapping a synchronous
    // PyProxy with callPromising() can leave JavaScript frames between the
    // promising and suspending Wasm frames, which WebKit correctly rejects.
    const runner = pyodide.pyimport("runner");
    recognise = runner.recognise_async;
    recogniseProfiled = runner.recognise_profiled_async;
  })();

  await Promise.all([pythonTask, modelsTask]);
  post({ type: "progress", stage: "setup", percent: 100, detail: "무료 인식 엔진 설치 및 준비 완료" });
  post({ type: "ready", gpu: useGpu });
}

let ready;
self.onmessage = async ({ data }) => {
  try {
    if (data.type === "init") {
      ready ??= init();
      await ready;
    } else if (data.type === "recognise") {
      ready ??= init();
      await ready;
      const path = `/tmp/page${data.id}.png`;
      pyodide.FS.writeFile(path, new Uint8Array(data.image));
      const t0 = performance.now();
      runTimes = [];
      staffCount = 0;
      // data.systems: the user's systems for this page (JSON), if they fixed it.
      // data.profile (tests/omr-bench.html): logs where the Python's time goes.
      const xml = await (data.profile ? recogniseProfiled : recognise)(path, data.systems ?? "");
      const ms = Math.round(performance.now() - t0);
      const names = [...sessionIds.keys()];
      const parts = names.map((n) => `${n.split("_")[0]} ${Math.round(runTimes[sessionIds.get(n)]?.ms ?? 0)} ms/${runTimes[sessionIds.get(n)]?.calls ?? 0} calls`);
      const inModels = runTimes.reduce((sum, t) => sum + (t?.ms ?? 0), 0);
      post({ type: "log", msg: `Page in ${ms} ms: ${parts.join(", ")}; Python ${Math.round(ms - inModels)} ms` });
      post({ type: "result", id: data.id, xml, ms });
    }
  } catch (e) {
    post({ type: "error", id: data.id, msg: String(e && e.message ? e.message : e) });
  }
};
post({ type: "loaded" });

