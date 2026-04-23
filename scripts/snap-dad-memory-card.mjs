/* ============================================================
   snap-dad-memory-card.mjs — Isolates the 04 / 04 "memory" card
   from the Dad analysis deck as one clean PNG.

   Produces:
     • dad-memory-card.png — just the fourth perspective card
       (the memory card), corners outside the card surface
       transparent. Matches the user's reference screenshot:
         • top row: PERSPECTIVE kicker + italic "Why Dad might've…"
           eyebrow + "04 / 04" counter
         • green gradient shape hero (Shape 36 — the only
           predominantly-green asset in the gradient library)
         • pink "FROM A MEMORY" kicker + italic serif title
           "His first-job story"
         • body paragraph sourced from CANNED_ANGLES[3].body
         • italic serif blockquote at the bottom
         • four pagination dots with the last one active

   Why this file exists alongside snap-dad-full-flow.mjs:
     The full-flow shot captures the entire phone — chat + deck
     + draft + bottom rail — as one tall image. User now wants
     the last perspective card alone, with transparent corners,
     for reuse as a standalone asset. Reproducing the minimum
     state needed (chat → analyse) and screenshotting the deck's
     fourth .angleCard article directly gets us there without
     pulling in any of the other phone chrome.

   Content mechanic:
     • USER_MSG / CHAT_REPLY — exam-scores framing. The "number"
       word in the memory-card body only makes sense under that
       context ("is this number telling me the truth"), so we
       match the topic. detectPerson() pins activePerson to Dad
       because "dad" appears in the message.
     • CANNED_ANGLES — four cards. Indices 0–2 are placeholders
       (never rendered here — we advance the deck to index 3
       and capture only that article). Index 3 carries the
       exact memory-card copy from the reference.
     • FAKE_MEMORIES_BY_INDEX[3].title in ChatScreen.jsx already
       reads "His first-job story" from a prior edit, so that
       line paints as the label automatically — no extra wiring
       needed.

   Navigation + theme-shape pin:
     • After the analysis renders, set deck.scrollLeft =
       clientWidth * 3 and dispatch a scroll event so React
       bumps analysisIdx to 3 (the "04 / 04" counter + the
       active pagination dot both depend on that state).
     • Force the fourth card's .angleThemeArt <img> src to
       Shape 36 so the green crescent shows. The app's
       pickRandomShapes(4) useMemo is keyed on analysis
       identity — Playwright has no seed hook into it, so we
       do a DOM-level src swap after the image has mounted.
       querySelectorAll('.angleThemeArt') returns one img per
       non-MBTI card in DOM order; the third match corresponds
       to deck index 3 (deck index 0 is MBTI-featured and
       renders the character portrait instead of a themeArt).

   Capture:
     • element.screenshot on the fourth .angleCard <article>
       with omitBackground:true. The card's glass surface
       paints its own backdrop-filter + rounded mask, so
       outside-corner pixels come out fully transparent.
     • DPR 3 native render + sharp lanczos3 × (8/3) upscale
       for the same quality rig as snap-mom-full-flow.mjs.
       Final PNG ~ card_width × 8 vertical, crisp glyphs,
       no backdrop-filter edge drift.
   ============================================================ */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'captures');
const BASE    = 'http://localhost:5173';

const USER_MSG =
  "My dad checked my exam scores and immediately asked why they weren't higher. It made me feel like my effort didn't matter.";

const CHAT_REPLY =
  "That immediate 'why weren't they higher' is what stays with you. Like the work you put in became invisible the second the number wasn't what he wanted. Effort without recognition just sits there, unwitnessed.";

/* Only index 3 matters for this capture — the other three cards
   are never painted. Still filled in with plausible placeholders
   so the shape of the payload matches what the app expects
   (the deck always renders 4 cards; if we short-circuit to one,
   the pagination dots would read "01 / 01" instead of "04 / 04"). */
