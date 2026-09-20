import 'dotenv/config';
import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().int().positive().default(8000),
  CLIENT_URL: z.string().default('http://localhost:5173'),
  /** `mock` simulates the vending device in software; `serial` talks to the real one. */
  HARDWARE: z.enum(['mock', 'serial']).default('mock'),
  SERIAL_PATH: z.string().optional(),
  SERIAL_TERMINATOR: z.enum(['lf', 'crlf']).default('lf'),
  /** 1 = pours take real time in the mock, 0 = instant. */
  MOCK_TIME_SCALE: z.coerce.number().min(0).default(1),
  ADMIN_PIN: z.string().min(4).default('1234'),
  DB_PATH: z.string().default('./data/drinko.sqlite'),
  CONFIG_PATH: z.string().default('./config/drinko.json'),
  CLIENT_DIST: z.string().default('../client/dist'),
  LOG_LEVEL: z.string().default('info'),
  NODE_ENV: z.string().default('development'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = envSchema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid environment: ${issues.join('; ')}`);
  }
  if (result.data.HARDWARE === 'serial' && !result.data.SERIAL_PATH) {
    throw new Error('SERIAL_PATH is required when HARDWARE=serial');
  }
  return result.data;
}
