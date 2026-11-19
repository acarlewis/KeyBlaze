/**
 * Simulates bursts into keyframed tracks. Pure TypeScript with no `vscode` import.
 *
 * Effects describe *what* to spawn through the `Emitter`. The engine owns physics, lifetimes,
 * limits and keyframe sampling. The mutable simulation state is pooled and reused between bursts
 * to avoid garbage on every keystroke.
 */
import type {
  BoltElement,
  BurstElement,
  BurstTrack,
  Frame,
  ParticleElement,
  RingElement,
  ShapeKind,
} from './BurstTrack';
import type { Random } from './random';

export interface ParticleInit {
  x?: number;
  y?: number;
  /** Initial velocity in px/s. */
  vx: number;
  vy: number;
  /** Constant acceleration in px/s² (gravity is +ay, buoyancy -ay). */
  ax?: number;
  ay?: number;
  /** Exponential velocity damping per second (0 = none). */
  drag?: number;
  /** Base radius in px. */
  size: number;
  /** Size multiplier at end of life (default 0.2). */
  sizeEnd?: number;
  /** Lifetime as a fraction of the burst duration, (0, 1]. */
  life?: number;
  /** Start delay as a fraction of the burst duration, [0, 1). */
  delay?: number;
  color: string;
  shape: ShapeKind;
  glow?: number;
  /** Initial rotation (deg) and spin (deg/s). */
  rotation?: number;
  spin?: number;
  /** Rotate to face the direction of travel (used for sparks/streaks). */
  alignToVelocity?: boolean;
  /** Random opacity flicker amount, 0–1. */
  flicker?: number;
  /** Fade in over the first part of life instead of starting at full opacity. */
  fadeIn?: boolean;
  /** Sideways sinusoidal sway amplitude in px (used for flames). */
  sway?: number;
}

export interface RingInit {
  x?: number;
  y?: number;
  radiusFrom: number;
  radiusTo: number;
  strokeWidth: number;
  color: string;
  glow?: number;
  delay?: number;
  life?: number;
}

export interface BoltInit {
  /** Flat x,y pairs relative to (x, y). */
  points: number[];
  x?: number;
  y?: number;
  width: number;
  color: string;
  glow?: number;
  delay?: number;
  life?: number;
  /** How strongly the bolt flickers, 0–1. */
  flicker?: number;
}

export interface Emitter {
  readonly rng: Random;
  particle(init: ParticleInit): void;
  ring(init: RingInit): void;
  bolt(init: BoltInit): void;
}

export interface SimulationOptions {
  readonly durationMs: number;
  /** Number of keyframes (≥ 2). */
  readonly keyframes: number;
  /** Hard cap on elements per burst. Extra spawns are dropped. */
  readonly maxElements: number;
  /** Bursts are clipped to this half-extent (px) so images stay small. */
  readonly maxHalfExtent: number;
  readonly rng: Random;
  /** Physics sub-steps between keyframes. */
  readonly substeps?: number;
}

/** Mutable per-particle simulation state, pooled. */
class ParticleState {
  x = 0;
  y = 0;
  vx = 0;
  vy = 0;
  ax = 0;
  ay = 0;
  drag = 0;
  init!: ParticleInit;

  reset(init: ParticleInit): this {
    this.init = init;
    this.x = init.x ?? 0;
    this.y = init.y ?? 0;
    this.vx = init.vx;
    this.vy = init.vy;
    this.ax = init.ax ?? 0;
    this.ay = init.ay ?? 0;
    this.drag = init.drag ?? 0;
    return this;
  }
}

export class ParticleEngine {
  private readonly pool: ParticleState[] = [];
  private createdStates = 0;

  constructor(private readonly poolCapacity = 512) {}

  /** Number of pooled simulation objects ever created (for tests: proves reuse). */
  get statesCreated(): number {
    return this.createdStates;
  }

  get pooledStates(): number {
    return this.pool.length;
  }