const CANNED_ANGLES = [
  { title: "His ISTJ wiring",          body: "Placeholder.", quote: "", mbtiFeatured: true  },
  { title: "What he was protecting",   body: "Placeholder.", quote: "", mbtiFeatured: false },
  { title: "Where the sting landed",   body: "Placeholder.", quote: "", mbtiFeatured: false },
  {
    /* title is overridden at render by FAKE_MEMORIES_BY_INDEX[3]
       in ChatScreen.jsx — kept here as a fallback only. */
    title: "His first-job story",
    body:  "The question wasn\u2019t \u2018you\u2019re not enough.\u2019 It was \u2018are you okay, and is this number telling me the truth?\u2019 He doesn\u2019t know how to ask the second part out loud yet.",
    quote: "I just want to make sure you\u2019re alright.",
    mbtiFeatured: false,
  },
];

function buildAnthropicResponse(payloadObj) {
  return {
    id: 'msg_mock',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5-20250929',
    content: [{ type: 'text', text: JSON.stringify(payloadObj) }],
    stop_reason: 'end_turn',
    stop_sequence: null,
    usage: { input_tokens: 1, output_tokens: 1 },
  };
}

const BROWSER_DPR    = 3;
const UPSCALE_FACTOR = 8 / 3;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 393, height: 1200 },  // tall enough that a fully-expanded card fits inside one viewport
  deviceScaleFactor: BROWSER_DPR,
});
const page = await context.newPage();

/* Only two Anthropic calls matter here: the first chat reply
   and the perspective-angles payload. We don't enter the
   drafting phase, so no third fulfiller is needed. Any
   stray later call gets aborted. */
let chatFulfilled = false, perspectiveFulfilled = false;
await page.route('**/api.anthropic.com/**', async (route) => {
  if (!chatFulfilled) {
    chatFulfilled = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildAnthropicResponse({
        reply: CHAT_REPLY, sections: [], suggestions: [],
      })),
    });
  } else if (!perspectiveFulfilled) {
    perspectiveFulfilled = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildAnthropicResponse({ angles: CANNED_ANGLES })),
    });
  } else {
    await route.abort();
  }
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hvReady === true, { timeout: 10000 });
await page.evaluate(() => window.__hv.navigate('home'));
await new Promise((r) => setTimeout(r, 500));

// Chat → send user message → wait for coach reply.
await page.locator('button[aria-label="New chat"]').first().click();
await new Promise((r) => setTimeout(r, 400));
await page.locator('textarea').first().fill(USER_MSG);
await new Promise((r) => setTimeout(r, 150));
await page.locator('button[aria-label="Send message"]').first().click();
await new Promise((r) => setTimeout(r, 3000));

// Analyse → wait for angles to render.
await page.locator('button.heroNext, [class*="inputBarCta"]').first().click();
await new Promise((r) => setTimeout(r, 3500));

/* Advance the horizontal deck to index 3 (04 / 04) AND pin
   the memory card's theme-shape to Shape 36 — the only
   predominantly-green asset in the gradient library. The
   deck's onScroll handler is what bumps React's analysisIdx
   state, which in turn updates the "04 / 04" counter, the
   italic eyebrow that follows the current card, and the
   pagination-dot highlight. */
await page.evaluate(() => {
  const deck = document.querySelector('[class*="angleDeck"]');
  if (!deck) return;
  // Jump to the last card. clientWidth * 3 lands on index 3.
  deck.scrollLeft = deck.clientWidth * 3;
  deck.dispatchEvent(new Event('scroll', { bubbles: true }));

  /* Non-MBTI cards each carry one .angleThemeArt <img>. Cards
     at deck indices 1, 2, 3 → theme imgs at array indices
     0, 1, 2 (card 0 is MBTI-featured, no themeArt). The
     memory card's hero shape is themeImgs[2]. */
  const themeImgs = document.querySelectorAll('[class*="angleThemeArt"]');
  if (themeImgs[2]) {
    themeImgs[2].src = '/asset/gradient%20shapes/Shape/Shape%2036.png';
  }
});

// Let the scroll-snap animation + React state update settle.
await new Promise((r) => setTimeout(r, 700));

