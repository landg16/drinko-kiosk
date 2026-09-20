import { describe, expect, it } from 'vitest';
import { planPour, type PlannerSettings } from './pour-planner';

const ingredient = (density: number) => ({ name: { ka: 'x', en: 'x' }, density, color: '#fff', abv: 0 });

const config = {
  channels: ['vodka', 'gin', 'tonic', 'energy'],
  ingredients: { vodka: ingredient(0.95), gin: ingredient(0.95), tonic: ingredient(1.03), energy: ingredient(1.04) },
};

const settings: PlannerSettings = { calibration: [1, 1, 1, 1], flowRateGps: [15, 15, 15, 15], overheadMs: 1500 };

describe('planPour', () => {
  it('converts a two-ingredient recipe into grams per channel and estimates the slowest channel', () => {
    const plan = planPour(
      [
        { ingredient: 'gin', ml: 40 },
        { ingredient: 'tonic', ml: 160 },
      ],
      config,
      settings,
    );
    expect(plan.grams).toEqual([0, 38, 165, 0]);
    // 165 g at 15 g/s = 11 s, plus overhead
    expect(plan.expectedMs).toBe(12_500);
  });

  it('applies the per-channel calibration factor', () => {
    const plan = planPour([{ ingredient: 'tonic', ml: 160 }], config, {
      ...settings,
      calibration: [1, 1, 1.1, 1],
    });
    expect(plan.grams[2]).toBe(181);
  });

  it('never rounds a requested ingredient down to zero', () => {
    const plan = planPour([{ ingredient: 'vodka', ml: 0.2 }], config, settings);
    expect(plan.grams[0]).toBe(1);
  });

  it('rejects an ingredient that is not on a channel', () => {
    expect(() => planPour([{ ingredient: 'rum', ml: 40 }], config, settings)).toThrow(/not on any channel/);
  });
});
