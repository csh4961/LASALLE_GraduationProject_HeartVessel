/* ============================================================
   capture-screens.mjs — Playwright-driven screen capture

   Spins up a Chromium instance, loads the running Vite dev server,
   seeds state via the dev-only window.__hv hook (see App.jsx),
   then screenshots the #root phone container for every screen in
   SCREENS below. Outputs PNGs into ./captures at 3x DPR.

   Two output modes per recipe:
     • default      — 393 × 852 CSS × 3 = 1179 × 2556. The phone
                      cropped to its standard viewport. Good for
                      poster slots that show "a phone screen".
     • tall (opt-in) — also outputs `<name>-tall.png`. Releases the
                      phone's `overflow: hidden` and every internal
                      scroll clip, lets content grow to its natural
                      height, then screenshots the now-taller phone.
                      Great for screens whose real content is longer
                      than 852px (profile prose, chat + analysis
                      cards, archive list). 3x DPR, width still 1179.

   Usage:
     1. In one terminal:  npm run dev -- --host
     2. In another:       npm run capture
     3. PNGs land in:     captures/01-splash.png,
                          captures/03-people-tall.png, ...

   `omitBackground: true` keeps the corners transparent outside the
   phone's 44px rounded edges, so you can lay the PNGs onto any
   background in Figma.
   ============================================================ */
import { chromium } from 'playwright';
import fs from 'fs/promises';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BASE     = process.env.CAPTURE_URL  || 'http://localhost:5173';
const OUT_DIR  = path.resolve(__dirname, '..', 'captures');
const SCALE    = 3;        // deviceScaleFactor → 3x PNG
const VP_W     = 393;      // phone CSS width
const VP_H     = 852;      // phone CSS height (normal mode)
const TALL_H   = 6000;     // viewport height ceiling for tall mode
const SETTLE   = 2000;     // ms to wait after state change before shooting
                           // (was 700 — bumped because HomeScreen's tagline
                           //  fade-in lands at 1.3s and the sub-tagline at
                           //  1.6s. Shooting earlier captured the text
                           //  mid-fade and the pink character behind it
                           //  bled through, making the text look pinkish
                           //  instead of solid white.)

/* ── helpers ─────────────────────────────────────────────── */
const wait   = (ms) => new Promise(r => setTimeout(r, ms));
const nav    = (page, name) => page.evaluate((n) => window.__hv.navigate(n), name);
const hvEval = (page, fn, ...args) => page.evaluate(fn, ...args);

/* ── screen recipes ──────────────────────────────────────────
   Each entry = { name, setup(page), tall? }. `setup` leaves the
   app in the state you want captured. After it resolves we wait
   SETTLE ms for animations/transitions, then screenshot #root.

   Set `tall: true` to ALSO emit `<name>-tall.png` — a second pass
   that releases overflow clipping so long content isn't cropped.
   ============================================================ */
