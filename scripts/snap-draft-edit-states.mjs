/* ============================================================
   snap-draft-edit-states.mjs — Draft-card captures with the
                                 "I will be pissed" issue state
                                 actively triggered.

   Produces (in captures/):
     • draft-edit-card.png       — just the inner .draftWordsBox
                                    (TONE FOR DAD row, italic draft
                                    with "I will be pissed" flagged
                                    in red, suggestion pill "I will
                                    be pissed → it'll really hurt",
                                    Copy text button). Transparent
                                    corners outside the rounded
                                    rectangle.
     • draft-edit-card-full.png  — full outer .draftCard (What to
                                    Say header + character image +
                                    italic verdict bubble + inner
                                    .draftWordsBox in triggered
                                    state + AI disclaimer). Captured
                                    with a tall viewport so nothing
                                    is clipped top/bottom.

   Why this state, mechanically:
     analyzeDraftFit() runs a regex pack over the active variant's
     current text. One of the matchers
       /\bi(?:'ll|\s+will|...)\s+…\s+pissed.../gi
     fires on "I will be pissed" and produces
       reason:     '"I will be pissed" threatens — share the hurt, not the anger'
       suggestion: "it'll really hurt"
     That reason becomes the .draftWordsCharHeroBubble text
     (italic verdict above the inner card) AND the editor gets a
     red underline on the span. The .draftFixRow below the editor
     mounts a .draftFixChip with "I will be pissed → it'll really
     hurt". No user tap needed — the row is driven purely by
     fit.issues.length > 0.

   All we have to do is get the triggering text into the editor.
   Easiest path: pre-bake it into the canned draft payload that
   the fake Anthropic route returns, so the variant mounts with
   the trigger phrase already present. No keyboard automation
   against the live textarea — the fit-check runs on every render
   so having it in the initial value is enough.
   ============================================================ */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'captures');
const BASE    = 'http://localhost:5173';

const SAMPLE = "My dad checked my exam scores and immediately asked why they weren't higher. It made me feel like my effort didn't matter.";

const CHAT_REPLY = "That immediate 'why weren't they higher' is what stays with you. Like the work you put in became invisible the second the number wasn't what he wanted. Effort without recognition just sits there, unwitnessed.";

// Minimal angle — we only need to advance past analysis.
const CANNED_ANGLES = [
  { title: "His ISTJ wiring", body: "Short placeholder.", quote: "", mbtiFeatured: true },
];

/* Draft payload tuned to the reference shot.
   The variant text matches the canned honest/direct draft
   snap-analysis-states uses, EXTENDED with the trigger
   sentence. analyzeDraftFit's emotional-threat matcher
   will catch "I will be pissed" and fire the verdict +
   red span + fix chip without any user interaction. */
const TRIGGER_DRAFT_TEXT =
  "Dad, when you saw my scores and asked why they weren't higher, it felt like the months I spent studying just disappeared. I'm not asking you to pretend they're perfect. I just need you to see that I worked hard for these, even if they're not what you expected. If you keep doing this, I will be pissed";

const CANNED_DRAFT_PAYLOAD = {
  nudge: "One way to make the work visible.",
  action: "Wait until you're alone with him, not right after a report card. Bring it up while you're doing something ordinary together so the conversation has somewhere to breathe.",
  variants: [
    {
      label: "Honest and direct",
      tone: "honest",
      text: TRIGGER_DRAFT_TEXT,
    },
  ],
};

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

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: 393, height: 852 },
  deviceScaleFactor: 3,
});
const page = await context.newPage();

/* Three-slot route handler: chat / perspective / draft.
   We fulfil all three without parking, since we don't need
   to snap any loading frames here — just the final drafting
   phase once the variant is mounted with trigger text. */
let chatFulfilled = false, perspectiveFulfilled = false, draftFulfilled = false;
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
  } else if (!draftFulfilled) {
    draftFulfilled = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildAnthropicResponse(CANNED_DRAFT_PAYLOAD)),
    });
  } else {
    await route.abort();
  }
});

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hvReady === true, { timeout: 10000 });
await page.evaluate(() => window.__hv.navigate('home'));
await new Promise((r) => setTimeout(r, 500));

