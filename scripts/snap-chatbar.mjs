/* ============================================================
   snap-chatbar.mjs — Isolated chat-bar captures

   Produces two standalone PNGs of just the chat input bar
   (`.chatBar` in App.module.css) with the rest of the app
   hidden, so the bar can be dropped onto any background:

     • chatbar-empty.png   — bar open, placeholder visible
                              ("Tell me anything, anytime.")
     • chatbar-filled.png  — bar open with the sample message
                              ("My dad checked my exam scores …")

   Both shots are taken at the bar's natural size × 3 DPR and
   ship with transparent corners. To make the bar's backdrop-
   filter still read as "dark glass" when the usual phone/screen
   background is hidden, we inject a single dark backing <div>
   directly underneath the bar — sized and rounded to match —
   so the backdrop picks up solid dark inside the rounded
   rectangle without painting anything outside it.
   ============================================================ */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'captures');
const BASE    = 'http://localhost:5173';

// Sample message the user requested for the filled-in shot.
const SAMPLE = "My dad checked my exam scores and immediately asked why they weren't higher. It made me feel like my effort didn't matter.";

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3, // same 3x as the main capture pipeline
});
const page = await context.newPage();

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hvReady === true, { timeout: 10000 });

// Home (or any nav-visible screen) so .chatBar exists in the DOM.
await page.evaluate(() => window.__hv.navigate('home'));
await new Promise((r) => setTimeout(r, 600));

// Click the floating chat button to open the bar. aria-label is
// "New chat" when closed (switches to "Send message" once open).
await page.locator('button[aria-label="New chat"]').first().click();
await new Promise((r) => setTimeout(r, 500)); // slide-up + focus

/* Strip everything that isn't the bar. We keep the bar's own
   rules intact (backdrop-filter, ::before/::after sheens) but
   hide:
     • html / body backgrounds (the pink that normally surrounds
       #root) — omitBackground handles body, but we set them
       !important just in case.
     • chatDim — the scrim that would darken the whole phone.
     • home / vessel shared character + the active screen content
       + the nav bar. These sit behind the bar and would otherwise
       bleed into the bar's backdrop-filter pickup or into the
       screenshot corners.
   We KEEP .chatBtn visible — when chat is open it's scaled to
   .chatBtnSmall (36×36) and sits at the bar's right-bottom, where
   the user's reference screenshots show it as the little circle
   inside the bar. Its position is absolute-in-.phone, and at the
   scaled size it lies entirely inside the bar's bounding rect,
   so element.screenshot(.chatBar) picks it up as overlapping
   pixels.
   We ALSO make .phone / #root backgrounds transparent so nothing
   else bleeds into the screenshot's rounded-corner region. */
await page.addStyleTag({ content: `
  html, body { background: transparent !important; }
  [class*="chatDim"] { display: none !important; }
  [class*="_sharedChar_"] { display: none !important; }
  [class*="_screenWrap_"] { display: none !important; }
  [class*="navBar"],
  [class*="navPill"] { display: none !important; }
  /* #root wraps .phone — both have dark backgrounds by default */
  #root { background: transparent !important; box-shadow: none !important; }
  #root > div { background: transparent !important; }
` });

/* Inject a dark backing element directly beneath the chat bar,
   precisely matching its rect + border-radius. With everything
   else now transparent, the bar's backdrop-filter (blur +
   saturate + SVG refraction) has nothing to pick up — without
   this backing the "glass" reads as a translucent wash instead
   of dark glass. The backing sits at z-index 140 (bar itself is
   150), so it paints just under the bar and NOT in the screenshot
   corners outside the bar's rounded edges. */
async function injectBacking(page) {
  await page.evaluate(() => {
    // Clean up any previous backing before re-injecting.
    document.querySelectorAll('[data-chatbar-backing]').forEach((n) => n.remove());

    const bar = document.querySelector('[class*="chatBar"]');
    if (!bar) return;
    const r = bar.getBoundingClientRect();
    const backing = document.createElement('div');
    backing.setAttribute('data-chatbar-backing', '');
    backing.style.cssText = `
      position: fixed;
      left: ${r.left}px;
      top: ${r.top}px;
      width: ${r.width}px;
      height: ${r.height}px;
      background: #141518;
      border-radius: 34px;
      z-index: 140;
      pointer-events: none;
    `;
    document.body.appendChild(backing);
  });
}

async function snap(filename) {
  // Re-inject on every snap — the bar's height changes after
  // typing so the backing rect needs to re-align.
  await injectBacking(page);
  await new Promise((r) => setTimeout(r, 80));
  const bar = page.locator('[class*="chatBar"]').first();
  const outPath = path.join(OUT_DIR, filename);
  await bar.screenshot({ path: outPath, omitBackground: true });
  console.log(`  ✓ ${filename}`);
}

// ── Shot 1 — empty bar with placeholder ──────────────────────
await snap('chatbar-empty.png');

// ── Shot 2 — bar with sample message typed in ────────────────
// fill() uses the native value setter under the hood, which
// React picks up via its synthetic onChange so the component
// state + autoResize behaviour fire normally. Manually run the
// same auto-resize formula afterwards just to be safe (React's
// useState update is async, and autoResize reads scrollHeight
// synchronously on the event — occasionally the resize lags
// the value set by a microtask).
const textarea = page.locator('textarea').first();
await textarea.fill(SAMPLE);
await textarea.evaluate((ta) => {
  ta.style.height = 'auto';
  ta.style.height = ta.scrollHeight + 'px';
});
await new Promise((r) => setTimeout(r, 300));

await snap('chatbar-filled.png');

await browser.close();
console.log(`\n✓ Saved to ${OUT_DIR}`);
