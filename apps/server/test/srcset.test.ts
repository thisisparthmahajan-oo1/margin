import { describe, expect, it } from 'vitest';
import { parseSrcset } from '../src/pipeline.ts';

describe('srcset', () => {
  it('keeps commas inside image CDN URLs (Substack)', () => {
    const cdn = (w: number) =>
      `https://substackcdn.com/image/fetch/$s_!xNU1!,w_${w},c_limit,f_auto,q_auto:good,fl_progressive:steep/https%3A%2F%2Fsubstack-post-media.s3.amazonaws.com%2Fpublic%2Fimages%2F47afb112_1804x1820.png`;
    expect(parseSrcset(`${cdn(424)} 424w, ${cdn(848)} 848w, ${cdn(1456)} 1456w`)).toEqual([
      { url: cdn(424), weight: 424 },
      { url: cdn(848), weight: 848 },
      { url: cdn(1456), weight: 1456 },
    ]);
  });

  it('reads the usual forms', () => {
    expect(parseSrcset('a.jpg 1x, b.jpg 2x')).toEqual([{ url: 'a.jpg', weight: 1 }, { url: 'b.jpg', weight: 2 }]);
    // As in browsers: a comma right after a URL ends it, a comma inside one (no space after) doesn't.
    expect(parseSrcset('a.jpg, b.jpg 300w')).toEqual([{ url: 'a.jpg', weight: 1 }, { url: 'b.jpg', weight: 300 }]);
    expect(parseSrcset('img?w=1,h=2 300w')).toEqual([{ url: 'img?w=1,h=2', weight: 300 }]);
    expect(parseSrcset('  a.jpg  ,  b.jpg 640w ,c.jpg ')).toEqual([
      { url: 'a.jpg', weight: 1 },
      { url: 'b.jpg', weight: 640 },
      { url: 'c.jpg', weight: 1 },
    ]);
    expect(parseSrcset('')).toEqual([]);
  });
});
