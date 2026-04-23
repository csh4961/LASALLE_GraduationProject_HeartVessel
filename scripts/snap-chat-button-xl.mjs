/* ============================================================
   snap-chat-button-xl.mjs — Chat button isolated at extreme
                              resolution.

   Produces:
     • chat-button-xl.png — the circular glass .chatBtn from
       App.module.css rendered at huge physical size (600×600
       CSS px) with deviceScaleFactor 3 → final PNG is
       1800×1800 pixels. Transparent corners outside the circle.

   Why both upscale in CSS AND bump DPR:
     • bumping DPR alone keeps the button at 66×66 CSS which
       means the backdrop-filter gets applied over a tiny area
       — when you then view the PNG enlarged, the filter looks
       like a few big blurry blobs because the blur kernel was
       computed at small CSS scale and then sampled up.
     • scaling the .chatBtn's width/height up to 600px forces
       the backdrop-filter + specular sheens + rim stroke to
       re-paint at the target size — the glass material stays
       physically correct at any zoom.
     • DPR 3 on top gives the final raster sharpness.

   Mechanic:
     1. Navigate to home so .chatBtn is in its closed/large state.
     2. Strip everything else (phone bg, nav bar, character,
        screens) to transparent/hidden so element.screenshot
        corners come out clean.
     3. Enlarge .chatBtn to 600×600, reposition to 0,0 (so the
        screenshot captures the whole enlarged rect — the natural
        position is bottom-right of the phone, which would place
        most of the enlarged pixels outside the viewport).
     4. Inject a dark backing element underneath — same trick as
        snap-chatbar.mjs / snap-dest-buttons.mjs — sized to the
        enlarged button's new rect + 50% radius. Without this the
        backdrop-filter has nothing to pick up since the rest of
        the page is transparent, and the button reads as a thin
        translucent wash instead of dark glass.
     5. element.screenshot with omitBackground.

   Glyph scaling: the <img> inside the button uses its own CSS
   size class; by enlarging the parent button we visually enlarge
   the glyph proportionally because its width/height are defined
   in relative-ish units (max-width:60%). If it's defined in
   absolute px, we bump it too so the proportion stays identical
   to the reference.
   ============================================================ */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'captures');
const BASE    = 'http://localhost:5173';

const BUTTON_SIZE = 600;   // CSS px — huge canvas for the glass to paint onto
const DPR         = 3;     // final PNG = 600 × 3 = 1800px per side

const browser = await chromium.launch();
const context = await browser.newContext({
  // Give the viewport enough room for the enlarged button +
  // its injected backing. 900×900 is comfortably larger than
  // the button's 600×600 footprint.
  viewport: { width: 900, height: 900 },
  deviceScaleFactor: DPR,
});
const page = await context.newPage();

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hvReady === true, { timeout: 10000 });

// Home has the chat button in its closed/66×66 state.
await page.evaluate(() => window.__hv.navigate('home'));
await new Promise((r) => setTimeout(r, 600));

/* Strip the rest of the app so the screenshot corners outside
   the circle can come out transparent. We DO keep .chatBtn
   visible (it's our target) and don't hide the <img> glyph
   inside it. The App.module.css chatBtn sits at absolute
   positioning inside .phone, so once we reposition it to the
   top-left of the viewport below, nothing of the hidden
   siblings overlaps its new rect. */
await page.addStyleTag({ content: `
  html, body { background: transparent !important; }
  #root { background: transparent !important; box-shadow: none !important; }
  #root > div { background: transparent !important; overflow: visible !important; }
  [class*="_sharedChar_"] { display: none !important; }
  [class*="_screenWrap_"] { display: none !important; }
  [class*="navBar"],
  [class*="navPill"] { display: none !important; }
  [class*="chatDim"] { display: none !important; }
  [class*="_header_"] { display: none !important; }
` });

/* Enlarge .chatBtn to BUTTON_SIZE × BUTTON_SIZE and anchor it
   to the viewport's top-left (0,0) so the full enlarged rect
   sits inside the screenshot window. The original positioning
   (left:302, bottom:30) would put most of the enlarged button
   outside the phone frame; we override to fixed 0,0 with plenty
   of headroom in the 900×900 viewport.

   We also grow the glyph image inside so it keeps its original
   proportion relative to the circle. The existing CSS sets the
   glyph to a specific px size via .chatBtnGlyph — bumping it
   proportionally (enlarged/original = 600/66 ≈ 9.09×) keeps
   the composition identical to the reference. */
await page.evaluate((px) => {
  const btn = document.querySelector('[class*="chatBtn"]:not([class*="chatBtnSmall"])');
  if (!btn) throw new Error('no chatBtn found');
  btn.style.position    = 'fixed';
  btn.style.left        = '0px';
  btn.style.top         = '0px';
  btn.style.right       = 'auto';
  btn.style.bottom      = 'auto';
  btn.style.width       = `${px}px`;
  btn.style.height      = `${px}px`;
  btn.style.transform   = 'none';
  btn.style.zIndex      = '9999';
  // Scale the interior glyph proportionally. The default CSS
  // sets .chatBtnGlyph to a fixed size; find it and bump it.
  const img = btn.querySelector('img');
  if (img) {
    const scale = px / 66;
    // Original glyph is ~34px; scale ratio keeps it at ~34 × scale.
    img.style.width     = `${34 * scale}px`;
    img.style.height    = 'auto';
    img.style.maxWidth  = 'none';
    img.style.maxHeight = 'none';
  }
}, BUTTON_SIZE);

/* Inject a dark backing matched to the enlarged button's rect
   + 50% border-radius. Phone background is now transparent, so
   the backdrop-filter had nothing to pick up — without this
   the glass reads as almost fully translucent. The backing
   sits just under the button (z-index: 9998 vs button's 9999). */
await page.evaluate((px) => {
  document.querySelectorAll('[data-chatbtn-backing]').forEach((n) => n.remove());
  const btn = document.querySelector('[class*="chatBtn"]:not([class*="chatBtnSmall"])');
  if (!btn) return;
  const r = btn.getBoundingClientRect();
  const backing = document.createElement('div');
  backing.setAttribute('data-chatbtn-backing', '');
  backing.style.cssText = `
    position: fixed;
    left: ${r.left}px;
    top: ${r.top}px;
    width: ${r.width}px;
    height: ${r.height}px;
    background: #0b0b0d;
    border-radius: 50%;
    z-index: 9998;
    pointer-events: none;
  `;
  document.body.appendChild(backing);
}, BUTTON_SIZE);

// Let the layout + backdrop-filter settle at the new size.
await new Promise((r) => setTimeout(r, 250));

/* omitBackground paints only inside the circle's mask + its
   own surface. Corners outside the circle come out as fully
   transparent pixels. */
const btn = page.locator('[class*="chatBtn"]:not([class*="chatBtnSmall"])').first();
await btn.screenshot({
  path: path.join(OUT_DIR, 'chat-button-xl.png'),
  omitBackground: true,
});
console.log('  ✓ chat-button-xl.png');

await browser.close();
console.log(`\n✓ Saved to ${OUT_DIR}`);
