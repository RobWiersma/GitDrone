https://gitdrone-bxa9ejf9gbhva9ek.westus3-01.azurewebsites.net/

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
| /                            | FlightFeedComponent        |
| /hangar                      | AircraftListComponent      |
| /hangar/new                  | AircraftFormComponent      |
| /hangar/:id                  | AircraftDetailComponent    |
| /hangar/:id/edit             | AircraftFormComponent      |
| /hangar/:id/tunes/import     | TuneImportComponent        |
| /hangar/:id/tunes/bulk       | TuneBulkImportComponent    |
| /tunes/compare?from=&to=     | TuneCompareComponent       |
| /hangar/:id/flights/upload   | FlightUploadComponent      |
| /flights/:id                 | FlightDetailComponent      |
| /flights/:id/overlay         | FlightOverlayComponent     |
| /osd                         | LovelyOsdComponent         |

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
- GET    /api/flights/{id}/telemetry  returns: { points: [[t, rssi %|null, baro height above takeoff (m)|null], ...] } at 10 Hz,
                                   or 404 when the log has neither rssi nor baroAlt
- POST   /api/osd/analyze          multipart/form-data: file (.bbl/.bfl, max 64 MB)
                                   returns: { fileName, sessions: [{ flight, track, sticks, battery, telemetry }] }
                                   Decodes in memory and stores nothing. flight.id is 0; track/sticks/battery match the
                                   per-flight endpoints, or null.

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

Flights with GPS get distance, top speed, max height above takeoff and furthest distance from home,
plus a map (Leaflet + OpenStreetMap tiles) with the path coloured by speed. `POST /api/flights/{id}/reprocess`
re-reads the stored log file, e.g. after a decoder change. `GET /api/flights/{id}/track` returns the path.

Logs with `rssi` get a lowest-RSSI stat, an RSSI chart and an RSSI element on the overlay. This is the signal
strength Betaflight logs (shown 0–100% like its OSD), not link quality, which Betaflight doesn't write to the blackbox.
Logs with `baroAlt` get the barometer height drawn dashed on the height chart next to GPS, and the overlay can take
its altitude from either.

## Video overlay

Each flight page has **Export video overlay** (`/flights/:id/overlay`): a transparent HUD video to put on a
track above your footage in Premiere Pro or After Effects. It shows speed and acceleration, altitude, distance
from home, satellites, battery (pack and per-cell voltage, amps, mAh used, watts), both sticks in
Blackbox Explorer style (modes 1–4), a flight timer and a mini map, and can draw everything with your goggles'
Betaflight OSD font (`font_bf.bin` / `font_bf_hd.bin`, DJI WTFOS format) including Betaflight's own icons.

**Layout.** Drag any element on the preview to move it, and set each one's size (50–200%) under Layout; the same
controls also move elements from the keyboard. The timer, RSSI, speed and battery panels also let you size each reading
inside them (speed, G-force, satellites, pack voltage, mAh, ...), and the panel grows or shrinks to fit. Positions are stored as fractions of the frame, so a layout looks the
same at every resolution, and it's remembered in your browser. Elements always stay fully inside the frame.

**How it renders.** Everything happens in the browser; nothing is uploaded. Each frame is drawn on a canvas
straight from the decoded log data (no playback, no screen capture), encoded as a PNG, and written into a
QuickTime `.mov` with the PNG codec, which keeps the alpha channel so the overlay is transparent without
keying. In Chrome and Edge the file streams straight to disk, so long or 4K exports don't fill up memory.

**Speed.** Rendering isn't tied to playback, so it runs faster than real time. Measured at 1080p: about
21 ms per frame, so a 7-minute flight at 30 fps (≈12,750 frames) renders in roughly 4½ minutes. Higher
resolutions and frame rates take proportionally longer (4K has 4× the pixels per frame), and the page shows a
live ETA while it works.

**Size.** The video is lossless, so it's large: about 170 KB per 1080p frame, roughly 2.2 GB for that
7-minute flight. Your editor's final export brings it back to normal size.

In Premiere: import the `.mov`, put it on a track above the footage, and slide it so the timer starts when the
quad arms. If it shows black instead of transparent, set Interpret Footage → Alpha Channel to Straight.

## LovelyOSD Overlay

The **LovelyOSD Overlay** tab (`/osd`) is the quick route: pick a blackbox log, see the same stats, map, playback
and charts as a flight page, and export the overlay video, without adding anything to the hangar. The API reads the
file in memory and forgets it (nothing goes into the database or `App_Data/logs`), and the results only live on the
page, so leaving it clears them. A file with several armed sessions gets a session picker. It's open to visitors who
aren't signed in, since nothing is stored; to protect the small App Service plan, the API decodes at most two logs at
once (two more wait, the rest get a "busy, try again" 503).

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
Authentication (Microsoft provider) with **Allow unauthenticated access**: visitors can browse and use LovelyOSD,
and only signed-in users can add or change anything (the API enforces this).
GitHub needs variable `AZURE_WEBAPP_NAME` and secret `AZURE_WEBAPP_PUBLISH_PROFILE`.

## License

GitDrone is free software under the [GNU General Public License v3.0](LICENSE). You can use, study, share and change
it; if you distribute a modified version, it has to stay under the GPL too.

## Credits

GitDrone stands on the open-source FPV world:

- **[Betaflight](https://github.com/betaflight/betaflight)** (GPL-3.0): the flight controller firmware whose logs,
  `diff all` format and OSD symbol codes (`osd_symbols.h`) this reads.
- **[Blackbox Explorer](https://github.com/betaflight/blackbox-log-viewer)** (GPL-3.0): `Services/BlackboxDecoder.cs`
  is a port of its log decoder, which is why GitDrone is GPL-3.0 as well.
- **[WTFOS msp-osd](https://github.com/fpv-wtf/msp-osd)**: the DJI goggles font format LovelyOSD reads. Fonts are
  loaded from your own computer and never uploaded or bundled here.
- **[Leaflet](https://leafletjs.com/)** (BSD-2-Clause) and **[OpenStreetMap](https://www.openstreetmap.org/copyright)**
  contributors (ODbL) for the flight maps.

