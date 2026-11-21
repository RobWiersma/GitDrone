import { Component, DestroyRef, ElementRef, afterNextRender, computed, inject, signal, viewChild } from '@angular/core';
import { HttpErrorResponse } from '@angular/common/http';
import { KeepFileDirective } from '../flights/file-handles';
import { clipOrder } from '../flights/join-clips';
import { JoinClipsComponent } from '../flights/join-clips.component';
import { FlightService } from '../flights/flight.service';
import { OsdAnalysis, formatDuration } from '../flights/flight.models';
import { FlightMapComponent, MapPin } from '../flights/flight-map.component';
import { matchMotorSound } from '../flights/clap';
import { CraftFix, craftAt, describe, takeoffTime, withoutPosition } from './inspect-log';
import { detectionsAt, drawCraft, drawDetections } from './inspect-draw';
import { InspectRenderPlan, MEMORY_LIMIT, RenderCancelled, estimateBytes, outputSize, renderInspection } from './inspect-render';
import {
  CLASSES, Detector, HOSTED_MODEL, PRESETS, classIndex, downloadHostedModel, forgetModels, keepPickedModel, loadModelBytes,
} from './inspect-model';
import { Finding, ScanProgress, ScanResult, clock, findingsCsv, scanFootage } from './inspect-scan';

type ModelState = 'loading' | 'downloading' | 'ready' | 'missing' | 'error';

/**
 * Inspection: load slow footage of power lines, solar panels, fences, gates or buildings, and the page finds them
 * frame by frame, follows each one through the clip, and flags the ones worth a closer look. Everything runs on this
 * machine, in the browser.
 */
@Component({
  selector: 'app-inspect',
  imports: [KeepFileDirective, FlightMapComponent, JoinClipsComponent],
  templateUrl: './inspect.component.html',
  styleUrl: './inspect.component.css',
})
export class InspectComponent {
  protected readonly classes = CLASSES;
  protected readonly clock = clock;
  protected readonly steps = [0.25, 0.5, 1, 2];

  private readonly video = viewChild<ElementRef<HTMLVideoElement>>('video');
  private readonly overlay = viewChild<ElementRef<HTMLCanvasElement>>('overlay');

  protected readonly file = signal<File | null>(null);
  protected readonly videoUrl = signal<string | null>(null);
  protected readonly aspect = signal(16 / 9);
  protected readonly duration = signal(0);
  protected readonly now = signal(0);

  protected readonly modelState = signal<ModelState>('loading');
  protected readonly modelProgress = signal(0);
  protected readonly modelError = signal('');
  private detector: Detector | null = null;
  protected readonly backend = signal<'webgpu' | 'wasm' | null>(null);

  protected readonly step = signal(0.5);

  // ---- What to look for (chosen before scanning; remembered in this browser) ----
  protected readonly presets = PRESETS.map(p => ({ name: p.name, set: new Set(p.labels.map(classIndex)) }));
  protected readonly objectClasses = CLASSES.map((c, i) => ({ ...c, i })).filter(c => c.kind === 'object');
  protected readonly lookalikeClasses = CLASSES.map((c, i) => ({ ...c, i })).filter(c => c.kind === 'lookalike');
  protected readonly defectClasses = CLASSES.map((c, i) => ({ ...c, i })).filter(c => c.kind === 'defect');
  protected readonly wanted = signal<ReadonlySet<number>>(loadWanted());
  protected readonly wantedSummary = computed(() => {
    const w = this.wanted(), preset = this.presets.find(p => sameSet(p.set, w));
    if (preset) return preset.name === 'Everything' ? `everything (${w.size} kinds)` : `${preset.name.toLowerCase()} (${w.size} kinds)`;
    return w.size ? CLASSES.filter((_, i) => w.has(i)).map(c => c.label.toLowerCase()).join(', ') : 'nothing';
  });
  /** The scan on screen looked for something else: scanning again would differ. */
  protected readonly wantedChanged = computed(() => {
    const r = this.result();
    return !!r && !this.scanning() && !sameSet(new Set(r.wanted), this.wanted());
  });
  protected readonly scanning = signal(false);
  protected readonly progress = signal<ScanProgress | null>(null);
  protected readonly result = signal<ScanResult | null>(null);
  protected readonly error = signal('');
  private control = { cancelled: false };

