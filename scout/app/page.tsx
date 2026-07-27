import { NearbyList } from '@/components/NearbyList';
import { currentPrefs } from '@/lib/prefs';
import { FLAGS } from '@/lib/flags';

export const dynamic = 'force-dynamic';

export default async function HomePage() {
  const prefs = await currentPrefs();

  return (
    <div className="space-y-4">
      <section>
        <h1 className="sr-only">Nearby places</h1>
        <p className="label-caps text-slate-muted">
          Avoiding{' '}
          {prefs.enabledCategories.length === 0
            ? 'nothing yet — pick categories in settings'
            : prefs.enabledCategories.map((id) => FLAGS[id].label).join(' · ')}
        </p>
      </section>

      <NearbyList />
    </div>
  );
}
