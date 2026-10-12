import type { ReaderFont, ReaderTheme } from '@margin/shared';
import { FONTS, readerSettings, THEMES, useReaderSettings } from '../data/settings.ts';

const LINE_HEIGHTS = [
  { label: 'Tight', value: 1.45 },
  { label: 'Normal', value: 1.6 },
  { label: 'Loose', value: 1.8 },
];
const MEASURES = [
  { label: 'Narrow', value: 56 },
  { label: 'Normal', value: 66 },
  { label: 'Wide', value: 78 },
];

export function ReaderSettingsPanel() {
  const s = useReaderSettings();
  return (
    <div className="panel settings-panel" role="dialog" aria-label="Text settings">
      <div className="size-row">
        <button
          className="size-button"
          aria-label="Smaller text"
          disabled={s.fontSize <= 14}
          onClick={() => readerSettings.set({ fontSize: s.fontSize - 1 })}
        >
          <span style={{ fontSize: 14 }}>A</span>
        </button>
        <span className="size-value">{s.fontSize}</span>
        <button
          className="size-button"
          aria-label="Larger text"
          disabled={s.fontSize >= 30}
          onClick={() => readerSettings.set({ fontSize: s.fontSize + 1 })}
        >
          <span style={{ fontSize: 22 }}>A</span>
        </button>
      </div>

      <div className="theme-row" role="radiogroup" aria-label="Theme">
        {(Object.keys(THEMES) as ReaderTheme[]).map((t) => (
          <button
            key={t}
            role="radio"
            aria-checked={s.theme === t}
            aria-label={THEMES[t].label}
            className="theme-swatch"
            style={{ background: THEMES[t].bg, color: THEMES[t].fg }}
            onClick={() => readerSettings.set({ theme: t })}
          >
            Aa
          </button>
        ))}
      </div>

      <div className="font-list" role="radiogroup" aria-label="Font">
        {(Object.keys(FONTS) as ReaderFont[]).map((f) => (
          <button
            key={f}
            role="radio"
            aria-checked={s.font === f}
            style={{ fontFamily: FONTS[f].stack }}
            onClick={() => readerSettings.set({ font: f })}
          >
            {FONTS[f].label}
          </button>
        ))}
      </div>

      <Segmented label="Line spacing" options={LINE_HEIGHTS} value={s.lineHeight} onChange={(lineHeight) => readerSettings.set({ lineHeight })} />
      <Segmented label="Width" options={MEASURES} value={s.measure} onChange={(measure) => readerSettings.set({ measure })} />
    </div>
  );
}

function Segmented({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { label: string; value: number }[];
  value: number;
  onChange: (v: number) => void;
}) {
  return (
    <div className="segmented-row">
      <span>{label}</span>
      <div className="segmented" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button key={o.value} role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}