  protected readonly threshold = signal(0.3);
  protected readonly hidden = signal<ReadonlySet<number>>(new Set());
  protected readonly flaggedOnly = signal(false);
  protected readonly selected = signal<number | null>(null);
  protected readonly announce = signal('');

  // ---- The blackbox log, for telemetry ----
  private readonly flights = inject(FlightService);
  protected readonly describe = describe;
  protected readonly formatDuration = formatDuration;
  protected readonly log = signal<OsdAnalysis | null>(null);
  protected readonly logBusy = signal(false);
  protected readonly logError = signal('');
  protected readonly sessionIndex = signal(0);
  /** Seconds into the footage where the log starts (negative: the log started first). */
  protected readonly offset = signal(0);
  protected readonly syncNote = signal('');
  protected readonly session = computed(() => this.log()?.sessions[this.sessionIndex()] ?? null);
  protected readonly takeoff = computed(() => { const s = this.session(); return s ? takeoffTime(s) : null; });
  protected readonly hasTrack = computed(() => (this.session()?.track?.points.length ?? 0) > 1);
  /** The craft right now, for the readout over the video and the map's cursor. */
  /**
   * Whether the craft's GPS position (latitude, longitude) goes into what the page shows and exports: the readout over
   * the video, the exported video, the findings list and the JSON and CSV. Off unless the pilot turns it on, so a shared
   * video doesn't give away where they fly; remembered in this browser. The map on the page uses it either way.
   */
  protected readonly showPosition = signal(loadShowPosition());
  protected setShowPosition(event: Event) {
    const on = (event.target as HTMLInputElement).checked;
    this.showPosition.set(on);
    try { localStorage.setItem(POSITION_KEY, on ? '1' : '0'); } catch { /* fine */ }
  }
  /** A fix as it may leave the page: without lat and lon unless the pilot asked for them. */
  protected shown(c: CraftFix | null | undefined): CraftFix | null { return this.showPosition() ? c ?? null : withoutPosition(c ?? null); }
  protected readonly craftNow = computed(() => { const s = this.session(); return s ? craftAt(s, this.offset(), this.now()) : null; });
  /** The craft at each finding's best sighting. */
  protected readonly craftFor = computed(() => {
    const s = this.session(), off = this.offset(), out = new Map<number, CraftFix>();
    if (s) for (const f of this.findings()) { const fix = craftAt(s, off, f.best.t); if (fix) out.set(f.id, fix); }
    return out;
  });
  protected readonly pins = computed<MapPin[]>(() => {
    const pins: MapPin[] = [];
    for (const f of this.findings()) {
      const c = this.craftFor().get(f.id);
      if (c && c.lat !== null && c.lon !== null) {
        pins.push({ id: f.id, lat: c.lat, lon: c.lon, color: CLASSES[f.cls].color,
          label: `${f.cues.length ? '⚠ ' : ''}${CLASSES[f.cls].label} #${f.id} · ${clock(f.best.t)}` });
      }
    }
    return pins;
  });

  /** Findings that pass the filters: strong enough, and seen more than once unless clearly strong. */
  private readonly passing = computed(() => {
    const r = this.result(), min = this.threshold(), hidden = this.hidden();
    if (!r) return [];
    return r.findings.filter(f => !hidden.has(f.cls) && f.best.score >= min && (f.hits >= 2 || f.best.score >= min + 0.15));
  });
  protected readonly findings = computed(() => {
    const list = this.flaggedOnly() ? this.passing().filter(f => f.cues.length) : this.passing();
    return [...list].sort((a, b) => (b.cues.length ? 1 : 0) - (a.cues.length ? 1 : 0) || a.from - b.from);
  });
  private readonly shownIds = computed(() => new Set(this.findings().map(f => f.id)));
  protected readonly flaggedCount = computed(() => this.passing().filter(f => f.cues.length).length);
  /** Each kind of thing: how many were found (before the class filter), for the filter chips. */
  protected readonly counts = computed(() => {
    const r = this.result(), min = this.threshold();
    const n = CLASSES.map(() => 0);
    for (const f of r?.findings ?? []) if (f.best.score >= min && (f.hits >= 2 || f.best.score >= min + 0.15)) n[f.cls]++;
    return n;
  });
  /** Timeline lanes: one per kind of thing that has findings showing. */
  protected readonly lanes = computed(() => {
    const byCls = new Map<number, Finding[]>();
    for (const f of this.findings()) byCls.set(f.cls, [...(byCls.get(f.cls) ?? []), f]);
    return [...byCls.entries()].sort((a, b) => a[0] - b[0]).map(([cls, items]) => ({ cls, items }));
  });
  protected readonly span = computed(() => this.result()?.duration || this.duration() || 1);