/* Expand the .heroScroll out of its absolute/overflow-auto box
   so the full height of the card can paint inside the viewport.
   Without this, tall cards get clipped to .heroScroll's visible
   rect — we want every pixel of the article in the shot. */
await page.addStyleTag({ content: `
  #root { height: auto !important; min-height: 0 !important; overflow: visible !important; align-items: flex-start !important; }
  #root > div { height: auto !important; min-height: 0 !important; overflow: visible !important; }
  [class*="_screenWrap_"] { position: static !important; inset: auto !important; height: auto !important; }
  [class*="heroScroll"] {
    position: static !important;
    inset: auto !important;
    overflow: visible !important;
    height: auto !important;
    max-height: none !important;
    padding-top: 0 !important;
    padding-bottom: 0 !important;
  }
  [class*="bottomArea"] { display: none !important; }
  /* Hide the floating chat FABs — both App.jsx's .chatBtn
     (home-screen speech-bubble launcher) and ChatScreen.jsx's
     .chatTriggerBtn (phase-aware chat trigger). Either can
     paint over the memory card's bottom-right corner
     (covering the last word of the italic quote). */
  [class*="chatBtn"],
  [class*="chatTriggerBtn"] { display: none !important; }
` });

// Hide the sticky ChatScreen ._header_ ("< Dad" top chrome) so
// it can't overlap the card's top edge.
await page.evaluate(() => {
  document.querySelectorAll('*').forEach((el) => {
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/(^|\s)_header_[A-Za-z0-9]+_\d+(\s|$)/.test(cls)) {
      el.style.display = 'none';
    }
  });
});

await new Promise((r) => setTimeout(r, 400));

/* The full composition lives on `.analysisCard`:
     .analysisHeader  → "PERSPECTIVE" kicker + italic "Why Dad
                        might've…" eyebrow + "04 / 04" counter
     .angleDeck       → horizontal scroller with 4 .angleCard
                        articles; deck.scrollLeft was already
                        set to clientWidth * 3 above, so the
                        fourth card (the memory card) is what
                        the deck's visible viewport crops to
     .angleDots       → four pagination dots; the last one
                        paints with the active class because
                        analysisIdx === 3

   Screenshotting the whole .analysisCard matches the reference
   image's framing. element.screenshot crops to the element's
   outer bounding rect, so horizontal siblings of the memory
   card inside the deck are clipped away automatically (the
   deck's own overflow:hidden + the scrollLeft offset mean only
   the memory card's pixels paint inside the visible rect).
   omitBackground:true gives transparent corners outside the
   card's rounded mask — same treatment as the draft-card clip. */
const analysisCard = page.locator('[class*="analysisCard"]').first();
await analysisCard.waitFor({ state: 'visible' });
await new Promise((r) => setTimeout(r, 200));

const tmpPath = path.join(OUT_DIR, '_dad_memory_native.png');
await analysisCard.screenshot({
  path: tmpPath,
  omitBackground: true,
});

await browser.close();

/* Post-process upscale — same rig as the Mom/Dad full-flow
   captures. DPR 3 paints cleanly; sharp lanczos3 resamples
   to ~2.67× linear in pure pixel space, no layout recompute. */
const sharp = (await import('sharp')).default;
const meta  = await sharp(tmpPath).metadata();
const outW  = Math.round(meta.width  * UPSCALE_FACTOR);
const outH  = Math.round(meta.height * UPSCALE_FACTOR);
console.log(`Upscaling ${meta.width} × ${meta.height} → ${outW} × ${outH} (lanczos3)`);

await sharp(tmpPath, { limitInputPixels: false })
  .resize(outW, outH, { kernel: 'lanczos3' })
  .png({ compressionLevel: 9 })
  .toFile(path.join(OUT_DIR, 'dad-memory-card.png'));

const fs = await import('fs');
fs.unlinkSync(tmpPath);

console.log('  ✓ dad-memory-card.png');
console.log(`\n✓ Saved to ${OUT_DIR}`);
