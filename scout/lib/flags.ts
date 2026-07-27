/**
 * The flag taxonomy. Every category a user can choose to avoid lives here.
 *
 * Keywords are matched on word boundaries after normalization (see matcher.ts),
 * so "corn" will never match the "corn oil" keyword. Brand names are matched the
 * same way but tracked separately so the UI can say *why* something matched.
 */

export const FLAG_IDS = [
  'cultivated',
  'precision-fermentation',
  'fungal',
  'analog',
  'seed-oils',
] as const;

export type FlagId = (typeof FLAG_IDS)[number];

export type Severity = 'high' | 'medium' | 'low';

export type Strictness = 'strict' | 'relaxed';

export interface FlagDefinition {
  id: FlagId;
  label: string;
  category: string;
  defaultSeverity: Severity;
  keywords: string[];
  brandNames: string[];
  /** One plain sentence a user actually understands. */
  explainer: string;
}

export const FLAGS: Record<FlagId, FlagDefinition> = {
  cultivated: {
    id: 'cultivated',
    label: 'Cultivated meat',
    category: 'Cultivated / cell-cultured meat',
    defaultSeverity: 'high',
    keywords: [
      'cell cultured',
      'cell-cultured',
      'cell cultivated',
      'cell-cultivated',
      'cultivated chicken',
      'cultivated pork',
      'cultivated salmon',
      'cultivated meat',
      'lab grown',
      'lab-grown',
    ],
    brandNames: [
      'Wildtype',
      'Upside Foods',
      'Good Meat',
      'Eat Just',
      'Mission Barns',
      'Believer Meats',
      'Fork & Good',
      'Clever Carnivore',
    ],
    explainer:
      'Meat grown from animal cells in a tank rather than from an animal. As of now this is close to nonexistent on US menus and shelves — only a handful of restaurants have ever served it.',
  },
  'precision-fermentation': {
    id: 'precision-fermentation',
    label: 'Precision fermentation',
    category: 'Proteins brewed by engineered microbes',
    defaultSeverity: 'medium',
    keywords: [
      'animal free whey',
      'animal-free whey',
      'non animal whey protein',
      'non-animal whey protein',
      'recombinant protein',
      'precision fermentation',
      'animal free dairy protein',
      'animal-free dairy protein',
    ],
    brandNames: ['Perfect Day', 'EVERY Company', 'Onego Bio', 'Vivici', 'Remilk'],
    explainer:
      'Dairy or egg proteins brewed by engineered microbes instead of coming from an animal. Shows up mostly in protein powders, ice cream, and some baked goods.',
  },
  fungal: {
    id: 'fungal',
    label: 'Fungal protein',
    category: 'Mycoprotein and fungal biomass',
    defaultSeverity: 'medium',
    keywords: ['mycoprotein', 'fungal protein', 'koji protein', 'fusarium venenatum'],
    brandNames: ["Quorn", "Nature's Fynd", 'Fy Protein', 'Meati', 'Prime Roots'],
    explainer:
      'Protein grown from fungus, used to imitate chicken or deli meat. Common in frozen meat-free products.',
  },
  analog: {
    id: 'analog',
    label: 'Plant-based analogs',
    category: 'Plant-based meat analogs',
    defaultSeverity: 'medium',
    keywords: [
      'soy leghemoglobin',
      'textured vegetable protein',
      'tvp',
      'pea protein isolate',
      'soy protein isolate',
      'methylcellulose',
      'plant based patty',
      'plant-based patty',
    ],
    brandNames: ['Impossible', 'Beyond Meat', 'Gardein', 'MorningStar Farms', 'Field Roast'],
    explainer:
      'Engineered plant protein built to look and taste like meat, usually held together with binders like methylcellulose.',
  },
  'seed-oils': {
    id: 'seed-oils',
    label: 'Seed oils',
    category: 'Industrial seed oils',
    defaultSeverity: 'medium',
    keywords: [
      'canola oil',
      'rapeseed oil',
      'soybean oil',
      'corn oil',
      'sunflower oil',
      'safflower oil',
      'grapeseed oil',
      'rice bran oil',
      'cottonseed oil',
      'vegetable oil',
      'vegetable shortening',
      'partially hydrogenated',
    ],
    brandNames: [],
    explainer:
      'Refined oils pressed from seeds, used for nearly all commercial frying. If you eat anything fried out of the house, assume it is in there unless the kitchen says otherwise.',
  },
};

export const FLAG_LIST: FlagDefinition[] = FLAG_IDS.map((id) => FLAGS[id]);

/** Categories enabled for a brand new user. */
export const DEFAULT_ENABLED: FlagId[] = ['seed-oils', 'analog'];

export function isFlagId(value: string): value is FlagId {
  return (FLAG_IDS as readonly string[]).includes(value);
}

export function parseFlagIds(values: unknown): FlagId[] {
  if (!Array.isArray(values)) return [];
  return values.filter((v): v is FlagId => typeof v === 'string' && isFlagId(v));
}