  simulate(spawn: (emitter: Emitter) => void, options: SimulationOptions): BurstTrack {
    const keyframes = Math.max(2, Math.floor(options.keyframes));
    const particles: ParticleInit[] = [];
    const rings: RingInit[] = [];
    const bolts: BoltInit[] = [];
    let total = 0;
    const accept = (): boolean => total++ < options.maxElements;

    spawn({
      rng: options.rng,
      particle: (p) => {
        if (accept()) particles.push(p);
      },
      ring: (r) => {
        if (accept()) rings.push(r);
      },
      bolt: (b) => {
        if (accept()) bolts.push(b);
      },
    });

    const elements: BurstElement[] = [
      ...this.simulateParticles(particles, keyframes, options),
      ...rings.map((r) => ringTrack(r, keyframes)),
      ...bolts.map((b) => boltTrack(b, keyframes, options.rng)),
    ];

    const { halfWidth, halfHeight } = measure(elements, options.maxHalfExtent);
    return { durationMs: options.durationMs, keyframes, halfWidth, halfHeight, elements };
  }

  private acquire(init: ParticleInit): ParticleState {
    const state = this.pool.pop();
    if (state) return state.reset(init);
    this.createdStates++;
    return new ParticleState().reset(init);
  }

  private release(states: ParticleState[]): void {
    for (const s of states) if (this.pool.length < this.poolCapacity) this.pool.push(s);
  }

  private simulateParticles(
    inits: ParticleInit[],
    keyframes: number,
    options: SimulationOptions,
  ): ParticleElement[] {
    if (inits.length === 0) return [];
    const substeps = Math.max(1, options.substeps ?? 4);
    const seconds = options.durationMs / 1000;
    const dt = seconds / ((keyframes - 1) * substeps);
    const states = inits.map((init) => this.acquire(init));
    const frames: Frame[][] = inits.map(() => []);
    // Per-particle random phase for sway/flicker, drawn up front so results are deterministic.
    const phases = inits.map(() => options.rng() * Math.PI * 2);
    const flickerNoise = inits.map(() => Array.from({ length: keyframes }, () => options.rng()));

    for (let k = 0; k < keyframes; k++) {
      const t = k / (keyframes - 1);
      if (k > 0) {
        for (let step = 0; step < substeps; step++) {
          const now = ((k - 1) * substeps + step) * dt;
          for (const s of states) integrate(s, dt, now / seconds);
        }
      }
      for (let i = 0; i < states.length; i++) {
        const s = states[i] as ParticleState;
        const init = s.init;
        frames[i]?.push(
          particleFrame(s, init, t, seconds, phases[i] ?? 0, flickerNoise[i]?.[k] ?? 0),
        );
      }
    }

    const out = inits.map((init, i): ParticleElement => ({
      kind: 'particle',
      shape: init.shape,
      size: init.size,
      color: init.color,
      glow: init.glow ?? 0,
      frames: frames[i] ?? [],
    }));
    this.release(states);
    return out;
  }
}

function integrate(s: ParticleState, dt: number, burstT: number): void {
  const delay = s.init.delay ?? 0;
  if (burstT < delay) return;
  s.vx += s.ax * dt;
  s.vy += s.ay * dt;
  if (s.drag > 0) {
    const damp = Math.exp(-s.drag * dt);
    s.vx *= damp;
    s.vy *= damp;
  }
  s.x += s.vx * dt;
  s.y += s.vy * dt;
}

/** Normalised local life position for an element: <0 not born, >1 dead. */
export function localLife(t: number, delay = 0, life = 1): number {
  const span = Math.max(1e-6, Math.min(life, 1 - delay));
  return (t - delay) / span;
}

