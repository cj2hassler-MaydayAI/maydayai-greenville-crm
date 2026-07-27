import { CategoryToggles } from '@/components/CategoryToggles';
import { currentPrefs } from '@/lib/prefs';

export const dynamic = 'force-dynamic';

export default async function SettingsPage() {
  const prefs = await currentPrefs();

  return (
    <div className="space-y-4">
      <h1 className="font-display text-2xl uppercase tracking-wide">Settings</h1>
      <CategoryToggles
        initialEnabled={prefs.enabledCategories}
        initialStrictness={prefs.strictness}
      />
    </div>
  );
}
