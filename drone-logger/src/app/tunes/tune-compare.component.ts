import { Component, computed, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { DatePipe } from '@angular/common';
import { FormsModule } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AircraftService } from '../aircraft/aircraft.service';
import { Aircraft } from '../aircraft/aircraft.models';
import { TuneService } from './tune.service';
import { TuneCompareResult, TuneDiffEntry, TuneDiffKind } from './tune.models';
import { TunePickerComponent } from './tune-picker.component';

const KIND_LABEL: Record<TuneDiffKind, string> = { changed: 'Changed', added: 'Newly set', removed: 'Back to default' };

@Component({
  selector: 'app-tune-compare',
  imports: [DatePipe, FormsModule, RouterLink, TunePickerComponent],
  template: `
    <div class="page">
      @if (result(); as r) {
        <a [routerLink]="['/aircraft', r.to.aircraftId]">Back to {{ aircraftName(r.to.aircraftId) }}</a>
      } @else {
        <a routerLink="/aircraft">Back to hangar</a>
      }
      <h1>Compare tunes</h1>

      @if (result(); as r) {
        <div class="pickers">
          <app-tune-picker legend="From (older)" name="from" [aircraft]="aircraft()"
                           [aircraftId]="r.from.aircraftId" [snapshotId]="r.from.id" (picked)="go($event, r.to.id)" />
          <button class="btn swap" type="button" (click)="go(r.to.id, r.from.id)" aria-label="Swap from and to">⇄</button>
          <app-tune-picker legend="To (newer)" name="to" [aircraft]="aircraft()"
                           [aircraftId]="r.to.aircraftId" [snapshotId]="r.to.id" (picked)="go(r.from.id, $event)" />
        </div>

        <div class="panel summary" aria-live="polite">
          <p>
            <strong>{{ r.from.label }}</strong> ({{ r.from.createdAt | date: 'd MMM y' }})
            to <strong>{{ r.to.label }}</strong> ({{ r.to.createdAt | date: 'd MMM y' }})
          </p>
          @if (r.from.aircraftId !== r.to.aircraftId) {
            <p class="warn">Comparing two different aircraft: {{ aircraftName(r.from.aircraftId) }} and {{ aircraftName(r.to.aircraftId) }}.</p>
          }
          @if (r.from.firmwareVersion !== r.to.firmwareVersion) {
            <p class="warn">Firmware differs ({{ r.from.firmwareVersion }} to {{ r.to.firmwareVersion }}). Defaults may have changed between versions, so some "default" values aren't the same number on both sides.</p>
          }
          <ul class="counts">
            <li><span class="tag changed">{{ r.changed }}</span> changed</li>
            <li><span class="tag added">{{ r.added }}</span> newly set</li>
            <li><span class="tag removed">{{ r.removed }}</span> back to default</li>
            <li><span class="tag">{{ r.unchanged }}</span> unchanged</li>
          </ul>
        </div>

        @if (r.groups.length === 0) {
          <p class="panel">These two tunes have identical settings.</p>
        } @else {
          <div class="field filter">
            <label for="filter">Filter settings</label>
            <input id="filter" type="search" [(ngModel)]="filter" placeholder="e.g. pitch, lpf, dshot" autocomplete="off" />
          </div>

          @for (section of sections(); track section.scope) {
            <section class="panel scope">
              <h2>{{ section.label }}</h2>
              @for (group of section.groups; track group.category) {
                <h3>{{ group.category }}</h3>
                <table>
                  <thead>
                    <tr><th scope="col">Setting</th><th scope="col">Change</th><th scope="col">From</th><th scope="col">To</th></tr>
                  </thead>
                  <tbody>
                    @for (e of group.changes; track e.key) {
                      <tr [class]="e.kind">
                        <th scope="row"><code>{{ e.key }}</code></th>
                        <td><span class="tag" [class]="e.kind">{{ kindLabel[e.kind] }}</span></td>
                        <td class="val">@if (e.from === null) { <em>default</em> } @else { {{ e.from }} }</td>
                        <td class="val">
                          @if (e.to === null) { <em>default</em> } @else { {{ e.to }} }
                          @if (delta(e); as d) { <span class="delta">({{ d }})</span> }
                        </td>
                      </tr>
                    }
                  </tbody>
                </table>
              }
            </section>
          } @empty {
            <p class="hint">No changed settings match "{{ filter() }}".</p>
          }
        }
      } @else if (state() === 'error') {
        <p class="error">Couldn't load this comparison. One of the tunes may have been deleted, or the API isn't running.</p>
      } @else if (state() === 'missing') {
        <p class="hint">Pick two tunes to compare from an aircraft's tune history.</p>
      } @else {
        <p class="hint">Loading comparison...</p>
      }
    </div>
  `,
  styles: [`
    h1 { margin-bottom: 1rem; }
    .pickers { display: grid; grid-template-columns: 1fr auto 1fr; gap: 1rem; align-items: center; margin-bottom: 1rem; }
    .swap { font-size: 1.2rem; }
    .summary p { margin: 0 0 .4rem; }
    .warn { color: var(--warn); }
    .counts { list-style: none; display: flex; flex-wrap: wrap; gap: 1.25rem; margin: .5rem 0 0; padding: 0; }
    .filter { max-width: 24rem; margin: 1.25rem 0; }
    .scope { margin-bottom: 1.25rem; }
    h3 { font-size: 1rem; margin: 1rem 0 .4rem; color: var(--muted); }
    table { width: 100%; border-collapse: collapse; font-size: .95rem; }
    th, td { text-align: left; padding: .35rem .6rem; border-bottom: 1px solid var(--line); vertical-align: top; }
    thead th { font-size: .85rem; color: var(--muted); font-weight: 600; }
    tbody th { font-weight: normal; }
    tbody th code { background: none; padding: 0; }
    .val { font-family: ui-monospace, "Cascadia Code", Menlo, monospace; font-size: .88rem; word-break: break-word; }
    .val em { font-family: system-ui, sans-serif; color: var(--muted); }
    .delta { color: var(--muted); margin-left: .3rem; }
    tr.changed { background: var(--diff-change-bg); }
    tr.added { background: var(--diff-add-bg); }
    tr.removed { background: var(--diff-remove-bg); }
    .tag { display: inline-block; min-width: 1.6rem; padding: .05rem .45rem; border-radius: 999px; font-size: .8rem;
           font-weight: 600; text-align: center; background: var(--wash); color: var(--ink); white-space: nowrap; }
    .tag.changed { background: var(--diff-change); color: var(--diff-ink); }
    .tag.added { background: var(--diff-add); color: var(--diff-ink); }
    .tag.removed { background: var(--diff-remove); color: var(--diff-ink); }
    @media (max-width: 42rem) {
      .pickers { grid-template-columns: 1fr; }
      .swap { justify-self: center; }
    }
  `],
})
export class TuneCompareComponent {
  from = input(undefined, { transform: numberAttribute });
  to = input(undefined, { transform: numberAttribute });

