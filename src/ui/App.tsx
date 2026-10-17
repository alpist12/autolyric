import { useEffect, useMemo, useRef, useState, type ChangeEvent, type DragEvent, type PointerEvent as ReactPointerEvent, type ReactNode } from "react";
import { MicrophonePitchSource } from "../audio/MicrophonePitchSource";
import { PracticeAudio } from "../audio/PracticeAudio";
import { MidiNoteSource } from "../input/MidiNoteSource";
import { parseMusicXml } from "../musicxml/parseMusicXml";
import { convertPdfLocally } from "../omr/localOmr";
import { retainSelectedFile } from "./retainSelectedFile";
import { ScoreFlowEngine } from "../ScoreFlowEngine";
import { createScoreflowBundle, readScoreflowBundle } from "../share/scoreflowBundle";
import { ScoreLibrary } from "../storage/ScoreLibrary";
import type { NoteObservation, StoredScore, TrackingState } from "../types";
import { demoXml } from "./demo";

type OsmdInstance = import("opensheetmusicdisplay").OpenSheetMusicDisplay;

type View = "home" | "upload" | "library" | "settings" | "player";
type IconName = "music" | "plus" | "upload" | "mic" | "star" | "play" | "search" | "settings" | "library" | "pause" | "pen" | "chevron" | "grid" | "check" | "speaker" | "metronome";

const library = new ScoreLibrary();
const demoScore = parseMusicXml(demoXml);
const demoStored: StoredScore = { id: demoScore.id, name: "월광 소나타 1악장.musicxml", xml: demoXml, score: demoScore, savedAt: Date.now() - 86_400_000 };

const paths: Record<IconName, ReactNode> = {
  music: <><path d="M9 18V5l12-2v13"/><circle cx="6" cy="18" r="3"/><circle cx="18" cy="16" r="3"/></>,
  plus: <><path d="M12 5v14"/><path d="M5 12h14"/></>,
  upload: <><path d="M4 15a7 7 0 0 1 11.7-7h1.8a4.5 4.5 0 0 1 2.5 8.2"/><path d="M12 12v9"/><path d="m16 16-4-4-4 4"/></>,
  mic: <><rect x="9" y="3" width="6" height="12" rx="3"/><path d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v3"/></>,
  star: <path d="m12 2 3.1 6.3 6.9 1-5 4.8 1.2 6.9-6.2-3.2L5.8 21 7 14.1 2 9.3l6.9-1Z"/>,
  play: <path className="filled" d="m7 4 13 8-13 8Z"/>,
  search: <><circle cx="11" cy="11" r="7"/><path d="m20 20-4-4"/></>,
  settings: <><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1-2.8 2.8-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6v.2h-4V21a1.7 1.7 0 0 0-1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1L4.2 17l.1-.1a1.7 1.7 0 0 0 .3-1.9A1.7 1.7 0 0 0 3 14H3v-4h.1a1.7 1.7 0 0 0 1.5-1 1.7 1.7 0 0 0-.3-1.9L4.2 7 7 4.2l.1.1A1.7 1.7 0 0 0 9 4.6a1.7 1.7 0 0 0 1-1.5V3h4v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1L19.8 7l-.1.1a1.7 1.7 0 0 0-.3 1.9 1.7 1.7 0 0 0 1.6 1h.2v4H21a1.7 1.7 0 0 0-1.6 1Z"/></>,
  library: <><rect x="3" y="4" width="18" height="16" rx="2"/><path d="M8 4v16M13 8h5M13 12h5"/></>,
  pause: <><path d="M9 5v14M15 5v14"/></>,
  pen: <><path d="m4 20 4.2-1 10.6-10.6-3.2-3.2L5 15.8Z"/><path d="m14 6 3.2 3.2"/></>,
  chevron: <path d="m9 18 6-6-6-6"/>,
  grid: <><rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><rect x="14" y="14" width="7" height="7" rx="1"/></>,
  check: <path d="m5 12 4 4L19 6"/>,
  speaker: <><path d="M11 5 6 9H3v6h3l5 4Z"/><path d="M15 9a4 4 0 0 1 0 6M18 6a8 8 0 0 1 0 12"/></>,
  metronome: <><path d="M7 21h10l-2-17H9Z"/><path d="m12 7 3 7M9 17h6"/><circle cx="15" cy="14" r="1"/></>,
};

