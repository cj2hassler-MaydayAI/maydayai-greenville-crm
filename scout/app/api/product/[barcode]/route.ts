import { NextResponse } from 'next/server';
import { lookupBarcode, normalizeBarcode } from '@/lib/openfoodfacts';
import { findFlags } from '@/lib/matcher';
import { ensureToken, loadPrefs } from '@/lib/prefs';

export const runtime = 'nodejs';

/**
 * Barcode -> Open Food Facts -> flagged ingredients, with the matched spans
 * returned so the client can highlight them inline. Works with a completely
 * empty database and no AI call.
 */
export async function GET(_request: Request, ctx: { params: Promise<{ barcode: string }> }) {
  const { barcode: raw } = await ctx.params;
  const barcode = normalizeBarcode(raw);
  if (!barcode) {
    return NextResponse.json(
      { error: 'bad_barcode', message: 'That does not look like a product barcode.' },
      { status: 400 },
    );
  }

  const token = await ensureToken();
  const prefs = loadPrefs(token);

  const product = await lookupBarcode(barcode);
  if (!product) {
    return NextResponse.json(
      {
        error: 'not_found',
        barcode,
        message: 'Open Food Facts has no record for this barcode.',
      },
      { status: 404 },
    );
  }

  const hits = findFlags(product.ingredientsText, {
    enabled: prefs.enabledCategories,
    strictness: prefs.strictness,
  });

  return NextResponse.json({
    product,
    hits,
    verdict: hits.length > 0 ? 'flagged' : product.ingredientsText ? 'clear' : 'unknown',
    prefs: { enabledCategories: prefs.enabledCategories, strictness: prefs.strictness },
    attribution: 'Product data from Open Food Facts (ODbL)',
  });
}