  private tunes = inject(TuneService);
  private router = inject(Router);

  readonly kindLabel = KIND_LABEL;
  aircraft = signal<Aircraft[]>([]);
  result = signal<TuneCompareResult | null>(null);
  state = signal<'loading' | 'error' | 'missing'>('loading');
  filter = signal('');

  /** Groups regrouped by scope, with the text filter applied to setting keys. */
  sections = computed(() => {
    const r = this.result();
    if (!r) return [];
    const needle = this.filter().trim().toLowerCase();
    const sections: { scope: string; label: string; groups: { category: string; changes: TuneDiffEntry[] }[] }[] = [];
    for (const g of r.groups) {
      const changes = needle ? g.changes.filter(c => c.key.toLowerCase().includes(needle)) : g.changes;
      if (changes.length === 0) continue;
      let section = sections.find(s => s.scope === g.scope);
      if (!section) sections.push(section = { scope: g.scope, label: g.scopeLabel, groups: [] });
      section.groups.push({ category: g.category, changes });
    }
    return sections;
  });

  constructor() {
    inject(AircraftService).list().subscribe(list => this.aircraft.set(list));

    effect(() => {
      const from = this.from();
      const to = this.to();
      if (!from || !to) { this.state.set('missing'); return; }
      this.state.set('loading');
      this.tunes.compare(from, to).subscribe({
        next: r => this.result.set(r),
        error: () => { this.result.set(null); this.state.set('error'); },
      });
    });
  }

  go(from: number, to: number) {
    this.router.navigate(['/tunes/compare'], { queryParams: { from, to } });
  }

  aircraftName(id: number) {
    return this.aircraft().find(a => a.id === id)?.name ?? 'aircraft';
  }

  /** "+4" style hint for plain numeric changes. */
  delta(e: TuneDiffEntry): string | null {
    if (e.kind !== 'changed' || e.from === null || e.to === null) return null;
    const a = Number(e.from), b = Number(e.to);
    if (!/^-?\d+(\.\d+)?$/.test(e.from) || !/^-?\d+(\.\d+)?$/.test(e.to) || !Number.isFinite(a) || !Number.isFinite(b)) return null;
    const d = Math.round((b - a) * 1000) / 1000;
    return d > 0 ? `+${d}` : `${d}`;
  }
}
