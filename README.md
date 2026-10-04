# Drone Logger (Angular frontend)

Aircraft collection with photo upload and Betaflight tune history.
These are the `src/` files only. Drop them into a fresh Angular project.

## Setup (Angular 19 or newer)

1. `ng new drone-logger --style=css` (answer the prompts as you like)
2. Copy `src/app/aircraft`, `src/app/tunes`, `src/app/api.config.ts`,
   `src/app/app.config.ts`, `src/app/app.routes.ts` and `src/styles.css`
   into the generated project, replacing files with the same name.
3. Make the root component's template just `<router-outlet />`.
4. `ng serve`

`USE_MOCK` in `src/app/api.config.ts` is `true`, so the app runs entirely
in memory with sample data. Set it to `false` and point `API_BASE` at your
ASP.NET Core API when the backend is ready.

## Routes

| Route                        | Component                  |
|------------------------------|----------------------------|
| /aircraft                    | AircraftListComponent      |
| /aircraft/new                | AircraftFormComponent      |
| /aircraft/:id                | AircraftDetailComponent    |
| /aircraft/:id/edit           | AircraftFormComponent      |
| /aircraft/:id/tunes/import   | TuneImportComponent        |
| /aircraft/:id/tunes/bulk     | TuneBulkImportComponent    |
| /tunes/compare?from=&to=     | TuneCompareComponent       |
| /aircraft/:id/flights/upload | FlightUploadComponent      |
| /flights/:id                 | FlightDetailComponent      |

## API contract

- GET    /api/aircraft
- GET    /api/aircraft/{id}
- POST   /api/aircraft            multipart/form-data (fields + `image` file)
- PUT    /api/aircraft/{id}       multipart/form-data (fields + `image`, `removeImage`)
- DELETE /api/aircraft/{id}
- GET    /api/aircraft/{id}/tunes
- POST   /api/aircraft/{id}/tunes  body: { label, notes?, rawText }
                                   returns: { snapshot, duplicateOf }
- POST   /api/aircraft/{id}/tunes/bulk  body: { items: [{ label, notes?, rawText, createdAt? }] } (max 500)
                                   returns: [{ index, status: created|duplicate|error, snapshot, duplicateOf, error }]
                                   Each item lands at its createdAt; one identical to the snapshot before it is skipped.
- GET    /api/tunes/{id}/raw        returns: { id, rawText }
- GET    /api/tunes/compare?from={snapshotId}&to={snapshotId}
                                   returns: { from, to, changed, added, removed, unchanged,
                                              groups: [{ scope, scopeLabel, category, changes: [{ key, from, to, kind }] }] }
                                   from/to on a change is null when that side is at the firmware default.
- GET    /api/aircraft/{id}/flights
- POST   /api/aircraft/{id}/flights  multipart/form-data: file (.bbl/.bfl, max 64 MB), tuneSnapshotId? (empty = match by date), notes?
                                   returns: { flights, duplicate }  (one flight per armed session in the file)
- GET    /api/flights/{id}
- PUT    /api/flights/{id}          body: { tuneSnapshotId, notes }
- DELETE /api/flights/{id}

## Comparing tunes

Each timeline entry has "Compare with previous". The compare page lets you pick any two
snapshots, including from different aircraft, and shows changes grouped by profile and
category (PIDs, filters, rates, motors, ...). "Newly set" and "back to default" reflect that
`diff all` only lists non-default values.

## Flights (blackbox logs)

Upload a Betaflight `.bbl`/`.bfl` file on the aircraft page. The API decodes it itself
(`Services/BlackboxDecoder.cs`, ported from betaflight/blackbox-log-viewer), creates one flight per
armed session, and links each to the newest tune saved before that flight (or the tune you pick).
Craft name and device UID from the log header are not stored. The original file is kept in
`App_Data/logs` so it can be re-parsed later, for example to add GPS tracks once logs include them
(enable the GPS field in the Configurator's Blackbox tab).

## Local development

Run the API (`dotnet run --launch-profile https` in `DroneLogger.Api`) and `ng serve` in `drone-logger`.
The Angular app calls `/api`; `proxy.conf.json` forwards `/api` and `/uploads` to https://localhost:5001.

## Deploying to Azure (free tier)

One Linux App Service (F1) hosts both: CI builds Angular into the API's `wwwroot`
(`.github/workflows/deploy.yml`, runs on every push to `master`).

App settings on the App Service:

| Setting                      | Value                                  |
|------------------------------|----------------------------------------|
| `ConnectionStrings__Default` | `Data Source=/home/data/droneLogger.db` |
| `Storage__UploadsPath`       | `/home/data/uploads`                   |
| `Storage__LogsPath`          | `/home/data/logs`                      |

`/home` survives restarts and deploys, so SQLite is fine on a single instance. Turn on App Service
Authentication (Microsoft provider) before sharing the URL; the app itself has no login.
GitHub needs variable `AZURE_WEBAPP_NAME` and secret `AZURE_WEBAPP_PUBLISH_PROFILE`.

