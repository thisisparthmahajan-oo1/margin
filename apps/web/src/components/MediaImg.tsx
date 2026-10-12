import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { isMediaPath, resolveMedia } from '../data/media.ts';

/** <img> that prefers the on-device copy of a stored article image. */
export function MediaImg({ src, ...rest }: ImgHTMLAttributes<HTMLImageElement> & { src: string }) {
  const [resolved, setResolved] = useState(isMediaPath(src) ? null : src);
  useEffect(() => {
    let live = true;
    void resolveMedia(src).then((url) => live && setResolved(url));
    return () => {
      live = false;
    };
  }, [src]);
  return resolved ? <img src={resolved} {...rest} /> : null;
}
