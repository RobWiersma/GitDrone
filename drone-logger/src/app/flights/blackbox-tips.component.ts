import { Component, input } from '@angular/core';

/**
 * How to set up Betaflight's Blackbox so a log has everything the overlay shows. Shared by LovelyOSD and the
 * per-flight overlay page; `open` expands it (LovelyOSD shows it expanded until a log is loaded).
 */
@Component({
  selector: 'app-blackbox-tips',
  template: `
    <details class="panel tips" [open]="open()">
      <summary><h2>Getting a good log</h2></summary>

      <h3>1. Turn on the right log fields</h3>
      <p>In Betaflight Configurator's <strong>Blackbox</strong> tab, make sure these are logged. Each one switches on a part of the overlay:</p>
      <table>
        <thead><tr><th scope="col">Log field</th><th scope="col">What it gives you</th></tr></thead>
        <tbody>
          <tr><td>RC commands</td><td>Sticks</td></tr>
          <tr><td>Battery</td><td>Voltage, current, mAh and watts (needs a current sensor for the last three)</td></tr>
          <tr><td>GPS</td><td>Mini map, speed, G-force, distance from home, satellites, height</td></tr>
          <tr><td>RSSI</td><td>RSSI reading and the lowest RSSI stat</td></tr>
          <tr><td>Altitude (barometer)</td><td>Smoother height, if your flight controller has a baro</td></tr>
        </tbody>
      </table>
      <p class="hint">
        Gyro, accelerometer, PID, setpoint, motor and debug fields aren't used by the overlay. Turn them off to fit longer flights
        on the flash chip, or keep them if you also tune with Blackbox Explorer.
      </p>
      <p>Prefer the CLI? <code>get blackbox</code> lists the settings (Betaflight 4.4 and newer). Then for example:</p>
      <pre><code>set blackbox_disable_rc = OFF
set blackbox_disable_bat = OFF
set blackbox_disable_gps = OFF
set blackbox_disable_rssi = OFF
set blackbox_disable_alt = OFF
save</code></pre>

      <h3>2. Pick a logging rate</h3>
      <p>
        <strong>250–500 Hz is plenty.</strong> The overlay reads sticks at 25 Hz and battery and RSSI at 10 Hz, and GPS arrives at its
        own rate (10 Hz by default), so higher rates only fill the flash faster. On an 8 kHz loop, 500 Hz is the 1/16 setting.
        Go to 1–2 kHz only if you also want the log for tuning.
      </p>

      <h3>3. Before you fly</h3>
      <ul>
        <li>Leave Blackbox on <strong>Normal</strong> mode, so it logs from arm to disarm. Each arm becomes its own session in the file.</li>
        <li><strong>Erase the flash</strong> (Blackbox tab) so the new flight has room.</li>
        <li>Wait for a <strong>GPS fix before arming</strong>. Home is set at arming, and distance from home and the map depend on it.</li>
        <li>Check your <strong>voltage and current calibration</strong> (Power &amp; Battery tab) against a multimeter. The overlay shows what the flight controller measured.</li>
      </ul>

      <h3>4. Get the file off the quad</h3>
      <ul>
        <li><strong>Onboard flash:</strong> in the Blackbox tab, use "Save flash to file", or "Activate Mass Storage Device Mode" and copy the <code>.bbl</code>.</li>
        <li><strong>SD card:</strong> copy the <code>.bbl</code> / <code>.bfl</code> file from the card.</li>
      </ul>

      <h3>5. Your OSD font (optional)</h3>
      <p>
        For the real goggles look, load <code>font_bf.bin</code> from your DJI goggles' WTFOS font folder (<code>font_bf_hd.bin</code> also works).
        It stays in your browser and is never uploaded.
      </p>
    </details>
  `,
  styles: [`
    .tips { margin: 1rem 0; }
    summary { cursor: pointer; list-style-position: outside; }
    summary h2 { display: inline; margin: 0; font-size: 1.15rem; }
    summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 4px; border-radius: 4px; }
    h3 { margin: 1.1rem 0 .4rem; font-size: 1rem; }
    p, ul { margin: .3rem 0; }
    ul { padding-left: 1.25rem; display: grid; gap: .3rem; }
    table { border-collapse: collapse; margin: .4rem 0; font-size: .92rem; }
    th, td { text-align: left; padding: .3rem 1rem .3rem 0; border-bottom: 1px solid var(--line); vertical-align: top; }
    th { color: var(--muted); font-weight: 600; }
    pre { background: var(--raised); border: 1px solid var(--line); border-radius: 8px; padding: .6rem .8rem; overflow-x: auto; margin: .4rem 0; font-size: .85rem; }
  `],
})
export class BlackboxTipsComponent {
  open = input(false);
}
