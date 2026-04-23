/* ============================================================
   snap-mom-full-flow.mjs — Mom flow captured as one tall PNG.

   Produces:
     • mom-full-flow.png — 393 wide, auto-height @3x. Single
       vertical capture of the ChatScreen's drafting-phase scroll
       in full: top-of-content = < Mom header + user bubble +
       first coach card, middle = perspective cards, bottom =
       What to Say draft card with character + TONE FOR MOM +
       draft body + Copy text + AI disclaimer + move to
       Vessel/Archive buttons.

   The user went through the flow manually on their own
   localhost:5173, but Playwright runs its own browser so we
   can't see their session state. We reproduce the same state
   with canned Anthropic responses that match their references:

     • User msg:  the "lonely living abroad" paragraph — contains
       "mom", so detectPerson() pins activePerson to the dummy
       Mom member and the header renders "Mom".
     • Coach reply:  the exact two-sentence text from reference
       image 1 (italicised opener + body paragraph).
     • Angles:  four plausible perspective angles on the topic.
       Content is less critical than presence — we just need
       the analysis card to render between the chat and the
       draft so the scroll-stack is complete.
     • Draft variant text: matches reference image 2 exactly.
       analyzeDraftFit scores it clean (no issue matchers fire)
       so the verdict reads "reads pretty well" and the tone
       descriptor "reads gently", matching the reference.

   Full-height capture mechanic:
     .heroScroll normally has overflow-y:auto + position:absolute
     inside .phone (a 393×852 frame). Its content in drafting
     phase stacks: chat turns → analysisCard → draftCard. With a
     tall viewport AND .heroScroll set to overflow:visible +
     height:auto, the content flows vertically inside the phone.
     Setting .phone to height:auto lets the frame grow with the
     scroll's content; .bottomArea remains anchored at the
     bottom of .phone via its own position:absolute, so the
     Move to Vessel/Archive rail paints at the very end of the
     tall phone frame.

     We size the viewport tall enough (6000px) that the whole
     composition paints in one frame, then screenshot the phone
     element. omitBackground:false keeps the phone's solid black
     background so the capture reads like a phone-UI screenshot.
   ============================================================ */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'captures');
const BASE    = 'http://localhost:5173';

const USER_MSG =
  "When I told my mom I've been feeling really lonely living abroad, she just told me to focus on how lucky I am to be here instead. It made me feel completely dismissed, like my feelings didn't matter at all.";

const CHAT_REPLY =
  "That's the kind of response that closes a door you were trying to open. You reached for connection, and she handed you a gratitude checklist instead. 'Lucky' doesn't fix lonely. Those two things can sit in the same room.";

/* Four plausible perspective angles, matched to the topic.
   Angle 0 is the MBTI-featured card — leave mbtiFeatured:true
   so the first card anchors with Mom's dummy MBTI character.
   Angle 3 is the "memory" index — its title is overridden by
   FAKE_MEMORIES_BY_INDEX[3] at render time, so the title here
   is a fallback only. */
const CANNED_ANGLES = [
  {
    title: "Her anxious love language",
    body:  "For many parents, 'at least you're lucky' is a reflex — it's how they try to protect you from the feeling they can't sit with themselves. It says nothing about whether your loneliness is real.",
    quote: "If I let you feel it, I feel it too.",
    mbtiFeatured: true,
  },
  {
    title: "What she was defending against",
    body:  "Naming your loneliness asks her to hold something she can't fix from this far away. Gratitude is the one lever she can still pull, so she pulls it — not because your feelings don't matter, but because they matter too much for her to touch.",
    quote: "I just want you to be okay over there.",
    mbtiFeatured: false,
  },
  {
    title: "Where the dismissal landed",
    body:  "'Focus on how lucky you are' reframes a feeling as an error. The sting isn't that she said it — it's that she replaced what you needed (being heard) with what she needed (you to be fine).",
    quote: "We don't get to choose which feelings count.",
    mbtiFeatured: false,
  },
  {
    title: "The softer read",
    body:  "She didn't reach for a checklist because your feelings are wrong. She reached because she's further from you than she's used to, and the only thing she has left to hand you across that distance is perspective.",
    quote: "",
    mbtiFeatured: false,
  },
];

