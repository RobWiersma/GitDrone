import { Routes } from '@angular/router';
import { AircraftListComponent } from './aircraft/aircraft-list.component';
import { AircraftFormComponent } from './aircraft/aircraft-form.component';
import { AircraftDetailComponent } from './aircraft/aircraft-detail.component';
import { TuneImportComponent } from './tunes/tune-import.component';
import { TuneCompareComponent } from './tunes/tune-compare.component';
import { TuneBulkImportComponent } from './tunes/tune-bulk-import.component';
import { FlightUploadComponent } from './flights/flight-upload.component';
import { FlightDetailComponent } from './flights/flight-detail.component';
import { FlightFeedComponent } from './flights/flight-feed.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: FlightFeedComponent, title: 'Flights' },
  { path: 'aircraft', component: AircraftListComponent, title: 'Hangar' },
  { path: 'aircraft/new', component: AircraftFormComponent, title: 'Add aircraft' },
  { path: 'aircraft/:id', component: AircraftDetailComponent, title: 'Aircraft' },
  { path: 'aircraft/:id/edit', component: AircraftFormComponent, title: 'Edit aircraft' },
  { path: 'aircraft/:id/tunes/import', component: TuneImportComponent, title: 'Import tune' },
  { path: 'aircraft/:id/tunes/bulk', component: TuneBulkImportComponent, title: 'Bulk import tunes' },
  { path: 'aircraft/:id/flights/upload', component: FlightUploadComponent, title: 'Upload blackbox log' },
  { path: 'flights/:id', component: FlightDetailComponent, title: 'Flight' },
  { path: 'tunes/compare', component: TuneCompareComponent, title: 'Compare tunes' },
  { path: '**', redirectTo: '' },
];