function Icon({ name, size = 20 }: { name: IconName; size?: number }) {
  return <svg className="icon" viewBox="0 0 24 24" width={size} height={size} aria-hidden="true">{paths[name]}</svg>;
}

function currentRoute(): View {
  const route = location.hash.slice(1).split("?")[0];
  return (["home", "upload", "library", "settings", "player"] as View[]).includes(route as View) ? route as View : "home";
}

function go(view: View, id?: string) {
  location.hash = `${view}${id ? `?id=${encodeURIComponent(id)}` : ""}`;
}

function Header({ view }: { view: View }) {
  return <header className="topbar"><div className="topbar-inner">
    <button className="brand" onClick={() => go("home")}><span className="brand-mark"><Icon name="music" size={18}/></span>ScoreFlow</button>
    <nav aria-label="주 메뉴">
      <button className={view === "home" ? "active" : ""} onClick={() => go("home")}>홈</button>
      <button className={view === "library" ? "active" : ""} onClick={() => go("library")}>내 악보</button>
      <button className={view === "settings" ? "active" : ""} onClick={() => go("settings")}>설정</button>
    </nav>
    <button className="primary upload-button" onClick={() => go("upload")}><Icon name="plus" size={18}/>업로드</button>
  </div></header>;
}

function useScores(refreshKey = 0) {
  const [scores, setScores] = useState<StoredScore[]>([]);
  useEffect(() => { library.list().then(setScores).catch(() => setScores([])); }, [refreshKey]);
  return [demoStored, ...scores.filter((item) => item.id !== demoStored.id)];
}

function ScoreThumb({ compact = false }: { compact?: boolean }) {
  return <div className={`score-thumb ${compact ? "compact" : ""}`} aria-hidden="true">
    <span>Adagio sostenuto</span><svg viewBox="0 0 600 120" preserveAspectRatio="xMidYMid meet">
      {[24, 36, 48, 60, 72, 92, 104, 116].map((y) => <line key={y} x1="0" y1={y} x2="600" y2={y}/>)}
      <text className="clef" x="92" y="71">𝄞</text><text className="accidental" x="132" y="65">♯</text><text className="accidental" x="168" y="65">♯</text>
      {[{ x: 225, y: 58 }, { x: 273, y: 66 }, { x: 323, y: 55 }, { x: 390, y: 63 }, { x: 440, y: 52 }, { x: 488, y: 65 }].map((note, i) => <g key={note.x}><ellipse cx={note.x} cy={note.y} rx="7" ry="5"/><line x1={note.x + 6} y1={note.y} x2={note.x + 6} y2={note.y - 30}/>{i === 1 || i === 4 ? <path d={`M${note.x + 6} ${note.y - 30} q18 5 18 17`}/> : null}</g>)}
    </svg>
  </div>;
}

function Home({ scores }: { scores: StoredScore[] }) {
  return <main className="page home-page">
    <div className="page-heading"><h1>오늘은 어떤 곡을 연주할까요?</h1><p>이어서 연주하거나 새 악보를 올려 바로 시작하세요.</p></div>
    <section className="home-grid">
      <button className="continue-card" onClick={() => go("player", scores[0]!.id)}>
        <div className="continue-preview"><ScoreThumb/><span className="tag">이어서 연주</span></div>
        <div className="continue-body"><div><strong>{scores[0]!.score.title}</strong><span>{scores[0]!.score.composer || "작곡가 미상"} · 2마디에서 멈춤 · 1페이지</span><i><b/></i></div><span className="play-round"><Icon name="play" size={25}/></span></div>
      </button>
      <div className="quick-grid">
        <button className="quick-card accent" onClick={() => go("upload")}><span className="quick-icon"><Icon name="upload"/></span><span><strong>악보 업로드</strong><small>PDF · MusicXML · MXL</small></span></button>
        <button className="quick-card" onClick={() => go("settings")}><span className="quick-top"><span className="quick-icon green"><Icon name="mic"/></span><small className="ready"><i/>준비 완료</small></span><span><strong>마이크 테스트</strong><small>내장 마이크</small></span></button>
        <button className="quick-card" onClick={() => go("library")}><span className="quick-icon amber"><Icon name="star"/></span><span><strong>즐겨찾기</strong><small>{Math.min(3, scores.length)}곡</small></span></button>
        <button className="quick-card" onClick={() => go("settings")}><span className="quick-icon gray"><Icon name="music"/></span><span><strong>밴드 파트</strong><small>기타 · 베이스 · 보컬</small></span></button>
      </div>
    </section>
    <section className="recent-section"><div className="section-title"><h2>최근 악보</h2><button onClick={() => go("library")}>전체 보기</button></div><div className="recent-grid">{scores.slice(0, 4).map((item) => <ScoreCard key={item.id} item={item}/>)}</div></section>
    <button className="tablet-tip" onClick={() => go("player", scores[0]!.id)}><Icon name="grid" size={24}/><span><strong>태블릿을 가로로 두면</strong> 두 페이지 보기로 바뀌고, 다음 페이지를 미리 준비합니다.</span><b>미리 보기</b></button>
  </main>;
}

