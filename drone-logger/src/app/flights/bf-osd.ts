/**
 * The OSD layout from a Betaflight CLI backup (diff all or dump): which elements are on, where on the character grid,
 * and the settings that change how they read (units, timers, alarms, cell voltages, craft name). The overlay redraws
 * that OSD from the log, character for character, so footage recorded without its OSD (DJI O4) gets it back.
 */
export interface BfOsdLayout {
  /** The backup's file name. */
  name: string;
  /** Character grid: 53 x 20 on HD (DJI, Walksnail, HDZero), 30 x 16 on PAL, 30 x 13 on NTSC. */
  cols: number;
  rows: number;
  /** Elements switched on in the active OSD profile that the overlay can draw, in Betaflight's drawing order. */
  elements: BfOsdElement[];
  /** Elements switched on that need data a blackbox log doesn't have (ESC temperature, flight mode...), by setting name. */
  skipped: string[];
  craftName: string;
  pilotName: string;
  units: 'IMPERIAL' | 'METRIC' | 'BRITISH';
  /** osd_timer_1 and osd_timer_2: source in the low 4 bits, precision in the next 4. */
  timers: [number, number];
  /** Per-cell voltages, in volts: the battery icon spans min..max, and below warn (min) is LOW BATTERY (LAND NOW). */
  cellMin: number;
  cellWarn: number;
  cellMax: number;
  lqAlarm: number;
  rssiAlarm: number;
  capAlarm: number;
  /** osd_stick_overlay_radio_mode, 1..4. */
  stickMode: 1 | 2 | 3 | 4;
}

export type BfOsdId =
  | 'vbat' | 'avg_cell_voltage' | 'rssi' | 'link_quality' | 'rssi_dbm' | 'tim_1' | 'tim_2' | 'current' | 'mah_drawn'
  | 'power' | 'gps_speed' | 'gps_sats' | 'altitude' | 'home_dist' | 'home_dir' | 'flight_dist' | 'throttle'
  | 'crosshairs' | 'g_force' | 'craft_name' | 'pilot_name' | 'warnings' | 'stick_overlay_left' | 'stick_overlay_right';

export interface BfOsdElement {
  id: BfOsdId;
  x: number;
  y: number;
  /** The element variant (bits 14-15): altitude's type 2 has no decimal. */
  type: number;
}

/** The ones drawn, in osd_elements.c's display order (later ones on top). */
const DRAWN: BfOsdId[] = [
  'rssi', 'link_quality', 'rssi_dbm', 'vbat', 'avg_cell_voltage', 'current', 'mah_drawn', 'power', 'tim_1', 'tim_2',
  'throttle', 'g_force', 'gps_sats', 'gps_speed', 'altitude', 'home_dist', 'home_dir', 'flight_dist', 'craft_name',
  'pilot_name', 'stick_overlay_left', 'stick_overlay_right', 'warnings', 'crosshairs',
];

/** OSD_POS: x in bits 0-4 plus bit 10 (HD columns past 31), y in bits 5-9, one visibility bit per OSD profile from bit 11. */
const posX = (v: number) => (v & 0x1f) | ((v & 0x400) >> 5);
const posY = (v: number) => (v >> 5) & 0x1f;
const PROFILE_BIT = 11;

