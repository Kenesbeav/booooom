import { TIMELINE, type ExperienceConfig } from './config';

type AudioKey = keyof ExperienceConfig['assets']['audio'];

export class CinematicAudio {
  private context: AudioContext | null = null;
  private master: GainNode | null = null;
  private muted = false;
  private sources: AudioScheduledSourceNode[] = [];
  private readonly externalBuffers = new Map<AudioKey, AudioBuffer>();

  constructor(private readonly config: ExperienceConfig) {}

  async preload(onProgress?: (progress: number) => void) {
    const entries = Object.entries(this.config.assets.audio).filter((entry): entry is [AudioKey, string] => Boolean(entry[1]));
    if (entries.length === 0) {
      onProgress?.(1);
      return;
    }

    const context = this.ensureContext();
    let loaded = 0;
    await Promise.all(entries.map(async ([key, path]) => {
      try {
        const response = await fetch(path);
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const arrayBuffer = await response.arrayBuffer();
        const buffer = await context.decodeAudioData(arrayBuffer);
        this.externalBuffers.set(key, buffer);
      } catch (error) {
        console.warn(`Не удалось загрузить аудио ${path}, используется синтезированный звук.`, error);
      }
      loaded += 1;
      onProgress?.(loaded / entries.length);
    }));
  }

  async start() {
    const context = this.ensureContext();
    if (context.state === 'suspended') await context.resume();
    this.stopSources();
    const now = context.currentTime + 0.04;
    this.scheduleWind(now);
    this.scheduleAwakening(now);
    this.scheduleAircraft(now + TIMELINE.planeStart);
    this.scheduleBomb(now + TIMELINE.bombRelease);
    this.scheduleExplosion(now + TIMELINE.impact);
    this.scheduleShockwave(now + TIMELINE.shockHit);
    this.scheduleFinale(now + TIMELINE.finale + 0.05);
  }

  stop() {
    this.stopSources();
  }

  setMuted(muted: boolean) {
    this.muted = muted;
    if (!this.context || !this.master) return;
    this.master.gain.cancelScheduledValues(this.context.currentTime);
    this.master.gain.setTargetAtTime(muted ? 0 : 0.82, this.context.currentTime, 0.035);
  }

  private ensureContext() {
    if (this.context && this.master) return this.context;
    this.context = new AudioContext();
    this.master = this.context.createGain();
    this.master.gain.value = this.muted ? 0 : 0.82;
    const compressor = this.context.createDynamicsCompressor();
    compressor.threshold.value = -14;
    compressor.knee.value = 8;
    compressor.ratio.value = 7;
    compressor.attack.value = 0.004;
    compressor.release.value = 0.3;
    this.master.connect(compressor).connect(this.context.destination);
    return this.context;
  }

  private stopSources() {
    this.sources.forEach((source) => {
      try { source.stop(); } catch { /* Источник уже остановлен. */ }
      source.disconnect();
    });
    this.sources = [];
  }

  private track<T extends AudioScheduledSourceNode>(node: T) {
    this.sources.push(node);
    return node;
  }

  private playExternal(key: AudioKey, when: number, gainValue: number, loop = false) {
    if (!this.context || !this.master) return false;
    const buffer = this.externalBuffers.get(key);
    if (!buffer) return false;
    const source = this.track(this.context.createBufferSource());
    const gain = this.context.createGain();
    source.buffer = buffer;
    source.loop = loop;
    gain.gain.value = gainValue;
    source.connect(gain).connect(this.master);
    source.start(when);
    if (!loop) source.stop(when + buffer.duration + 0.1);
    return true;
  }

