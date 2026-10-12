import { Eye, EyeOff } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { signIn, useAuth } from '../data/auth.ts';

/** Shows the app once this device is signed in; otherwise asks for the access token. */
export function TokenGate({ children }: { children: ReactNode }) {
  const auth = useAuth();
  if (auth.status === 'ready') return <>{children}</>;
  if (auth.status === 'checking') return null;
  return <SignIn reason={auth.reason} />;
}

function SignIn({ reason }: { reason: string | null }) {
  const [token, setToken] = useState('');
  const [visible, setVisible] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!token.trim() || busy) return;
    setBusy(true);
    setError(null);
    try {
      await signIn(token);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <main className="token-gate">
      <form className="token-card" onSubmit={submit}>
        <span className="wordmark">Margin</span>
        <h1>Enter your access token</h1>
        <p className="token-help">
          {reason ?? 'This is the APP_TOKEN set on your Margin server. You’ll stay signed in on this device for 30 days.'}
        </p>
        <label className="visually-hidden" htmlFor="token-input">
          Access token
        </label>
        <div className="token-field">
          <input
            id="token-input"
            type={visible ? 'text' : 'password'}
            autoFocus
            autoComplete="current-password"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Access token"
            aria-invalid={!!error}
            aria-describedby={error ? 'token-error' : undefined}
            value={token}
            onChange={(e) => {
              setToken(e.target.value);
              setError(null);
            }}
          />
          <button
            type="button"
            className="icon-button small"
            aria-label={visible ? 'Hide token' : 'Show token'}
            onClick={() => setVisible((v) => !v)}
          >
            {visible ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>
        {error && (
          <p id="token-error" className="field-error">
            {error}
          </p>
        )}
        <button type="submit" className="button primary token-submit" disabled={!token.trim() || busy}>
          {busy ? 'Signing in…' : 'Continue'}
        </button>
      </form>
    </main>
  );
}
