import { Component, computed, effect, inject, input, numberAttribute, signal } from '@angular/core';
import { NonNullableFormBuilder, ReactiveFormsModule, Validators } from '@angular/forms';
import { Router, RouterLink } from '@angular/router';
import { AircraftService } from './aircraft.service';
import { AIRCRAFT_TYPES, AircraftInput } from './aircraft.models';
import { AircraftImageComponent } from './aircraft-image.component';

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

@Component({
  selector: 'app-aircraft-form',
  imports: [ReactiveFormsModule, RouterLink, AircraftImageComponent],
  template: `
    <form class="page narrow" [formGroup]="form" (ngSubmit)="submit()">
      <h1>{{ isEdit() ? 'Edit aircraft' : 'Add aircraft' }}</h1>

      <div class="photo">
        <app-aircraft-image [src]="preview()" [alt]="form.controls.name.value || 'this aircraft'" />
        <div class="photo-actions">
          <label class="btn">
            {{ preview() ? 'Replace photo' : 'Add photo' }}
            <input class="sr-only" type="file" accept="image/jpeg,image/png,image/webp" (change)="onFile($event)" />
          </label>
          @if (preview()) {
            <button class="btn" type="button" (click)="clearImage()">Remove photo</button>
          }
          <p class="hint">JPG, PNG or WebP, up to 5 MB.</p>
          @if (imageError()) { <p class="error">{{ imageError() }}</p> }
        </div>
      </div>

      <div class="field">
        <label for="name">Name</label>
        <input id="name" formControlName="name" maxlength="60" autocomplete="off" />
        @if (form.controls.name.touched && form.controls.name.invalid) {
          <p class="error">Give this aircraft a name.</p>
        }
      </div>

      <div class="field">
        <label for="type">Type</label>
        <select id="type" formControlName="type">
          @for (t of types; track t) { <option [value]="t">{{ t }}</option> }
        </select>
      </div>

      <div class="two">
        <div class="field"><label for="prop">Prop size</label><input id="prop" formControlName="propSize" placeholder='5"' /></div>
        <div class="field"><label for="weight">Weight (g)</label><input id="weight" type="number" formControlName="weightGrams" min="1" /></div>
      </div>

      <div class="field"><label for="frame">Frame</label><input id="frame" formControlName="frame" /></div>
      <div class="field"><label for="fc">Flight controller</label><input id="fc" formControlName="flightController" /></div>
      <div class="field"><label for="battery">Battery</label><input id="battery" formControlName="battery" placeholder="6S 1300mAh" /></div>
      <div class="field"><label for="notes">Notes</label><textarea id="notes" rows="4" formControlName="notes"></textarea></div>

      @if (error()) { <p class="error">{{ error() }}</p> }

      <div class="actions">
        <button class="btn btn-primary" type="submit" [disabled]="saving()">{{ saving() ? 'Saving...' : 'Save aircraft' }}</button>
        <a class="btn" [routerLink]="isEdit() ? ['/aircraft', id()] : ['/aircraft']">Cancel</a>
      </div>
    </form>
  `,
  styles: [`
    .photo { display: grid; grid-template-columns: 10rem 1fr; gap: 1rem; align-items: start; margin: 1.25rem 0 1.5rem; }
    .photo app-aircraft-image { border-radius: 8px; border: 1px solid var(--line); }
    .photo-actions { display: flex; flex-wrap: wrap; gap: .5rem; align-items: center; }
    .photo-actions .hint, .photo-actions .error { flex-basis: 100%; }
    .two { display: grid; grid-template-columns: 1fr 1fr; gap: 1rem; }
    .actions { display: flex; gap: .75rem; margin-top: 1.5rem; }
    @media (max-width: 30rem) { .photo, .two { grid-template-columns: 1fr; } }
  `],
})
export class AircraftFormComponent {
  /** Bound from the route. 0 means "new". */
  id = input(0, { transform: (v: unknown) => numberAttribute(v, 0) });
  isEdit = computed(() => this.id() > 0);

  private fb = inject(NonNullableFormBuilder);
  private service = inject(AircraftService);
  private router = inject(Router);

  types = AIRCRAFT_TYPES;
  form = this.fb.group({
    name: ['', [Validators.required, Validators.maxLength(60)]],
    type: [AIRCRAFT_TYPES[0] as AircraftInput['type']],
    propSize: [''],
    frame: [''],
    flightController: [''],
    battery: [''],
    weightGrams: this.fb.control<number | null>(null, [Validators.min(1)]),
    notes: [''],
  });

  preview = signal<string | null>(null);
  imageError = signal('');
  saving = signal(false);
  error = signal('');
  private imageFile: File | null = null;
  private imageRemoved = false;

  constructor() {
    effect(() => {
      const id = this.id();
      if (id > 0) {
        this.service.get(id).subscribe({
          next: a => {
            this.form.patchValue(a);
            this.preview.set(a.imageUrl);
          },
          error: () => this.error.set('Could not load this aircraft.'),
        });
      }
    });
  }

  onFile(event: Event) {
    const file = (event.target as HTMLInputElement).files?.[0];
    if (!file) return;
    if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
      this.imageError.set('Use a JPG, PNG or WebP image.');
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      this.imageError.set('That image is over 5 MB. Pick a smaller one.');
      return;
    }
    this.imageError.set('');
    this.imageFile = file;
    this.imageRemoved = false;
    this.preview.set(URL.createObjectURL(file));
  }

  clearImage() {
    this.imageFile = null;
    this.imageRemoved = true;
    this.preview.set(null);
  }

  submit() {
    if (this.form.invalid) {
      this.form.markAllAsTouched();
      return;
    }
    this.saving.set(true);
    this.error.set('');
    this.service.save(this.isEdit() ? this.id() : null, this.form.getRawValue(), this.imageFile, this.imageRemoved).subscribe({
      next: a => this.router.navigate(['/aircraft', a.id]),
      error: () => {
        this.saving.set(false);
        this.error.set('Could not save. Check your connection and try again.');
      },
    });
  }
}
