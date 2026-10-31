import { Component, DestroyRef, inject } from '@angular/core';
import { NgOptimizedImage } from '@angular/common';
import { Meta } from '@angular/platform-browser';
import { RouterLink } from '@angular/router';

const DESCRIPTION = 'DJI O4 footage comes off the air unit without your Betaflight OSD. Here is how to put it back from your '
  + 'blackbox log: speed, battery, sticks, map and stats in your goggles\' font, as a finished video or a transparent overlay, '
  + 'free in your browser with LovelyOSD Editor.';

/**
 * A plain how-to for the question pilots search for: getting the OSD onto clean DJI O4 footage. Written for search
 * and for linking in forums, so it explains the why, walks the whole job, and answers the usual follow-ups.
 */
@Component({
  selector: 'app-dji-o4-osd-guide',
  imports: [NgOptimizedImage, RouterLink],
  template: `
    <article class="page guide">
      <p class="eyebrow">Guide · LovelyOSD Editor</p>
      <h1>How to add your OSD to DJI O4 footage</h1>
      <p class="lede">
        Your O4 records beautiful footage, but it comes off the air unit clean: no speed, no battery, no sticks. Your blackbox
        log has all of it, though, so you can put the OSD back afterwards, in your goggles' own font, synced to your flight.
        Here's how, for free and without installing anything.
      </p>
      <figure>
        <img ngSrc="home/osd-hillside.jpg" width="800" height="450" priority
             alt="DJI O4 footage over a hillside with its OSD added back: speed, battery per cell, the mini map and both sticks" />
        <figcaption class="hint">O4 footage with its OSD put back from the blackbox log.</figcaption>
      </figure>

      <nav class="toc" aria-label="On this page">
        <ol>
          <li><a routerLink="/guides/add-osd-to-dji-o4-footage" fragment="why">Why your O4 footage has no OSD</a></li>
          <li><a routerLink="/guides/add-osd-to-dji-o4-footage" fragment="need">What you need</a></li>
          <li><a routerLink="/guides/add-osd-to-dji-o4-footage" fragment="steps">Step by step</a></li>
          <li><a routerLink="/guides/add-osd-to-dji-o4-footage" fragment="faq">Questions</a></li>
        </ol>
      </nav>

      <section aria-labelledby="why">
        <h2 id="why">Why your O4 footage has no OSD</h2>
        <p>
          With DJI's digital systems, Betaflight's OSD isn't part of the camera's picture. The flight controller sends the OSD
          to your goggles, and the goggles draw it over the live feed. The air unit records its own high-quality copy of the
          video, and that copy never sees the OSD.
        </p>
        <p>
          You can record in the goggles to keep the OSD, but that's the lower-quality live feed. The better way is to keep the
          air unit's footage and draw the OSD again from the flight's data. Betaflight's <strong>blackbox log</strong> records
          your sticks, battery, GPS and RSSI the whole flight, which is everything the OSD showed.
        </p>
      </section>

      <section aria-labelledby="need">
        <h2 id="need">What you need</h2>
        <ul class="needs">
          <li><strong>Your O4 footage</strong>, copied off the air unit as you normally would.</li>
          <li><strong>The flight's blackbox log</strong> (<code>.bbl</code> or <code>.bfl</code>) from the flight controller's flash or SD card.</li>
          <li><strong>A computer with Chrome or Edge.</strong> The video renders on your graphics card, right in the browser.</li>
          <li><em>Optional:</em> your goggles' OSD font (<code>font_btfl.png</code>, or the older <code>font_bf.bin</code>), a phone or stick cam recording for sound, and music.</li>
        </ul>
      </section>

      <section aria-labelledby="steps">
        <h2 id="steps">Step by step</h2>

        <h3>1. Log the right things before you fly</h3>
        <p>
          In Betaflight Configurator's <strong>Blackbox</strong> tab, make sure <strong>RC commands</strong> (sticks),
          <strong>Battery</strong>, <strong>GPS</strong> and <strong>RSSI</strong> are logged. A logging rate of 250–500 Hz is
          plenty. Erase the flash so the flight fits, and wait for a GPS fix before you arm, since home is set at arming.
          On ELRS or Crossfire, set the debug mode to <code>CRSF_LINK_STATISTICS_UPLINK</code> and log <strong>Debug</strong>
          too, and the OSD gets your link quality (LQ) and RSSI in dBm.
          The full checklist, CLI commands included, is under <strong>Getting a good log</strong> in the editor.
        </p>

        <h3>2. Get your files</h3>
        <p>
          Copy the clip off your O4. For the log, plug the quad into your computer: in LovelyOSD Editor, press
          <strong>Connect FC over USB</strong> and then <strong>Open FC drive</strong>, and the newest log loads by itself (Chrome
          or Edge). You can also use Configurator's mass storage mode or copy the file from the SD card.
        </p>

        <h3>3. Load them into LovelyOSD Editor</h3>
        <p>
          Open <a routerLink="/osd">LovelyOSD Editor</a>, load the log, then your footage. If you filmed with a phone on the ground
          or a stick cam, add it as the sound track: it's lined up for you from the sound of the motors arming. Add music too, if you
          like.
        </p>

        <h3>4. Line up your takeoff</h3>
        <p>
          Move to the frame where you leave the ground (the arrow buttons step single frames) and press
          <strong>Takeoff is here</strong>. The OSD now follows your footage exactly. If the footage has the motors in its
          sound, <strong>Sync from motor sound</strong> can find it for you, and a clap works too. Once everything's synced, it all
          locks together on the timeline.
        </p>
        <figure>
          <img ngSrc="guides/editor.jpg" width="1400" height="1683"
               alt="LovelyOSD Editor with O4 footage loaded: the footage's sync and colour settings on the left, the preview with the OSD, and a timeline with the OSD, footage, sound and music tracks" />
          <figcaption class="hint">The editor: settings on the left, the preview with your OSD, and the timeline with every track.</figcaption>
        </figure>

        <h3>5. Make it look like your goggles</h3>
        <p>
          Load your goggles' Betaflight font (<code>font_btfl.png</code> or <code>font_bf.bin</code>) to draw the OSD the way your goggles do.
          No font file? WTFOS's <a href="https://github.com/fpv-wtf/msp-osd/tree/v0.11.1/fonts" target="_blank" rel="noopener">.bin fonts are on GitHub</a> (<code>font_bf_hd.bin</code>),
          and Walksnail fonts work too. Load your Betaflight CLI backup (<code>diff all</code>) as well and it redraws the exact OSD
          layout you set up in the Configurator. Click anything in the preview to
          move it, resize it or change its colours, and turn parts on or off. O4 footage is often flat, so the footage has
          Lumetri-style colour controls (exposure, contrast, saturation and more) too.
        </p>

        <h3>6. Render</h3>
        <p>
          Press <strong>Video .mp4</strong> for a finished video, ready to upload, in landscape for YouTube or vertical for Shorts,
          Reels and TikTok. It renders on your graphics card at your footage's resolution, so 4K stays 4K, and 100 fps O4 footage
          comes out at 60. Prefer your own editor? <strong>Overlay .mov</strong> exports a transparent OSD to put on a track above
          your footage in Premiere Pro or After Effects.
        </p>
        <p class="cta"><a class="btn btn-primary" routerLink="/osd">Open LovelyOSD Editor</a></p>
      </section>

      <section aria-labelledby="faq">
        <h2 id="faq">Questions</h2>
        <h3>Is my footage uploaded anywhere?</h3>
        <p>
          No. Your footage, sound, music and font play and render on your own computer. Only the log is sent to be decoded, and
          it's read in memory and forgotten. No account, nothing kept.
        </p>
        <h3>Does it work with DJI O3, Walksnail or a GoPro?</h3>
        <p>
          Yes. The OSD is drawn from the Betaflight log, not from the video, so any footage of the flight works: O3, O4, Walksnail,
          HDZero's DVR, a GoPro or a phone. This guide is about the O4 because that's where people miss their OSD most.
        </p>
        <h3>Why not just record in the goggles?</h3>
        <p>
          You can, and the OSD will be in it, but that recording is the live feed, at a lower quality than the air unit's own.
          Drawing the OSD onto the air unit's footage gets you both.
        </p>
        <h3>Which browser should I use?</h3>
        <p>
          Chrome or Edge on a computer. They can read the flight controller over USB and save big videos straight to disk. Other
          browsers work for the rest. Phones can't do it: the editor needs your files and a graphics card.
        </p>
        <h3>Is it free?</h3>
        <p>Yes, and open source (<a href="https://github.com/RobWiersma/GitDrone">GPL-3.0 on GitHub</a>).</p>
      </section>
    </article>
  `,
  styles: [`
    .guide { max-width: 50rem; display: grid; gap: 1.5rem; }
    .eyebrow { margin: 0; text-transform: uppercase; letter-spacing: .06em; font-size: .78rem; font-weight: 700; color: var(--muted); }
    h1 { font-size: clamp(1.9rem, 4vw, 2.5rem); margin: 0; }
    .lede { font-size: 1.1rem; line-height: 1.6; margin: 0; }
    h2 { font-size: 1.4rem; margin: 0 0 .6rem; scroll-margin-top: 4.5rem; }
    h3 { font-size: 1.08rem; margin: 1.4rem 0 .4rem; }
    p, li { line-height: 1.65; }
    p { margin: 0 0 .6rem; }
    figure { margin: .5rem 0 1rem; display: grid; gap: .4rem; }
    figure img { width: 100%; height: auto; border-radius: 12px; border: 1px solid var(--line); }
    figcaption { margin: 0; font-size: .88rem; }
    .toc { padding: .8rem 1.1rem; border: 1px solid var(--line); border-radius: 10px; background: var(--surface); }
    .toc ol { margin: 0; padding-left: 1.2rem; display: grid; gap: .2rem; }
    .needs { margin: 0; padding-left: 1.2rem; display: grid; gap: .35rem; }
    .cta { margin-top: 1rem; }
  `],
})
export class DjiO4OsdGuideComponent {
  constructor() {
    // Search engines read this page's own description, not the site's.
    const meta = inject(Meta);
    const before = meta.getTag('name="description"')?.content ?? '';
    meta.updateTag({ name: 'description', content: DESCRIPTION });
    inject(DestroyRef).onDestroy(() => meta.updateTag({ name: 'description', content: before }));
  }
}