const DRAFT_TEXT =
  "Mom, when I told you I was lonely and you said to focus on being lucky, I know you were trying to help. But I wasn't asking you to fix it or remind me of the good parts. I was just asking you to sit with me in the hard part for a minute. I need you to hear me, not redirect me.";

const CANNED_DRAFT_PAYLOAD = {
  nudge: "Here\u2019s a shape \u2014 yours to reshape.",
  action: "Pick a time when she's not busy and the conversation doesn't have to end fast.",
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
const VIEWPORT_H = 6000;  // ample headroom; we trim after capture

/* Two-stage quality strategy:
     • BROWSER_DPR = 3  — the native phone pipeline's pixel
       density. Chromium renders glyphs, backdrop-filters,
       and border-radius with high confidence at this DPR;
       previous attempts at 8 and 15 produced glyph banding
       (tile-seam subpixel rounding) or "cards cut off" artifacts
       around card edges (backdrop-filter + rounded corners
       drift at high DPR).
     • UPSCALE_FACTOR = 8/3  — applied in sharp after the
       browser capture closes. Produces a final ≈ 3144 × 18224
       PNG, exactly the size user approved (half of the DPR 15
       attempt, ~2.67× linear vs native).
   Sharp's lanczos3 kernel is a high-quality reconstruction
   filter — perceptually near-identical to a clean DPR-8 direct
   render for text and glass surfaces, without the Chromium
   rasterisation edge cases that broke the direct-render path. */
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

/* At this point .heroScroll contains the full stack:
   user bubble + coach card + analysisCard + draftCard.
   .bottomArea at the phone's bottom holds the dual
   Vessel/Archive buttons. Now we expand everything into
   one vertical flow.

   Key overrides:
     • .heroScroll — drop its position:absolute + overflow:auto
       so its content lays out in normal flow inside .phone at
       the container's full intrinsic height. Keep the original
       padding-top (120px header breathing) and padding-bottom
       so the first / last items don't crowd the sticky chrome.
     • .phone / #root > div / #root — allow natural vertical
       growth. The 100% heights clip to viewport otherwise.
     • .bottomArea — keep absolute at bottom of .phone, but
       since .phone now height:auto grows with heroScroll, the
       bottom rail lands right after the disclaimer.
   */
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

/* Measure the rendered phone so we can clip exactly to it. */
const phoneHandle = page.locator('#root > div').first();
const bbox = await phoneHandle.boundingBox();
const phoneW = Math.round(bbox.width);
const phoneH = Math.round(bbox.height);
const phoneY = Math.round(bbox.y);
console.log(`Rendered phone: ${phoneW} × ${phoneH} CSS px → raster ${phoneW * BROWSER_DPR} × ${phoneH * BROWSER_DPR}`);

/* Capture at DPR 3 — Chromium's known-good rendering path. */
await page.setViewportSize({ width: VIEWPORT_W, height: phoneH + phoneY + 40 });
await new Promise((r) => setTimeout(r, 250));

const tmpPath = path.join(OUT_DIR, '_mff_native.png');
await page.screenshot({
  path: tmpPath,
  clip: { x: 0, y: phoneY, width: phoneW, height: phoneH },
});

await browser.close();

/* Post-process upscale with lanczos3 reconstruction.
   This sidesteps high-DPR Chromium rasterisation issues:
     • glyph tile-seam banding (DPR 15)
     • backdrop-filter + border-radius subpixel drift that
       made card edges read as "cut off" (DPR 8)
   The browser's render is clean; sharp then resamples
   purely in pixel space — no layout recomputation, no
   font hinting edge cases, no backdrop-filter re-evaluation. */
const sharp = (await import('sharp')).default;
const meta  = await sharp(tmpPath).metadata();
const outW  = Math.round(meta.width  * UPSCALE_FACTOR);
const outH  = Math.round(meta.height * UPSCALE_FACTOR);
console.log(`Upscaling ${meta.width} × ${meta.height} → ${outW} × ${outH} (lanczos3)`);

await sharp(tmpPath, { limitInputPixels: false })
  .resize(outW, outH, { kernel: 'lanczos3' })
  .png({ compressionLevel: 9 })
  .toFile(path.join(OUT_DIR, 'mom-full-flow.png'));

const fs = await import('fs');
fs.unlinkSync(tmpPath);

console.log('  ✓ mom-full-flow.png');
console.log(`\n✓ Saved to ${OUT_DIR}`);