// Chat step — open chat bar, type sample, submit.
await page.locator('button[aria-label="New chat"]').first().click();
await new Promise((r) => setTimeout(r, 400));
await page.locator('textarea').first().fill(SAMPLE);
await new Promise((r) => setTimeout(r, 150));
await page.locator('button[aria-label="Send message"]').first().click();
await new Promise((r) => setTimeout(r, 2800));

// Analyse → analysisLoading → analysis phase.
await page.locator('button.heroNext, [class*="inputBarCta"]').first().click();
await new Promise((r) => setTimeout(r, 3200));

// Help me respond → draftLoading → drafting phase.
await page.locator('[class*="inputBarCta"]').first().click();
await new Promise((r) => setTimeout(r, 3200));

/* At this point the .draftCard is mounted with the trigger
   draft already in the editor. The fit-check has run and the
   verdict bubble + red span + fix chip are all rendered. */

/* Both captures need the viewport grown vertically. The
   .draftWordsBox alone overflows 852px once the fit row +
   Copy text button mount at the bottom, and the full .draftCard
   is even taller. Playwright's element.screenshot clips to
   what's painted in the viewport, so a short viewport cuts
   the bottom off the PNG regardless of element bounds.

   We do the same layout massage snap-analysis-states does for
   drafting-card.png:
     • enlarge the viewport vertically (393×2400)
     • zero out .heroScroll top/bottom padding so nothing
       competes vertically
     • hide .bottomArea so the Move-to-Vessel/Archive rail
       doesn't paint over the card
     • hide the ChatScreen top header ("< Dad")
     • scroll heroScroll so .draftCard's top sits at y=0

   Doing this ONCE up front lets both element.screenshots below
   run against the enlarged, scroll-aligned layout. */
await page.setViewportSize({ width: 393, height: 2400 });
await page.evaluate(() => {
  const style = document.createElement('style');
  style.id = 'hv-draft-fullshot-style';
  style.textContent = `
    [class*="heroScroll"] {
      padding-top: 0 !important;
      padding-bottom: 0 !important;
    }
    [class*="bottomArea"] {
      display: none !important;
    }
  `;
  document.head.appendChild(style);
});
// Hide the ChatScreen ._header_ (the "< Dad" top chrome). Class
// names are hashed by CSS Modules so we walk the DOM + regex-
// match on the hashed prefix (._header_xwk7w_9 etc.).
await page.evaluate(() => {
  document.querySelectorAll('*').forEach((el) => {
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/(^|\s)_header_[A-Za-z0-9]+_\d+(\s|$)/.test(cls)) {
      el.setAttribute('data-hv-hidden-header', '');
      el.style.display = 'none';
    }
  });
});
// Scroll heroScroll so the draft card's top edge sits at y=0
// in the enlarged viewport.
await page.evaluate(() => {
  const card = document.querySelector('[class*="draftCard"]');
  const scroller = document.querySelector('[class*="heroScroll"]');
  if (card && scroller) {
    const cardTop = card.getBoundingClientRect().top;
    const scTop   = scroller.getBoundingClientRect().top;
    scroller.scrollTop += (cardTop - scTop);
  }
});
await new Promise((r) => setTimeout(r, 500));

/* ── Capture 1 — just the inner .draftWordsBox ───────────────
   omitBackground keeps the corners outside the rounded rect
   transparent. The box has its own liquid-glass surface so we
   don't need to inject a backing — the glass paints its own
   translucent-dark interior over whatever is behind it. */
const draftWordsBox = page.locator('[class*="draftWordsBox"]').first();
await draftWordsBox.screenshot({
  path: path.join(OUT_DIR, 'draft-edit-card.png'),
  omitBackground: true,
});
console.log('  ✓ draft-edit-card.png');

/* ── Capture 2 — full .draftCard including character + verdict ── */
const draftCard = page.locator('[class*="draftCard"]').first();
await draftCard.screenshot({
  path: path.join(OUT_DIR, 'draft-edit-card-full.png'),
  omitBackground: true,
});
console.log('  ✓ draft-edit-card-full.png');

await browser.close();
console.log(`\n✓ Saved to ${OUT_DIR}`);
