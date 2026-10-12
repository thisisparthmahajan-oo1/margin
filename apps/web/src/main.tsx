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
import { saveUrl } from './data/actions.ts';
import { startSync } from './data/sync.ts';
import { toast } from './data/toast.ts';
import { initBackButton, initShareTarget, isNative } from './platform/native.ts';
import { Shell } from './components/Shell.tsx';
import { AddPage } from './pages/AddPage.tsx';
import { ListPage } from './pages/ListPage.tsx';
import { NotesPage } from './pages/NotesPage.tsx';
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
      { path: '/folder/:folderId', element: <ListPage /> },
      { path: '/notes', element: <NotesPage /> },
      { path: '/search', element: <SearchPage /> },
      { path: '/settings', element: <SettingsPage /> },
    ],
  },
  { path: '/read/:id', element: <ReaderPage /> },
  { path: '/add', element: <AddPage /> },
]);

// The native app ships its files inside the APK; only the PWA needs a service worker.
if (!isNative) registerSW({ immediate: true });
startSync();
initBackButton();
initShareTarget(async (text) => {
  const id = await saveUrl(text);
  toast(id ? 'Saved to Home' : 'No link found in what was shared');
  void router.navigate('/');
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
