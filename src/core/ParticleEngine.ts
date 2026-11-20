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
  FlameElement,
  FlameShape,
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
  /** Centre velocity in px/s (rings can drift, e.g. rise). */
  vx?: number;
  vy?: number;
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

export interface FlameInit {
  /** Base centre (px from the origin). */
  x?: number;
  y?: number;
  /** Velocity (px/s), buoyancy (`ay` < 0 rises) and damping, as for particles. */
  vx?: number;
  vy?: number;
  ay?: number;
  drag?: number;
  /** Half width and height at full size, px. */
  width: number;
  height: number;
  /** How much the tongue lengthens over its life (0.5 = 50 % taller before it dies down). */
  stretch?: number;
  /** Lean amplitude as a fraction of the height (sway of the tip). */
  curl?: number;
  /** Sideways sway of the whole tongue, px. */
  sway?: number;
  /** Sway phase in radians. Tongues of one fire share a phase, so they sway together. Random if absent. */
  phase?: number;
  /** Shape and brightness flicker, 0–1. */
  flicker?: number;
  /** Body, hot core and cool edge colours. */
  color: string;
  core: string;
  edge: string;
  /** Draw the white-hot core layer (default true). */
  hotCore?: boolean;
  glow?: number;
  delay?: number;
  life?: number;
}

export interface Emitter {
  readonly rng: Random;
  particle(init: ParticleInit): void;
  ring(init: RingInit): void;
  bolt(init: BoltInit): void;
  flame(init: FlameInit): void;
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
    const flames: FlameInit[] = [];
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
      flame: (f) => {
        if (accept()) flames.push(f);
      },
    });

    const substeps = Math.max(1, options.substeps ?? 4);
    const elements: BurstElement[] = [
      // Flames first: later elements (embers, sparks) are drawn on top of them.
      ...flames.map((f) =>
        flameTrack(f, keyframes, substeps, options.durationMs / 1000, options.rng),
      ),
      ...this.simulateParticles(particles, keyframes, options),
      ...rings.map((r) => ringTrack(r, keyframes, options.durationMs / 1000)),
      ...bolts.map((b) => boltTrack(b, keyframes, options.rng)),
    ];

    const { halfWidth, up, down } = measure(elements, options.maxHalfExtent);
    return { durationMs: options.durationMs, keyframes, halfWidth, up, down, elements };
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

