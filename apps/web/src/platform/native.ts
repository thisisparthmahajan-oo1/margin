import { App } from '@capacitor/app';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';
import { toast } from '../data/toast.ts';

export type Platform = 'web' | 'android' | 'ios';
export const platform = Capacitor.getPlatform() as Platform;
export const isNative = platform !== 'web';

/**
 * Android: our ShareIntent plugin (apps/android/.../ShareIntentPlugin.java) delivers text shared to
 * the app from the share sheet. Events are retained natively until this listener attaches.
 */
interface ShareIntentPlugin {
  addListener(event: 'shared', cb: (data: { text: string }) => void): Promise<PluginListenerHandle>;
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

async function offerCopiedLink(onShared: (text: string) => void) {
  const { hasLink, changeCount } = await ClipboardLink.check();
  if (!hasLink || localStorage.getItem(LAST_OFFERED_COPY) === String(changeCount)) return;
  localStorage.setItem(LAST_OFFERED_COPY, String(changeCount));
  toast(
    'Save the link you copied?',
    {
      label: 'Save',
      run: async () => {
        const { text } = await ClipboardLink.readLink();
        if (text) onShared(text);
      },
    },
    10_000,
  );
}

/** How links from other apps reach Margin on each platform. */
const shareTargets: Record<Platform, (onShared: (text: string) => void) => void> = {
  // The PWA receives shares through the web manifest's share_target (/add route).
  web: () => {},
  android: (onShared) => void ShareIntent.addListener('shared', ({ text }) => onShared(text)),
  ios: (onShared) => {
    const offer = () => offerCopiedLink(onShared).catch((e) => console.warn('Copied-link check failed', e));
    void offer();
    void App.addListener('appStateChange', ({ isActive }) => isActive && void offer());
  },
};

export const initShareTarget = (onShared: (text: string) => void) => shareTargets[platform](onShared);

/** Android back button: go back in the app, and leave the app from the top level. (iOS uses swipe-back.) */
export function initBackButton() {
  if (platform !== 'android') return;
  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && window.location.pathname !== '/') window.history.back();
    else void App.exitApp();
  });
}
