/** Optional rear-camera backdrop. Never recorded, never uploaded, no audio. */
export class CameraBackdrop {
  private stream: MediaStream | null = null;
  status: 'off' | 'requesting' | 'on' | 'denied' | 'unsupported' = 'off';
  private video: HTMLVideoElement;

  constructor(video: HTMLVideoElement) {
    this.video = video;
  }

  get supported(): boolean {
    return !!navigator.mediaDevices?.getUserMedia;
  }

  async start(): Promise<boolean> {
    if (!this.supported) {
      this.status = 'unsupported';
      return false;
    }
    if (this.stream) return true;
    this.status = 'requesting';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: 'environment', width: { ideal: 1280 }, height: { ideal: 720 } },
        audio: false,
      });
      this.video.srcObject = this.stream;
      await this.video.play().catch(() => undefined);
      this.status = 'on';
      return true;
    } catch {
      this.status = 'denied';
      return false;
    }
  }

  stop(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    this.video.srcObject = null;
    if (this.status === 'on' || this.status === 'requesting') this.status = 'off';
  }
}