function ringTrack(init: RingInit, keyframes: number, seconds: number): RingElement {
  const frames: Frame[] = [];
  for (let k = 0; k < keyframes; k++) {
    const local = localLife(k / (keyframes - 1), init.delay, init.life);
    const c = Math.min(1, Math.max(0, local));
    const eased = 1 - (1 - c) ** 3; // ease-out cubic
    const age = Math.max(0, k / (keyframes - 1) - (init.delay ?? 0)) * seconds;
    frames.push({
      x: (init.x ?? 0) + (init.vx ?? 0) * age,
      y: (init.y ?? 0) + (init.vy ?? 0) * age,
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

/**
 * A flame tongue: buoyant motion like a particle, plus an outline per keyframe that swells in,
 * stretches upwards, leans and curls with the sway, flickers, then narrows and dies down.
 */
function flameTrack(
  init: FlameInit,
  keyframes: number,
  substeps: number,
  seconds: number,
  rng: Random,
): FlameElement {
  const randomPhase = rng() * Math.PI * 2;
  const phase = init.phase ?? randomPhase;
  // Slow enough that the tip sways and curls instead of flapping between keyframes.
  const swayHz = 1.6 + rng() * 1.6;
  const flicker = init.flicker ?? 0.6;
  const stretch = init.stretch ?? 0.5;
  const curl = init.curl ?? 0.25;
  const delay = init.delay ?? 0;
  let x = init.x ?? 0;
  let y = init.y ?? 0;
  let vx = init.vx ?? 0;
  let vy = init.vy ?? 0;
  const ay = init.ay ?? 0;
  const damp = init.drag ?? 0;
  const dt = seconds / ((keyframes - 1) * substeps);
  const frames: Frame[] = [];
  const shapes: FlameShape[] = [];
  for (let k = 0; k < keyframes; k++) {
    const t = k / (keyframes - 1);
    if (k > 0) {
      for (let step = 0; step < substeps; step++) {
        const now = ((k - 1) * substeps + step) * dt;
        if (now / seconds < delay) continue;
        vy += ay * dt;
        if (damp > 0) {
          const d = Math.exp(-damp * dt);
          vx *= d;
          vy *= d;
        }
        x += vx * dt;
        y += vy * dt;
      }
    }
    const local = localLife(t, delay, init.life);
    const alive = local >= 0 && local <= 1;
    const c = Math.min(1, Math.max(0, local));
    const n1 = rng();
    const n2 = rng();
    const n3 = rng();
    const age = Math.max(0, t - delay) * seconds;
    // Swell in quickly (ease-out), then narrow and finally collapse.
    const grow = 0.3 + 0.7 * (1 - (1 - Math.min(1, c / 0.2)) ** 2);
    const wf = grow * (1 - 0.62 * c ** 1.6) * (1 + flicker * (n1 - 0.5) * 0.3);
    const hf = grow * (1 + stretch * c) * (1 - 0.55 * c ** 2.4) * (1 + flicker * (n2 - 0.5) * 0.45);
    const swing = Math.sin(phase + age * swayHz * Math.PI * 2 * 0.5);
    const lean = Math.max(-0.6, Math.min(0.6, curl * swing + flicker * (n3 - 0.5) * 0.12));
    let opacity = 0;
    if (alive) {
      opacity = Math.min(1, c / 0.1) * (c < 0.5 ? 1 : (1 - (c - 0.5) / 0.5) ** 1.3);
      opacity *= 1 - flicker * 0.18 * n1;
    }
    frames.push({ x: x + (init.sway ?? 0) * swing * (0.4 + c), y, s: 1, o: opacity, r: 0 });
    shapes.push({
      w: init.width * Math.max(0.05, wf),
      h: init.height * Math.max(0.1, hf),
      lean,
      wobble: (n3 - 0.5) * 2 * flicker,
    });
  }
  return {
    kind: 'flame',
    color: init.color,
    core: init.core,
    edge: init.edge,
    hotCore: init.hotCore ?? true,
    glow: init.glow ?? 0,
    frames,
    shapes,
  };
}

/**
 * Extents over all visible frames, each clamped to `max` and at least 4px:
 * `halfWidth` (symmetric horizontally, so the origin stays centred on the caret), `up` and `down`.
 */
export function measure(
  elements: readonly BurstElement[],
  max: number,
): { halfWidth: number; up: number; down: number } {
  let hw = 4;
  let up = 4;
  let down = 4;
  const grow = (x: number, y: number, r: number): void => {
    hw = Math.max(hw, Math.abs(x) + r);
    up = Math.max(up, -y + r);
    down = Math.max(down, y + r);
  };
  for (const el of elements) {
    for (const f of el.frames) {
      if (f.o <= 0) continue;
      if (el.kind === 'particle') {
        grow(f.x, f.y, el.size * f.s * (el.glow > 0 ? 2.5 : 1) + 1);
      } else if (el.kind === 'ring') {
        grow(f.x, f.y, f.s + el.strokeWidth * (el.glow > 0 ? 3 : 1));
      } else if (el.kind === 'flame') {
        // Conservative box of the outline and its glow ellipse (render/flamePath.ts flameExtents).
        const shape = el.shapes[el.frames.indexOf(f)];
        if (!shape) continue;
        const glow = el.glow > 0;
        const half = Math.max(
          Math.abs(shape.lean * shape.h) + shape.w * 1.25,
          glow ? shape.w * 1.55 : 0,
        );
        hw = Math.max(hw, Math.abs(f.x) + half + 1);
        up = Math.max(up, -f.y + shape.h * (glow ? 1.02 : 1) + 1);
        down = Math.max(down, f.y + Math.max(shape.w * 0.65, glow ? shape.h * 0.22 : 0) + 1);
      } else {
        const pad = el.width * (el.glow > 0 ? 3 : 1);
        for (let i = 0; i + 1 < el.points.length; i += 2) {
          grow(f.x + (el.points[i] ?? 0) * f.s, f.y + (el.points[i + 1] ?? 0) * f.s, pad);
        }
      }
    }
  }
  const c = (v: number): number => Math.ceil(Math.min(max, v));
  return { halfWidth: c(hw), up: c(up), down: c(down) };
}
