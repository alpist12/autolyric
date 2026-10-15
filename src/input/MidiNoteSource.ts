import type { NoteObservation } from "../types";

export class MidiNoteSource {
  private access: MIDIAccess | undefined;
  private listeners = new Map<MIDIInput, (event: MIDIMessageEvent) => void>();

  constructor(private readonly onNote: (observation: NoteObservation) => void) {}

  async start(): Promise<void> {
    const request = (navigator as Navigator & { requestMIDIAccess?: () => Promise<MIDIAccess> }).requestMIDIAccess;
    if (!request) throw new Error("이 브라우저는 Web MIDI를 지원하지 않습니다.");
    this.access = await request.call(navigator);
    this.attachInputs();
    this.access.onstatechange = () => this.attachInputs();
  }

  stop(): void {
    if (this.access) this.access.onstatechange = null;
    for (const [input, listener] of this.listeners) input.removeEventListener("midimessage", listener);
    this.listeners.clear();
    this.access = undefined;
  }

  private attachInputs(): void {
    if (!this.access) return;
    for (const input of this.access.inputs.values()) {
      if (this.listeners.has(input)) continue;
      const listener = (event: MIDIMessageEvent) => {
        if (!event.data) return;
        const [status = 0, note = 0, velocity = 0] = event.data;
        if ((status & 0xf0) !== 0x90 || velocity === 0) return;
        this.onNote({ midi: note, velocity, confidence: 1, timestampMs: performance.now(), source: "midi" });
      };
      input.addEventListener("midimessage", listener);
      this.listeners.set(input, listener);
    }
  }
}
