export interface CameraTrack { stop(): void }
export interface CameraStream { getTracks(): CameraTrack[] }

// A permission prompt can resolve after its dialog has gone away. Its stream
// still belongs to the old request and must be stopped without being displayed.
export class CameraLease<Stream extends CameraStream = MediaStream> {
  private generation = 0;
  private stream: Stream | null = null;

  async acquire(request: () => Promise<Stream>): Promise<Stream | null> {
    this.stop();
    const generation = this.generation;
    try {
      const stream = await request();
      if (generation !== this.generation) {
        stream.getTracks().forEach((track) => track.stop());
        return null;
      }
      this.stream = stream;
      return stream;
    } catch (cause) {
      if (generation !== this.generation) return null;
      throw cause;
    }
  }

  owns(stream: Stream): boolean { return this.stream === stream; }

  stop(): void {
    this.generation++;
    const stream = this.stream;
    this.stream = null;
    stream?.getTracks().forEach((track) => track.stop());
  }
}

export function cameraConstraints(deviceId?: string): MediaStreamConstraints {
  return {
    audio: false,
    video: {
      ...(deviceId ? { deviceId: { exact: deviceId } } : { facingMode: { ideal: "environment" } }),
      width: { ideal: 1280 }, height: { ideal: 720 },
    },
  };
}

export function cameraError(cause: unknown): string {
  const name = cause && typeof cause === "object" && "name" in cause ? String(cause.name) : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "Camera access was not allowed. Check this site's camera permission, then retry or enter the code manually";
  if (name === "NotFoundError") return "No camera is available. Connect a camera or enter the code manually";
  if (name === "NotReadableError" || name === "AbortError") return "The camera is unavailable or in use. Close other camera apps, then retry or enter the code manually";
  if (name === "OverconstrainedError") return "That camera setting is unavailable. Try the default camera or enter the code manually";
  return "The camera or barcode reader could not start. Retry or enter the code manually";
}
