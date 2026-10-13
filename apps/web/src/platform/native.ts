import { App } from '@capacitor/app';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { toast } from '../data/toast.ts';

export type Platform = 'web' | 'android' | 'ios';
export const platform = Capacitor.getPlatform() as Platform;
export const isNative = platform !== 'web';

/** Something another app handed to Margin: text that may contain a link, or a file. */
export type SharedItem = { type: 'text'; text: string } | { type: 'file'; blob: Blob; name: string };

/** Reads a file the native side saved inside the app's sandbox (shared PDFs). */
async function readNativeFile(pathOrUrl: string, name: string): Promise<SharedItem> {
  const url = pathOrUrl.startsWith('file://') ? pathOrUrl : `file://${pathOrUrl}`;
  const res = await fetch(Capacitor.convertFileSrc(url));
  if (!res.ok) throw new Error(`Couldn't read the shared file (HTTP ${res.status})`);
  return { type: 'file', blob: await res.blob(), name };
}

const fileNameOf = (url: string) => decodeURIComponent(url.split('/').pop() ?? '') || 'Document.pdf';

/**
 * Android: our ShareIntent plugin (apps/android/.../ShareIntentPlugin.java) delivers links and PDFs
 * shared to the app. Events are retained natively until this listener attaches.
 */
interface ShareIntentPlugin {
  addListener(
    event: 'shared',
    cb: (data: { text?: string; file?: { path: string; name: string } }) => void,
  ): Promise<PluginListenerHandle>;
}
const ShareIntent = registerPlugin<ShareIntentPlugin>('ShareIntent');

/**
 * iOS: our ClipboardLink plugin (packages/capacitor-clipboard-link). A share-sheet
 * extension needs the paid Apple Developer Program, so instead the app offers to save a link you
 * copied. `check` doesn't read the clipboard (no iOS paste prompt); `readLink` does, after a tap.
 */
interface ClipboardLinkPlugin {
  check(): Promise<{ hasLink: boolean; changeCount: number }>;
  readLink(): Promise<{ text: string }>;
}
const ClipboardLink = registerPlugin<ClipboardLinkPlugin>('ClipboardLink');

/** Remembers which copy we already asked about, so each copied link is offered once. */
const LAST_OFFERED_COPY = 'margin.lastOfferedCopy';

async function offerCopiedLink(onShared: (item: SharedItem) => void) {
  const { hasLink, changeCount } = await ClipboardLink.check();
  if (!hasLink || localStorage.getItem(LAST_OFFERED_COPY) === String(changeCount)) return;
  localStorage.setItem(LAST_OFFERED_COPY, String(changeCount));
  toast(
    'Save the link you copied?',
    {
      label: 'Save',
      run: async () => {
        const { text } = await ClipboardLink.readLink();
        if (text) onShared({ type: 'text', text });
      },
    },
    10_000,
  );
}

/**
 * iOS: PDFs shared or "opened in" Margin (declared in Info.plist) arrive as a file:// URL in the
 * app's Inbox, via the launch URL on a cold start and `appUrlOpen` afterwards.
 */
function receiveOpenedFiles(onShared: (item: SharedItem) => void) {
  const seen = new Set<string>();
  const receive = (url: string | undefined) => {
    if (!url?.startsWith('file://') || seen.has(url)) return;
    seen.add(url);
    readNativeFile(url, fileNameOf(url)).then(onShared, (e) => toast((e as Error).message));
  };
  void App.getLaunchUrl().then((launch) => receive(launch?.url));
  void App.addListener('appUrlOpen', ({ url }) => receive(url));
}

/** How links and files from other apps reach Margin on each platform. */
const shareTargets: Record<Platform, (onShared: (item: SharedItem) => void) => void> = {
  // The PWA receives links through the web manifest's share_target (/add route); files are added with Add PDF or drag and drop.
  web: () => {},
  android: (onShared) =>
    void ShareIntent.addListener('shared', ({ text, file }) => {
      if (text) onShared({ type: 'text', text });
      else if (file) readNativeFile(file.path, file.name).then(onShared, (e) => toast((e as Error).message));
    }),
  ios: (onShared) => {
    receiveOpenedFiles(onShared);
    const offer = () => offerCopiedLink(onShared).catch((e) => console.warn('Copied-link check failed', e));
    void offer();
    void App.addListener('appStateChange', ({ isActive }) => isActive && void offer());
  },
};

export const initShareTarget = (onShared: (item: SharedItem) => void) => shareTargets[platform](onShared);

/** Android back button: go back in the app, and leave the app from the top level. (iOS uses swipe-back.) */
export function initBackButton() {
  if (platform !== 'android') return;
  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && window.location.pathname !== '/') window.history.back();
    else void App.exitApp();
  });
}
