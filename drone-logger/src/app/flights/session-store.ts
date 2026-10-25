import { handleOf } from './file-handles';

/**
 * Saved LovelyOSD sessions, in this browser only (IndexedDB): which log and files a video was made from, and
 * everything set up for it, from the sync to the grade. Files are kept as File System Access handles where the browser
 * has them (Chrome, Edge), so a session reopens them after one permission click; elsewhere it asks for each file by
 * name. Nothing is uploaded.
 */

/** A file a session uses: its handle where there is one, and enough to recognise it when picked again. */
export interface SavedFile {
  name: string;
  size: number;
  lastModified: number;
  handle: FileSystemFileHandle | null;
}

export interface SavedSession<State = unknown> {
  id: string;
  name: string;
  savedAt: number;
  log: SavedFile;
  /** Which armed session in the log file. */
  logIndex: number;
  footage: SavedFile | null;
  sound: SavedFile | null;
  music: SavedFile | null;
  /** The editor's state, as it takes it back. */
  editor: State;
}

export const savedFile = (file: File | null): SavedFile | null =>
  file ? { name: file.name, size: file.size, lastModified: file.lastModified, handle: handleOf(file) } : null;

/** The same file as it was saved: same name and size. */
export const sameFile = (saved: SavedFile, file: File) => saved.name === file.name && saved.size === file.size;

type Permission = 'granted' | 'denied' | 'prompt';
interface PermissionHandle { queryPermission(o: { mode: 'read' }): Promise<Permission>; requestPermission(o: { mode: 'read' }): Promise<Permission> }

/**
 * The saved file, read again through its handle: asks for permission if the browser wants it (which needs a click to
 * be underway). Null when there's no handle, permission is refused, or the file has gone or changed.
 */
export async function reopen(saved: SavedFile | null): Promise<File | null> {
  if (!saved?.handle) return null;
  try {
    const h = saved.handle as unknown as PermissionHandle;
    let permission = await h.queryPermission({ mode: 'read' });
    if (permission === 'prompt') permission = await h.requestPermission({ mode: 'read' });
    if (permission !== 'granted') return null;
    const file = await saved.handle.getFile();
    return sameFile(saved, file) ? file : null;
  } catch {
    return null; // moved, deleted, or the drive isn't there
  }
}

const DB = 'gitdrone-sessions';
const STORE = 'sessions';

function open(): Promise<IDBDatabase> {
  return new Promise((ok, fail) => {
    const req = indexedDB.open(DB, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: 'id' });
    req.onsuccess = () => ok(req.result);
    req.onerror = () => fail(req.error);
  });
}

async function run<T>(mode: IDBTransactionMode, work: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await open();
  return new Promise<T>((ok, fail) => {
    const tx = db.transaction(STORE, mode);
    const req = work(tx.objectStore(STORE));
    tx.oncomplete = () => ok(req.result);
    tx.onerror = () => fail(tx.error);
  });
}

/** Every saved session, newest first; none where storage is blocked (private windows). */
export async function listSessions<State>(): Promise<SavedSession<State>[]> {
  try {
    const all = await run<SavedSession<State>[]>('readonly', s => s.getAll());
    return all.sort((a, b) => b.savedAt - a.savedAt);
  } catch {
    return [];
  }
}

export async function putSession<State>(session: SavedSession<State>): Promise<boolean> {
  try {
    await run('readwrite', s => s.put(session));
    return true;
  } catch {
    return false;
  }
}

export async function deleteSession(id: string): Promise<void> {
  try {
    await run('readwrite', s => s.delete(id));
  } catch { /* already gone */ }
}
