/**
 * Talks to a Betaflight flight controller over USB (Web Serial, Chrome and Edge) to reboot it into mass storage
 * mode, then reads the blackbox logs off the drive it turns into (File System Access API). This is what the
 * Configurator's "Activate Mass Storage Device Mode" button does, minus the Configurator.
 */

import { rememberHandle } from './file-handles';

// Just enough of the Web Serial and File System Access types for this file; TypeScript's DOM lib has neither yet.
interface SerialPortLike {
  open(options: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readable: ReadableStream<Uint8Array> | null;
  writable: WritableStream<Uint8Array> | null;
}
interface SerialLike {
  requestPort(options?: { filters?: { usbVendorId: number }[] }): Promise<SerialPortLike>;
}
interface DirectoryHandleLike {
  name: string;
  values(): AsyncIterable<{ kind: 'file' | 'directory'; name: string; getFile?: () => Promise<File> }>;
}
type DirectoryPicker = (options?: { id?: string; mode?: 'read' }) => Promise<DirectoryHandleLike>;

const MSP_FC_VARIANT = 2;
const MSP_SET_REBOOT = 68;
const REBOOT_MSC = 2;
const REBOOT_MSC_UTC = 3;

/** USB vendor ids of the chips and bridges flight controllers use, so the port list shows only likely FCs. */
const FC_VENDOR_IDS = [
  0x0483, // STMicroelectronics (F4, F7, H7 VCP)
  0x2e3c, // Artery AT32
  0x314b, // Geehy APM32
  0x10c4, // Silicon Labs CP210x
  0x0403, // FTDI
  0x1a86, // WCH CH340
];

export const LOG_FILE_PATTERN = /\.(bbl|bfl|bbs)$/i;

export function serialSupported() {
  return typeof navigator !== 'undefined' && 'serial' in navigator;
}

export function drivePickerSupported() {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

export class FcUsbError extends Error {}

/**
 * Asks the user for the flight controller's port and reboots it into mass storage mode. Resolves once the FC has
 * agreed; it then drops off the serial bus and shows up as a drive a few seconds later.
 */
export async function rebootToMassStorage(): Promise<void> {
  const serial = (navigator as unknown as { serial: SerialLike }).serial;
  let port: SerialPortLike;
  try {
    port = await serial.requestPort({ filters: FC_VENDOR_IDS.map(usbVendorId => ({ usbVendorId })) });
  } catch {
    throw new FcUsbError('No flight controller picked. Plug it in over USB (no battery needed) and try again.');
  }

  try {
    await port.open({ baudRate: 115200 });
  } catch {
    throw new FcUsbError('Could not open that port. Close the Betaflight Configurator or anything else using it, then try again.');
  }

  const link = new MspLink(port);
  try {
    const variant = new TextDecoder().decode(await link.request(MSP_FC_VARIANT));
    if (variant !== 'BTFL') {
      throw new FcUsbError(variant ? `This flight controller runs ${variant}, not Betaflight.` : 'That port did not answer like a Betaflight flight controller.');
    }

    // Betaflight's Configurator asks for UTC file times on Linux and local time everywhere else.
    const mode = /linux/i.test(navigator.userAgent) && !/android/i.test(navigator.userAgent) ? REBOOT_MSC_UTC : REBOOT_MSC;
    // The FC often drops off USB before its reply makes it back; once the command is out, silence means it rebooted.
    const reply = await link.request(MSP_SET_REBOOT, [mode], { optional: true });
    // The reply echoes the mode, then says whether the flash or SD card is ready to share.
    if (reply && reply.length >= 2 && reply[1] === 0) {
      throw new FcUsbError('The flight controller says its log storage is not ready. Check the SD card, or that this board has blackbox flash.');
    }
  } finally {
    await link.close();
  }
}

/** Lets the user pick the FC's drive and returns the blackbox logs on it, newest first; null if they backed out. */
export async function readDriveLogs(): Promise<{ drive: string; files: File[] } | null> {
  const picker = (window as unknown as { showDirectoryPicker: DirectoryPicker }).showDirectoryPicker;
  let dir: DirectoryHandleLike;
  try {
    dir = await picker({ id: 'fc-drive', mode: 'read' });
  } catch {
    return null;
  }
  const files: File[] = [];
  for await (const entry of dir.values()) {
    if (entry.kind === 'file' && entry.getFile && LOG_FILE_PATTERN.test(entry.name)) {
      const file = await entry.getFile();
      // The entry is the file's handle: a saved session can read the log from the drive again.
      rememberHandle(file, entry as unknown as FileSystemFileHandle);
      files.push(file);
    }
  }
  // FCs without a clock stamp every file with the same date, so the log number breaks the tie.
  files.sort((a, b) => b.lastModified - a.lastModified || b.name.localeCompare(a.name, undefined, { numeric: true }));
  return { drive: dir.name, files };
}

/** MSP v1 requests and replies over an open serial port. */
class MspLink {
  private reader: ReadableStreamDefaultReader<Uint8Array>;
  private writer: WritableStreamDefaultWriter<Uint8Array>;
  private buffer: number[] = [];

  constructor(private port: SerialPortLike) {
    this.reader = port.readable!.getReader();
    this.writer = port.writable!.getWriter();
  }

  async request(command: number, payload?: number[]): Promise<Uint8Array>;
  /** `optional`: resolve null rather than fail when no reply comes, for commands that make the FC go away. */
  async request(command: number, payload: number[], options: { optional: true }): Promise<Uint8Array | null>;
  async request(command: number, payload: number[] = [], { optional = false } = {}): Promise<Uint8Array | null> {
    const timeoutMs = 1500;
    let checksum = payload.length ^ command;
    for (const b of payload) checksum ^= b;
    await this.writer.write(new Uint8Array([0x24, 0x4d, 0x3c, payload.length, command, ...payload, checksum]));

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const frame = this.takeFrame(command);
      if (frame) return frame;
      const chunk = await this.readWithin(deadline - Date.now());
      if (!chunk) break;
      this.buffer.push(...chunk);
    }
    if (optional) return null;
    throw new FcUsbError('The flight controller did not answer. Unplug it, plug it back in and try again.');
  }

  /** Pulls the reply to `command` out of the buffer, skipping noise and replies to anything else. */
  private takeFrame(command: number): Uint8Array | null {
    const b = this.buffer;
    for (;;) {
      const start = b.findIndex((v, i) => v === 0x24 && b[i + 1] === 0x4d && (b[i + 2] === 0x3e || b[i + 2] === 0x21));
      if (start < 0) { b.splice(0, Math.max(0, b.length - 2)); return null; }
      if (start > 0) b.splice(0, start);
      if (b.length < 5) return null;
      const size = b[3];
      if (b.length < 6 + size) return null;
      const frame = b.splice(0, 6 + size);
      if (frame[4] !== command) continue;
      if (frame[2] === 0x21) throw new FcUsbError('The flight controller refused the request. It may need a newer Betaflight.');
      return new Uint8Array(frame.slice(5, 5 + size));
    }
  }

  /** A read that outlived its timeout stays here, so the next call picks up its bytes instead of losing them. */
  private pending: Promise<Uint8Array | null> | null = null;

  private async readWithin(ms: number): Promise<Uint8Array | null> {
    this.pending ??= this.reader.read().then(r => r.value ?? null, () => null);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<'timeout'>(resolve => { timer = setTimeout(() => resolve('timeout'), Math.max(0, ms)); });
    try {
      const result = await Promise.race([this.pending, timeout]);
      if (result === 'timeout') return null;
      this.pending = null;
      return result;
    } finally {
      clearTimeout(timer);
    }
  }

  /** The FC drops off the bus as it reboots, so every step here may fail; none of that matters. */
  async close() {
    await this.reader.cancel().catch(() => undefined);
    this.reader.releaseLock();
    this.writer.releaseLock();
    await this.port.close().catch(() => undefined);
  }
}
