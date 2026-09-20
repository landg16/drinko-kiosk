import type { DrinkoConfig, RecipeLine } from '../config/schema';

export interface PlannerSettings {
  /** per-channel correction factor set from the admin calibration wizard */
  calibration: number[];
  /** per-channel pump speed in grams per second, for progress estimation */
  flowRateGps: number[];
  /** fixed per-pour overhead of the device */
  overheadMs: number;
}

export interface PourPlan {
  /** grams per channel, one entry per configured channel */
  grams: number[];
  expectedMs: number;
}

/** Recipe ml → grams per channel plus an estimated duration; pumps run together, so the slowest channel sets the time. */
export function planPour(
  recipe: RecipeLine[],
  config: Pick<DrinkoConfig, 'channels' | 'ingredients'>,
  settings: PlannerSettings,
): PourPlan {
  const exact = config.channels.map(() => 0);
  for (const line of recipe) {
    const channel = config.channels.indexOf(line.ingredient);
    if (channel === -1) throw new Error(`ingredient "${line.ingredient}" is not on any channel`);
    const ingredient = config.ingredients[line.ingredient];
    if (!ingredient) throw new Error(`unknown ingredient "${line.ingredient}"`);
    exact[channel] += line.ml * ingredient.density * (settings.calibration[channel] ?? 1);
  }

  const grams = exact.map((value) => (value > 0 ? Math.max(1, Math.round(value)) : 0));

  let slowestMs = 0;
  grams.forEach((value, channel) => {
    if (value === 0) return;
    const rate = settings.flowRateGps[channel] ?? 0;
    if (rate <= 0) throw new Error(`flow rate for channel ${channel + 1} must be positive`);
    slowestMs = Math.max(slowestMs, (value / rate) * 1000);
  });

  return { grams, expectedMs: Math.round(slowestMs + settings.overheadMs) };
}
