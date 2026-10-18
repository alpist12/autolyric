export type InputSource = "microphone" | "midi" | "manual";

export interface ScoreEvent {
  index: number;
  measureIndex: number;
  measureNumber: string;
  page: number;
  beat: number;
  durationBeats: number;
  midiPitches: number[];
}

export interface ScoreMeasure {
  index: number;
  number: string;
  page: number;
  startEventIndex: number;
  endEventIndex: number;
}

export interface Score {
  id: string;
  title: string;
  composer: string;
  fileType: "musicxml";
  pageCount: number;
  measures: ScoreMeasure[];
  events: ScoreEvent[];
  initialTempo: number;
}

export interface NoteObservation {
  midi: number;
  timestampMs: number;
  confidence: number;
  source: InputSource;
  velocity?: number;
}

export interface TrackingState {
  status: "idle" | "tracking" | "uncertain" | "paused" | "finished";
  eventIndex: number;
  measureIndex: number;
  page: number;
  confidence: number;
  estimatedTempo: number;
  lastUpdateMs: number;
}

export interface StoredScore {
  id: string;
  name: string;
  xml: string;
  score: Score;
  savedAt: number;
  updatedAt?: number;
  note?: string;
  annotations?: string[];
}
