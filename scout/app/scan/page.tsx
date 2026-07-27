import { Scanner } from '@/components/Scanner';
import { currentPrefs } from '@/lib/prefs';
import { FLAGS } from '@/lib/flags';

export const dynamic = 'force-dynamic';

export default async function ScanPage() {
  const prefs = await currentPrefs();

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-2xl uppercase tracking-wide">Scan a product</h1>
        <p className="label-caps mt-1 text-slate-muted">
          Checking against{' '}
          {prefs.enabledCategories.length === 0
            ? 'nothing — pick categories in settings'
            : prefs.enabledCategories.map((id) => FLAGS[id].label).join(' · ')}
        </p>
      </div>

      <Scanner />
    </div>
  );
}