  constructor() {
    const destroyRef = inject(DestroyRef);
    afterNextRender(() => {
      void this.openModel();
      let raf = 0, lastKey = '';
      const tick = () => {
        raf = requestAnimationFrame(tick);
        const v = this.video()?.nativeElement;
        if (v && Math.abs(v.currentTime - this.now()) > 0.04) this.now.set(v.currentTime);
        const key = `${v?.currentTime}|${this.shownIds().size}|${this.selected()}|${this.result()?.samples.length}|${v?.clientWidth}|${this.offset()}|${this.sessionIndex()}|${!!this.log()}|${this.showPosition()}`;
        if (key !== lastKey) { lastKey = key; this.draw(); }
      };
      raf = requestAnimationFrame(tick);
      destroyRef.onDestroy(() => cancelAnimationFrame(raf));
    });
    destroyRef.onDestroy(() => {
      this.control.cancelled = true;
      this.detector?.dispose();
      const url = this.videoUrl();
      if (url) URL.revokeObjectURL(url);
    });
  }

  private async openModel(bytes?: Uint8Array) {
    this.modelState.set('loading');
    this.modelError.set('');
    try {
      const b = bytes ?? (await loadModelBytes(p => this.modelProgress.set(p)));
      if (!b) { this.modelState.set('missing'); return; }
      this.detector?.dispose();
      this.detector = await Detector.open(b);
      this.backend.set(this.detector.backend);
      this.modelState.set('ready');
    } catch (err) {
      this.modelState.set('error');
      this.modelError.set(err instanceof Error ? err.message : String(err));
    }
  }

  /** The model online, offered as a download when there's none here. */
  protected readonly hosted = HOSTED_MODEL;

  protected async downloadModel() {
    this.modelState.set('downloading');
    this.modelProgress.set(0);
    this.modelError.set('');
    try {
      await this.openModel(await downloadHostedModel(p => this.modelProgress.set(p)));
    } catch (err) {
      this.modelState.set('error');
      this.modelError.set(err instanceof Error ? err.message : String(err));
    }
  }

  protected async onModel(event: Event) {
    const input = event.target as HTMLInputElement, f = input.files?.[0];
    input.value = '';
    if (f) await this.openModel(await keepPickedModel(f));
  }

  protected async reloadModel() {
    await forgetModels();
    await this.openModel();
  }

  /** Footage files picked together (one recording the camera split up), waiting to be joined into one, or null. */
  protected readonly footageParts = signal<File[] | null>(null);

  protected onFootage(event: Event) {
    const input = event.target as HTMLInputElement, files = Array.from(input.files ?? []);
    input.value = '';
    this.footageParts.set(files.length > 1 ? clipOrder(files) : null);
    if (files.length === 1) this.loadFootage(files[0]);
  }

  protected loadFootage(f: File) {
    this.footageParts.set(null);
    this.stop();
    const old = this.videoUrl();
    if (old) URL.revokeObjectURL(old);
    this.file.set(f);
    this.videoUrl.set(URL.createObjectURL(f));
    this.result.set(null);
    this.selected.set(null);
    this.progress.set(null);
    this.error.set('');
  }

  protected onMeta() {
    const v = this.video()?.nativeElement;
    if (!v) return;
    if (v.videoWidth && v.videoHeight) this.aspect.set(v.videoWidth / v.videoHeight);
    this.duration.set(v.duration || 0);
  }

  protected async scan() {
    const f = this.file();
    if (!f || !this.detector || this.scanning()) return;
    this.control = { cancelled: false };
    this.scanning.set(true);
    this.error.set('');
    this.selected.set(null);
    this.result.set(null);
    this.announce.set('Scanning started.');
    try {
      const r = await scanFootage(f, this.detector, this.step(), this.wanted(), (p, partial) => {
        this.progress.set(p);
        this.result.set(partial);
      }, this.control);
      if (r) {
        this.result.set(r);
        this.announce.set(`Scan finished: ${this.findings().length} findings, ${this.flaggedCount()} flagged for a closer look.`);
      } else {
        this.announce.set('Scan stopped.');
      }
    } catch (err) {
      this.error.set(err instanceof Error ? err.message : String(err));
    } finally {
      this.scanning.set(false);
    }
  }

