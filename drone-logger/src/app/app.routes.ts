import { Routes } from '@angular/router';
import { AircraftListComponent } from './aircraft/aircraft-list.component';
import { AircraftFormComponent } from './aircraft/aircraft-form.component';
import { AircraftDetailComponent } from './aircraft/aircraft-detail.component';
import { TuneImportComponent } from './tunes/tune-import.component';
import { TuneCompareComponent } from './tunes/tune-compare.component';
import { TuneBulkImportComponent } from './tunes/tune-bulk-import.component';
import { FlightUploadComponent } from './flights/flight-upload.component';
import { FlightFeedComponent } from './flights/flight-feed.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: FlightFeedComponent, title: 'Flights' },
  { path: 'hangar', component: AircraftListComponent, title: 'Hangar' },
  { path: 'hangar/new', component: AircraftFormComponent, title: 'Add aircraft' },
  { path: 'hangar/:id', component: AircraftDetailComponent, title: 'Aircraft' },
  { path: 'hangar/:id/edit', component: AircraftFormComponent, title: 'Edit aircraft' },
  { path: 'hangar/:id/tunes/import', component: TuneImportComponent, title: 'Import tune' },
  { path: 'hangar/:id/tunes/bulk', component: TuneBulkImportComponent, title: 'Bulk import tunes' },
  { path: 'hangar/:id/flights/upload', component: FlightUploadComponent, title: 'Upload blackbox log' },
  // Lazy: this page pulls in Leaflet, which nothing else needs.
  { path: 'flights/:id/overlay', loadComponent: () => import('./flights/flight-overlay.component').then(m => m.FlightOverlayComponent), title: 'Video overlay' },
  { path: 'flights/:id', loadComponent: () => import('./flights/flight-detail.component').then(m => m.FlightDetailComponent), title: 'Flight' },
  { path: 'tunes/compare', component: TuneCompareComponent, title: 'Compare tunes' },

  // Old /aircraft addresses, kept so bookmarks still work.
  { path: 'aircraft', pathMatch: 'full', redirectTo: 'hangar' },
  { path: 'aircraft/new', redirectTo: 'hangar/new' },
  { path: 'aircraft/:id', redirectTo: 'hangar/:id' },
  { path: 'aircraft/:id/edit', redirectTo: 'hangar/:id/edit' },
  { path: 'aircraft/:id/tunes/import', redirectTo: 'hangar/:id/tunes/import' },
  { path: 'aircraft/:id/tunes/bulk', redirectTo: 'hangar/:id/tunes/bulk' },
  { path: 'aircraft/:id/flights/upload', redirectTo: 'hangar/:id/flights/upload' },

  { path: '**', redirectTo: '' },
];
