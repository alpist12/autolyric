import { detectPitchYin } from "./yin";
import type { NoteObservation } from "../types";

export interface MicrophoneOptions {
  deviceId?: string;
  minFrequency?: number;
  maxFrequency?: number;
  minClarity?: number;
  onNote: (observation: NoteObservation) => void;
  onLevel?: (rms: number) => void;
}

export class MicrophonePitchSource {
  private context: AudioContext | undefined;
  private stream: MediaStream | undefined;
  private frame: number | undefined;

  constructor(private readonly options: MicrophoneOptions) {}

  async start(): Promise<void> {
    if (this.context) return;
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("이 브라우저는 마이크 입력을 지원하지 않습니다.");
    this.stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        channelCount: 1,
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false,
        ...(this.options.deviceId ? { deviceId: { exact: this.options.deviceId } } : {}),
      },
    });
    this.context = new AudioContext({ latencyHint: "interactive" });
    await this.context.resume();
    const source = this.context.createMediaStreamSource(this.stream);
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 4096;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    let lastRoundedMidi: number | null = null;
    let lastEmission = 0;

    const analyse = () => {
      if (!this.context) return;
      analyser.getFloatTimeDomainData(samples);
      const result = detectPitchYin(samples, this.context.sampleRate, {
        ...(this.options.minFrequency === undefined ? {} : { minFrequency: this.options.minFrequency }),
        ...(this.options.maxFrequency === undefined ? {} : { maxFrequency: this.options.maxFrequency }),
      });
      this.options.onLevel?.(result?.rms ?? 0);
      if (result && result.clarity >= (this.options.minClarity ?? 0.8)) {
        const midi = Math.round(result.midi);
        const now = performance.now();
        if (midi !== lastRoundedMidi || now - lastEmission >= 160) {
          this.options.onNote({ midi, timestampMs: now, confidence: result.clarity, source: "microphone" });
          lastRoundedMidi = midi;
          lastEmission = now;
        }
      }
      this.frame = requestAnimationFrame(analyse);
    };
    analyse();
  }

  async stop(): Promise<void> {
    if (this.frame !== undefined) cancelAnimationFrame(this.frame);
    this.stream?.getTracks().forEach((track) => track.stop());
    await this.context?.close();
    this.frame = undefined;
    this.stream = undefined;
    this.context = undefined;
  }
}