const SCREENS = [
  /* ── Splash / Home ───────────────────────────────────── */
  {
    name: '01-splash',
    async setup(page) {
      await nav(page, 'splash');
    },
  },
  {
    name: '02-home',
    async setup(page) {
      await nav(page, 'home');
    },
  },

  /* ── People / Profiles ───────────────────────────────── */
  {
    name: '03-people',
    tall: true, // list can grow past 852px with many members
    async setup(page) {
      await nav(page, 'family');
    },
  },
  // Individual profile details — one per prose-heavy relation, so
  // the poster can show the variety of long-form prose content
  // that lives under .proseBlock panels.
  {
    name: '04a-profile-dad',
    tall: true,
    async setup(page) {
      await hvEval(page, () => {
        const m = window.__hv.familyMembers.find(x => x.relation === 'Dad');
        if (m) {
          window.__hv.setSelectedFamilyMember(m);
          window.__hv.navigate('family-detail');
        }
      });
    },
  },
  {
    name: '04b-profile-mom',
    tall: true,
    async setup(page) {
      await hvEval(page, () => {
        const m = window.__hv.familyMembers.find(x => x.relation === 'Mom');
        if (m) {
          window.__hv.setSelectedFamilyMember(m);
          window.__hv.navigate('family-detail');
        }
      });
    },
  },
  {
    name: '04c-profile-older-sister',
    tall: true,
    async setup(page) {
      await hvEval(page, () => {
        const m = window.__hv.familyMembers.find(x => x.relation === 'Older\nSister');
        if (m) {
          window.__hv.setSelectedFamilyMember(m);
          window.__hv.navigate('family-detail');
        }
      });
    },
  },
  {
    name: '04d-profile-older-brother',
    tall: true,
    async setup(page) {
      await hvEval(page, () => {
        const m = window.__hv.familyMembers.find(x => x.relation === 'Older\nBrother');
        if (m) {
          window.__hv.setSelectedFamilyMember(m);
          window.__hv.navigate('family-detail');
        }
      });
    },
  },

  /* ── Onboarding ──────────────────────────────────────── */
  {
    name: '05-onboarding-pick',
    async setup(page) {
      await hvEval(page, () => {
        window.__hv.setEditingMember(null);
        window.__hv.navigate('onboarding');
      });
    },
  },

  /* ── Vessel ──────────────────────────────────────────── */
  {
    name: '06-vessel',
    tall: true, // orbit + many letter cards can exceed viewport
    async setup(page) {
      await nav(page, 'vessel');
    },
  },
  {
    // The VesselDetailScreen route — a single expanded letter card,
    // not a chat replay. (User added this recipe mid-session; its
    // logic is preserved here under the new numbering.)
    name: '07-vessel-detail',
    async setup(page) {
      await hvEval(page, () => {
        const e = window.__hv.vesselEntries[0];
        if (e) {
          window.__hv.setSelectedVesselEntry(e);
          window.__hv.navigate('vessel-detail');
        }
      });
    },
  },
  {
    // ChatScreen in replay mode, seeded from a Vessel entry. This
    // is the "chat + analysis cards" view the poster most needs —
    // the main tall-capture target.
    name: '08-vessel-replay-chat',
    tall: true,
    async setup(page) {
      await hvEval(page, () => {
        const e = window.__hv.vesselEntries[0];
        if (e) {
          window.__hv.setSelectedVesselEntry(e);
          window.__hv.setReplayEntry(e);
          window.__hv.setReplaySource('vessel');
          window.__hv.navigate('chat');
        }
      });
    },
  },

  /* ── Archive ─────────────────────────────────────────── */
  {
    name: '09-archive',
    tall: true, // entry list can exceed 852px
    async setup(page) {
      await nav(page, 'archive');
    },
  },
  {
    // ChatScreen in replay mode, seeded from an Archive entry —
    // the other main "chat + cards" surface. Tall capture shows
    // the full conversation + analysis deck inline.
    name: '10-archive-replay-chat',
    tall: true,
    async setup(page) {
      await hvEval(page, () => {
        const e = window.__hv.archiveEntries[0];
        if (e) {
          window.__hv.setSelectedArchiveEntry(e);
          window.__hv.setReplayEntry(e);
          window.__hv.setReplaySource('archive');
          window.__hv.navigate('chat');
        }
      });
    },
  },
];

/* ── tall-mode helpers ──────────────────────────────────────
   Releases clipping on the three nested cages that each lock the
   app to 852px, lets the scroll lists paint their full content,
   then sizes everything to contain that content.

   The three cages (in order, outer → inner):
     1. body    — display: flex; align-items/justify-content: center
                  — vertically centres #root in the viewport. In a
                  6000px tall viewport this plants #root at y≈2574,
                  not y=0. If we don't switch body to block layout,
                  phone.screenshot() captures 0..phoneHeight from
                  the PAGE, which gives us body background until
                  y=2574, then the phone.
     2. #root   — height: 852px; overflow: hidden. Clips ANY content
                  past 852px regardless of what .phone does. Earlier
                  releaseClipping passes only touched .phone and
                  never opened this cage, which is why the resulting
                  PNGs were solid #000 from 0..852 (the phone's own
                  bg) and body-pink #E8CFC9 below (where #root
                  clipped and body showed through).
     3. .phone  — height: 100%; overflow: hidden. Mirror of #root's
                  cage one level in.
   ============================================================ */