function ScoreCard({ item, table = false }: { item: StoredScore; table?: boolean }) {
  if (table) return <button className="score-row" onClick={() => go("player", item.id)}><ScoreThumb compact/><span className="row-title"><strong>{item.score.title}</strong><small>{item.score.composer || "작곡가 미상"}</small></span><span>MusicXML</span><span>{item.score.pageCount}쪽</span><span>{new Date(item.savedAt).toLocaleDateString("ko-KR")}</span><Icon name="chevron" size={18}/></button>;
  return <button className="score-card" onClick={() => go("player", item.id)}><div className="card-preview"><ScoreThumb compact/></div><span><strong>{item.score.title}</strong><small>{item.score.composer || "작곡가 미상"}</small><em>{item.id === demoStored.id ? "어제 연주" : "최근 추가"} · MusicXML</em></span></button>;
}

async function readScoreFile(file: File): Promise<string> {
  const lower = file.name.toLowerCase();
  if (file.size > 50 * 1024 * 1024) throw new Error("파일은 50MB 이하만 업로드할 수 있습니다.");
  if (lower.endsWith(".xml") || lower.endsWith(".musicxml")) return file.text();
  if (lower.endsWith(".mxl")) {
    const { default: JSZip } = await import("jszip");
    const zip = await JSZip.loadAsync(file);
    const containerText = await zip.file("META-INF/container.xml")?.async("text");
    if (!containerText) throw new Error("MXL 내부의 악보 정보를 찾지 못했습니다.");
    const path = new DOMParser().parseFromString(containerText, "application/xml").querySelector("rootfile")?.getAttribute("full-path");
    const xml = path ? await zip.file(path)?.async("text") : undefined;
    if (!xml) throw new Error("MXL 내부의 MusicXML 파일을 찾지 못했습니다.");
    return xml;
  }
  throw new Error("자동 악보 추적은 MusicXML(.xml, .musicxml, .mxl) 파일을 지원합니다.");
}

