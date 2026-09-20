import { z } from 'zod';
import type { DrinkoConfig } from '../config/schema';
import type { Database } from './database';

/** Values staff change from the admin screen; everything else lives in config/drinko.json. */
const settingsSchema = z.object({
  /** one entry per board channel; the API checks the length against the driver */
  calibration: z.array(z.number().positive()).min(1),
  flowRateGps: z.array(z.number().positive()).min(1),
  disabledDrinks: z.array(z.string()),
});

export type Settings = z.infer<typeof settingsSchema>;

export function defaultSettings(config: DrinkoConfig): Settings {
  return {
    calibration: [1, 1, 1, 1],
    flowRateGps: config.channels.map(() => config.device.defaultFlowRateGps),
    disabledDrinks: [],
  };
}

export class SettingsRepository {
  private readonly getStmt;
  private readonly upsertStmt;

  constructor(
    db: Database,
    private readonly defaults: Settings,
  ) {
    this.getStmt = db.prepare("SELECT value FROM settings WHERE key = 'settings'");
    this.upsertStmt = db.prepare(
      "INSERT INTO settings (key, value) VALUES ('settings', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value",
    );
  }

  get(): Settings {
    const row = this.getStmt.get() as { value: string } | undefined;
    if (!row) return structuredClone(this.defaults);
    const parsed = settingsSchema.safeParse({ ...this.defaults, ...(JSON.parse(row.value) as object) });
    return parsed.success ? parsed.data : structuredClone(this.defaults);
  }

  update(patch: Partial<Settings>): Settings {
    const defined = Object.fromEntries(Object.entries(patch).filter(([, value]) => value !== undefined));
    const next = settingsSchema.parse({ ...this.get(), ...defined });
    this.upsertStmt.run(JSON.stringify(next));
    return next;
  }
}
