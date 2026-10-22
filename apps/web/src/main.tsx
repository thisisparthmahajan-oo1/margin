import '@fontsource/ibm-plex-sans/400.css';
import '@fontsource/ibm-plex-sans/500.css';
import '@fontsource/ibm-plex-sans/600.css';
import '@fontsource/literata/400.css';
import '@fontsource/literata/400-italic.css';
import '@fontsource/literata/700.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/400-italic.css';
import '@fontsource/source-serif-4/700.css';
import '@fontsource/lora/400.css';
import '@fontsource/lora/400-italic.css';
import '@fontsource/lora/700.css';
import '@fontsource/inter/400.css';
import '@fontsource/inter/700.css';
import '@fontsource/atkinson-hyperlegible/400.css';
import '@fontsource/atkinson-hyperlegible/400-italic.css';
import '@fontsource/atkinson-hyperlegible/700.css';
import './styles.css';

import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router-dom';
import { registerSW } from 'virtual:pwa-register';
import { TokenGate } from './components/TokenGate.tsx';
import { saveUrl } from './data/actions.ts';
import { addFiles } from './data/addFiles.ts';
import { initAuth, onSignedIn } from './data/auth.ts';
import { startSync } from './data/sync.ts';
import { toast } from './data/toast.ts';
import { initBackButton, initShareTarget, isNative } from './platform/native.ts';
import { Shell } from './components/Shell.tsx';
import { AddPage } from './pages/AddPage.tsx';
import { ListPage } from './pages/ListPage.tsx';
import { NotesPage } from './pages/NotesPage.tsx';
import { RequestsPage } from './pages/RequestsPage.tsx';
import { ReaderPage } from './pages/ReaderPage.tsx';
import { SearchPage } from './pages/SearchPage.tsx';
import { SettingsPage } from './pages/SettingsPage.tsx';

const router = createBrowserRouter([
  {
    element: <Shell />,
    children: [
      { path: '/', element: <ListPage list={{ kind: 'home' }} /> },
      { path: '/liked', element: <ListPage list={{ kind: 'liked' }} /> },
      { path: '/archive', element: <ListPage list={{ kind: 'archive' }} /> },
      { path: '/pdfs', element: <ListPage list={{ kind: 'pdfs' }} /> },
      { path: '/videos', element: <ListPage list={{ kind: 'videos' }} /> },
      { path: '/podcasts', element: <ListPage list={{ kind: 'podcasts' }} /> },
      { path: '/folder/:folderId', element: <ListPage /> },
      { path: '/tag/:tagId', element: <ListPage /> },
      { path: '/notes', element: <NotesPage /> },
      { path: '/requests', element: <RequestsPage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
  { path: '/read/:id', element: <ReaderPage /> },
  { path: '/add', element: <AddPage /> },
]);

// The native app ships its files inside the APK; only the PWA needs a service worker.
if (!isNative) registerSW({ immediate: true });
initBackButton();
void initAuth();
// Nothing talks to the server until this device is signed in. Shared links wait (Android retains them).
let shareTargetReady = false;
onSignedIn(() => {
  startSync();
  if (shareTargetReady) return;
  shareTargetReady = true;
  initShareTarget(async (item) => {
    if (item.type === 'file') await addFiles([item]);
    else toast((await saveUrl(item.text)) ? 'Saved to Home' : 'No link found in what was shared');
    void router.navigate('/');
  });
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <TokenGate>
      <RouterProvider router={router} />
    </TokenGate>
  </StrictMode>,
);
