/**
 * Cabin ambience synthesised with Web Audio (FR-037): engine hum, ventilation hiss, and a soft
 * passenger murmur bed. No audio files, so nothing to license and nothing to download. Every
 * channel has its own gain and can be muted independently; a master gain sits on top.
 */
import type { FlightPhase } from "@aerofocus/core";
import type { UiPreferences } from "./prefs";

type Channel = "engine" | "ventilation" | "passengers";

interface ChannelNodes {
  gain: GainNode;
  stop: () => void;
}

export class CabinAudio {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private channels = new Map<Channel, ChannelNodes>();
  private phase: FlightPhase | null = null;
  private prefs: UiPreferences["audio"];

  constructor(prefs: UiPreferences["audio"]) {
    this.prefs = prefs;
  }

  get running(): boolean {
    return this.ctx !== null && this.ctx.state === "running";
  }

  /** Must be called from a user gesture the first time (browser autoplay policy). */
  async start(): Promise<void> {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
      this.channels.set("engine", this.engine(this.ctx, this.master));
      this.channels.set("ventilation", this.noise(this.ctx, this.master, 1800, 0.6));
      this.channels.set("passengers", this.noise(this.ctx, this.master, 400, 0.25, 2.5));
    }
    if (this.ctx.state !== "running") await this.ctx.resume();
    this.apply(this.prefs);
    this.setPhase(this.phase);
  }

  async stop(): Promise<void> {
    if (!this.ctx) return;
    for (const c of this.channels.values()) c.stop();
    this.channels.clear();
    await this.ctx.close();
    this.ctx = null;
    this.master = null;
  }

  apply(prefs: UiPreferences["audio"]): void {
    this.prefs = prefs;
    if (!this.ctx || !this.master) return;
    const t = this.ctx.currentTime;
    this.master.gain.setTargetAtTime(prefs.muted ? 0 : prefs.master, t, 0.1);
    this.channels.get("engine")?.gain.gain.setTargetAtTime(prefs.engine * this.engineLevel(), t, 0.3);
    this.channels.get("ventilation")?.gain.gain.setTargetAtTime(prefs.ventilation * 0.5, t, 0.3);
    this.channels.get("passengers")?.gain.gain.setTargetAtTime(prefs.passengers * 0.4, t, 0.3);
  }

  /** Engine note rises for takeoff and climb, settles in cruise, drops on the ground. */
  setPhase(phase: FlightPhase | null): void {
    this.phase = phase;
    if (!this.ctx) return;
    const engine = this.channels.get("engine");
    if (!engine) return;
    engine.gain.gain.setTargetAtTime(this.prefs.engine * this.engineLevel(), this.ctx.currentTime, 2);
    const osc = (engine as ChannelNodes & { osc?: OscillatorNode }).osc;
    if (osc) osc.frequency.setTargetAtTime(this.engineHz(), this.ctx.currentTime, 3);
  }

  /** Two-tone chime before announcements (FR-036). */
  chime(volume = 0.5): void {
    if (!this.ctx || !this.master || this.prefs.muted) return;
    const ctx = this.ctx;
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(this.master);
    const tones: [number, number][] = [
      [880, 0],
      [659.25, 0.35],
    ];
    for (const [hz, at] of tones) {
      const o = ctx.createOscillator();
      o.type = "sine";
      o.frequency.value = hz;
      o.connect(g);
      o.start(ctx.currentTime + at);
      o.stop(ctx.currentTime + at + 0.6);
    }
    const t = ctx.currentTime;
    g.gain.linearRampToValueAtTime(volume * 0.4, t + 0.02);
    g.gain.setTargetAtTime(0, t + 0.8, 0.15);
  }

  private engineLevel(): number {
    switch (this.phase) {
      case null:
      case "taxi_out":
      case "taxi_in":
        return 0.35;
      case "takeoff":
      case "climb":
        return 1;
      case "descent":
      case "approach":
        return 0.7;
      case "landing":
        return 0.9;
      default:
        return 0.8;
    }
  }

  private engineHz(): number {
    switch (this.phase) {
      case "takeoff":
      case "climb":
        return 120;
      case "descent":
      case "approach":
        return 80;
      case null:
      case "taxi_out":
      case "taxi_in":
        return 70;
      default:
        return 95;
    }
  }

  private engine(ctx: AudioContext, out: AudioNode): ChannelNodes & { osc: OscillatorNode } {
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const osc = ctx.createOscillator();
    osc.type = "sawtooth";
    osc.frequency.value = this.engineHz();
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = 220;
    lp.Q.value = 0.7;
    const sub = ctx.createOscillator();
    sub.type = "sine";
    sub.frequency.value = 48;
    const subGain = ctx.createGain();
    subGain.gain.value = 0.5;
    osc.connect(lp).connect(gain);
    sub.connect(subGain).connect(gain);
    // Broadband rumble under the tone.
    const rumble = this.noise(ctx, gain, 160, 0.35);
    gain.connect(out);
    osc.start();
    sub.start();
    return {
      gain,
      osc,
      stop: () => {
        osc.stop();
        sub.stop();
        rumble.stop();
      },
    };
  }

  /** Filtered noise bed: lowpass at `cutoffHz`, with a slow amplitude wobble so it breathes. */
  private noise(ctx: AudioContext, out: AudioNode, cutoffHz: number, level: number, wobbleHz = 0.1): ChannelNodes {
    const seconds = 4;
    const buffer = ctx.createBuffer(1, ctx.sampleRate * seconds, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    let b0 = 0;
    let b1 = 0;
    for (let i = 0; i < data.length; i++) {
      // Pink-ish noise via a two-pole leaky integrator.
      const white = Math.random() * 2 - 1;
      b0 = 0.98 * b0 + white * 0.04;
      b1 = 0.6 * b1 + white * 0.2;
      data[i] = (b0 * 3 + b1 + white * 0.2) * 0.6;
    }
    const src = ctx.createBufferSource();
    src.buffer = buffer;
    src.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass";
    lp.frequency.value = cutoffHz;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    const inner = ctx.createGain();
    inner.gain.value = level;
    const lfo = ctx.createOscillator();
    lfo.frequency.value = wobbleHz;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = level * 0.3;
    lfo.connect(lfoGain).connect(inner.gain);
    src.connect(lp).connect(inner).connect(gain).connect(out);
    src.start();
    lfo.start();
    return {
      gain,
      stop: () => {
        src.stop();
        lfo.stop();
      },
    };
  }
}

