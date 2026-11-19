import type { EffectId } from '../config/schema';
import { EFFECT_IDS } from '../config/schema';
import type { Effect } from './Effect';
import { EnergyBurst } from './EnergyBurst';
import { FireEffect } from './FireEffect';
import { FireworksEffect } from './FireworksEffect';
import { LightningEffect } from './LightningEffect';
import { MinimalEffect } from './MinimalEffect';
import { ParticleBurst } from './ParticleBurst';
import { StarEffect } from './StarEffect';

const EFFECTS: Readonly<Record<EffectId, Effect>> = {
  particles: ParticleBurst,
  fire: FireEffect,
  lightning: LightningEffect,
  energy: EnergyBurst,
  fireworks: FireworksEffect,
  stars: StarEffect,
  minimal: MinimalEffect,
};

export function getEffect(id: EffectId): Effect {
  return EFFECTS[id];
}

export function allEffects(): Effect[] {
  return EFFECT_IDS.map((id) => EFFECTS[id]);
}
