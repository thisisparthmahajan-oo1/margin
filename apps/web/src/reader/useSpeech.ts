import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { speech } from '../platform/speech.ts';

const BLOCKS = 'h1, h2, h3, h4, p, li, blockquote, figcaption, pre';
export const RATES = [1, 1.25, 1.5, 1.75, 2] as const;

/**
 * Listen to an article: speaks one block at a time (long utterances get cut off on some engines)
 * and marks the block being read. Pause stops the engine and resume restarts the current block.
 */
export function useSpeech(root: RefObject<HTMLElement | null>) {
  const [state, setState] = useState<'stopped' | 'playing' | 'paused'>('stopped');
  const [rate, setRate] = useState<(typeof RATES)[number]>(1);
  const blocks = useRef<HTMLElement[]>([]);
  const index = useRef(0);
  const rateRef = useRef(rate);
  /** Bumped on every start/stop so a finishing utterance from an older run doesn't advance. */
  const run = useRef(0);

  const mark = (i: number | null) => {
    blocks.current.forEach((b, j) => b.classList.toggle('speaking', j === i));
    if (i !== null) blocks.current[i]?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  };

  const speakFrom = useCallback(async (start: number) => {
    const myRun = ++run.current;
    await speech.stop();
    setState('playing');
    for (let i = start; i < blocks.current.length; i++) {
      if (run.current !== myRun) return;
      index.current = i;
      mark(i);
      await speech.speak(blocks.current[i]!.innerText, rateRef.current);
    }
    if (run.current === myRun) {
      mark(null);
      setState('stopped');
    }
  }, []);

  const play = () => {
    if (state === 'paused') {
      void speakFrom(index.current);
      return;
    }
    blocks.current = [...(root.current?.querySelectorAll<HTMLElement>(BLOCKS) ?? [])].filter(
      (b) => b.innerText.trim() && !b.parentElement?.closest(BLOCKS),
    );
    // Start from the first block visible on screen, like resuming where you're reading.
    const firstVisible = blocks.current.findIndex((b) => b.getBoundingClientRect().bottom > 80);
    void speakFrom(Math.max(0, firstVisible));
  };

  const pause = () => {
    run.current++;
    void speech.stop();
    setState('paused');
  };

  const stop = useCallback(() => {
    run.current++;
    void speech.stop();
    mark(null);
    setState('stopped');
  }, []);

  const cycleRate = () => {
    const next = RATES[(RATES.indexOf(rate) + 1) % RATES.length]!;
    setRate(next);
    rateRef.current = next;
    if (state === 'playing') void speakFrom(index.current); // restart the current block at the new speed
  };

  useEffect(() => () => {
    run.current++;
    if (speech.supported) void speech.stop();
  }, []);

  return { supported: speech.supported, state, rate, play, pause, stop, cycleRate };
}