function Upload({ onSaved }: { onSaved: () => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState(0);
  const [progressText, setProgressText] = useState("악보 분석 중");
  const [fileName, setFileName] = useState("");
  const [error, setError] = useState("");
  const [pendingPdf, setPendingPdf] = useState<File | null>(null);
  const handle = async (file?: File, confirmed = false) => {
    if (!file) return;
    let selected = file;
    if (!confirmed) {
      try {
        selected = await retainSelectedFile(file);
        if (input.current) input.current.value = "";
      } catch {
        setError("파일을 불러오지 못했습니다. 다운로드가 끝난 뒤 다시 선택해 주세요.");
        return;
      }
    }
    const isPdf = selected.name.toLowerCase().endsWith(".pdf");
    if (isPdf && !confirmed) {
      setPendingPdf(selected); setFileName(selected.name); setError(""); return;
    }
    if (!isPdf) setPendingPdf(null);
    setBusy(true); setProgress(2); setProgressText("파일을 불러오는 중"); setFileName(selected.name); setError("");
    try {
      await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
      const xml = isPdf
        ? await convertPdfLocally(selected, (value, label) => { setProgress(value); setProgressText(label); })
        : await readScoreFile(selected);
      setProgress(96); setProgressText("악보 구조 확인 중");
      const score = parseMusicXml(xml);
      const savedName = isPdf ? selected.name.replace(/\.pdf$/i, ".musicxml") : selected.name;
      await library.save({ id: score.id, name: savedName, xml, score, savedAt: Date.now() });
      setPendingPdf(null); setProgress(100); setProgressText("준비 완료"); onSaved(); setTimeout(() => go("player", score.id), 250);
    } catch (reason) { setError(reason instanceof Error ? reason.message : "악보를 열지 못했습니다."); setBusy(false); setProgress(0); }
  };
  return <main className="page upload-page">
    <div className="page-heading"><h1>악보를 업로드하세요</h1><p>PDF는 MusicXML로 변환하고, 기존 MusicXML은 바로 연주 모드로 엽니다.</p></div>
    <div className={`drop-zone${pendingPdf ? " has-file" : ""}`} onDragOver={(e) => e.preventDefault()} onDrop={(e: DragEvent) => { e.preventDefault(); void handle(e.dataTransfer.files[0]); }}>
      <span className="drop-icon"><Icon name="upload" size={30}/></span><h2>{pendingPdf ? "PDF 파일을 불러왔습니다" : "파일을 이곳에 끌어다 놓으세요"}</h2><p>{pendingPdf ? pendingPdf.name : "PDF(.pdf) · MusicXML(.xml, .musicxml, .mxl)"}</p>
      <button className="primary" onClick={() => input.current?.click()}>{pendingPdf ? "다른 파일 선택" : "파일 선택"}</button><input ref={input} hidden type="file" accept=".pdf,.xml,.musicxml,.mxl" onChange={(e: ChangeEvent<HTMLInputElement>) => { void handle(e.target.files?.[0]); }}/>{pendingPdf ? <small className="file-selected-status">✓ 선택 완료 · {(pendingPdf.size / 1024 / 1024).toFixed(1)}MB</small> : <small>PDF 20MB · MusicXML 50MB 이하</small>}
    </div>
    {pendingPdf && !busy && <section className="omr-connect"><div><strong>기기에서 무료 변환</strong><p>PDF는 서버로 보내지 않고 이 브라우저에서 MusicXML로 바꿉니다. 첫 변환 때만 약 157MB 인식 모델을 받으며 이후에는 기기에 캐시됩니다.</p></div><div><a href="https://github.com/pzfreo/partsong" target="_blank" rel="noreferrer">오픈소스 · AGPL-3.0</a><button className="primary" onClick={() => void handle(pendingPdf, true)}>무료 변환 시작</button></div><small>최신 Chrome·Edge 권장 · 인쇄 악보용 · 변환 중 탭을 닫지 마세요. <a href="/source/autolyric-scoreflow-0.1.0.tgz">ScoreFlow 소스</a></small></section>}
    {busy && <div className="upload-progress" role="status" aria-live="polite"><span className="loading-orbit" aria-hidden="true"><i/><b/><em/></span><div><strong>{fileName}</strong><span>{progressText} · {progress}%</span><i><b style={{ width: `${progress}%` }}/></i></div></div>}
    {error && <div className="notice error">{error}</div>}
  </main>;
}

function Library({ scores, onImported }: { scores: StoredScore[]; onImported: () => void }) {
  const shareInput = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState("recent");
  const [message, setMessage] = useState("");
  const exportScores = () => {
    const blob = new Blob([createScoreflowBundle(scores, (id) => localStorage.getItem(`scoreflow-note:${id}`) || "")], { type: "application/json" });
    const anchor = document.createElement("a");
    anchor.href = URL.createObjectURL(blob); anchor.download = `scoreflow-band-${new Date().toISOString().slice(0, 10)}.scoreflow`; anchor.click();
    setTimeout(() => URL.revokeObjectURL(anchor.href), 0);
  };
  const importScores = async (file?: File) => {
    if (!file) return;
    try {
      if (file.size > 50 * 1024 * 1024) throw new Error("공유 파일은 50MB 이하만 가져올 수 있습니다.");
      const shared = readScoreflowBundle(await file.text());
      for (const item of shared) {
        const score = parseMusicXml(item.xml);
        await library.save({ id: score.id, name: item.name, xml: item.xml, score, savedAt: item.savedAt });
        if (item.note) localStorage.setItem(`scoreflow-note:${score.id}`, item.note);
      }
      setMessage(`${shared.length}개의 악보와 메모를 가져왔습니다.`); onImported();
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : "공유 파일을 가져오지 못했습니다."); }
  };
  const filtered = scores.filter((item) => `${item.score.title} ${item.score.composer}`.toLowerCase().includes(query.toLowerCase())).sort((a, b) => sort === "title" ? a.score.title.localeCompare(b.score.title, "ko") : b.savedAt - a.savedAt);
  return <main className="page library-page">
    <div className="library-heading"><div className="page-heading"><h1>내 악보</h1><p>{scores.length}개의 악보 · 이 기기에 저장됨</p></div><div className="library-actions"><button className="secondary" disabled={!scores.length} onClick={exportScores}>공유 파일 내보내기</button><button className="secondary" onClick={() => shareInput.current?.click()}>공유 파일 가져오기</button><input ref={shareInput} hidden type="file" accept=".scoreflow,application/json" onChange={(event) => { void importScores(event.target.files?.[0]); event.target.value = ""; }}/><button className="primary" onClick={() => go("upload")}><Icon name="plus"/>업로드</button></div></div>
    {message && <div className="notice share-notice" role="status">{message}</div>}
    <div className="library-tools"><label className="search"><Icon name="search" size={18}/><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="내 악보 검색"/></label><div className="filters"><button className="active">전체</button><button>즐겨찾기</button><button>최근 연주</button><button>폴더</button></div><select value={sort} onChange={(e) => setSort(e.target.value)}><option value="recent">최근 추가순</option><option value="title">곡명순</option></select></div>
    <div className="score-table"><div className="table-head"><span>곡명</span><span>형식</span><span>페이지</span><span>추가일</span><i/></div>{filtered.map((item) => <ScoreCard key={item.id} item={item} table/>)}</div>
    {!filtered.length && <div className="empty">검색 결과가 없습니다.</div>}
  </main>;
}