  protected stop() { this.control.cancelled = true; }

  protected isPreset(set: ReadonlySet<number>) { return sameSet(set, this.wanted()); }
  protected usePreset(set: ReadonlySet<number>) { this.setWanted(new Set(set)); }
  protected toggleWanted(i: number) {
    const n = new Set(this.wanted());
    if (n.has(i)) n.delete(i); else n.add(i);
    this.setWanted(n);
  }
  private setWanted(set: ReadonlySet<number>) {
    this.wanted.set(set);
    try { localStorage.setItem(WANTED_KEY, JSON.stringify(CLASSES.filter((_, i) => set.has(i)).map(c => c.label))); } catch { /* fine */ }
  }

  protected setStep(event: Event) { this.step.set(Number((event.target as HTMLSelectElement).value)); }
  protected setThreshold(event: Event) { this.threshold.set(Number((event.target as HTMLInputElement).value) / 100); }
  protected setFlaggedOnly(event: Event) { this.flaggedOnly.set((event.target as HTMLInputElement).checked); }
  protected toggleClass(cls: number) {
    this.hidden.update(h => { const n = new Set(h); if (n.has(cls)) n.delete(cls); else n.add(cls); return n; });
  }

  /** Shows a finding: jumps the video to its best sighting and highlights its box. */
  protected show(f: Finding) {
    this.selected.set(f.id);
    this.seek(f.best.t);
  }

  protected seek(t: number) {
    const v = this.video()?.nativeElement;
    if (!v) return;
    v.pause();
    v.currentTime = Math.max(0, Math.min(t, (v.duration || t) - 0.01));
  }

  protected seekLane(event: MouseEvent) {
    const el = event.currentTarget as HTMLElement, rect = el.getBoundingClientRect();
    this.seek(((event.clientX - rect.left) / rect.width) * this.span());
  }

  protected left(t: number) { return `${(t / this.span()) * 100}%`; }
  protected width(f: Finding) { return `max(4px, ${((f.to - f.from) / this.span()) * 100}%)`; }
  protected pct(x: number) { return `${Math.round(x * 100)}%`; }
  protected score(f: Finding) { return this.pct(f.best.score); }
  protected label(f: Finding) { return CLASSES[f.cls].label; }

  protected onLog(event: Event) {
    const input = event.target as HTMLInputElement, f = input.files?.[0];
    input.value = '';
    if (!f) return;
    if (f.size > 64 * 1024 * 1024) { this.logError.set('That log is over 64 MB.'); return; }
    this.logBusy.set(true);
    this.logError.set('');
    this.flights.analyze(f).subscribe({
      next: r => {
        this.logBusy.set(false);
        if (!r.sessions.length) { this.logError.set(`${f.name} has no flights in it.`); return; }
        this.log.set(r);
        // The longest flight in the file is most likely the one filmed.
        let best = 0;
        r.sessions.forEach((s, i) => { if (s.flight.durationMs > r.sessions[best].flight.durationMs) best = i; });
        this.sessionIndex.set(best);
        this.syncNote.set('');
        this.announce.set(`Log loaded: ${r.sessions.length} flight${r.sessions.length > 1 ? 's' : ''}. Line it up with the footage next.`);
      },
      error: (e: HttpErrorResponse) => {
        this.logBusy.set(false);
        const problem = e.error?.errors as Record<string, string[]> | undefined;
        this.logError.set(problem ? Object.values(problem).flat().join(' ')
          : e.status === 503 ? 'The log reader is busy right now. Try again in a minute.'
          : 'Could not read this log. Check that the API is running and try again.');
      },
    });
  }

  protected forgetLog() {
    this.log.set(null);
    this.syncNote.set('');
  }

  protected setSession(event: Event) { this.sessionIndex.set(Number((event.target as HTMLSelectElement).value)); }

  protected setOffset(event: Event) {
    const v = Number((event.target as HTMLInputElement).value);
    if (Number.isFinite(v)) { this.offset.set(v); this.syncNote.set(''); }
  }

