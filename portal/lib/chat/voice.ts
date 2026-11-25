/**
 * Voice notes: recording in the browser. The recording is sent like any other
 * file (encrypted before upload), with its length and a small waveform kept
 * inside the encrypted message, so the server sees neither.
 */

export const VOICE_MAX_SECONDS = 20 * 60;
/** Bars in a voice note's waveform. */
export const VOICE_BARS = 48;
// Speech-quality Opus/AAC: about 15 MB an hour, so 20 minutes is about 5 MB.
const AUDIO_BITS_PER_SECOND = 32_000;
const SAMPLE_MS = 80;

const MIME_CANDIDATES = [
  "audio/webm;codecs=opus", // Chrome, Edge, Firefox
  "audio/mp4;codecs=mp4a.40.2", // Safari
  "audio/mp4",
  "audio/ogg;codecs=opus",
  "audio/webm",
];

export function canRecordVoice() {
  return (
    typeof window !== "undefined" &&
    typeof window.MediaRecorder !== "undefined" &&
    Boolean(navigator.mediaDevices?.getUserMedia)
  );
}

function pickMime(): string | undefined {
  return MIME_CANDIDATES.find((type) => MediaRecorder.isTypeSupported(type));
}

function extensionFor(mime: string) {
  if (mime.includes("mp4")) return "m4a";
  if (mime.includes("ogg")) return "ogg";
  return "webm";
}

/** Squeeze level samples into `bars` values from 0 to 100, scaled to the loudest moment. */
export function toWaveform(samples: number[], bars = VOICE_BARS): number[] {
  if (!samples.length) return Array(bars).fill(0);
  const out: number[] = [];
  for (let i = 0; i < bars; i += 1) {
    const start = Math.floor((i * samples.length) / bars);
    const end = Math.max(start + 1, Math.floor(((i + 1) * samples.length) / bars));
    out.push(Math.max(...samples.slice(start, end)));
  }
  const peak = Math.max(...out, 0.0001);
  return out.map((value) => Math.round((value / peak) * 100));
}

export type VoiceRecording = { file: File; duration: number; waveform: number[]; url: string };

export class MicrophoneBlockedError extends Error {
  constructor() {
    super("Chat needs your microphone to record. Allow microphone access for this site in your browser and try again.");
  }
}

/**
 * Records one voice note. `onLevel` gets the current loudness (0 to 1) and the
 * seconds recorded so far, about 12 times a second; `onLimit` fires when the
 * 20-minute limit is reached (the recording is then stopped and kept).
 */
export class VoiceRecorder {
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private context: AudioContext | null = null;
  private timer: number | null = null;
  private chunks: Blob[] = [];
  private samples: number[] = [];
  private startedAt = 0;
  private finished: Promise<VoiceRecording | null> | null = null;
  private resolveFinished: ((value: VoiceRecording | null) => void) | null = null;
  private keep = true;

  constructor(
    private readonly onLevel: (level: number, seconds: number) => void,
    private readonly onLimit: () => void,
  ) {}

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
      });
    } catch (error) {
      if (error instanceof DOMException && (error.name === "NotAllowedError" || error.name === "SecurityError")) {
        throw new MicrophoneBlockedError();
      }
      throw new Error("No microphone was found. Connect one and try again.");
    }

    const mimeType = pickMime();
    this.recorder = new MediaRecorder(this.stream, {
      ...(mimeType ? { mimeType } : {}),
      audioBitsPerSecond: AUDIO_BITS_PER_SECOND,
    });
    this.recorder.ondataavailable = (event) => {
      if (event.data.size) this.chunks.push(event.data);
    };
    this.finished = new Promise((resolve) => {
      this.resolveFinished = resolve;
    });
    this.recorder.onstop = () => this.finish();

    // Loudness for the live meter and the waveform.
    this.context = new AudioContext();
    const analyser = this.context.createAnalyser();
    analyser.fftSize = 1024;
    this.context.createMediaStreamSource(this.stream).connect(analyser);
    const buffer = new Float32Array(analyser.fftSize);

    this.recorder.start(1000);
    this.startedAt = performance.now();
    this.timer = window.setInterval(() => {
      analyser.getFloatTimeDomainData(buffer);
      let sum = 0;
      for (const value of buffer) sum += value * value;
      const level = Math.min(1, Math.sqrt(sum / buffer.length) * 4);
      this.samples.push(level);
      const seconds = this.elapsed();
      this.onLevel(level, seconds);
      if (seconds >= VOICE_MAX_SECONDS) {
        this.onLimit();
        void this.stop();
      }
    }, SAMPLE_MS);
  }

  elapsed() {
    return this.startedAt ? (performance.now() - this.startedAt) / 1000 : 0;
  }

  /** Stop and keep the recording. */
  stop(): Promise<VoiceRecording | null> {
    this.keep = true;
    return this.end();
  }

  /** Stop and throw the recording away. */
  cancel() {
    this.keep = false;
    void this.end();
  }

  private end(): Promise<VoiceRecording | null> {
    if (!this.recorder || this.recorder.state === "inactive") {
      this.release();
      return this.finished ?? Promise.resolve(null);
    }
    this.recorder.stop();
    return this.finished!;
  }

  private finish() {
    const duration = Math.min(this.elapsed(), VOICE_MAX_SECONDS);
    const mime = (this.recorder?.mimeType || pickMime() || "audio/webm").split(";")[0];
    const chunks = this.chunks;
    const samples = this.samples;
    this.release();
    if (!this.keep || !chunks.length || duration < 0.5) {
      this.resolveFinished?.(null);
      return;
    }
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-");
    const file = new File(chunks, `Voice message ${stamp}.${extensionFor(mime)}`, { type: mime });
    this.resolveFinished?.({ file, duration, waveform: toWaveform(samples), url: URL.createObjectURL(file) });
  }

  private release() {
    if (this.timer) window.clearInterval(this.timer);
    this.timer = null;
    this.stream?.getTracks().forEach((track) => track.stop());
    this.stream = null;
    void this.context?.close().catch(() => undefined);
    this.context = null;
  }
}

/** "0:07", "12:30" */
export function formatDuration(seconds: number) {
  const total = Math.max(0, Math.floor(seconds));
  return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, "0")}`;
}