type SettingsState = { instrument: string; view: string; autoTurn: boolean; autoScroll: boolean; zoom: number; highlight: boolean; sensitivity: number; highContrast: boolean; largeControls: boolean };
const defaultSettings: SettingsState = { instrument: "기타", view: "auto", autoTurn: true, autoScroll: true, zoom: 100, highlight: true, sensitivity: 75, highContrast: false, largeControls: false };

function useSettings() {
  const [settings, setSettings] = useState<SettingsState>(() => { try { return { ...defaultSettings, ...JSON.parse(localStorage.getItem("scoreflow-settings") || "{}") }; } catch { return defaultSettings; } });
  useEffect(() => localStorage.setItem("scoreflow-settings", JSON.stringify(settings)), [settings]);
  return [settings, setSettings] as const;
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) { return <button role="switch" aria-checked={checked} className={`toggle ${checked ? "on" : ""}`} onClick={() => onChange(!checked)}><i/></button>; }

function Settings({ settings, setSettings }: { settings: SettingsState; setSettings: (next: SettingsState) => void }) {
  const update = <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => setSettings({ ...settings, [key]: value });
  return <main className="page settings-page"><div className="page-heading"><h1>설정</h1></div><div className="settings-layout">
    <aside>{["악기", "악보 표시", "오디오", "접근성"].map((item, i) => <a key={item} href={`#setting-${i}`} className={i === 0 ? "active" : ""}>{item}</a>)}</aside>
    <div className="settings-content">
      <section id="setting-0"><h2>악기</h2><p>밴드 파트에 맞춰 음정 인식 방식과 전처리를 조정합니다.</p><div className="instrument-grid">{["보컬", "기타", "베이스", "키보드", "바이올린", "플루트", "색소폰", "트럼펫"].map((item) => <button key={item} className={settings.instrument === item ? "selected" : ""} onClick={() => update("instrument", item)}><Icon name="music"/><span>{item}</span>{settings.instrument === item && <Icon name="check"/>}</button>)}</div><p className="instrument-note">드럼처럼 음높이가 없는 파트는 현재 자동 위치 추적 대상이 아닙니다.</p></section>
      <section id="setting-1"><h2>악보 표시</h2><SettingRow label="보기 방식"><select value={settings.view} onChange={(e) => update("view", e.target.value)}><option value="auto">한 페이지 자동 (기기에 맞춤)</option><option value="single">한 페이지</option><option value="double">두 페이지</option></select></SettingRow><SettingRow label="자동 페이지 넘김"><Toggle checked={settings.autoTurn} onChange={(v) => update("autoTurn", v)}/></SettingRow><SettingRow label="자동 스크롤"><Toggle checked={settings.autoScroll} onChange={(v) => update("autoScroll", v)}/></SettingRow><SettingRow label={`확대 비율 ${settings.zoom}%`}><input type="range" min="70" max="140" value={settings.zoom} onChange={(e) => update("zoom", Number(e.target.value))}/></SettingRow><SettingRow label="현재 마디 강조" hint="연주 중인 마디에 파란 커서를 표시합니다."><Toggle checked={settings.highlight} onChange={(v) => update("highlight", v)}/></SettingRow></section>
      <section id="setting-2"><h2>오디오 입력</h2><SettingRow label="입력 장치"><select><option>내장 마이크 (기본값)</option><option>USB 오디오 인터페이스</option></select></SettingRow><SettingRow label={`입력 감도 ${settings.sensitivity}%`} hint="주변 소음 낮음 · 인식에 적합"><input type="range" value={settings.sensitivity} onChange={(e) => update("sensitivity", Number(e.target.value))}/></SettingRow></section>
      <section id="setting-3"><h2>접근성</h2><SettingRow label="고대비 표시"><Toggle checked={settings.highContrast} onChange={(v) => update("highContrast", v)}/></SettingRow><SettingRow label="큰 연주 컨트롤"><Toggle checked={settings.largeControls} onChange={(v) => update("largeControls", v)}/></SettingRow></section>
    </div>
  </div></main>;
}

