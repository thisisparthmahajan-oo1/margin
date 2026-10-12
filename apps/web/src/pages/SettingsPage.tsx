import { useLiveQuery } from 'dexie-react-hooks';
import { signOut } from '../data/auth.ts';
import { db } from '../data/db.ts';
import { appSettings, useAppSettings } from '../data/settings.ts';
import { syncNow, useSyncStatus } from '../data/sync.ts';

export function SettingsPage() {
  const settings = useAppSettings();
  const sync = useSyncStatus();
  const stats = useLiveQuery(async () => ({
    articles: await db.bookmarks.where('status').equals('ready').count(),
    unsynced: await db.outbox.count(),
  }), []);

  return (
    <section className="list-page settings-page">
      <header className="list-header">
        <h1>Settings</h1>
      </header>

      <div className="setting">
        <label className="toggle">
          <input
            type="checkbox"
            checked={settings.autoArchive}
            onChange={(e) => appSettings.set({ autoArchive: e.target.checked })}
          />
          Archive articles when I reach the end
        </label>
      </div>

      <div className="setting">
        <h2>This device</h2>
        <p>
          {stats?.articles ?? 0} articles saved for offline reading.
          {stats?.unsynced ? ` ${stats.unsynced} changes waiting to sync.` : ''}
        </p>
        <p className="muted">
          Last synced {sync.lastSyncedAt ? new Date(sync.lastSyncedAt).toLocaleTimeString() : 'not yet'}.
        </p>
        <button className="button" onClick={() => void syncNow()}>
          Sync now
        </button>
      </div>

      <div className="setting">
        <h2>Sign-in</h2>
        {settings.sessionExpiresAt ? (
          <p>
            Signed in on this device until{' '}
            {new Date(settings.sessionExpiresAt).toLocaleDateString(undefined, { dateStyle: 'long' })}. After that you’ll be
            asked for your access token again.
          </p>
        ) : (
          <p className="muted">This server doesn’t require an access token.</p>
        )}
        {settings.sessionExpiresAt && (
          <button className="button" onClick={signOut}>
            Sign out
          </button>
        )}
        <p className="muted">Signing out keeps your saved articles on this device.</p>
      </div>
    </section>
  );
}
