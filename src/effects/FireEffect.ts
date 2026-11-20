import { between } from '../core/random';
import { flamePalette } from './color';
import type { Effect } from './Effect';
import { resolveShape } from './Effect';

/**
 * Fire: real flame tongues that rise from the typed character.
 *
 * - Two or three main tongues stand on the character, smaller ones flank them and a few detached
 *   licks break away and rise higher. Every tongue swells in, stretches upwards, leans and curls with
 *   its sway, flickers and then dies down (see ParticleEngine `flameTrack`).
 * - Each tongue has three layers: a soft outer glow, a gradient body (cool edge at the tip, hot at
 *   the base) and a white-hot core (render/flamePath.ts).
 * - Glowing embers drift up and, now and then, a spark shoots out.
 * - Typing heat (fast, sustained typing) makes the flames burn higher and throw more embers.
 *
 * Colours come from the palette sorted by brightness, so any palette keeps a bright core and darker
 * edges. A non-`auto` particle shape applies to the embers. Both variants stay above the baseline:
 * the rising variant simply starts a little higher.
 */
export const FireEffect: Effect = {
  id: 'fire',
  naturalShape: 'circle',
  spawn(emitter, params) {
    const { rng } = emitter;
    const f = params.intensityFactor;
    const heat = params.heat ?? 0;
    const speed = params.speed;
    const palette = flamePalette(params.colors);
    const emberShape = resolveShape(params.shape, this.naturalShape);
    const glow = params.glow ? 1 : 0;

    // The typed character sits just left of the caret: centre the fire there.
    const cx = -Math.max(2, params.size * 0.8);
    // The base sits on the upper half of the character and fades out at the bottom, so the character
    // stays readable through it.
    const baseY = params.variant === 'full' ? -2 : -3;
    const height = params.size * 5.2 * f * (1 + 0.55 * heat);
    const width = params.size * 1.15 * (0.9 + 0.1 * f);
    const tongues = Math.min(12, Math.max(3, Math.round(params.count * 0.33 * (1 + 0.2 * heat))));
    const spread = params.size * 1.6 * f;

    // One fire sways as a whole (like a draught), each tongue slightly out of step.
    const firePhase = rng() * Math.PI * 2;
    for (let i = 0; i < tongues; i++) {
      const main = i < (heat > 0.5 ? 3 : 2);
      const lick = !main && rng() < 0.22 + 0.15 * heat;
      const side = main ? between(rng, -0.35, 0.35) : between(rng, -1, 1);
      const scale = main
        ? between(rng, 0.9, 1.15)
        : lick
          ? between(rng, 0.3, 0.5)
          : between(rng, 0.45, 0.8);
      emitter.flame({
        x: cx + side * spread,
        y: baseY + between(rng, -1, 1),
        // Flanking tongues drift outwards a little; licks rise fast and break away.
        vx: side * between(rng, 4, 14) * speed,
        vy: -(lick ? between(rng, 45, 80) : between(rng, 6, 22)) * speed * f,
        ay: -(lick ? 30 : between(rng, 25, 60)) * speed * f,
        drag: lick ? 0.6 : 1.4,
        width: width * scale * between(rng, 0.85, 1.15),
        height: height * scale * between(rng, 0.8, 1.2),
        stretch: lick ? 0.2 : between(rng, 0.3, 0.7),
        curl: between(rng, 0.12, 0.35),
        phase: firePhase + between(rng, -0.6, 0.6),
        sway: between(rng, 0.8, 2.4) * f,
        flicker: between(rng, 0.55, 1),
        color: rng() < 0.5 ? palette.body[0] : palette.body[1],
        core: palette.core,
        edge: palette.edge,
        // Halos only on the main tongues: they carry the light, and soft layers are the costliest to paint.
        glow: main ? glow : 0,
        hotCore: scale >= 0.6,
        delay: main ? between(rng, 0, 0.06) : lick ? between(rng, 0.15, 0.4) : between(rng, 0, 0.3),
        life: main
          ? between(rng, 0.75, 1)
          : lick
            ? between(rng, 0.35, 0.55)
            : between(rng, 0.5, 0.85),
      });
    }

    const embers = Math.min(8, Math.max(1, Math.round(params.count * 0.18 * (1 + 0.5 * heat))));
    for (let i = 0; i < embers; i++) {
      emitter.particle({
        x: cx + between(rng, -0.6, 0.6) * spread,
        y: baseY - 2,
        vx: between(rng, -30, 30) * speed,
        vy: -between(rng, 50, 120) * speed * f,
        ay: -25,
        drag: 1.6,
        size: Math.max(0.7, params.size * between(rng, 0.16, 0.28)),
        sizeEnd: 0.35,
        life: between(rng, 0.5, 1),
        delay: between(rng, 0, 0.45),
        color: rng() < 0.6 ? palette.ember : palette.body[0],
        shape: emberShape,
        glow: params.glow ? 0.7 : 0,
        flicker: 0.7,
        sway: 2,
      });
    }

    // Occasional sparks: more likely when the typing is hot.
    if (rng() < 0.3 + 0.45 * heat) {
      const sparks = 1 + (rng() < heat ? 1 : 0);
      for (let i = 0; i < sparks; i++) {
        const angle = -Math.PI / 2 + between(rng, -0.7, 0.7);
        const v = between(rng, 120, 200) * speed * f;
        emitter.particle({
          x: cx,
          y: baseY - 3,
          vx: Math.cos(angle) * v,
          vy: Math.sin(angle) * v,
          ay: 60,
          drag: 2.4,
          size: Math.max(0.8, params.size * 0.3),
          sizeEnd: 0.2,
          life: between(rng, 0.3, 0.5),
          delay: between(rng, 0, 0.2),
          color: palette.ember,
          shape: 'spark',
          alignToVelocity: true,
          glow: params.glow ? 0.5 : 0,
        });
      }
    }
  },
};
