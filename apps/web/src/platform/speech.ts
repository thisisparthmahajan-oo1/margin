import { Capacitor } from '@capacitor/core';
import { TextToSpeech } from '@capacitor-community/text-to-speech';

/**
 * Reads one piece of text aloud. `speak` settles when the text finishes or `stop()` is called.
 * Pausing is done by the caller as stop + re-speak, so both engines share one simple contract.
 */
export interface SpeechEngine {
  supported: boolean;
  speak(text: string, rate: number): Promise<void>;
  stop(): Promise<void>;
}

const webSpeech: SpeechEngine = {
  supported: typeof window !== 'undefined' && 'speechSynthesis' in window,
  speak: (text, rate) =>
    new Promise((resolve) => {
      const u = new SpeechSynthesisUtterance(text);
      u.rate = rate;
      u.onend = () => resolve();
      u.onerror = () => resolve();
      speechSynthesis.speak(u);
    }),
  stop: async () => speechSynthesis.cancel(),
};

/** Android WebView has no speechSynthesis; use the system TTS engine through the plugin. */
const nativeSpeech: SpeechEngine = {
  supported: true,
  speak: (text, rate) => TextToSpeech.speak({ text, rate, lang: navigator.language || 'en-US', category: 'playback' }).catch(() => {}),
  stop: () => TextToSpeech.stop().catch(() => {}),
};

export const speech: SpeechEngine = Capacitor.isNativePlatform() ? nativeSpeech : webSpeech;
