import { Directive } from '@angular/core';

/**
 * Keeping hold of picked files, so a saved session can open them again without picking each one: in Chrome and Edge,
 * file inputs marked \`appKeepFile\` open the File System Access picker instead, whose handles can be stored and asked
 * for again later. The input still fires its usual change event with the file, so nothing else has to change. Other
 * browsers get their ordinary file dialog and no handle.
 */

/** The handle behind each picked file, where there is one. */
const handles = new WeakMap<File, FileSystemFileHandle>();

export const rememberHandle = (file: File, handle: FileSystemFileHandle) => handles.set(file, handle);
export const handleOf = (file: File | null | undefined) => (file ? handles.get(file) ?? null : null);
/** Chrome and Edge: files picked here can be reopened by a saved session. */
export const canKeepFiles = () => typeof window !== 'undefined' && 'showOpenFilePicker' in window;

interface PickerType { description: string; accept: Record<string, string[]> }
type OpenFilePicker = (o: { id?: string; types?: PickerType[]; excludeAcceptAllOption?: boolean }) => Promise<FileSystemFileHandle[]>;

const VIDEO_EXTS = ['.mp4', '.mov', '.m4v', '.mkv', '.webm', '.avi', '.ts', '.mts'];
const AUDIO_EXTS = ['.mp3', '.m4a', '.aac', '.wav', '.ogg', '.oga', '.opus', '.flac', '.weba'];

/** An input's \`accept\` as picker file types: "video/*", "audio/*" and plain extensions like ".bbl". */
function pickerTypes(accept: string): PickerType[] {
  const types: PickerType[] = [];
  const exts: string[] = [];
  for (const token of accept.split(',').map(t => t.trim()).filter(Boolean)) {
    if (token === 'video/*') types.push({ description: 'Videos', accept: { 'video/*': VIDEO_EXTS } });
    else if (token === 'audio/*') types.push({ description: 'Sound', accept: { 'audio/*': AUDIO_EXTS } });
    else if (token.startsWith('.')) exts.push(token);
  }
  if (exts.length) types.push({ description: 'Files', accept: { 'application/octet-stream': exts } });
  return types;
}

/**
 * Set once the picker turns out not to work here (some embedded browsers have it but won't open or read files from it):
 * from then on file inputs open the ordinary dialog.
 */
let pickerBroken = false;

/** Remembers the folder per kind of file, as the ordinary dialog does. */
const pickerId = (accept: string) => (accept.includes('video') ? 'gitdrone-video' : accept.includes('audio') ? 'gitdrone-sound' : 'gitdrone-file');

@Directive({
  selector: 'input[type=file][appKeepFile]',
  host: { '(click)': 'pick($event)' },
})
export class KeepFileDirective {
  async pick(event: MouseEvent) {
    if (!canKeepFiles() || pickerBroken) return; // the ordinary dialog opens
    event.preventDefault();
    const input = event.target as HTMLInputElement;
    const picker = (window as unknown as { showOpenFilePicker: OpenFilePicker }).showOpenFilePicker;
    // The ordinary dialog instead, straight away if this click still allows it, or on the next click if not.
    const fallBack = () => {
      pickerBroken = true;
      try { input.showPicker(); } catch { /* needs a fresh click, which now opens it */ }
    };
    let handle: FileSystemFileHandle;
    try {
      [handle] = await picker({ id: pickerId(input.accept), types: pickerTypes(input.accept), excludeAcceptAllOption: false });
    } catch (err) {
      if (!(err instanceof DOMException && err.name === 'AbortError')) fallBack();
      return; // closed without picking
    }
    let file: File;
    try {
      file = await handle.getFile();
    } catch {
      fallBack();
      return;
    }
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;
    // The input may hand out its own File object for the same file; remember the handle for both.
    rememberHandle(file, handle);
    if (input.files[0]) rememberHandle(input.files[0], handle);
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }
}
