import { Routes } from '@angular/router';
import { requireSignIn } from './auth.service';
import { AircraftListComponent } from './aircraft/aircraft-list.component';
import { AircraftFormComponent } from './aircraft/aircraft-form.component';
import { AircraftDetailComponent } from './aircraft/aircraft-detail.component';
import { TuneImportComponent } from './tunes/tune-import.component';
import { TuneCompareComponent } from './tunes/tune-compare.component';
import { TuneBulkImportComponent } from './tunes/tune-bulk-import.component';
import { HomeComponent } from './home/home.component';

export const routes: Routes = [
  { path: '', pathMatch: 'full', component: HomeComponent, title: 'LovelyOSD Editor: your FPV footage with its OSD, in your browser' },
  { path: 'hangar', component: AircraftListComponent, title: 'Hangar' },
  { path: 'hangar/new', canActivate: [requireSignIn], component: AircraftFormComponent, title: 'Add aircraft' },
  { path: 'hangar/:id', component: AircraftDetailComponent, title: 'Aircraft' },
  { path: 'hangar/:id/edit', canActivate: [requireSignIn], component: AircraftFormComponent, title: 'Edit aircraft' },
  { path: 'hangar/:id/tunes/import', canActivate: [requireSignIn], component: TuneImportComponent, title: 'Import tune' },
  { path: 'hangar/:id/tunes/bulk', canActivate: [requireSignIn], component: TuneBulkImportComponent, title: 'Bulk import tunes' },
  { path: 'tunes/compare', component: TuneCompareComponent, title: 'Compare tunes' },
  { path: 'stats', canActivate: [requireSignIn], loadComponent: () => import('./stats/stats.component').then(m => m.StatsComponent), title: 'Visitors' },
  { path: 'guides/add-osd-to-dji-o4-footage', loadComponent: () => import('./guides/dji-o4-osd.component').then(m => m.DjiO4OsdGuideComponent),
    title: 'How to add OSD to DJI O4 footage, free in your browser · LovelyOSD Editor' },
  { path: 'about', loadComponent: () => import('./about/about.component').then(m => m.AboutComponent),
    title: 'About LovelyOSD Editor: free OSD video editing for FPV pilots' },
  // Lazy: this page pulls in ONNX Runtime Web for the detector.
  { path: 'inspector', loadComponent: () => import('./inspect/inspect.component').then(m => m.InspectComponent), title: 'Inspector (beta): find things to inspect in your drone footage' },
  { path: 'inspect', redirectTo: 'inspector' },
  { path: 'osd', loadComponent: () => import('./osd/lovely-osd.component').then(m => m.LovelyOsdComponent), title: 'LovelyOSD Editor' },

  // Old /aircraft addresses, kept so bookmarks still work.
  { path: 'aircraft', pathMatch: 'full', redirectTo: 'hangar' },
  { path: 'aircraft/new', redirectTo: 'hangar/new' },
  { path: 'aircraft/:id', redirectTo: 'hangar/:id' },
  { path: 'aircraft/:id/edit', redirectTo: 'hangar/:id/edit' },
  { path: 'aircraft/:id/tunes/import', redirectTo: 'hangar/:id/tunes/import' },
  { path: 'aircraft/:id/tunes/bulk', redirectTo: 'hangar/:id/tunes/bulk' },

  { path: '**', redirectTo: '' },
];
