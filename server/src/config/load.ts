import { readFileSync } from 'node:fs';
import { configSchema, type DrinkoConfig } from './schema';

export function parseConfig(json: unknown, source = 'config'): DrinkoConfig {
  const result = configSchema.safeParse(json);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`);
    throw new Error(`Invalid ${source}: ${issues.join('; ')}`);
  }
  return validateReferences(result.data, source);
}

export function loadConfig(path: string): DrinkoConfig {
  let json: unknown;
  try {
    json = JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    throw new Error(`Cannot read config ${path}: ${(error as Error).message}`);
  }
  return parseConfig(json, path);
}

/** Cross-field checks that a schema cannot express: every reference must point somewhere real. */
export function validateReferences(config: DrinkoConfig, source = 'config'): DrinkoConfig {
  const problems: string[] = [];

  config.channels.forEach((ingredient, index) => {
    if (!config.ingredients[ingredient]) {
      problems.push(`channel ${index + 1} refers to unknown ingredient "${ingredient}"`);
    }
  });

  const onChannel = new Set(config.channels);
  const categoryIds = new Set(config.categories.map((category) => category.id));
  const seen = new Set<string>();

  for (const drink of config.drinks) {
    if (seen.has(drink.id)) problems.push(`duplicate drink id "${drink.id}"`);
    seen.add(drink.id);
    if (!categoryIds.has(drink.category)) {
      problems.push(`drink "${drink.id}" has unknown category "${drink.category}"`);
    }
    for (const [sizeId, size] of Object.entries(drink.sizes)) {
      if (!size) continue;
      for (const line of size.recipe) {
        if (!config.ingredients[line.ingredient]) {
          problems.push(`drink "${drink.id}" (${sizeId}) uses unknown ingredient "${line.ingredient}"`);
        } else if (!onChannel.has(line.ingredient)) {
          problems.push(`drink "${drink.id}" (${sizeId}) uses "${line.ingredient}", which is not on any channel`);
        }
      }
    }
  }

  if (problems.length > 0) throw new Error(`Invalid ${source}: ${problems.join('; ')}`);
  return config;
}