function SettingRow({ label, hint, children }: { label: string; hint?: string; children: ReactNode }) { return <div className="setting-row"><span><strong>{label}</strong>{hint && <small>{hint}</small>}</span>{children}</div>; }

function ScoreCanvas({ xml, eventIndex, zoom, annotations }: { xml: string; eventIndex: number; zoom: number; annotations: boolean }) {
  const host = useRef<HTMLDivElement>(null); const osmd = useRef<OsmdInstance | null>(null); const last = useRef(0);
  useEffect(() => {
    if (!host.current) return;
    let cancelled = false;
    let ready = false;
    let renderer: OsmdInstance | null = null;
    const onResize = () => { if (ready && renderer && host.current && host.current.clientWidth > 0) renderer.render(); };
    void import("opensheetmusicdisplay").then(async ({ OpenSheetMusicDisplay }) => {
      if (cancelled || !host.current) return;
      renderer = new OpenSheetMusicDisplay(host.current, { autoResize: false, backend: "svg", drawingParameters: "compacttight", followCursor: true });
      osmd.current = renderer;
      await renderer.load(xml);
      if (cancelled || !host.current || host.current.clientWidth <= 0) return;
      renderer.Zoom = zoom / 100; renderer.render(); renderer.cursor.show(); last.current = 0; ready = true; addEventListener("resize", onResize);
    });
    return () => { cancelled = true; removeEventListener("resize", onResize); host.current?.replaceChildren(); osmd.current = null; };
  }, [xml]);
  useEffect(() => { if (!osmd.current) return; osmd.current.Zoom = zoom / 100; osmd.current.render(); }, [zoom]);
  useEffect(() => { const cursor = osmd.current?.cursor; if (!cursor) return; if (eventIndex < last.current) cursor.reset(); const steps = eventIndex < last.current ? eventIndex : eventIndex - last.current; for (let i = 0; i < steps; i += 1) cursor.next(); cursor.show(); last.current = eventIndex; }, [eventIndex]);
  return <div className="score-stage"><div className="score-render" ref={host}/>{annotations && <DrawingLayer/>}</div>;
}

function DrawingLayer() {
  const [lines, setLines] = useState<string[]>([]); const active = useRef<number | null>(null);
  const point = (event: ReactPointerEvent<SVGSVGElement>) => { const rect = event.currentTarget.getBoundingClientRect(); return `${event.clientX - rect.left},${event.clientY - rect.top}`; };
  return <svg className="drawing-layer" onPointerDown={(e) => { e.currentTarget.setPointerCapture(e.pointerId); active.current = lines.length; setLines([...lines, `M${point(e)}`]); }} onPointerMove={(e) => { if (active.current === null) return; setLines((current) => current.map((line, i) => i === active.current ? `${line} L${point(e)}` : line)); }} onPointerUp={() => { active.current = null; }}>{lines.map((line, i) => <path key={i} d={line}/>)}</svg>;
}

function midiName(midi: number) { return `${["C", "C♯", "D", "D♯", "E", "F", "F♯", "G", "G♯", "A", "A♯", "B"][midi % 12]}${Math.floor(midi / 12) - 1}`; }