/** Short notification tone (break end, landing) independent of the cabin bed. */
export function playAlert(kind: "break" | "landing" | "boarding", volume = 0.6): void {
  try {
    const Ctx = window.AudioContext;
    if (!Ctx) return;
    const ctx = new Ctx();
    const g = ctx.createGain();
    g.gain.value = 0;
    g.connect(ctx.destination);
    const notes = kind === "landing" ? [523.25, 659.25, 783.99] : kind === "boarding" ? [659.25, 523.25] : [783.99, 659.25];
    notes.forEach((hz, i) => {
      const o = ctx.createOscillator();
      o.type = "triangle";
      o.frequency.value = hz;
      o.connect(g);
      o.start(ctx.currentTime + i * 0.28);
      o.stop(ctx.currentTime + i * 0.28 + 0.5);
    });
    g.gain.linearRampToValueAtTime(volume * 0.5, ctx.currentTime + 0.03);
    g.gain.setTargetAtTime(0, ctx.currentTime + notes.length * 0.28 + 0.2, 0.2);
    setTimeout(() => ctx.close().catch(() => undefined), notes.length * 400 + 1200);
  } catch {
    /* audio unavailable */
  }
}

/** Spoken announcement through the browser's own voices (FR-038); captions are always shown. */
export function speak(text: string, volume = 0.8): void {
  try {
    if (!("speechSynthesis" in window)) return;
    const u = new SpeechSynthesisUtterance(text);
    u.rate = 0.95;
    u.pitch = 1;
    u.volume = volume;
    window.speechSynthesis.speak(u);
  } catch {
    /* unsupported */
  }
}