async function releaseClipping(page) {
  /* ── Pass A — open all three cages & let scroll lists flow ─ */
  await page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) return;
    const phone = root.firstElementChild;
    if (!phone) return;

    // 1 — Unflex body. align-items:flex-start would still centre
    // horizontally; `display: block` drops both centring axes and
    // plants #root at (0, 0). Pink bg stays (it's harmless — any
    // residual pink outside the phone frame is clipped by the
    // final screenshot bounds), but centring needs to go.
    document.body.style.display = 'block';
    document.body.style.alignItems = 'stretch';
    document.body.style.justifyContent = 'flex-start';

    // 2 — Crack open #root. This is the critical step — it's the
    // cage that earlier passes missed. maxHeight:none overrides
    // the `max-height: 100dvh` from the <433px media query, which
    // would otherwise re-cap the root at 6000px (fine at our tall
    // viewport, but bad news if someone bumps TALL_H later).
    root.style.height = 'auto';
    root.style.minHeight = '852px';
    root.style.maxHeight = 'none';
    root.style.overflow = 'visible';
    root.style.borderRadius = '0'; // avoid rounded clip on tall height

    // 3 — .phone mirrors #root.
    phone.style.height = 'auto';
    phone.style.minHeight = '852px';
    phone.style.overflow = 'visible';

    // 4 — Hide bottom overlays. Tall shots are about CONTENT; the
    // navBar / chatBtn / chatBar can't position sensibly when phone
    // height goes from 852 to 1500+ anyway.
    const OVERLAYS = [
      '[class*="navBar"]',
      '[class*="chatBtn"]',
      '[class*="chatBar"]',
      '[class*="navPill"]',
      '[class*="chatDim"]',
    ].join(', ');
    phone.querySelectorAll(OVERLAYS).forEach((el) => {
      el.style.display = 'none';
    });

    // 5 — FIRST: neutralise `min-height: 100%` / `min-height:
    // calc(100% + N)` patterns. These are "fill parent" knobs
    // used across the app so cards pad to the full scroll
    // viewport in normal use (ChatScreen's .draftCard,
    // .heroCard, .analysisCard each carry min-height: 100%;
    // Archive's .listInner uses calc(100% + 124px)).
    //
    // Why this has to run BEFORE scroll-container pinning (step
    // 5b below): pinning reads scrollHeight, which already
    // includes cards stretched by the 100% min-height. Those
    // stretched cards inflate scrollHeight, which (if we then
    // pinned the scroller to that value) would feed back into
    // the cards' 100% → taller cards → even bigger scrollHeight
    // next measurement. Stripping the knob first collapses each
    // card to its content height, so scrollHeight reads true.
    //
    // Chromium returns `min-height: 100%` VERBATIM in
    // getComputedStyle (it does not resolve percents against
    // parent). We detect that string directly. For cases where
    // the browser *does* resolve (some nested layouts), we fall
    // back to comparing px value against parent rect.
    phone.querySelectorAll('*').forEach((el) => {
      const mh = getComputedStyle(el).minHeight;
      if (!mh || mh === 'auto' || mh === 'normal' || mh === '0px') return;
      if (mh.includes('%') || mh.startsWith('calc')) {
        el.style.minHeight = '0px';
        return;
      }
      const mhPx = parseFloat(mh);
      if (!mhPx || mhPx < 50) return;
      const parentH = el.parentElement
        ? el.parentElement.getBoundingClientRect().height
        : 0;
      if (mhPx >= parentH - 4) {
        el.style.minHeight = '0px';
      }
    });

    // 5b — For scroll containers (overflow:auto|scroll), pin
    // their height to scrollHeight and release overflow. This
    // replaces a flex:1 "fill available space" with an explicit
    // "be this tall" so the box actually contributes to ancestor
    // layout when we later size the phone to fit.
    const scrollerSel = [
      '[class*="list"]',
      '[class*="heroScroll"]',
      '[class*="chatHistory"]',
      '[class*="scrollBody"]',
      '[class*="messageArea"]',
    ].join(', ');
    phone.querySelectorAll(scrollerSel).forEach((el) => {
      const cs = getComputedStyle(el);
      const isScroller = ['auto', 'scroll'].includes(cs.overflow) ||
                         ['auto', 'scroll'].includes(cs.overflowY);
      if (!isScroller) return;
      const sh = el.scrollHeight;
      if (sh > 0) {
        el.style.height = sh + 'px';
        el.style.minHeight = sh + 'px';
        el.style.maxHeight = 'none';
        el.style.flex = 'none';
        el.style.overflow = 'visible';
        el.style.overflowY = 'visible';
      }
    });

    // 6 — Walk descendants once more. For LARGE overflow:hidden
    // containers (≥300px — i.e. .card on Archive, .screen, etc.),
    // release overflow so their contents (which may now overflow
    // because of step 5) paint instead of getting clipped. Leave
    // small overflow:hidden alone — it's powering -webkit-line-
    // clamp and ellipsis on entry previews.
    // Also release absolute `top+bottom` stretch-fills so those
    // boxes grow with their content instead of pinning to .screen's
    // now-taller box (which would balloon them past any actual
    // content).
    //
    // CRITICAL: skip elements whose computed top AND bottom are
    // both 0 — those are "fill-parent" wrappers (App.module.css
    // .screenWrap uses `inset: 0` which computes to top:0,
    // bottom:0 on all sides). Releasing their bottom anchor
    // collapses them to 0 height, which cascades: .screen
    // (height: 100%) becomes 0, .card inside measures as 0 tall
    // at iteration time so the ≥300 gate skips it and its
    // overflow: hidden stays, clipping the entire entry list.
    phone.querySelectorAll('*').forEach((el) => {
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();

      if ((cs.overflow === 'hidden' || cs.overflowY === 'hidden') &&
          rect.height >= 300) {
        el.style.overflow = 'visible';
        el.style.overflowY = 'visible';
      }

      if (cs.position === 'absolute' &&
          cs.top !== 'auto' && cs.bottom !== 'auto') {
        const topPx = parseFloat(cs.top) || 0;
        const botPx = parseFloat(cs.bottom) || 0;
        // Skip fill-parent wrappers (both offsets == 0).
        if (topPx === 0 && botPx === 0) return;
        el.style.bottom = 'auto';
        el.style.height = 'auto';
        el.style.maxHeight = 'none';
      }
    });
  });

  // Let the browser reflow with the Pass A style changes before
  // we measure — getBoundingClientRect reads force a flush, but a
  // paint tick first avoids subtle race conditions with backdrop-
  // filter / transform-based children.
  await new Promise((r) => setTimeout(r, 250));

  /* ── Pass B — measure content, size phone + #root ──────────
     With everything released, walk every visible descendant,
     find the largest `rect.bottom`, and pin BOTH phone AND #root
     minHeight to contain it. Pinning only phone doesn't help —
     #root would clip anything past 852. */
  await page.evaluate(() => {
    const root = document.getElementById('root');
    const phone = root?.firstElementChild;
    if (!phone) return;

    const phoneRect = phone.getBoundingClientRect();
    let maxBottom = phoneRect.top + 852;

    phone.querySelectorAll('*').forEach((el) => {
      const cs = getComputedStyle(el);
      if (cs.display === 'none' || cs.visibility === 'hidden') return;
      const r = el.getBoundingClientRect();
      if (r.width < 1 || r.height < 1) return;
      if (r.bottom > maxBottom) maxBottom = r.bottom;
    });

    const needed = Math.ceil(maxBottom - phoneRect.top + 32);
    const finalH = Math.max(852, needed);
    phone.style.height = finalH + 'px';
    phone.style.minHeight = finalH + 'px';
    root.style.height = finalH + 'px';
    root.style.minHeight = finalH + 'px';
  });
}

