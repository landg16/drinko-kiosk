import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig, parseConfig } from './load';

const configPath = join(__dirname, '..', '..', 'config', 'drinko.json');
const readRaw = () => JSON.parse(readFileSync(configPath, 'utf8'));

describe('config', () => {
  it('loads the shipped layout A config', () => {
    const config = loadConfig(configPath);
    expect(config.channels).toEqual(['vodka', 'gin', 'tonic', 'energy']);
    expect(config.drinks).toHaveLength(8);
    expect(config.device.checkTankTimeoutMs).toBe(2000);
    expect(config.order.maxPoursPerOrder).toBe(4);
  });

  it('rejects a recipe ingredient that is not on a channel', () => {
    const raw = readRaw();
    raw.ingredients.rum = { name: { ka: 'რომი', en: 'Rum' } };
    raw.drinks[0].sizes.single.recipe[0].ingredient = 'rum';
    expect(() => parseConfig(raw)).toThrow(/not on any channel/);
  });

  it('rejects duplicate drink ids', () => {
    const raw = readRaw();
    raw.drinks.push({ ...raw.drinks[0] });
    expect(() => parseConfig(raw)).toThrow(/duplicate drink id/);
  });

  it('rejects an empty channel list', () => {
    const raw = readRaw();
    raw.channels = [];
    expect(() => parseConfig(raw)).toThrow(/channels/);
  });
});
