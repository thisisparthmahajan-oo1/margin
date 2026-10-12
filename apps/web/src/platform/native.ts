import { App } from '@capacitor/app';
import { Capacitor, registerPlugin, type PluginListenerHandle } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();

/**
 * Our own Android plugin (apps/android/.../ShareIntentPlugin.java): text shared to the app via the
 * share sheet. Events are retained natively until this listener attaches, so cold starts work too.
 */
interface ShareIntentPlugin {
  addListener(event: 'shared', cb: (data: { text: string }) => void): Promise<PluginListenerHandle>;
}
const ShareIntent = registerPlugin<ShareIntentPlugin>('ShareIntent');

export function initShareTarget(onShared: (text: string) => void) {
  if (!isNative) return; // the PWA receives shares through the manifest share_target (/add)
  void ShareIntent.addListener('shared', ({ text }) => onShared(text));
}

/** Android back button: go back in the app, and leave the app from the top level. */
export function initBackButton() {
  if (!isNative) return;
  void App.addListener('backButton', ({ canGoBack }) => {
    if (canGoBack && window.location.pathname !== '/') window.history.back();
    else void App.exitApp();
  });
}
