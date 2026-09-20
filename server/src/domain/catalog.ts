import type { DrinkoConfig, SizeConfig } from '../config/schema';
import type { DeviceStatus, Menu, MenuDrink, MenuIngredient, MenuSize, TankStatus } from './types';

export interface CatalogSettings {
  disabledDrinks: string[];
}

/** A recipe is available while none of its channels report a low tank. Unknown counts as available. */
export function isRecipeAvailable(
  recipe: { ingredient: string }[],
  config: Pick<DrinkoConfig, 'channels'>,
  tanks: TankStatus[],
): boolean {
  return recipe.every((line) => {
    const channel = config.channels.indexOf(line.ingredient);
    return channel !== -1 && tanks[channel] !== 'low';
  });
}

function buildSize(size: SizeConfig, config: DrinkoConfig, tanks: TankStatus[], enabled: boolean): MenuSize {
  return {
    price: size.price,
    recipe: size.recipe.map((line) => ({ ...line })),
    available: enabled && isRecipeAvailable(size.recipe, config, tanks),
  };
}

export function buildMenu(config: DrinkoConfig, device: DeviceStatus, settings: CatalogSettings): Menu {
  const tanks = device.tanks;
  const disabled = new Set(settings.disabledDrinks);

  const ingredients: MenuIngredient[] = Object.entries(config.ingredients).map(([id, ingredient]) => {
    const channel = config.channels.indexOf(id);
    return {
      id,
      name: ingredient.name,
      color: ingredient.color,
      abv: ingredient.abv,
      channel: channel === -1 ? null : channel,
      tank: channel === -1 ? 'unknown' : (tanks[channel] ?? 'unknown'),
    };
  });

  const drinks: MenuDrink[] = config.drinks.map((drink) => {
    const enabled = !disabled.has(drink.id);
    const single = buildSize(drink.sizes.single, config, tanks, enabled);
    const double = drink.sizes.double ? buildSize(drink.sizes.double, config, tanks, enabled) : undefined;
    const recipeLines = [...drink.sizes.single.recipe, ...(drink.sizes.double?.recipe ?? [])];
    return {
      id: drink.id,
      name: drink.name,
      category: drink.category,
      strength: drink.strength,
      cup: drink.cup,
      ingredients: [...new Set(recipeLines.map((line) => line.ingredient))],
      sizes: double ? { single, double } : { single },
      available: single.available || (double?.available ?? false),
    };
  });

  return {
    currency: config.currency,
    maxPoursPerOrder: config.order.maxPoursPerOrder,
    categories: config.categories.map((category) => ({ ...category })),
    ingredients,
    drinks,
  };
}
