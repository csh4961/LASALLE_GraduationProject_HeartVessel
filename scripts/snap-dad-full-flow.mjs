/* ============================================================
   snap-dad-full-flow.mjs — Dad flow captured as one tall PNG,
                             draft in TRIGGERED state.

   Produces:
     • dad-full-flow.png — 3144 × ~18k @ final raster. Same
       capture rig as snap-mom-full-flow.mjs (DPR 3 native
       render + sharp lanczos3 × 8/3 post-upscale). Single
       vertical shot, top = < Dad header + user bubble +
       coach card, middle = perspective cards, bottom = the
       What to Say draft card with THREE red highlights +
       THREE fix chips + AI disclaimer + move to Vessel /
       Archive rail.

   Why this script exists (vs reusing snap-mom-full-flow):
     The user just extended analyzeDraftFit with three new
     matchers — conditional "like that" warnings, "makes me
     want to [withdraw]" threats, and standalone shutdown
     phrases (shut everything down / stop opening up / etc.).
     Previously a draft containing those phrases reached the
     drafting phase with score ≈ 75 → verdict "reads pretty
     well" and zero red highlights. With the new matchers the
     SAME draft triggers three issues → score drops to the
     low band → verdict becomes the first issue's reason and
     the editor renders three red spans + three fix chips.
     This script bakes in the exact triggering draft so the
     capture demonstrates the extended matchers firing.

   Canned payload composition:
     • USER_MSG — the original exam-scores framing that the
       "Dad" dummy member was designed around. detectPerson()
       pins activePerson to Dad because the word "dad"
       appears in the message; that's what drives the
       header, character image, and "TONE FOR DAD" label.
     • CHAT_REPLY — warm coach reply matching the topic.
     • CANNED_ANGLES — four ISTJ-Dad-shaped perspectives.
       Angle 0 carries mbtiFeatured:true so the first
       perspective card anchors with Dad's MBTI character.
     • DRAFT_TEXT — the user's own test sentence, containing
       "if you're actually capable" (quoted context, not a
       matcher trigger), "I just needed you to see that,
       not push harder" (clean), and the two triggers the
       user flagged in their most recent message:
         – "If you say like that" → conditional-warning match
         – "makes me want to stop opening up" → withdrawal
           threat match (longer than standalone "stop
           opening up", so it wins the dedupe)
         – "shut everything down" → standalone shutdown
           match (doesn't overlap with the one above, so it
           survives as a third separate issue)
       Expected on-screen: 3 red spans, 3 fix chips, verdict
       bubble quoting the first issue's reason.

   Capture mechanic: identical to snap-mom-full-flow. Expand
   .heroScroll into normal flow via CSS overrides, measure
   the resulting phone height, clip-screenshot at DPR 3, then
   post-upscale with sharp lanczos3 × (8/3) so the final PNG
   matches the Mom capture's approved size (~3144 × 18k).
   ============================================================ */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'captures');
const BASE    = 'http://localhost:5173';

/* Exact user message + coach reply from the user's current
   localhost state (captured in their screenshots). The topic
   is job-hunting struggles, not exam scores — previous canned
   version was wrong context. The coach reply's FIRST sentence
   becomes the italic verdict bubble ("That 'if you're actually
   capable' line is brutal.") and the rest paints as body. */
const USER_MSG =
  "When I told my dad I\u2019ve been struggling to find a job, he was like, \u201CIf you\u2019re actually capable, you\u2019ll make it anyway. Just try harder.\u201D It honestly felt pretty harsh, like everything I\u2019ve been doing doesn\u2019t count and it\u2019s just on me for not being good enough.";

const CHAT_REPLY =
  "That \u2018if you\u2019re actually capable\u2019 line is brutal. It turned your struggle into a referendum on whether you\u2019re enough, when what you needed was just to be seen in a hard moment. The try harder part stings because you ARE trying, and he just made it sound like the baseline you\u2019ve been clearing every day doesn\u2019t count.";

/* Four Dad-shaped perspective angles tailored to the job-
   struggle topic (not exam scores). Angle 0 carries
   mbtiFeatured:true so the first perspective card anchors
   with Dad's MBTI character. */