async function captureNormal(page, cfg, outDir) {
  try {
    await cfg.setup(page);
  } catch (err) {
    console.warn(`  ! setup failed for ${cfg.name}:`, err.message);
  }
  await wait(SETTLE);
  const outPath = path.join(outDir, `${cfg.name}.png`);
  const root = page.locator('#root').first();
  await root.screenshot({ path: outPath, omitBackground: true });
  return outPath;
}

async function captureTall(page, cfg, outDir) {
  // Fresh navigation to wipe any inline styles from a prior tall
  // pass. `load` is enough — we don't need networkidle on a warm
  // dev server that's already fetched everything.
  await page.goto(BASE, { waitUntil: 'load' });
  await page.waitForFunction(() => window.__hvReady === true, { timeout: 10000 });

  // Grow viewport BEFORE setup so any layout code that reads
  // window.innerHeight sees the larger canvas.
  await page.setViewportSize({ width: VP_W, height: TALL_H });

  try {
    await cfg.setup(page);
  } catch (err) {
    console.warn(`  ! tall setup failed for ${cfg.name}:`, err.message);
  }
  await wait(SETTLE);

  await releaseClipping(page);
  await wait(500); // reflow settle

  // Screenshot the phone element (now grown) rather than #root,
  // so omitBackground still works around the rounded corners.
  const outPath = path.join(outDir, `${cfg.name}-tall.png`);
  const phone = page.locator('#root > div').first();
  await phone.screenshot({ path: outPath, omitBackground: true });

  // Reset viewport for the next iteration.
  await page.setViewportSize({ width: VP_W, height: VP_H });
  return outPath;
}

