import { useLiveQuery } from 'dexie-react-hooks';
import { useState } from 'react';
import { db } from '../data/db.ts';
import { appSettings, useAppSettings } from '../data/settings.ts';
import { syncNow, useSyncStatus } from '../data/sync.ts';

export function SettingsPage() {
  const settings = useAppSettings();
  const sync = useSyncStatus();
  const [token, setToken] = useState(settings.apiToken);
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
        <h2>Access token</h2>
        <p className="muted">The token the server was started with (APP_TOKEN). The Android app has it built in.</p>
        <form
          className="token-form"
          onSubmit={(e) => {
            e.preventDefault();
            appSettings.set({ apiToken: token.trim() });
            void syncNow();
          }}
        >
          <input type="password" value={token} onChange={(e) => setToken(e.target.value)} placeholder="Token" />
          <button className="button" type="submit">
            Save token
          </button>
        </form>
      </div>
    </section>
  );
}
