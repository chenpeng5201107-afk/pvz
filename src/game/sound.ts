export class Sound {
  enabled = localStorage.getItem('fg:sound') !== 'off';
  private context: AudioContext | null = null;
  private lastShot = 0;
  async unlock(): Promise<void> {
    if (!this.enabled) return;
    this.context ??= new AudioContext();
    if (this.context.state === 'suspended') await this.context.resume();
  }
  toggle(): boolean {
    this.enabled = !this.enabled;
    localStorage.setItem('fg:sound', this.enabled ? 'on' : 'off');
    if (this.enabled) void this.unlock();
    return this.enabled;
  }
  play(kind: string): void {
    if (!this.enabled || !this.context || this.context.state !== 'running') return;
    const now = this.context.currentTime;
    if (kind === 'shot' && now - this.lastShot < 0.08) return;
    if (kind === 'shot') this.lastShot = now;
    const notes: Record<string, [number, number, number]> = {
      shot: [510, 280, 0.07],
      place: [330, 660, 0.13],
      kill: [660, 990, 0.2],
      transform: [420, 840, 0.18],
      explosion: [130, 35, 0.4],
      invalid: [170, 120, 0.16],
      leak: [170, 90, 0.3],
      wave: [440, 660, 0.3],
      won: [523, 1046, 0.45],
      lost: [220, 110, 0.5],
    };
    const note = notes[kind];
    if (!note) return;
    const oscillator = this.context.createOscillator(),
      gain = this.context.createGain();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(note[0], now);
    oscillator.frequency.exponentialRampToValueAtTime(note[1], now + note[2]);
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(kind === 'shot' ? 0.022 : 0.065, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + note[2]);
    oscillator.connect(gain);
    gain.connect(this.context.destination);
    oscillator.start(now);
    oscillator.stop(now + note[2] + 0.02);
  }
}
