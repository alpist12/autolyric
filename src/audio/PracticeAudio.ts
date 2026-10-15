import type { Score, ScoreEvent } from "../types";

export interface TimedScoreEvent {
  event: ScoreEvent;
  startBeat: number;
  durationBeats: number;
}

export function buildScoreTimeline(score: Score): TimedScoreEvent[] {
  const measureLengths = score.measures.map((measure) => {
    const events = score.events.filter((event) => event.measureIndex === measure.index);
    return Math.max(1, ...events.map((event) => event.beat + event.durationBeats));
  });
  const starts: number[] = [];
  measureLengths.reduce((sum, length, index) => {
    starts[index] = sum;
    return sum + length;
  }, 0);
  return score.events.map((event) => ({
    event,
    startBeat: (starts[event.measureIndex] ?? 0) + event.beat,
    durationBeats: event.durationBeats,
  }));
}

export class PracticeAudio {
  private context: AudioContext | null = null;
  private timer: number | null = null;
  private timeline: TimedScoreEvent[];
  private bpm: number;
  private previewing = false;
  private metronome = false;
  private clockTime = 0;
  private clockBeat = 0;
  private scheduleIndex = 0;
  private visualIndex = 0;
  private nextClickBeat = 0;
  private voices = new Set<OscillatorNode>();

  constructor(private readonly score: Score, private readonly onEvent: (eventIndex: number) => void, private readonly onPreviewStop: () => void = () => {}) {
    this.timeline = buildScoreTimeline(score);
    this.bpm = score.initialTempo;
  }

  get isPreviewing() { return this.previewing; }
  get isMetronomeOn() { return this.metronome; }

  async play(startEventIndex: number, bpm: number) {
    await this.ensureContext();
    this.stopVoices();
    this.bpm = bpm;
    this.previewing = true;
    this.scheduleIndex = Math.max(0, Math.min(startEventIndex, this.timeline.length - 1));
    this.visualIndex = this.scheduleIndex;
    this.clockBeat = this.timeline[this.scheduleIndex]?.startBeat ?? 0;
    this.clockTime = this.context!.currentTime + 0.06;
    this.nextClickBeat = Math.ceil(this.clockBeat);
    this.ensureTimer();
    this.tick();
  }

  pause() {
    this.previewing = false;
    this.stopVoices();
    this.stopTimerIfIdle();
    this.onPreviewStop();
  }

  async setMetronome(enabled: boolean, bpm: number) {
    await this.ensureContext();
    this.bpm = bpm;
    this.metronome = enabled;
    if (enabled && !this.previewing) {
      this.clockBeat = 0;
      this.clockTime = this.context!.currentTime + 0.06;
      this.nextClickBeat = 0;
    }
    if (enabled) { this.ensureTimer(); this.tick(); }
    else this.stopTimerIfIdle();
  }

  setTempo(bpm: number) {
    const context = this.context;
    if (!context) { this.bpm = bpm; return; }
    const beat = this.currentBeat();
    this.clockBeat = beat;
    this.clockTime = context.currentTime;
    this.bpm = bpm;
    this.nextClickBeat = Math.ceil(beat);
  }

  dispose() {
    this.previewing = false;
    this.metronome = false;
    this.stopVoices();
    if (this.timer !== null) window.clearInterval(this.timer);
    this.timer = null;
    void this.context?.close();
    this.context = null;
  }

  private async ensureContext() {
    this.context ??= new AudioContext();
    await this.context.resume();
  }

  private currentBeat() {
    if (!this.context) return this.clockBeat;
    return this.clockBeat + Math.max(0, this.context.currentTime - this.clockTime) * this.bpm / 60;
  }

  private ensureTimer() {
    this.timer ??= window.setInterval(() => this.tick(), 30);
  }

  private stopTimerIfIdle() {
    if (this.previewing || this.metronome || this.timer === null) return;
    window.clearInterval(this.timer);
    this.timer = null;
  }

  private tick() {
    if (!this.context) return;
    const beat = this.currentBeat();
    const horizon = beat + this.bpm / 60 * 0.35;
    const secondsPerBeat = 60 / this.bpm;

    while (this.previewing && this.scheduleIndex < this.timeline.length && this.timeline[this.scheduleIndex]!.startBeat <= horizon) {
      const timed = this.timeline[this.scheduleIndex]!;
      const at = this.clockTime + (timed.startBeat - this.clockBeat) * secondsPerBeat;
      for (const midi of timed.event.midiPitches) this.scheduleTone(midi, at, timed.durationBeats * secondsPerBeat);
      this.scheduleIndex += 1;
    }
    while (this.previewing && this.visualIndex < this.timeline.length && this.timeline[this.visualIndex]!.startBeat <= beat) {
      this.onEvent(this.timeline[this.visualIndex]!.event.index);
      this.visualIndex += 1;
    }
    if (this.previewing && this.visualIndex >= this.timeline.length) this.pause();

    while (this.metronome && this.nextClickBeat <= horizon) {
      const at = this.clockTime + (this.nextClickBeat - this.clockBeat) * secondsPerBeat;
      this.scheduleClick(at, this.nextClickBeat % 4 === 0);
      this.nextClickBeat += 1;
    }
  }

  private scheduleTone(midi: number, at: number, duration: number) {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.type = "triangle";
    oscillator.frequency.value = 440 * 2 ** ((midi - 69) / 12);
    gain.gain.setValueAtTime(0.0001, at);
    gain.gain.exponentialRampToValueAtTime(0.075, at + 0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + Math.max(0.08, Math.min(duration, 1.8)));
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + Math.max(0.1, Math.min(duration, 1.85)));
    this.voices.add(oscillator);
    oscillator.onended = () => this.voices.delete(oscillator);
  }

  private scheduleClick(at: number, accent: boolean) {
    const context = this.context!;
    const oscillator = context.createOscillator();
    const gain = context.createGain();
    oscillator.frequency.value = accent ? 1500 : 980;
    gain.gain.setValueAtTime(0.13, at);
    gain.gain.exponentialRampToValueAtTime(0.0001, at + 0.045);
    oscillator.connect(gain).connect(context.destination);
    oscillator.start(at);
    oscillator.stop(at + 0.05);
    this.voices.add(oscillator);
    oscillator.onended = () => this.voices.delete(oscillator);
  }

  private stopVoices() {
    for (const voice of this.voices) { try { voice.stop(); } catch {} }
    this.voices.clear();
  }
}