  /** The frame on screen is takeoff: line the log's takeoff up with it. */
  protected takeoffHere() {
    const t = this.takeoff(), v = this.video()?.nativeElement;
    if (t === null || !v) return;
    this.offset.set(Math.round((v.currentTime - t) * 100) / 100);
    this.syncNote.set(`Lined up: takeoff at ${clock(v.currentTime)} in the footage.`);
  }

  /** Lines the log up by matching the footage's motor sound to the throttle. */
  protected async syncFromMotors() {
    const f = this.file(), sticks = this.session()?.sticks?.points;
    if (!f || !sticks?.length) return;
    if (f.size > 1.5e9) { this.syncNote.set('This footage is too big to listen to here; line it up at takeoff instead.'); return; }
    this.syncNote.set('Listening to the motors and matching them to your throttle…');
    try {
      const m = await matchMotorSound(f, sticks);
      if (!m) this.syncNote.set('There was too little sound or log to match.');
      else if (!m.confident) this.syncNote.set(`No clear match (best ${m.offset.toFixed(2)} s, score ${m.score}); line it up at takeoff instead.`);
      else { this.offset.set(m.offset); this.syncNote.set(`Matched the motor sound: the log starts at ${m.offset.toFixed(2)} s.`); }
    } catch {
      this.syncNote.set('This footage has no sound to match (DJI O4 records none); line it up at takeoff instead.');
    }
  }

  protected showById(id: number) {
    const f = this.result()?.findings.find(x => x.id === id);
    if (f) this.show(f);
  }

  protected osmLink(c: CraftFix) { return `https://www.openstreetmap.org/?mlat=${c.lat}&mlon=${c.lon}#map=19/${c.lat}/${c.lon}`; }

  protected exportJson() {
    const r = this.result(), f = this.file();
    if (!r || !f) return;
    const data = {
      footage: f.name, duration: r.duration, width: r.width, height: r.height, sampleEvery: r.step,
      classes: CLASSES.map(c => c.label),
      log: this.session() ? { file: this.log()!.fileName, flight: this.sessionIndex(), startsAtFootageSeconds: this.offset() } : null,
      findings: this.findings().map(({ thumb: _, ...rest }) => ({ ...rest, label: CLASSES[rest.cls].label, craft: this.shown(this.craftFor().get(rest.id)) })),
    };
    this.download(`${baseName(f.name)}-inspection.json`, JSON.stringify(data, null, 2), 'application/json');
  }

  protected exportCsv() {
    const f = this.file();
    if (f) this.download(`${baseName(f.name)}-inspection.csv`, findingsCsv(f.name, this.findings(), new Map([...this.craftFor()].map(([id, c]) => [id, this.shown(c)!]))), 'text/csv');
  }

