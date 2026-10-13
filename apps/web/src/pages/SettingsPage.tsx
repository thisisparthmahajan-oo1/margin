import { formatBytes, type StorageResponse } from '@margin/shared';
import { useLiveQuery } from 'dexie-react-hooks';
import { useEffect, useState } from 'react';
import { api, ApiRequestError } from '../data/api.ts';
import { signOut } from '../data/auth.ts';
import { db } from '../data/db.ts';
import { deviceFileBytes } from '../data/files.ts';
import { appSettings, useAppSettings } from '../data/settings.ts';
import { syncNow, useSyncStatus } from '../data/sync.ts';

export function SettingsPage() {
  const settings = useAppSettings();
  const sync = useSyncStatus();
  const stats = useLiveQuery(async () => ({
    articles: await db.bookmarks.where('status').equals('ready').count(),
    unsynced: await db.outbox.count(),
    fileBytes: await deviceFileBytes(),
  }), []);
  const storage = useServerStorage();

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
          {stats?.articles ?? 0} items saved for offline reading
          {stats?.fileBytes ? `, including ${formatBytes(stats.fileBytes)} of PDFs` : ''}.
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
        <h2>PDF storage</h2>
        {storage === 'unavailable' ? (
          <p className="muted">File storage isn’t set up on the server, so PDFs can’t be added.</p>
        ) : storage === 'offline' ? (
          <p className="muted">Connect to the internet to see how much space is left.</p>
        ) : storage ? (
          <>
            <p>
              {formatBytes(storage.usedBytes)} of {formatBytes(storage.limitBytes)} used. Each PDF can be up to{' '}
              {formatBytes(storage.maxFileBytes)}.
            </p>
            <div className="meter" role="meter" aria-valuemin={0} aria-valuemax={storage.limitBytes} aria-valuenow={storage.usedBytes}>
              <span style={{ width: `${Math.min(100, (storage.usedBytes / storage.limitBytes) * 100)}%` }} />
            </div>
            <p className="muted">Deleting a PDF frees its space right away.</p>
          </>
        ) : null}
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

function useServerStorage() {
  const [storage, setStorage] = useState<StorageResponse | 'unavailable' | 'offline' | null>(null);
  useEffect(() => {
    api<StorageResponse>('GET', '/api/files/storage').then(setStorage, (e) =>
      setStorage(e instanceof ApiRequestError && e.status === 501 ? 'unavailable' : 'offline'),
    );
  }, []);
  return storage;
}
