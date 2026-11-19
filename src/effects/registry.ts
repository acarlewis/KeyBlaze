import type { EffectId } from '../config/schema';
import type { Effect } from './Effect';
import { ParticleBurst } from './ParticleBurst';

/**
 * Effect lookup. Phase 3 ships the engine with ParticleBurst. The remaining effects are added in
 * Phase 4. Until then `getEffect` reports the fallback through `isImplemented` so the UI never
 * claims an effect it doesn't have.
 */
const EFFECTS: Partial<Record<EffectId, Effect>> = {
  particles: ParticleBurst,
};

export function getEffect(id: EffectId): Effect {
  return EFFECTS[id] ?? ParticleBurst;
}

export function isImplemented(id: EffectId): boolean {
  return EFFECTS[id] !== undefined;
}