const CANNED_ANGLES = [
  {
    title: "His ISTJ wiring",
    body:  "For a lot of ISTJ fathers, 'capable' is a fixed standard, not a moving target. When the outcome lags, the instinct isn't to question the market or the path — it's to check whether you're putting in the hours. The conditional isn't meant as a doubt; it's how he double-checks the ledger.",
    quote: "If the result's off, something upstream must be.",
    mbtiFeatured: true,
  },
  {
    /* Index 1 — matches the user's current localhost state
       (perspective carousel parked on card 02/04). Content
       transcribed verbatim from their screenshot: title "What
       he was protecting", body about self-reliance vs hugs,
       quote about the world not handing things to him. */
    title: "What he was protecting",
    body:  "He values self reliance the way other dads value hugs. Making sure you don\u2019t lean on excuses was, in his head, how he keeps you dependable.",
    quote: "He needs to know the world won\u2019t hand it to him.",
    mbtiFeatured: false,
  },
  {
    title: "Where the sting landed",
    body:  "'If you're actually capable' isn't a question about the job search — it's a conditional pointed at you. That's why it lands harder than a career-advice conversation would. You brought him effort; he answered with a question mark on your identity.",
    quote: "Effort without acknowledgement stops feeling like effort.",
    mbtiFeatured: false,
  },
  {
    /* Memory card (deck index 3). Title is overridden by
       FAKE_MEMORIES_BY_INDEX[3] in ChatScreen.jsx — this
       `title` field is a fallback only. The body does the
       memory work: it names a specific past conversation
       with Dad, describes the tendency it revealed, and
       ties it back to what just happened. Per user:
       "과거 아빠와의 대화에 따르면 아빠는 ~~한 성향이고
       그때 ~~한 반응을 보인거랑 이번이랑 엮어서". */
    title: "His first-job story",
    body:  "Remember the night he walked you through his first-job story — showing up with zero connections, no safety net, making it work on grit alone. Back then he told it proudly, but also a little defensively: anyone who couldn't do what he did just hadn't tried hard enough. That's the template he reaches for when your struggle shows up at his door. 'If you're actually capable' isn't him doubting you — it's him handing you the only manual that ever worked on him, because he doesn't know another one.",
    quote: "I had less than you, and I still made it work.",
    mbtiFeatured: false,
  },
];

/* The exact draft text the user was testing against. After
   the new matchers land, this triggers:
     1. "If you say like that"            → conditional warning
     2. "it makes me want to stop opening up" → withdrawal threat
     3. "shut everything down"            → standalone shutdown
   Three red highlights + three fix chips render automatically
   because analyzeDraftFit runs on every render in drafting
   phase. No user interaction needed. */
const DRAFT_TEXT =
  "Dad, when you said \u201Cif you\u2019re actually capable,\u201D it sounds like you have little faith in me. I\u2019m already trying my best. I just needed you to see that, not push harder. If you say like that, it makes me want to stop opening up and shut everything down.";

