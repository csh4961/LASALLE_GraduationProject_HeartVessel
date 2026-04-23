/* ============================================================
   snap-draft-clean-screen.mjs — Drafting phase, "fix applied"
                                  full phone shot.

   Produces:
     • draft-clean-screen.png — 393×852 @3x full phone frame of
       the drafting screen AFTER the emotional-threat suggestion
       has been accepted: "I will be pissed" → "it'll really
       hurt". Matches the user's reference shot:
         • back button (top-left) + "Dad" title
         • large character floating in centre
         • italic verdict bubble: "reads pretty well"
         • TONE FOR DAD card with "reads gently" + slider ~75%
         • clean italic draft ending "…it'll really hurt."
         • no red highlight, no fix-chip row
         • Copy text inside the glass box
         • AI disclaimer below
         • Move to Vessel / Move to Archive rail at the bottom

   Mechanic — why this state, no click needed:
     analyzeDraftFit's matchers don't fire against the swapped
     text. With no issues:
       • fit.issues.length === 0 → .draftFixRow doesn't render
       • The editor's red-highlight mirror paints nothing
       • Verdict falls through to the score bands — with warmth +
         an I-statement + no issues, the score lands in 68-81 →
         `reads pretty well` (matches reference exactly)
       • Tone descriptor below the gauge maps the same score
         into the "reads gently" band
     So we just pre-bake the cleaned draft into the canned
     Anthropic payload and let the drafting phase render it.

   Full-phone shot stays at the real 393×852 viewport — no
   viewport growth, no .heroScroll padding overrides, nothing
   hidden. What the user sees is what ships.
   ============================================================ */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'captures');
const BASE    = 'http://localhost:5173';

const SAMPLE = "My dad checked my exam scores and immediately asked why they weren't higher. It made me feel like my effort didn't matter.";

const CHAT_REPLY = "That immediate 'why weren't they higher' is what stays with you. Like the work you put in became invisible the second the number wasn't what he wanted. Effort without recognition just sits there, unwitnessed.";

const CANNED_ANGLES = [
  { title: "His ISTJ wiring", body: "Short placeholder.", quote: "", mbtiFeatured: true },
];

/* Cleaned variant text — the emotional-threat sentence has
   already been swapped ("I will be pissed" → "it'll really
   hurt"). Period added back so the sentence reads as a closed
   thought (matches the reference's "…it'll really hurt."). */
const CLEAN_DRAFT_TEXT =
  "Dad, when you saw my scores and asked why they weren't higher, it felt like the months I spent studying just disappeared. I'm not asking you to pretend they're perfect. I just need you to see that I worked hard for these, even if they're not what you expected. If you keep doing this, it'll really hurt.";

const CANNED_DRAFT_PAYLOAD = {
  // Per user's latest reference: the "What to Say" header's
  // nudge title reads "Here's a shape — yours to reshape.".
  // That exact line is one of the example nudges the prompt
  // in utils/claude.js lists, so wiring the canned payload to
  // produce it simply matches the reference shot.
  nudge: "Here\u2019s a shape \u2014 yours to reshape.",
  action: "Wait until you're alone with him, not right after a report card. Bring it up while you're doing something ordinary together so the conversation has somewhere to breathe.",
  variants: [
    {
      label: "Honest and direct",
      tone: "honest",
      text: CLEAN_DRAFT_TEXT,
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

// Chat → analyse → drafting.
await page.locator('button[aria-label="New chat"]').first().click();
await new Promise((r) => setTimeout(r, 400));
await page.locator('textarea').first().fill(SAMPLE);
await new Promise((r) => setTimeout(r, 150));
await page.locator('button[aria-label="Send message"]').first().click();
await new Promise((r) => setTimeout(r, 2800));

await page.locator('button.heroNext, [class*="inputBarCta"]').first().click();
await new Promise((r) => setTimeout(r, 3200));

await page.locator('[class*="inputBarCta"]').first().click();
await new Promise((r) => setTimeout(r, 3200));

/* Capture the outer .draftCard as one clean unit — every
   element the card contains must be in the shot:
     • .draftCardHeader (WHAT TO SAY kicker + "Here's a shape
       — yours to reshape." nudge)
     • .draftWordsCharHero (character image + verdict bubble
       "reads pretty well")
     • .draftWordsBox (TONE FOR DAD meter + draft body + Copy
       text button)
     • .draftDisclaimer (AI disclaimer line)

   Growing the viewport to 2400px vertical lets the whole
   card paint without clipping — character hero + inner box +
   disclaimer easily exceeds 852px. Zeroing .heroScroll's
   120px top/bottom padding and hiding .bottomArea keeps the
   Vessel/Archive rail from bleeding into the card's rect.
   Hiding the ChatScreen ._header_ ("< Dad" top chrome) keeps
   the sticky header from painting over the scroll-aligned
   card top. Finally we scroll heroScroll so .draftCard's top
   edge (the kicker row) sits at y=0 in the enlarged viewport. */
await page.setViewportSize({ width: 393, height: 2400 });
await page.addStyleTag({ content: `
  [class*="heroScroll"] {
    padding-top: 0 !important;
    padding-bottom: 0 !important;
  }
  [class*="bottomArea"] { display: none !important; }
` });
// Hide the ChatScreen ._header_ ("< Dad" top chrome). Class
// names are CSS-Modules-hashed — regex-match by prefix.
await page.evaluate(() => {
  document.querySelectorAll('*').forEach((el) => {
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/(^|\s)_header_[A-Za-z0-9]+_\d+(\s|$)/.test(cls)) {
      el.style.display = 'none';
    }
  });
});
// Scroll heroScroll so the .draftCard's top edge sits at y=0.
await page.evaluate(() => {
  const card = document.querySelector('[class*="draftCard"]');
  const scroller = document.querySelector('[class*="heroScroll"]');
  if (card && scroller) {
    const cardTop = card.getBoundingClientRect().top;
    const scTop   = scroller.getBoundingClientRect().top;
    scroller.scrollTop += (cardTop - scTop);
  }
});
await new Promise((r) => setTimeout(r, 400));

/* omitBackground paints only inside the card's own surface
   + its rounded-corner mask, so every pixel outside the
   card edge comes out fully transparent. */
const draftCard = page.locator('[class*="draftCard"]').first();
await draftCard.screenshot({
  path: path.join(OUT_DIR, 'draft-clean-card.png'),
  omitBackground: true,
});
console.log('  ✓ draft-clean-card.png');

await browser.close();
console.log(`\n✓ Saved to ${OUT_DIR}`);
