# GitDrone frontend (`drone-logger`)

The Angular 22 app behind GitDrone: the hangar, flight pages, tune history and the LovelyOSD overlay editor. The
[main README](../README.md) covers what GitDrone does; this one is about working on the frontend.

## Running it

You need [Node.js](https://nodejs.org/) 24, and the API running for anything that reads a log or the database
(see the main README's [Getting started](../README.md#getting-started)).

```bash
npm install
npx ng serve
```

Open http://localhost:4200. The dev server reloads on every change and proxies `/api` and `/uploads` to the API on
https://localhost:5001 (`proxy.conf.json`).

```bash
npx ng build   # production build into dist/ (CI copies it into the API's wwwroot)
npx ng test    # unit tests with Vitest
```

The build keeps each component's styles under a budget (`angular.json`: a warning at 8 kB, an error at 10 kB). The
overlay editor sits close to it, so new styles there should reuse the existing classes where they can.

## Where things are

```text
src/app/
├── aircraft/      Hangar: list, detail, form, photo
├── flights/       Flight pages and everything video:
│   ├── flight-detail, flight-view, flight-map, flight-profile, flight-playback   Stats, map, charts, stick replay
│   ├── flight-upload, fc-usb, fc-usb.component     Uploading logs, and getting them off the quad over USB
│   ├── overlay-export.component    The overlay editor (preview, component panel, Options, both exports)
│   ├── overlay-renderer            Draws one HUD frame on a canvas (panels, sticks, map, stats, title, craft name)
│   ├── mov-writer                  The transparent overlay: PNG frames in a QuickTime .mov
│   ├── video-render                The finished .mp4: decode, composite and encode with Mediabunny (WebCodecs)
│   ├── range-window.component      The two-handle slider for the render range
│   ├── clap                        Sound analysis: arming, launch, claps and motor-sound sync
│   └── glyph-font, stick-math      Betaflight OSD fonts and stick modes
├── osd/           LovelyOSD: the no-account overlay tool (/osd)
├── tunes/         Import, timeline, compare
├── home/ · stats/ Front page and visitor stats
└── icon.component.ts   The small outline icons used across the editor (hover text lives on the buttons)
```

## Browser features it relies on

| Feature | Used for | Where it works |
|---|---|---|
| Canvas 2D | Drawing every overlay frame | Everywhere |
| [WebCodecs](https://developer.mozilla.org/docs/Web/API/WebCodecs_API) (via [Mediabunny](https://mediabunny.dev/)) | Rendering the finished `.mp4` | Chrome, Edge, recent Safari and Firefox |
| [File System Access](https://developer.mozilla.org/docs/Web/API/File_System_API) | Writing big exports straight to disk; opening the flight controller's drive | Chrome and Edge; others download from memory |
| [Web Serial](https://developer.mozilla.org/docs/Web/API/Web_Serial_API) | Rebooting the flight controller into mass storage | Chrome and Edge |

Nothing a visitor loads is uploaded except a log they decode (read in memory by the API and forgotten in LovelyOSD).
Footage, sound tracks and fonts stay on their computer.
