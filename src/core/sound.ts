/**
 * Sound design: original, synthesised sounds (WebAudio oscillators and filtered noise). There are no
 * recorded assets, so there are no licensing concerns. Pure data: the webview plays these recipes.
 */
import type { SoundTheme } from '../config/schema';

export type SoundKind = 'key' | 'milestone';

export interface ToneStep {
  /** Oscillator type, or 'noise' for a filtered noise burst. */
  readonly wave: OscillatorKind | 'noise';
  /** Start / end frequency in Hz (for noise: band-pass centre). */
  readonly from: number;
  readonly to: number;
  /** Offset from the start of the sound, ms. */
  readonly atMs: number;
  readonly durationMs: number;
  /** Peak gain before master volume, 0–1. */
  readonly gain: number;
}

export type OscillatorKind = 'sine' | 'square' | 'sawtooth' | 'triangle';

const NOTE = (semitonesFromA4: number): number => 440 * 2 ** (semitonesFromA4 / 12);

/** Recipe for one sound. `tier` (0-based milestone tier) raises milestone sounds in pitch and length. */
export function soundRecipe(theme: SoundTheme, kind: SoundKind, tier = 0): ToneStep[] {
  const lift = Math.min(tier, 4) * 2; // +2 semitones per tier
  if (kind === 'key') {
    switch (theme) {
      case 'soft':
        return [{ wave: 'sine', from: 880, to: 660, atMs: 0, durationMs: 45, gain: 0.25 }];
      case 'mechanical':
        return [
          { wave: 'noise', from: 3200, to: 3200, atMs: 0, durationMs: 14, gain: 0.35 },
          { wave: 'sine', from: 140, to: 90, atMs: 0, durationMs: 28, gain: 0.25 },
        ];
      case 'arcade':
        return [{ wave: 'square', from: 1200, to: 1800, atMs: 0, durationMs: 32, gain: 0.12 }];
      case 'chime':
        return [{ wave: 'triangle', from: 1568, to: 1568, atMs: 0, durationMs: 90, gain: 0.2 }];
    }
  }
  // Milestone: a short rising arpeggio (major triad), longer for higher tiers.
  const triad = [0, 4, 7, 12].slice(0, 3 + Math.min(1, tier));
  const base = 3 + lift; // C5 + lift
  const step = theme === 'arcade' ? 55 : 80;
  const wave: OscillatorKind =
    theme === 'arcade' ? 'square' : theme === 'chime' ? 'triangle' : 'sine';
  const notes: ToneStep[] = triad.map((semi, i) => {
    const f = NOTE(base + semi);
    return {
      wave,
      from: f,
      to: f,
      atMs: i * step,
      durationMs: theme === 'chime' ? 420 : 220,
      gain: theme === 'arcade' ? 0.12 : 0.22,
    };
  });
  if (theme === 'mechanical') {
    notes.unshift({ wave: 'noise', from: 2400, to: 2400, atMs: 0, durationMs: 20, gain: 0.3 });
  }
  return notes;
}

/** Minimum gap between keystroke sounds, so fast typing never becomes a buzz. */
export const KEY_SOUND_MIN_GAP_MS = 45;