/* ── runner ──────────────────────────────────────────────── */
async function main() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  console.log(`› Launching Chromium (device scale ${SCALE}x)...`);
  const browser = await chromium.launch();
  const context = await browser.newContext({
    viewport: { width: VP_W, height: VP_H },
    deviceScaleFactor: SCALE,
    // Reduced motion is kept OFF — we *want* the final resting
    // state of animated elements (orbit, taglines, etc.), and
    // SETTLE gives them time to land.
  });
  const page = await context.newPage();

  page.on('pageerror', (err) => console.warn('  [pageerror]', err.message));
  page.on('console',   (msg) => {
    if (msg.type() === 'error') console.warn('  [console.error]', msg.text());
  });

  console.log(`› Loading ${BASE} ...`);
  await page.goto(BASE, { waitUntil: 'networkidle' });

  // Wait for the dev-only hook to attach (see App.jsx > CaptureHook).
  // If it never appears, someone's running a production build — bail
  // with a loud error instead of producing blank screenshots.
  try {
    await page.waitForFunction(() => window.__hvReady === true, { timeout: 10000 });
  } catch {
    console.error('\nERROR: window.__hv never attached.');
    console.error('       Make sure the Vite dev server is running (npm run dev --host),');
    console.error('       not a preview/prod build. The CaptureHook is DEV-only.\n');
    await browser.close();
    process.exit(1);
  }
  console.log('› Hook attached. Beginning capture loop...\n');

  // Small nudge: hide the default browser scrollbar + strip any page
  // chrome that might show up on non-macOS. Scoped to just the
  // screenshot, not persisted.
  await page.addStyleTag({ content: `
    html, body { background: transparent !important; overflow: hidden; }
    ::-webkit-scrollbar { display: none; }
  `});

  /* ── Pass 1 — normal (393×852) captures ──────────────── */
  console.log('  [pass 1/2] normal captures');
  for (const cfg of SCREENS) {
    await captureNormal(page, cfg, OUT_DIR);
    const stat = await fs.stat(path.join(OUT_DIR, `${cfg.name}.png`));
    console.log(`    ✓ ${cfg.name.padEnd(28)}  ${(stat.size / 1024).toFixed(0)} KB`);
  }

  /* ── Pass 2 — tall captures (opt-in per recipe) ──────── */
  const tallList = SCREENS.filter((s) => s.tall);
  if (tallList.length > 0) {
    console.log(`\n  [pass 2/2] tall captures (${tallList.length})`);
    for (const cfg of tallList) {
      await captureTall(page, cfg, OUT_DIR);
      const stat = await fs.stat(path.join(OUT_DIR, `${cfg.name}-tall.png`));
      console.log(`    ✓ ${cfg.name.padEnd(24)}-tall  ${(stat.size / 1024).toFixed(0)} KB`);
    }
  }

  const total = SCREENS.length + tallList.length;
  console.log(`\n✓ Done. ${total} PNG(s) saved to ${OUT_DIR}`);
  await browser.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
