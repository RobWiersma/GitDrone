import { Component, signal } from '@angular/core';

/**
 * Shown on phones and small touch tablets only (the media query decides, so desktops never see it): LovelyOSD Editor
 * works with the flight's files and renders on the GPU, so it wants a computer. Offers to send the link onward, through
 * the phone's share sheet where there is one, or by copying it.
 */
@Component({
  selector: 'app-phone-notice',
  template: `
    <aside class="notice" aria-labelledby="phone-notice-title">
      <p id="phone-notice-title" class="title"><span aria-hidden="true">🖥️</span> This one needs a big-boy PC</p>
      <p>
        LovelyOSD Editor works with your flight's log and footage files and renders 4K video on your graphics card, so open it on
        a computer, in Chrome or Edge. Send yourself the link for later:
      </p>
      <button class="btn btn-primary" type="button" (click)="send()">{{ label() }}</button>
    </aside>
  `,
  styles: `
    :host { display: none; }
    /* Phones and small touch tablets: a coarse pointer on a narrow screen. */
    @media (pointer: coarse) and (max-width: 52rem) { :host { display: block; } }
    .notice { padding: 1rem 1.1rem; border-radius: 12px; border: 1px solid var(--accent);
              background: color-mix(in srgb, var(--accent) 10%, var(--surface)); color: var(--ink); }
    .notice p { margin: 0 0 .75rem; line-height: 1.5; }
    .title { font-weight: 800; font-size: 1.1rem; }
  `,
})
export class PhoneNoticeComponent {
  label = signal(typeof navigator !== 'undefined' && 'share' in navigator ? 'Send me the link' : 'Copy the link');

  async send() {
    const url = `${location.origin}/osd`;
    if ('share' in navigator) {
      try {
        await navigator.share({ title: 'LovelyOSD Editor', text: 'Your FPV footage with its OSD, ready to upload. Open this on my computer.', url });
        return;
      } catch (e) {
        if (e instanceof DOMException && e.name === 'AbortError') return; // closed the share sheet
      }
    }
    try {
      await navigator.clipboard.writeText(url);
      this.label.set('Copied. Paste it to yourself');
    } catch {
      this.label.set(url); // nothing else worked: at least show it to copy by hand
    }
  }
}
