import {
  AUDIO_RATE,
  encodeAudioWav,
} from "../../../../../../supabase/functions/_shared/clinical-audio-model.ts";
interface RecorderCallbacks {
  onFrames: (frames: number) => void;
  onLimit: () => void;
  onError: () => void;
}
export class ClinicalPcmRecorder {
  private stream: MediaStream | null = null;
  private context: AudioContext | null = null;
  private node: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private chunks: Int16Array[] = [];
  private disposed = false;
  private complete = false;
  private finishAck: (() => void) | null = null;
  constructor(private callbacks: RecorderCallbacks) {}
  async start() {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true,
        },
        video: false,
      });
      this.stream = stream;
      stream.getTracks().forEach((track) =>
        track.addEventListener("ended", () => {
          if (!this.disposed) {
            this.callbacks.onError();
            void this.dispose();
          }
        }),
      );
      if (this.disposed) {
        this.closeTracks();
        return;
      }
      const context = new AudioContext({ sampleRate: AUDIO_RATE });
      this.context = context;
      if (context.sampleRate !== AUDIO_RATE)
        throw new Error(
          "This browser cannot capture the required sample format. Use a compatible WAV.",
        );
      await context.audioWorklet.addModule(
        "/audio/clinical-dictation-worklet.js",
      );
      if (this.disposed) {
        await this.dispose();
        return;
      }
      this.node = new AudioWorkletNode(context, "clinical-dictation-pcm", {
        numberOfInputs: 1,
        numberOfOutputs: 1,
        outputChannelCount: [1],
        channelCount: 1,
      });
      this.node.port.onmessage = (event) => {
        if (this.disposed) return;
        if (
          event.data.type === "chunk" &&
          event.data.samples instanceof Int16Array
        ) {
          this.chunks.push(event.data.samples);
          this.callbacks.onFrames(event.data.total);
        }
        if (event.data.type === "complete") {
          this.complete = true;
          this.finishAck?.();
          if (event.data.reason === "limit") this.callbacks.onLimit();
        }
      };
      this.node.onprocessorerror = () => {
        this.callbacks.onError();
        void this.dispose();
      };
      this.gain = context.createGain();
      this.gain.gain.value = 0;
      context.createMediaStreamSource(stream).connect(this.node);
      this.node.connect(this.gain);
      this.gain.connect(context.destination);
      await context.resume();
      if (this.disposed) await this.dispose();
    } catch (error) {
      await this.dispose();
      throw error;
    }
  }
  async pause() {
    this.stream?.getTracks().forEach((t) => {
      t.enabled = false;
    });
    this.node?.port.postMessage("pause");
    await this.context?.suspend();
  }
  async resume() {
    this.node?.port.postMessage("resume");
    this.stream?.getTracks().forEach((t) => {
      t.enabled = true;
    });
    await this.context?.resume();
  }
  async stop() {
    if (this.disposed || !this.node || !this.context)
      throw new Error(
        "Recording could not be finalized. No audio was uploaded.",
      );
    this.stream?.getTracks().forEach((t) => {
      t.enabled = false;
    });
    try {
      if (!this.complete) {
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          const ack = new Promise<void>((resolve, reject) => {
            this.finishAck = resolve;
            timer = setTimeout(
              () =>
                reject(
                  new Error(
                    "Recording did not finalize. No audio was uploaded.",
                  ),
                ),
              1500,
            );
          });
          await this.context.resume();
          this.node.port.postMessage("stop");
          await ack;
        } finally {
          if (timer) clearTimeout(timer);
          this.finishAck = null;
        }
      }
      return encodeAudioWav(this.chunks);
    } finally {
      await this.dispose();
    }
  }
  private closeTracks() {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
  }
  async dispose() {
    this.disposed = true;
    this.closeTracks();
    this.node?.disconnect();
    this.gain?.disconnect();
    if (this.node) {
      this.node.port.onmessage = null;
      this.node.onprocessorerror = null;
      this.node.port.close();
    }
    this.node = null;
    this.gain = null;
    const context = this.context;
    this.context = null;
    if (context && context.state !== "closed")
      await context.close().catch(() => undefined);
  }
}
