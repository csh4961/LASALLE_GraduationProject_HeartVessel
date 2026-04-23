/* ============================================================
   snap-vessel-detail.mjs — Vessel expanded-detail full phone shot

   Produces:
     • vessel-detail-screen.png — 393×852 @3x capture of the Vessel
       screen in its expanded state: back button (top), orbit
       hearts sliding into their expanded-slot positions behind
       the main heart, "01 / N" page counter, "Dad ✼" header,
       message preview, date + held-days line, "See details →"
       CTA, and the Home/Vessel/Archive nav bar + chat button
       at the bottom.

   Flow:
     1. Navigate to the Vessel screen via window.__hv.navigate('vessel').
        Dummy vessel entries mount from AppContext (DUMMY_VESSEL
        has 2 Dad entries by default — counter reads "01 / 02").
     2. Wait ~1400ms for the orbit enter stagger to settle (per
        VesselScreen comment: ~1.2s to staggerDone + a little
        buffer) so every heart is at opacity 1 and no heart is
        still in the middle of its fade-in.
     3. Click the first .heartBtn (Dad is index 0 in DUMMY_FAMILY,
        so its button is the first in the orbit). handleHeartTap
        sets expandedIndex=0 + mountExpanded=true, the orbit
        morph runs (~0.6s), and .detailContent fades in after
        a 0.32s delay + 0.36s duration.
     4. Wait ~1600ms — covers the morph (0.6s) + detail fade-in
        (0.32 + 0.36 = 0.68s) + padding.
     5. Screenshot the phone.

   If you want the "01 / 12" exact counter from the reference
   shot, pre-seed 12 Dad entries into localStorage before goto
   (the app reads 'hv_vesselEntries'). The default capture
   reflects whatever DUMMY_VESSEL ships today.
   ============================================================ */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'captures');
const BASE    = 'http://localhost:5173';

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
});
const page = await context.newPage();

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hvReady === true, { timeout: 10000 });

await page.evaluate(() => window.__hv.navigate('vessel'));
// Let the orbit enter-stagger finish (~1.2s per the code's own
// staggerDone flag) so every heart is fully opaque before the
// click morph starts. Without this pause the clicked heart can
// still be mid-fade when handleHeartTap fires, producing an
// uneven morph frame.
await new Promise((r) => setTimeout(r, 1400));

/* Click Dad's orbit heart. The heart buttons live at index
   positions in DUMMY_FAMILY order — Dad is DUMMY_FAMILY[0] →
   first .heartBtn in the orbit.

   The orbit has a continuous rotation (orbitRot state) so the
   button is never "stable" from Playwright's auto-wait point
   of view. We sidestep the stability check by reaching into
   the DOM and firing a native click synchronously — React's
   onClick picks it up the same way a pointer click would. The
   orbit's live position is irrelevant: handleHeartTap reads
   the button's current position off the DOM at click time, so
   the morph starts from wherever the heart happens to be in
   its rotation arc. */
await page.evaluate(() => {
  const btn = document.querySelector('[class*="heartBtn"]');
  if (!btn) throw new Error('no heartBtn found');
  btn.click();
});

/* Wait for:
     • orbit-to-slot morph: ~600ms
     • .detailContent fade-in: 320ms delay + 360ms duration
     • buffer so we don't land mid-tween
   1600ms is comfortable. */
await new Promise((r) => setTimeout(r, 1600));

const phone = page.locator('#root > div').first();
await phone.screenshot({
  path: path.join(OUT_DIR, 'vessel-detail-screen.png'),
});
console.log('  ✓ vessel-detail-screen.png');

await browser.close();
console.log(`\n✓ Saved to ${OUT_DIR}`);
