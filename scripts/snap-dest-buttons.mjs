/* ============================================================
   snap-dest-buttons.mjs — Isolated dual-destination buttons

   Produces two standalone PNGs of just the drafting-phase
   commit pills (`.destDualBtn` in ChatScreen.module.css) with
   the rest of the app hidden, so each pill can be dropped onto
   any background:

     • move-to-vessel-button-clean.png   — heart + Move to Vessel
     • move-to-archive-button-clean.png  — folder + Move to Archive

   The pills use url(#liquidGlass) + blur(22px) + saturate on a
   translucent-dark (rgba 30,30,34,0.38) core. Without anything
   behind them the glass would read as a thin translucent wash
   rather than the dark material the user wants. Same trick as
   snap-chatbar.mjs: inject a dark backing element (matched to
   each button's rect + 9999px/pill radius) directly underneath
   each pill, so the backdrop-filter has a solid dark canvas to
   pick up, while the rest of the screenshot corners stay
   transparent via omitBackground.

   We reach the drafting phase the same way snap-analysis-states
   does — fake Anthropic responses for the initial chat reply,
   the perspective angles, and the draft payload. Once the two
   pills are mounted in .inputRow we hide everything else in the
   DOM, inject the backings, and shoot each element in turn.
   ============================================================ */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'captures');
const BASE    = 'http://localhost:5173';

const SAMPLE = "My dad checked my exam scores and immediately asked why they weren't higher. It made me feel like my effort didn't matter.";

const CHAT_REPLY = "That immediate 'why weren't they higher' is what stays with you. Like the work you put in became invisible the second the number wasn't what he wanted. Effort without recognition just sits there, unwitnessed.";

// Single minimal angle — we just need to leave the analysis phase.
const CANNED_ANGLES = [
  { title: "His ISTJ wiring", body: "Short placeholder.", quote: "", mbtiFeatured: true },
];

const CANNED_DRAFT_PAYLOAD = {
  nudge: "One way to make the work visible.",
  action: "Short action placeholder.",
  variants: [
    {
      label: "Honest and direct",
      tone: "honest",
      text: "Short placeholder draft — enough to mount the destination rail.",
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

/* Same three-slot cycle handler as snap-analysis-states, but
   since we don't need to snap any loading frames here we just
   fulfil every slot immediately. */
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

// Open chat, type draft, submit.
await page.locator('button[aria-label="New chat"]').first().click();
await new Promise((r) => setTimeout(r, 400));
await page.locator('textarea').first().fill(SAMPLE);
await new Promise((r) => setTimeout(r, 150));
await page.locator('button[aria-label="Send message"]').first().click();
await new Promise((r) => setTimeout(r, 2800));

// Analyse → analysisLoading → analysis (perspective auto-fulfils).
await page.locator('button.heroNext, [class*="inputBarCta"]').first().click();
await new Promise((r) => setTimeout(r, 3200));

// Help me respond → draftLoading → drafting (draft auto-fulfils).
await page.locator('[class*="inputBarCta"]').first().click();
await new Promise((r) => setTimeout(r, 3200));

/* At this point .destDualBtn buttons are mounted in the .inputRow
   at the bottom of the phone. We now isolate them. */

/* Strip everything that isn't the two destination buttons.
   Subtle: the buttons live inside `.screenWrap > ChatScreen >
   .bottomArea > .inputRow > .destDualRow`. We CAN'T hide any
   of those ancestors or the buttons disappear with them. Instead:
     • Make every ancestor background transparent so omitBackground
       captures clean corners around each pill.
     • Hide the `.sharedChar`, chat-screen header, `.heroScroll`
       (which holds the draft card + character + tone pill — all
       painted above the buttons in the phone frame), and the
       other bottom-area siblings (nav bar, chat circle, dim
       scrim) — anything that would overlap the buttons' rect
       or bleed into the backdrop-filter pickup.
     • Leave .inputRow + .destDualRow + .destDualBtn alone. */
await page.addStyleTag({ content: `
  html, body { background: transparent !important; }
  #root { background: transparent !important; box-shadow: none !important; }
  #root > div { background: transparent !important; }
  [class*="_sharedChar_"] { display: none !important; }
  [class*="_header_"] { display: none !important; }
  [class*="heroScroll"] { display: none !important; }
  [class*="navBar"],
  [class*="navPill"] { display: none !important; }
  [class*="chatBtn"] { display: none !important; }
  [class*="chatDim"] { display: none !important; }
  /* Paint-through for every container between #root and
     .destDualBtn so none of them draw a background behind the
     pills. */
  [class*="_screenWrap_"],
  [class*="ChatScreen_chatScreen"],
  [class*="_chatScreen_"],
  [class*="bottomArea"],
  [class*="inputRow"],
  [class*="destDualRow"] {
    background: transparent !important;
  }
` });

/* Inject a dark backing element directly beneath each dest
   button, precisely matching its rect + border-radius. With
   the phone background now transparent, the backdrop-filter
   has nothing to pick up — without this backing the dark
   glass reads as a near-transparent wash instead of the deep
   dark material in the user's reference. Backing sits at
   z-index < the button itself so it paints just under it and
   NOT outside the pill's rounded edges. */
async function injectBackings() {
  await page.evaluate(() => {
    document.querySelectorAll('[data-dest-backing]').forEach((n) => n.remove());
    const btns = document.querySelectorAll('[class*="destDualBtn"]');
    btns.forEach((btn, i) => {
      const r = btn.getBoundingClientRect();
      const backing = document.createElement('div');
      backing.setAttribute('data-dest-backing', String(i));
      backing.style.cssText = `
        position: fixed;
        left: ${r.left}px;
        top: ${r.top}px;
        width: ${r.width}px;
        height: ${r.height}px;
        background: #0b0b0d;
        border-radius: 9999px;
        z-index: 0;
        pointer-events: none;
      `;
      document.body.appendChild(backing);
    });
    // Make sure the buttons themselves sit above the backings.
    document.querySelectorAll('[class*="destDualBtn"]').forEach((b) => {
      b.style.zIndex = '1';
      b.style.position = b.style.position || 'relative';
    });
  });
}

await injectBackings();
await new Promise((r) => setTimeout(r, 150));

/* Shoot each button. omitBackground keeps the corners outside
   the pill radius transparent. The backing matches the pill
   radius exactly, so only the pill shape paints dark glass. */
const destBtns = page.locator('[class*="destDualBtn"]');

await destBtns.first().screenshot({
  path: path.join(OUT_DIR, 'move-to-vessel-button-clean.png'),
  omitBackground: true,
});
console.log('  ✓ move-to-vessel-button-clean.png');

await destBtns.nth(1).screenshot({
  path: path.join(OUT_DIR, 'move-to-archive-button-clean.png'),
  omitBackground: true,
});
console.log('  ✓ move-to-archive-button-clean.png');

await browser.close();
console.log(`\n✓ Saved to ${OUT_DIR}`);
