import { z } from 'zod';

export const localizedSchema = z.object({ ka: z.string().min(1), en: z.string().min(1) });

export const ingredientSchema = z.object({
  name: localizedSchema,
  /** grams per ml; converts recipe ml into the grams the device expects */
  density: z.number().positive().default(1),
  /** liquid color for the pouring animation */
  color: z.string().default('#FFFFFF'),
  abv: z.number().min(0).max(100).default(0),
});

export const recipeLineSchema = z.object({
  ingredient: z.string().min(1),
  ml: z.number().positive(),
});

export const sizeSchema = z.object({
  price: z.number().nonnegative(),
  recipe: z.array(recipeLineSchema).min(1),
});

export const drinkSchema = z.object({
  id: z.string().regex(/^[a-z0-9-]+$/, 'lowercase letters, digits and dashes only'),
  name: localizedSchema,
  category: z.string().min(1),
  strength: z.number().int().min(0).max(3),
  /** which cup the guest should place under the nozzle */
  cup: z.enum(['large', 'small']).default('large'),
  sizes: z.object({ single: sizeSchema, double: sizeSchema.optional() }),
});

export const categorySchema = z.object({ id: z.string().min(1), name: localizedSchema });

export const deviceConfigSchema = z.object({
  /** used for progress estimation until the admin calibrates each channel */
  defaultFlowRateGps: z.number().positive().default(15),
  /** fixed time the device spends per pour besides pumping */
  pourOverheadMs: z.number().nonnegative().default(1500),
  tankPollMs: z.number().positive().default(60_000),
  checkTankTimeoutMs: z.number().positive().default(2_000),
  /** how often the Drinko driver polls CheckTank while a pour runs */
  pourPollMs: z.number().positive().default(500),
  /** pour timeout = expectedMs × multiplier + extra */
  pourTimeoutMultiplier: z.number().positive().default(2),
  pourTimeoutExtraMs: z.number().nonnegative().default(5_000),
  reconnectMs: z.number().positive().default(3_000),
  /** a pour ending before expectedMs × ratio with no result from the board counts as "nothing flowed"; 0 disables */
  suspiciousPourRatio: z.number().min(0).max(1).default(0.25),
  /** poll interval while the device is in error, so recovery is noticed quickly */
  errorPollMs: z.number().positive().default(5_000),
  /** consecutive failed polls before the serial link is closed and reopened */
  pollFailuresBeforeReconnect: z.number().int().positive().default(3),
});

export const orderConfigSchema = z.object({
  maxPoursPerOrder: z.number().int().positive().default(4),
  /** unpaid orders older than this are cancelled by the sweeper */
  unpaidTtlMs: z.number().positive().default(5 * 60_000),
  /** paid orders waiting for a cup longer than this are marked abandoned */
  awaitingCupTtlMs: z.number().positive().default(3 * 60_000),
});

export const configSchema = z.object({
  currency: z.string().default('GEL'),
  /** ingredient id per board channel, in channel order; must match the driver's channel count */
  channels: z.array(z.string().min(1)).min(1).max(16),
  ingredients: z.record(z.string(), ingredientSchema),
  categories: z.array(categorySchema).min(1),
  drinks: z.array(drinkSchema).min(1),
  device: deviceConfigSchema.prefault({}),
  order: orderConfigSchema.prefault({}),
});

export type DrinkoConfig = z.infer<typeof configSchema>;
export type DrinkConfig = DrinkoConfig['drinks'][number];
export type IngredientConfig = DrinkoConfig['ingredients'][string];
export type SizeConfig = z.infer<typeof sizeSchema>;
export type RecipeLine = z.infer<typeof recipeLineSchema>;
export type Localized = z.infer<typeof localizedSchema>;
