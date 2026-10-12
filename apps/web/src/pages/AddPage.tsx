import { useEffect, useRef } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { saveUrl } from '../data/actions.ts';
import { toast } from '../data/toast.ts';

/** PWA share target (and a bookmarklet-friendly URL): /add?url=… or /add?text=… */
export function AddPage() {
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const done = useRef(false);

  useEffect(() => {
    if (done.current) return;
    done.current = true;
    const input = [params.get('url'), params.get('text'), params.get('title')].filter(Boolean).join(' ');
    void saveUrl(input).then((id) => {
      toast(id ? 'Saved to Home' : 'No link found in what was shared');
      navigate('/', { replace: true });
    });
  }, [params, navigate]);

  return null;
}