function Player({ item, settings }: { item: StoredScore; settings: SettingsState }) {
  const engine = useMemo(() => { const value = new ScoreFlowEngine(item.score); value.autoTurnEnabled = settings.autoTurn; return value; }, [item, settings.autoTurn]);
  const [tracking, setTracking] = useState<TrackingState>(engine.follower.state); const [source, setSource] = useState<"microphone" | "midi" | null>(null); const [level, setLevel] = useState(0); const [lastNote, setLastNote] = useState<number | null>(null); const [annotation, setAnnotation] = useState(false); const [noteOpen, setNoteOpen] = useState(false); const [note, setNote] = useState(() => localStorage.getItem(`scoreflow-note:${item.id}`) || ""); const [message, setMessage] = useState(""); const [previewing, setPreviewing] = useState(false); const [metronome, setMetronome] = useState(false); const [practiceTempo, setPracticeTempo] = useState(Math.round(item.score.initialTempo));
  const mic = useRef<MicrophonePitchSource | null>(null); const midi = useRef<MidiNoteSource | null>(null); const practice = useRef<PracticeAudio | null>(null);
  const accept = (observation: NoteObservation) => { setLastNote(observation.midi); setTracking(engine.accept(observation).tracking); };
  const stop = async () => { await mic.current?.stop(); midi.current?.stop(); mic.current = null; midi.current = null; setSource(null); setTracking(engine.follower.pause()); };
  const startMic = async () => { try { await stop(); const value = new MicrophonePitchSource({ minClarity: Math.max(.55, settings.sensitivity / 100), onNote: accept, onLevel: setLevel }); mic.current = value; await value.start(); setSource("microphone"); setMessage(""); } catch (e) { setMessage(e instanceof Error ? e.message : "마이크를 시작할 수 없습니다."); } };
  const startMidi = async () => { try { await stop(); const value = new MidiNoteSource(accept); midi.current = value; await value.start(); setSource("midi"); setMessage(""); } catch (e) { setMessage(e instanceof Error ? e.message : "MIDI를 시작할 수 없습니다."); } };
  useEffect(() => {
    const value = new PracticeAudio(item.score, (eventIndex) => setTracking(engine.follower.reset(eventIndex)), () => setPreviewing(false));
    practice.current = value;
    return () => { value.dispose(); practice.current = null; };
  }, [engine, item.score]);
  useEffect(() => { practice.current?.setTempo(practiceTempo); }, [practiceTempo]);
  useEffect(() => () => { void mic.current?.stop(); midi.current?.stop(); }, []);
  const togglePreview = async () => {
    if (previewing) { practice.current?.pause(); setPreviewing(false); return; }
    await stop();
    await practice.current?.play(tracking.eventIndex, practiceTempo);
    setPreviewing(true); setMessage("");
  };
  const toggleMetronome = async () => {
    const next = !metronome;
    await practice.current?.setMetronome(next, practiceTempo);
    setMetronome(next);
  };
  const measure = tracking.measureIndex + 1; const progress = ((tracking.eventIndex + 1) / item.score.events.length) * 100;
  return <div className={`player ${settings.highContrast ? "high-contrast" : ""}`}>
    <header className="player-header"><button className="brand compact" onClick={() => go("home")}><span className="brand-mark"><Icon name="music" size={17}/></span></button><div className="player-title"><strong>{item.score.title}</strong><span>{item.score.composer || "작곡가 미상"}</span></div><div className="player-page">{tracking.page} / {item.score.pageCount}</div><button className={`tool-button ${annotation ? "active" : ""}`} onClick={() => setAnnotation(!annotation)}><Icon name="pen"/>필기</button><button className={`tool-button ${noteOpen ? "active" : ""}`} onClick={() => setNoteOpen(!noteOpen)}><Icon name="library"/>메모</button><button className="tool-button" onClick={() => go("settings")}><Icon name="settings"/>설정</button></header>
    <div className="player-body"><aside className="player-sidebar"><div className="connection"><span><i className={source || previewing ? "live" : ""}/>{previewing ? "미리듣기 재생 중" : source === "midi" ? "MIDI 연결됨" : source === "microphone" ? "마이크 연결됨" : "입력 대기"}</span><strong>{settings.instrument} 모드</strong></div><h3>입력 장치</h3><button className={source === "microphone" ? "selected" : ""} onClick={() => void startMic()}><Icon name="mic"/>내장 마이크</button><button className={source === "midi" ? "selected" : ""} onClick={() => void startMidi()}><Icon name="music"/>Web MIDI</button><div className="sensitivity"><span>입력 레벨</span><i><b style={{ width: `${Math.min(100, level * 500)}%` }}/></i></div><h3>연습 도구</h3><button className={previewing ? "selected" : ""} onClick={() => void togglePreview()}><Icon name={previewing ? "pause" : "speaker"}/>{previewing ? "미리듣기 정지" : "악보 미리듣기"}</button><button className={metronome ? "selected" : ""} onClick={() => void toggleMetronome()}><Icon name="metronome"/>메트로놈 {metronome ? "켜짐" : "켜기"}</button><label className="tempo-control"><span>연습 템포</span><strong>{practiceTempo} BPM</strong><input type="range" min="40" max="220" value={practiceTempo} onChange={(e) => setPracticeTempo(Number(e.target.value))}/></label><div className="tracking-card"><span className="pulse"><i/></span><div><strong>{previewing ? "악보를 재생하는 중" : source ? "연주를 따라가는 중" : "입력을 연결하세요"}</strong><small>{measure}마디 · {tracking.page < item.score.pageCount ? "다음 페이지 준비됨" : "마지막 페이지"}</small></div></div><div className="metrics"><div><span>템포</span><strong>{previewing || metronome ? practiceTempo : Math.round(tracking.estimatedTempo)} <small>BPM</small></strong></div><div><span>입력 음</span><strong>{lastNote === null ? "—" : midiName(lastNote)}</strong></div><div><span>인식 신뢰도</span><strong>{Math.round(tracking.confidence * 100)}%</strong></div></div>{message && <div className="notice error small">{message}</div>}</aside>
      <main className="player-main"><div className="score-meta"><span>{previewing ? "미리듣기 재생 중" : source ? "연주를 따라가는 중" : "대기 중"}</span><strong>{measure} / {item.score.measures.length}마디</strong></div><ScoreCanvas xml={item.xml} eventIndex={tracking.eventIndex} zoom={settings.zoom} annotations={annotation}/></main>
    </div>
    {noteOpen && <aside className="note-drawer"><div><strong>합주 메모</strong><button onClick={() => setNoteOpen(false)}>×</button></div><textarea value={note} onChange={(e) => { setNote(e.target.value); localStorage.setItem(`scoreflow-note:${item.id}`, e.target.value); }} placeholder="큐, 다이내믹, 파트별 주의점을 적어 두세요."/><small>이 기기에 자동 저장됩니다.</small></aside>}
    <footer className={`player-footer ${settings.largeControls ? "large" : ""}`}><div className="progress"><b style={{ width: `${progress}%` }}/></div><button onClick={() => engine.goToMeasure(Math.max(0, tracking.measureIndex - 1))}>←</button><button className="pause-main" onClick={() => source ? void stop() : void startMic()}><Icon name={source ? "pause" : "play"}/></button><button onClick={() => { const next = engine.goToMeasure(Math.min(item.score.measures.length - 1, tracking.measureIndex + 1)); setTracking(next); }}>→</button><span>{settings.autoTurn ? "자동 넘김" : "수동 넘김"}</span></footer>
  </div>;
}

export function App() {
  const [view, setView] = useState<View>(currentRoute()); const [refresh, setRefresh] = useState(0); const scores = useScores(refresh); const [settings, setSettings] = useSettings();
  useEffect(() => { const onHash = () => setView(currentRoute()); addEventListener("hashchange", onHash); if (!location.hash) go("home"); return () => removeEventListener("hashchange", onHash); }, []);
  const id = new URLSearchParams(location.hash.split("?")[1] || "").get("id"); const selected = scores.find((item) => item.id === id) ?? scores[0]!;
  if (view === "player") return <Player item={selected} settings={settings}/>;
  return <div className="app"><Header view={view}/>{view === "home" && <Home scores={scores}/>} {view === "upload" && <Upload onSaved={() => setRefresh((v) => v + 1)}/>} {view === "library" && <Library scores={scores} onImported={() => setRefresh((v) => v + 1)}/>} {view === "settings" && <Settings settings={settings} setSettings={setSettings}/>}</div>;
}