function particleFrame(
  s: ParticleState,
  init: ParticleInit,
  t: number,
  seconds: number,
  phase: number,
  noise: number,
): Frame {
  const local = localLife(t, init.delay, init.life);
  const alive = local >= 0 && local <= 1;
  const clamped = Math.min(1, Math.max(0, local));
  const sizeEnd = init.sizeEnd ?? 0.2;
  let opacity = 0;
  if (alive) {
    opacity = init.fadeIn ? Math.min(1, clamped / 0.15) * (1 - clamped) ** 1.1 : 1 - clamped ** 2; // stays bright, then fades quickly
    if (init.flicker) opacity *= 1 - init.flicker * noise;
  }
  const ageSeconds = Math.max(0, t - (init.delay ?? 0)) * seconds;
  const sway = init.sway ? Math.sin(phase + ageSeconds * 9) * init.sway * clamped : 0;
  let rotation = (init.rotation ?? 0) + (init.spin ?? 0) * ageSeconds;
  if (init.alignToVelocity && (s.vx !== 0 || s.vy !== 0))
    rotation = (Math.atan2(s.vy, s.vx) * 180) / Math.PI;
  return {
    x: s.x + sway,
    y: s.y,
    s: alive || local > 1 ? 1 + (sizeEnd - 1) * clamped : 1,
    o: opacity,
    r: rotation,
  };
}

function ringTrack(init: RingInit, keyframes: number): RingElement {
  const frames: Frame[] = [];
  for (let k = 0; k < keyframes; k++) {
    const local = localLife(k / (keyframes - 1), init.delay, init.life);
    const c = Math.min(1, Math.max(0, local));
    const eased = 1 - (1 - c) ** 3; // ease-out cubic
    frames.push({
      x: init.x ?? 0,
      y: init.y ?? 0,
      s: init.radiusFrom + (init.radiusTo - init.radiusFrom) * eased,
      o: local >= 0 && local <= 1 ? (1 - c) ** 1.5 : 0,
      r: 0,
    });
  }
  return {
    kind: 'ring',
    color: init.color,
    glow: init.glow ?? 0,
    strokeWidth: init.strokeWidth,
    frames,
  };
}

function boltTrack(init: BoltInit, keyframes: number, rng: Random): BoltElement {
  const frames: Frame[] = [];
  const flicker = init.flicker ?? 0.5;
  for (let k = 0; k < keyframes; k++) {
    const local = localLife(k / (keyframes - 1), init.delay, init.life);
    const alive = local >= 0 && local <= 1;
    const c = Math.min(1, Math.max(0, local));
    const flash = 1 - flicker * rng();
    frames.push({ x: init.x ?? 0, y: init.y ?? 0, s: 1, o: alive ? flash * (1 - c) : 0, r: 0 });
  }
  return {
    kind: 'bolt',
    color: init.color,
    glow: init.glow ?? 0,
    width: init.width,
    points: init.points,
    frames,
  };
}

/** Bounding half-extents over all frames, clamped to `max`. Always at least 4px. */
export function measure(
  elements: readonly BurstElement[],
  max: number,
): { halfWidth: number; halfHeight: number } {
  let hw = 4;
  let hh = 4;
  for (const el of elements) {
    for (const f of el.frames) {
      if (f.o <= 0) continue;
      let ex: number;
      let ey: number;
      if (el.kind === 'particle') {
        const r = el.size * f.s * (el.glow > 0 ? 2.5 : 1) + 1;
        ex = Math.abs(f.x) + r;
        ey = Math.abs(f.y) + r;
      } else if (el.kind === 'ring') {
        const r = f.s + el.strokeWidth * (el.glow > 0 ? 3 : 1);
        ex = Math.abs(f.x) + r;
        ey = Math.abs(f.y) + r;
      } else {
        let px = 0;
        let py = 0;
        for (let i = 0; i + 1 < el.points.length; i += 2) {
          px = Math.max(px, Math.abs((el.points[i] ?? 0) * f.s));
          py = Math.max(py, Math.abs((el.points[i + 1] ?? 0) * f.s));
        }
        const pad = el.width * (el.glow > 0 ? 3 : 1);
        ex = Math.abs(f.x) + px + pad;
        ey = Math.abs(f.y) + py + pad;
      }
      hw = Math.max(hw, ex);
      hh = Math.max(hh, ey);
    }
  }
  return { halfWidth: Math.ceil(Math.min(max, hw)), halfHeight: Math.ceil(Math.min(max, hh)) };
}
