/**
 * Open Food Facts — free, no key, full ingredient lists. This is the single best
 * data source in the app and the one path that works with a completely empty
 * database and no AI call.
 */

import { eq } from 'drizzle-orm';
import { db } from './db/client';
import { products } from './db/schema';
import { cachedFetchJson } from './http-cache';

// Overridable so you can point at a mirror or a local fixture server in tests.
const BASE = process.env.SCOUT_OFF_BASE ?? 'https://world.openfoodfacts.org';
const PRODUCT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export interface Product {
  barcode: string;
  name: string | null;
  brand: string | null;
  ingredientsText: string | null;
  categories: string | null;
  imageUrl: string | null;
}

interface OffProduct {
  code?: string;
  product_name?: string;
  brands?: string;
  ingredients_text?: string;
  ingredients_text_en?: string;
  categories?: string;
  categories_tags?: string[];
  image_url?: string;
  image_front_url?: string;
}

interface OffProductResponse {
  status?: number;
  product?: OffProduct;
}

interface OffSearchResponse {
  products?: OffProduct[];
}

function toProduct(barcode: string, raw: OffProduct): Product {
  return {
    barcode,
    name: raw.product_name?.trim() || null,
    brand: raw.brands?.split(',')[0]?.trim() || null,
    ingredientsText: (raw.ingredients_text_en || raw.ingredients_text)?.trim() || null,
    categories: raw.categories?.trim() || raw.categories_tags?.join(', ') || null,
    imageUrl: raw.image_front_url || raw.image_url || null,
  };
}

function readCached(barcode: string): Product | null {
  const row = db.select().from(products).where(eq(products.barcode, barcode)).get();
  if (!row) return null;
  if (Date.now() - new Date(row.cachedAt).getTime() > PRODUCT_TTL_MS) return null;
  return {
    barcode: row.barcode,
    name: row.name,
    brand: row.brand,
    ingredientsText: row.ingredientsText,
    categories: row.categories,
    imageUrl: row.imageUrl,
  };
}

function cache(product: Product): void {
  const cachedAt = new Date().toISOString();
  db.insert(products)
    .values({ ...product, cachedAt })
    .onConflictDoUpdate({
      target: products.barcode,
      set: { ...product, cachedAt },
    })
    .run();
}

export function normalizeBarcode(input: string): string | null {
  const digits = input.replace(/\D/g, '');
  if (digits.length < 8 || digits.length > 14) return null;
  return digits;
}

/** Looks up a barcode. Returns null when Open Food Facts has no record. */
export async function lookupBarcode(barcodeInput: string): Promise<Product | null> {
  const barcode = normalizeBarcode(barcodeInput);
  if (!barcode) return null;

  const cached = readCached(barcode);
  if (cached) return cached;

  const url = `${BASE}/api/v2/product/${encodeURIComponent(barcode)}.json`;
  let payload: OffProductResponse;
  try {
    payload = await cachedFetchJson<OffProductResponse>(url, { throttle: false });
  } catch {
    return null;
  }

  if (payload.status !== 1 || !payload.product) return null;

  const product = toProduct(barcode, payload.product);
  cache(product);
  return product;
}

/**
 * "Similar products without this" — searches the same category and returns items
 * whose ingredient list we actually have, so the caller can re-run the matcher
 * against real text rather than guessing.
 */
export async function searchByCategory(category: string, limit = 24): Promise<Product[]> {
  const tag = category
    .split(',')[0]
    .trim()
    .toLowerCase()
    .replace(/^en:/, '')
    .replace(/\s+/g, '-');
  if (!tag) return [];

  const url =
    `${BASE}/api/v2/search?categories_tags=${encodeURIComponent(tag)}` +
    `&fields=code,product_name,brands,ingredients_text,ingredients_text_en,categories,image_front_url` +
    `&page_size=${limit}`;

  try {
    const payload = await cachedFetchJson<OffSearchResponse>(url, { throttle: false });
    return (payload.products ?? [])
      .filter((p) => p.code && (p.ingredients_text_en || p.ingredients_text))
      .map((p) => toProduct(p.code as string, p));
  } catch {
    return [];
  }
}

export async function searchByBrand(brand: string, limit = 24): Promise<Product[]> {
  const tag = brand.trim().toLowerCase().replace(/\s+/g, '-');
  if (!tag) return [];

  const url =
    `${BASE}/api/v2/search?brands_tags=${encodeURIComponent(tag)}` +
    `&fields=code,product_name,brands,ingredients_text,ingredients_text_en,categories,image_front_url` +
    `&page_size=${limit}`;

  try {
    const payload = await cachedFetchJson<OffSearchResponse>(url, { throttle: false });
    return (payload.products ?? [])
      .filter((p) => p.code)
      .map((p) => toProduct(p.code as string, p));
  } catch {
    return [];
  }
}
