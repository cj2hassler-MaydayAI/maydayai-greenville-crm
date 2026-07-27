import { NextResponse, type NextRequest } from 'next/server';
import { lookupBarcode, searchByCategory } from '@/lib/openfoodfacts';
import { findFlags } from '@/lib/matcher';
import { ensureToken, loadPrefs } from '@/lib/prefs';

export const runtime = 'nodejs';

/**
 * "Similar products without this" — pulls the same Open Food Facts category and
 * keeps only products whose real ingredient list clears the user's categories.
 * Every suggestion has been matched against actual text, not inferred.
 */
export async function GET(request: NextRequest) {
  const barcode = request.nextUrl.searchParams.get('barcode');
  if (!barcode) {
    return NextResponse.json({ error: 'bad_request' }, { status: 400 });
  }

  const token = await ensureToken();
  const prefs = loadPrefs(token);

  const product = await lookupBarcode(barcode);
  if (!product?.categories) {
    return NextResponse.json({ alternatives: [], reason: 'no_category' });
  }

  const candidates = await searchByCategory(product.categories);

  const alternatives = candidates
    .filter((c) => c.barcode !== product.barcode && c.ingredientsText)
    .map((c) => ({
      product: c,
      hits: findFlags(c.ingredientsText, {
        enabled: prefs.enabledCategories,
        strictness: prefs.strictness,
      }),
    }))
    .filter((c) => c.hits.length === 0)
    .slice(0, 6)
    .map((c) => c.product);

  return NextResponse.json({
    alternatives,
    searchedCategory: product.categories.split(',')[0]?.trim() ?? null,
    attribution: 'Product data from Open Food Facts (ODbL)',
  });
}