export function parseBfOsd(name: string, text: string): BfOsdLayout {
  if (!/^#\s*Betaflight\b/m.test(text) && !/^set\s+osd_/m.test(text)) {
    throw new Error("That isn't a Betaflight CLI backup. Save one from the Configurator's CLI tab (Save to File), or paste diff all into a .txt file.");
  }
  // Master settings only: OSD positions aren't per profile, so the first value wins and later profile sections can't clash.
  const set = new Map<string, string>();
  for (const line of text.split(/\r?\n/)) {
    const m = /^\s*set\s+([a-z0-9_]+)\s*=\s*(.*?)\s*$/i.exec(line);
    if (m && !set.has(m[1].toLowerCase())) set.set(m[1].toLowerCase(), m[2]);
  }
  const num = (key: string, fallback: number) => {
    const n = Number(set.get(key));
    return set.has(key) && Number.isFinite(n) ? n : fallback;
  };
  const word = (key: string, fallback: string) => (set.get(key) ?? fallback).toUpperCase();

  const profile = Math.min(3, Math.max(1, num('osd_profile', 1)));
  const visible = new Map<string, number>();
  for (const [key, value] of set) {
    const m = /^osd_(.+)_pos$/.exec(key);
    const v = Number(value);
    if (m && Number.isFinite(v) && v & (1 << (PROFILE_BIT + profile - 1))) visible.set(m[1], v);
  }
  if (!visible.size) throw new Error('No OSD elements are switched on in this backup (OSD profile ' + profile + ').');

  const elements = DRAWN.filter(id => visible.has(id)).map(id => {
    const v = visible.get(id)!;
    return { id, x: posX(v), y: posY(v), type: (v >> 14) & 3 };
  });
  // The disarmed banner never shows in flight, so it isn't missing.
  const skipped = [...visible.keys()].filter(k => !DRAWN.includes(k as BfOsdId) && k !== 'disarmed').map(k => `osd_${k}_pos`);

  // The grid: the canvas the VTX reported when saved, else the video system, else whatever the positions need.
  let cols = num('osd_canvas_width', 0), rows = num('osd_canvas_height', 0);
  if (!cols || !rows) {
    const video = word('vcd_video_system', 'AUTO');
    const msp = word('osd_displayport_device', 'AUTO') === 'MSP';
    const beyondSd = [...visible.values()].some(v => posX(v) > 29 || posY(v) > 15);
    [cols, rows] = video === 'HD' || msp || beyondSd ? [53, 20] : video === 'NTSC' ? [30, 13] : [30, 16];
  }

  const units = word('osd_units', 'METRIC');
  const mode = num('osd_stick_overlay_radio_mode', 2);
  return {
    name, cols, rows, elements, skipped,
    craftName: set.get('craft_name') ?? '',
    pilotName: set.get('pilot_name') ?? '',
    units: units === 'IMPERIAL' || units === 'BRITISH' ? units : 'METRIC',
    // Betaflight's defaults: timer 1 is power-on time, timer 2 total armed time, both in whole seconds.
    timers: [num('osd_timer_1', 0x0a00), num('osd_timer_2', 0x0a01)],
    cellMin: num('vbat_min_cell_voltage', 330) / 100,
    cellWarn: num('vbat_warning_cell_voltage', 350) / 100,
    cellMax: num('vbat_max_cell_voltage', 430) / 100,
    lqAlarm: num('osd_link_quality_alarm', 80),
    rssiAlarm: num('osd_rssi_alarm', 20),
    capAlarm: num('osd_cap_alarm', 2200),
    stickMode: mode === 1 || mode === 3 || mode === 4 ? mode : 2,
  };
}

/** Plain names for elements, by id or by setting name (as in `skipped`), for telling the user what won't be drawn. */
export const bfOsdLabel = (id: string) => {
  const key = id.replace(/^osd_|_pos$/g, '');
  return BF_LABELS[key] ?? key.replace(/_/g, ' ');
};

const BF_LABELS: Record<string, string> = {
  vbat: 'battery voltage', avg_cell_voltage: 'cell voltage', rssi: 'RSSI', link_quality: 'link quality',
  rssi_dbm: 'RSSI dBm', tim_1: 'timer 1', tim_2: 'timer 2', current: 'current', mah_drawn: 'mAh used',
  power: 'power', gps_speed: 'GPS speed', gps_sats: 'satellites', altitude: 'altitude', home_dist: 'distance home',
  home_dir: 'home arrow', flight_dist: 'flight distance', throttle: 'throttle', g_force: 'G-force',
  stick_overlay_left: 'left stick', stick_overlay_right: 'right stick', esc_tmp: 'ESC temperature',
  esc_rpm: 'ESC RPM', flymode: 'flight mode', ah: 'artificial horizon', ah_sbar: 'horizon sidebars',
  vtx_channel: 'VTX channel', rtc_date_time: 'date and time', compass_bar: 'compass bar', nheading: 'heading',
};

// ---- remembering the backup (this browser only; never uploaded) ----

const KEY = 'gitdrone-bf-osd';

export function saveBfOsd(name: string, text: string | null) {
  try {
    if (text === null) localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, JSON.stringify({ name, text }));
  } catch { /* private mode or full storage: the layout just isn't remembered */ }
}

export function loadSavedBfOsd(): BfOsdLayout | null {
  try {
    const saved = JSON.parse(localStorage.getItem(KEY) ?? 'null') as { name: string; text: string } | null;
    return saved ? parseBfOsd(saved.name, saved.text) : null;
  } catch {
    return null;
  }
}
