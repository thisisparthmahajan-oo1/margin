import { savePdf } from './actions.ts';
import { toast } from './toast.ts';

/** Adds files picked, dropped or shared on this device. Only PDFs are kept. */
export async function addFiles(files: { blob: Blob; name: string }[]) {
  let saved = 0;
  for (const f of files) if (await savePdf(f.blob, f.name)) saved++;
  const skipped = files.length - saved;
  if (saved && !skipped) toast(saved === 1 ? 'Saved to Home' : `${saved} PDFs saved to Home`);
  else if (saved) toast(`${saved} saved. ${skipped} ${skipped === 1 ? 'file isn’t a PDF' : 'files aren’t PDFs'}, so ${skipped === 1 ? 'it was' : 'they were'} skipped.`);
  else toast(files.length === 1 ? 'Only PDFs can be added' : 'None of these files are PDFs');
}

export const fromFileList = (list: FileList | null) => [...(list ?? [])].map((f) => ({ blob: f as Blob, name: f.name }));