const CANNED_DRAFT_PAYLOAD = {
  nudge: "Here\u2019s a shape \u2014 yours to reshape.",
  action: "Wait until it's a quiet moment — not right after the next score comes home — and keep the conversation about what you need from him, not about the number on the paper.",
  variants: [
    {
      label: "Honest and direct",
      tone: "honest",
      text: DRAFT_TEXT,
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

const VIEWPORT_W = 393;
const VIEWPORT_H = 6000;

/* Same two-stage quality strategy as snap-mom-full-flow:
     • Browser renders at DPR 3 — Chromium's known-good path
       for glyphs, backdrop-filter, and border-radius. High-DPR
       direct render (tried at 8 and 15 during the Mom pass)
       produced glyph tile-seam banding and "cards cut off"
       edge artifacts.
     • Sharp lanczos3 × (8/3) upscales purely in pixel space
       after the browser closes. No layout recomputation, no
       backdrop-filter re-evaluation — so no rasterisation
       edge cases. Final PNG is ≈ 3144 × 18-20k, matching the
       size the user approved for the Mom capture. */
const BROWSER_DPR    = 3;
const UPSCALE_FACTOR = 8 / 3;

const browser = await chromium.launch();
const context = await browser.newContext({
  viewport: { width: VIEWPORT_W, height: VIEWPORT_H },
  deviceScaleFactor: BROWSER_DPR,
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

// Chat → send user message.
await page.locator('button[aria-label="New chat"]').first().click();
await new Promise((r) => setTimeout(r, 400));
await page.locator('textarea').first().fill(USER_MSG);
await new Promise((r) => setTimeout(r, 150));
await page.locator('button[aria-label="Send message"]').first().click();
await new Promise((r) => setTimeout(r, 3000));

// Analyse → analysisLoading → analysis.
await page.locator('button.heroNext, [class*="inputBarCta"]').first().click();
await new Promise((r) => setTimeout(r, 3200));

// Help me respond → draftLoading → drafting.
await page.locator('[class*="inputBarCta"]').first().click();
await new Promise((r) => setTimeout(r, 3200));

/* Advance the perspective carousel to card index 1 (02/04).
   The .angleDeck is a horizontal CSS scroll-snap scroller —
   each angle card takes 100% of the deck's width. Setting
   scrollLeft = clientWidth snaps to the second card and the
   onScroll handler bumps analysisIdx to 1 (which also updates
   the "02 / 04" counter in the card header).

   Done BEFORE the CSS overrides that flatten heroScroll into
   normal flow — those don't touch the deck's internal
   horizontal scroll, but doing this while heroScroll is still
   its original absolute/overflow-auto self keeps the deck's
   geometry unambiguous (clientWidth is the real card width,
   not something stretched by an ancestor override).

   At the same time we force the gradient-shape for card index
   1 to a specific BLUE-palette asset so the visual matches
   what the user is seeing on their own localhost (Shape 21 —
   predominantly blue/teal with purple + green splashes). The
   app picks themeShapes at random via pickRandomShapes(4) in
   a useMemo, which Playwright has no hook into; easiest fix
   is DOM-level src replacement after the <img> has mounted.
   querySelectorAll('.angleThemeArt') returns one img per
   non-MBTI card in DOM order, so the FIRST result corresponds
   to deck index 1 (deck index 0 is mbtiFeatured and renders
   the MBTI portrait instead of a themeArt img). */
await page.evaluate(() => {
  const deck = document.querySelector('[class*="angleDeck"]');
  if (!deck) return;
  const w = deck.clientWidth;
  deck.scrollLeft = w;   // index 0 → index 1
  // Force a scroll event so React's onScroll updates analysisIdx.
  deck.dispatchEvent(new Event('scroll', { bubbles: true }));

  // Pin deck-index-1's shape to the blue asset. Looking up
  // .angleThemeArt instead of angle-specific selectors is
  // robust against class-hash changes — the rule is unique
  // to the themed cards. First match in DOM order = index 1.
  const themeImgs = document.querySelectorAll('[class*="angleThemeArt"]');
  if (themeImgs[0]) {
    themeImgs[0].src = '/asset/gradient%20shapes/Shape/Shape%2021.png';
  }
});
// Let React's state update + any scroll-snap animation settle
// before the CSS overrides reshape the layout.
await new Promise((r) => setTimeout(r, 500));

/* Same layout overrides the Mom capture uses — expand
   heroScroll + phone + root into normal vertical flow so
   the whole stack (chat, analysisCard, draftCard, dest rail)
   paints in one contiguous image. See snap-mom-full-flow's
   comment block for the rationale on each rule. */
await page.addStyleTag({ content: `
  html, body { height: auto !important; overflow: visible !important; background: transparent !important; }
  #root { height: auto !important; min-height: 0 !important; overflow: visible !important; align-items: flex-start !important; }
  #root > div { height: auto !important; min-height: 0 !important; overflow: visible !important; }
  [class*="_screenWrap_"] { position: static !important; inset: auto !important; height: auto !important; }
  [class*="heroScroll"] {
    position: static !important;
    inset: auto !important;
    overflow: visible !important;
    height: auto !important;
    max-height: none !important;
  }
` });
await new Promise((r) => setTimeout(r, 600));

const phoneHandle = page.locator('#root > div').first();
const bbox = await phoneHandle.boundingBox();
const phoneW = Math.round(bbox.width);
const phoneH = Math.round(bbox.height);
const phoneY = Math.round(bbox.y);
console.log(`Rendered phone: ${phoneW} × ${phoneH} CSS px → raster ${phoneW * BROWSER_DPR} × ${phoneH * BROWSER_DPR}`);

await page.setViewportSize({ width: VIEWPORT_W, height: phoneH + phoneY + 40 });
await new Promise((r) => setTimeout(r, 250));

const tmpPath = path.join(OUT_DIR, '_dff_native.png');
await page.screenshot({
  path: tmpPath,
  clip: { x: 0, y: phoneY, width: phoneW, height: phoneH },
});

await browser.close();

const sharp = (await import('sharp')).default;
const meta  = await sharp(tmpPath).metadata();
const outW  = Math.round(meta.width  * UPSCALE_FACTOR);
const outH  = Math.round(meta.height * UPSCALE_FACTOR);
console.log(`Upscaling ${meta.width} × ${meta.height} → ${outW} × ${outH} (lanczos3)`);

await sharp(tmpPath, { limitInputPixels: false })
  .resize(outW, outH, { kernel: 'lanczos3' })
  .png({ compressionLevel: 9 })
  .toFile(path.join(OUT_DIR, 'dad-full-flow.png'));

const fs = await import('fs');
fs.unlinkSync(tmpPath);

console.log('  ✓ dad-full-flow.png');
console.log(`\n✓ Saved to ${OUT_DIR}`);