  private download(name: string, text: string, type: string) {
    const url = URL.createObjectURL(new Blob([text], { type }));
    const a = document.createElement('a');
    a.href = url;
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  // ---- The Inspector's video: the footage with the findings and telemetry drawn in ----
  protected readonly videoSizes = [{ label: '1080p', height: 1080 }, { label: '720p', height: 720 }, { label: 'Original', height: 0 }];
  protected readonly exportHeight = signal(1080);
  protected readonly rendering = signal(false);
  protected readonly renderDone = signal(0);
  protected readonly renderTotal = signal(0);
  protected readonly renderNote = signal('');
  protected readonly renderError = signal('');
  private renderControl = { cancelled: false };
  /** What the chosen size comes to for this footage, e.g. "1440×1080". */
  protected readonly exportSize = computed(() => {
    const r = this.result();
    if (!r) return '';
    const s = outputSize(r, this.exportHeight() || null);
    return `${s.width}×${s.height}`;
  });

  protected setExportHeight(event: Event) { this.exportHeight.set(Number((event.target as HTMLSelectElement).value)); }

  /** Draws everything the page shows over the footage into an MP4, saved where the pilot picks. */
  protected async exportVideo() {
    const r = this.result(), f = this.file();
    if (!r || !f || this.rendering()) return;
    const name = `${baseName(f.name)}-inspector.mp4`;
    this.renderError.set('');
    this.renderNote.set('');
    let writable: WritableStream | null = null;
    const picker = (window as unknown as { showSaveFilePicker?: SaveFilePicker }).showSaveFilePicker;
    if (picker) {
      try {
        const handle = await picker({ suggestedName: name, types: [{ description: 'MP4 video', accept: { 'video/mp4': ['.mp4'] } }] });
        writable = await handle.createWritable();
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return; // closed the dialog: a choice, not a failure
        writable = null; // refused (protected folder, embedded browser): try memory below
      }
    }
    if (!writable && estimateBytes(r, this.exportHeight() || null, r.duration) > MEMORY_LIMIT) {
      this.renderError.set('This video is too big to make in memory, and saving straight to a file isn\'t possible here. Pick a smaller size, or use Chrome or Edge.');
      return;
    }
    const s = this.session(), off = this.offset();
    const plan: InspectRenderPlan = {
      file: f, result: r, from: 0, to: r.duration, height: this.exportHeight() || null,
      draw: { shown: this.shownIds(), flagged: new Set(this.passing().filter(x => x.cues.length).map(x => x.id)), selected: null },
      craftAt: s ? (this.showPosition() ? (t: number) => craftAt(s, off, t) : (t: number) => withoutPosition(craftAt(s, off, t))) : null,
    };
    this.renderControl = { cancelled: false };
    this.rendering.set(true);
    this.renderDone.set(0);
    this.renderTotal.set(0);
    this.announce.set('Exporting the video.');
    const started = performance.now();
    try {
      const blob = await renderInspection(plan, writable, (done, total) => {
        if (done % 5 === 0 || done === total) { this.renderDone.set(done); this.renderTotal.set(total); }
      }, this.renderControl);
      if (blob) {
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = name;
        a.click();
        setTimeout(() => URL.revokeObjectURL(url), 60_000);
      }
      const secs = Math.round((performance.now() - started) / 1000);
      this.renderNote.set(`Saved ${name} (${this.renderTotal()} frames, ${secs} s).`);
      this.announce.set(this.renderNote());
    } catch (e) {
      if (e instanceof RenderCancelled) this.renderNote.set('Export cancelled; the file is incomplete, so delete it.');
      else this.renderError.set(`The export stopped: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      this.rendering.set(false);
    }
  }

  protected cancelExport() { this.renderControl.cancelled = true; }

  /** Draws the findings at the video's current time over it, and the craft's readout, as the export will. */
  private draw() {
    const canvas = this.overlay()?.nativeElement, v = this.video()?.nativeElement;
    if (!canvas || !v) return;
    const dpr = window.devicePixelRatio || 1, w = v.clientWidth, h = v.clientHeight;
    if (canvas.width !== Math.round(w * dpr) || canvas.height !== Math.round(h * dpr)) {
      canvas.width = Math.round(w * dpr);
      canvas.height = Math.round(h * dpr);
    }
    const ctx = canvas.getContext('2d')!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);
    drawCraft(ctx, this.shown(this.craftNow()), 1);
    const r = this.result();
    if (!r) return;
    const flagged = new Set(r.findings.filter(f => f.cues.length).map(f => f.id));
    drawDetections(ctx, detectionsAt(r.samples, r.step, v.currentTime), { shown: this.shownIds(), flagged, selected: this.selected() }, w, h, 1);
  }
}

const WANTED_KEY = 'gitdrone-inspect-look-for';
const POSITION_KEY = 'gitdrone-inspect-show-position';

function loadShowPosition(): boolean {
  try { return typeof localStorage !== 'undefined' && localStorage.getItem(POSITION_KEY) === '1'; } catch { return false; }
}

/** The classes picked last time, by name (so a re-exported model with more classes keeps the choice), else all. */
function loadWanted(): ReadonlySet<number> {
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(WANTED_KEY) : null;
    const labels = raw ? (JSON.parse(raw) as unknown) : null;
    if (Array.isArray(labels)) {
      const set = new Set(labels.map(l => classIndex(String(l))).filter(i => i >= 0));
      if (set.size) return set;
    }
  } catch { /* fall through */ }
  return new Set(CLASSES.map((_, i) => i));
}

const sameSet = (a: ReadonlySet<number>, b: ReadonlySet<number>) => a.size === b.size && [...a].every(x => b.has(x));

type SaveFilePicker = (o: { suggestedName: string; types: { description: string; accept: Record<string, string[]> }[] }) =>
  Promise<{ createWritable(): Promise<WritableStream> }>;

const baseName = (name: string) => name.replace(/\.[^.]+$/, '');