  private createNoise(seconds: number) {
    const context = this.ensureContext();
    const length = Math.ceil(context.sampleRate * seconds);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const data = buffer.getChannelData(channel);
      let last = 0;
      for (let index = 0; index < length; index += 1) {
        const white = Math.random() * 2 - 1;
        last = last * 0.93 + white * 0.07;
        data[index] = last * 2.2;
      }
    }
    return buffer;
  }

  private scheduleWind(when: number) {
    if (!this.context || !this.master || this.playExternal('wind', when, 0.34, true)) return;
    const source = this.track(this.context.createBufferSource());
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    source.buffer = this.createNoise(4);
    source.loop = true;
    filter.type = 'bandpass';
    filter.frequency.value = 420;
    filter.Q.value = 0.34;
    gain.gain.setValueAtTime(0.055, when);
    gain.gain.linearRampToValueAtTime(0.12, when + 3.2);
    gain.gain.setValueAtTime(0.12, when + TIMELINE.shockHit - 0.6);
    gain.gain.linearRampToValueAtTime(0.43, when + TIMELINE.smokeArrival + 0.9);
    gain.gain.exponentialRampToValueAtTime(0.008, when + TIMELINE.finale + 0.1);
    panner.pan.setValueAtTime(-0.22, when);
    panner.pan.linearRampToValueAtTime(0.3, when + 13);
    panner.pan.linearRampToValueAtTime(-0.1, when + TIMELINE.finale - 0.3);
    source.connect(filter).connect(panner).connect(gain).connect(this.master);
    source.start(when);
    source.stop(when + TIMELINE.finale + 0.5);
  }

  private scheduleAwakening(when: number) {
    if (!this.context || !this.master) return;
    for (const offset of [0.5, 1.32, 2.28, 3.03]) {
      const oscillator = this.track(this.context.createOscillator());
      const gain = this.context.createGain();
      oscillator.type = 'sine';
      oscillator.frequency.setValueAtTime(44, when + offset);
      oscillator.frequency.exponentialRampToValueAtTime(35, when + offset + 0.28);
      gain.gain.setValueAtTime(0.0001, when + offset);
      gain.gain.exponentialRampToValueAtTime(0.11, when + offset + 0.035);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + offset + 0.42);
      oscillator.connect(gain).connect(this.master);
      oscillator.start(when + offset);
      oscillator.stop(when + offset + 0.45);
    }
  }

  private scheduleAircraft(when: number) {
    if (!this.context || !this.master || this.playExternal('aircraft', when, 0.65)) return;
    const gain = this.context.createGain();
    const filter = this.context.createBiquadFilter();
    const panner = this.context.createStereoPanner();
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.24, when + 2.4);
    gain.gain.setValueAtTime(0.23, when + 5.3);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 9.4);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(280, when);
    filter.frequency.linearRampToValueAtTime(720, when + 4.1);
    filter.frequency.exponentialRampToValueAtTime(190, when + 9.3);
    panner.pan.setValueAtTime(0.95, when);
    panner.pan.linearRampToValueAtTime(-0.95, when + 8.8);
    panner.connect(gain).connect(this.master);
    for (const [type, frequency, amount] of [['sawtooth', 47, 0.12], ['triangle', 93, 0.17], ['sine', 138, 0.08]] as const) {
      const oscillator = this.track(this.context.createOscillator());
      const voiceGain = this.context.createGain();
      oscillator.type = type;
      oscillator.frequency.setValueAtTime(frequency, when);
      oscillator.frequency.linearRampToValueAtTime(frequency * 1.12, when + 4.2);
      oscillator.frequency.linearRampToValueAtTime(frequency * 0.92, when + 9.2);
      voiceGain.gain.value = amount;
      oscillator.connect(voiceGain).connect(filter).connect(panner);
      oscillator.start(when);
      oscillator.stop(when + 9.5);
    }
  }

  private scheduleBomb(when: number) {
    if (!this.context || !this.master) return;
    const duration = TIMELINE.impact - TIMELINE.bombRelease;
    const oscillator = this.track(this.context.createOscillator());
    const gain = this.context.createGain();
    const panner = this.context.createStereoPanner();
    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(1080, when);
    oscillator.frequency.exponentialRampToValueAtTime(185, when + duration - 0.04);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(0.13, when + 0.28);
    gain.gain.linearRampToValueAtTime(0.22, when + duration - 0.2);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    panner.pan.setValueAtTime(0.18, when);
    panner.pan.linearRampToValueAtTime(-0.18, when + duration);
    oscillator.connect(panner).connect(gain).connect(this.master);
    oscillator.start(when);
    oscillator.stop(when + duration + 0.02);
  }

  private scheduleExplosion(when: number) {
    if (!this.context || !this.master) return;
    if (!this.playExternal('explosion', when, 0.92)) {
      const source = this.track(this.context.createBufferSource());
      const filter = this.context.createBiquadFilter();
      const gain = this.context.createGain();
      source.buffer = this.createNoise(3.8);
      filter.type = 'lowpass';
      filter.frequency.setValueAtTime(3100, when);
      filter.frequency.exponentialRampToValueAtTime(95, when + 3.6);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.linearRampToValueAtTime(0.86, when + 0.035);
      gain.gain.exponentialRampToValueAtTime(0.013, when + 3.65);
      source.connect(filter).connect(gain).connect(this.master);
      source.start(when);
      source.stop(when + 3.8);
    }

    const sub = this.track(this.context.createOscillator());
    const subGain = this.context.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(53, when);
    sub.frequency.exponentialRampToValueAtTime(21, when + 3.35);
    subGain.gain.setValueAtTime(0.0001, when);
    subGain.gain.exponentialRampToValueAtTime(0.72, when + 0.03);
    subGain.gain.exponentialRampToValueAtTime(0.0001, when + 3.5);
    sub.connect(subGain).connect(this.master);
    sub.start(when);
    sub.stop(when + 3.55);
  }

  private scheduleShockwave(when: number) {
    if (!this.context || !this.master) return;
    const source = this.track(this.context.createBufferSource());
    const filter = this.context.createBiquadFilter();
    const gain = this.context.createGain();
    source.buffer = this.createNoise(2.2);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(780, when);
    filter.frequency.exponentialRampToValueAtTime(58, when + 2);
    gain.gain.setValueAtTime(0.9, when);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + 2.1);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(when);
    source.stop(when + 2.2);
  }

  private scheduleFinale(when: number) {
    if (!this.context || !this.master || this.playExternal('finale', when, 0.7)) return;
    const notes = [146.83, 220, 293.66, 369.99, 440, 587.33, 739.99];
    notes.forEach((frequency, index) => {
      const start = when + index * 0.11;
      const oscillator = this.track(this.context!.createOscillator());
      const gain = this.context!.createGain();
      const panner = this.context!.createStereoPanner();
      oscillator.type = index < 3 ? 'triangle' : 'sine';
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.085, start + 0.06);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 2.6);
      panner.pan.value = -0.5 + (index / notes.length);
      oscillator.connect(panner).connect(gain).connect(this.master!);
      oscillator.start(start);
      oscillator.stop(start + 2.7);
    });
  }
}
