/* ============================================================
   snap-archive-screen.mjs — Archive list screen (scrolled)

   Produces:
     • archive-screen.png — 393×852 @3x capture of the Archive
       screen in its "scroll-collapsed" state: the pink folder
       hero has shrunk to its collapsed pill-size (56px, centred
       next to the back button at y≈82), the tagline has faded
       out, and the filter tab row (All / Dad / Mom / Older
       Sister / Older Brother …) sits flush above a list of
       sent-message cards.

   Why "scroll-collapsed" and not the initial hero state: the
   reference shot the user supplied shows the small folder at
   the top + tagline hidden + cards filling the rest of the
   screen. That's the state ArchiveScreen enters after scrolling
   the .list past its THRESHOLD (CARD_TOP_MAX - CARD_TOP_MIN =
   124px). We scroll 180px so the collapse is fully committed
   (progress=1) and no intermediate tween frame bleeds into the
   capture.

   Flow:
     1. Navigate to archive via window.__hv.navigate('archive').
        AppContext seeds DUMMY_ARCHIVE → the list mounts with 8
        entries (To Mom, To Dad, To Older Sister, To Older
        Brother, To Younger Sister, To Younger Brother, To
        Grandpa, To Grandma).
     2. Wait for mount + hero image load + first-paint fade.
     3. Scroll the .list element down 180px. ArchiveScreen's
        handleListScroll sets scrollY → the hero / card / inner-
        translate math computes progress=1 and the hero shrinks
        to HERO_MIN. The .listInner translateY also moves up
        ~124px so the cards settle into their collapsed position.
     4. Wait ~500ms for any scroll-driven transition to settle.
     5. Screenshot the phone.
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

await page.evaluate(() => window.__hv.navigate('archive'));
// Mount + first-paint fade + hero image load. 1000ms is safe.
await new Promise((r) => setTimeout(r, 1000));

/* Scroll the archive list — the .list element owns the scroll,
   NOT the screen or document. ArchiveScreen.handleListScroll
   reads scrollTop off the scroll event target, which is the
   .list div, and drives the hero-collapse math off that. So we
   reach into the DOM, find the .list, and set scrollTop
   directly — a synthetic scroll event fires, setScrollY
   updates, and the collapse progresses to 1 on the next
   render. */
await page.evaluate(() => {
  const list = document.querySelector('[class*="_list_"]');
  if (!list) throw new Error('no .list found');
  // 180 > THRESHOLD (124) so progress clamps to 1 — fully collapsed.
  list.scrollTop = 180;
  // Nudge a scroll event in case assignment alone doesn't trigger
  // React's onScroll in this test harness. (Chromium fires scroll
  // on scrollTop assignment natively, but a dispatchEvent is a
  // cheap insurance policy.)
  list.dispatchEvent(new Event('scroll', { bubbles: true }));
});
await new Promise((r) => setTimeout(r, 500));

const phone = page.locator('#root > div').first();
await phone.screenshot({
  path: path.join(OUT_DIR, 'archive-screen.png'),
});
console.log('  ✓ archive-screen.png');

await browser.close();
console.log(`\n✓ Saved to ${OUT_DIR}`);
