/**
 * Loads data/seed-chains.json into the database and regenerates
 * data/seed-flags.json from the taxonomy in lib/flags.ts.
 *
 *   npm run db:seed
 *
 * Idempotent: chains are upserted by a deterministic id, and their seeded menu
 * items are replaced rather than duplicated.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { eq } from 'drizzle-orm';
import { db } from '../lib/db/client';
import { menuItems } from '../lib/db/schema';
import { insertMenuItem, replaceFlagHits, upsertChain } from '../lib/db/repository';
import { FLAG_IDS, FLAGS } from '../lib/flags';
import { findFlags } from '../lib/matcher';

const ROOT = resolve(import.meta.dirname, '..');

interface SeedItem {
  name: string;
  description?: string;
  ingredientsText?: string;
  source: string;
  confidence: 'high' | 'medium' | 'low';
  verifiedAt: string;
  note?: string;
}

interface SeedChain {
  name: string;
  aliases: string[];
  website: string | null;
  items: SeedItem[];
}

interface SeedFile {
  chains: SeedChain[];
}

/**
 * Confidence words to numbers. "low" deliberately lands under the 0.6 threshold
 * in computeVerdict, so an unverified record can flag a venue but can never
 * earn it a "verified clean".
 */
const CONFIDENCE: Record<SeedItem['confidence'], number> = {
  high: 0.8,
  medium: 0.65,
  low: 0.35,
};

function chainId(name: string): string {
  return `chn_${name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}`;
}

function seedChains(): void {
  const file = JSON.parse(
    readFileSync(resolve(ROOT, 'data/seed-chains.json'), 'utf8'),
  ) as SeedFile;

  let chainCount = 0;
  let itemCount = 0;
  let hitCount = 0;
  const withoutItems: string[] = [];

  for (const chain of file.chains) {
    const id = chainId(chain.name);
    upsertChain({
      id,
      name: chain.name,
      aliases: chain.aliases ?? [],
      website: chain.website ?? null,
    });
    chainCount++;

    // Replace this chain's seeded items so re-running does not duplicate them.
    db.delete(menuItems).where(eq(menuItems.chainId, id)).run();

    if (!chain.items || chain.items.length === 0) {
      withoutItems.push(chain.name);
      continue;
    }

    for (const item of chain.items) {
      const itemId = insertMenuItem({
        chainId: id,
        name: item.name,
        description: item.description ?? null,
        ingredientsText: item.ingredientsText ?? null,
        source: 'seed',
        confidence: CONFIDENCE[item.confidence],
        sourceNote: [item.source, item.note].filter(Boolean).join(' — '),
        verifiedAt: item.verifiedAt,
      });
      itemCount++;

      // Precompute hits across every category; the UI re-matches per user, but
      // storing them keeps flag_hits useful for offline auditing of the dataset.
      const hits = findFlags(item.ingredientsText ?? '', { enabled: [...FLAG_IDS] });
      replaceFlagHits(itemId, hits);
      hitCount += hits.length;
    }
  }

  console.log(`chains:     ${chainCount}`);
  console.log(`menu items: ${itemCount}`);
  console.log(`flag hits:  ${hitCount}`);
  console.log(
    `no data:    ${withoutItems.length} chains carry no items and will read "NO DATA" — that is the honest answer for them.`,
  );
}

function writeSeedFlags(): void {
  const payload = {
    $comment:
      'Generated from lib/flags.ts by scripts/seed.ts. Edit the registry, not this file.',
    generatedAt: new Date().toISOString().slice(0, 10),
    flags: FLAG_IDS.map((id) => {
      const flag = FLAGS[id];
      return {
        id: flag.id,
        label: flag.label,
        category: flag.category,
        defaultSeverity: flag.defaultSeverity,
        keywords: flag.keywords,
        brandNames: flag.brandNames,
        explainer: flag.explainer,
      };
    }),
  };
  const path = resolve(ROOT, 'data/seed-flags.json');
  writeFileSync(path, `${JSON.stringify(payload, null, 2)}\n`);
  console.log(`flags:      ${payload.flags.length} written to data/seed-flags.json`);
}

writeSeedFlags();
seedChains();
