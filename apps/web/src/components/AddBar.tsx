import { FileUp } from 'lucide-react';
import { useRef, useState, type FormEvent } from 'react';
import { saveUrl } from '../data/actions.ts';
import { addFiles, fromFileList } from '../data/addFiles.ts';
import { toast } from '../data/toast.ts';

export function AddBar() {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const picker = useRef<HTMLInputElement>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!value.trim()) return;
    const id = await saveUrl(value);
    if (!id) {
      setError('Paste a full link, like https://example.com/article');
      return;
    }
    setValue('');
    setError(null);
    toast('Saved to Home');
  };

  return (
    <form className="add-bar" onSubmit={submit}>
      <input
        id="add-input"
        type="text"
        inputMode="url"
        autoComplete="off"
        placeholder="Paste a link to save it"
        aria-label="Link to save"
        aria-invalid={!!error}
        value={value}
        onChange={(e) => {
          setValue(e.target.value);
          setError(null);
        }}
      />
      <button type="submit" className="button primary" disabled={!value.trim()}>
        Save
      </button>
      <button
        type="button"
        className="button add-pdf"
        onClick={() => picker.current?.click()}
        title="Add PDFs from this device"
        aria-label="Add PDF"
      >
        <FileUp size={16} aria-hidden /> <span className="add-pdf-label">Add PDF</span>
      </button>
      <input
        ref={picker}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        hidden
        onChange={(e) => {
          void addFiles(fromFileList(e.target.files));
          e.target.value = '';
        }}
      />
      {error && <p className="field-error">{error}</p>}
    </form>
  );
}
