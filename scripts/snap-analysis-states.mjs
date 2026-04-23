/* ============================================================
   snap-analysis-states.mjs — End-to-end chat → analysis → drafting
                              → saved captures, all in one run.

   Produces (in captures/):
     • analysing-button.png        — pink "Analysing" CTA, mid-wave
     • perspective-screen.png      — full phone in 'analysis' phase
     • perspective-card-01..04.png — each of the 4 angle cards alone
     • shaping-button.png          — pink "Shaping" CTA, mid-wave
     • drafting-screen.png         — full phone in 'drafting' phase
     • move-to-vessel-button.png   — just the Vessel destination pill
     • move-to-archive-button.png  — just the Archive destination pill
     • drafting-card.png           — full .draftCard incl. AI disclaimer
     • drafting-inner-card.png     — just the inner liquid-glass Words box
     • saved-vessel-screen.png     — full phone, 'Tucked into your Vessel.'
     • saved-archive-screen.png    — full phone, 'Filed in Archive.'

   Flow:
     1. Route all Anthropic traffic. A cycle-aware handler holds three
        state slots (chat / perspective / draft). The first call to
        each slot in a cycle is the "real" one — chat fulfils
        immediately, perspective + draft park so we can snap the two
        loading states. resetCycle() clears the slots so we can rerun
        the full flow after a page reload (needed for the Archive
        saved screen, since we need a clean start to re-click a
        different destination button).
     2. First cycle:
          chat → Analyse → perspective cards × 4 → Help me respond →
          Shaping → drafting card + buttons + inner card + full card
          → click "Move to Vessel" → saved-vessel-screen.png
     3. page.reload() + resetCycle()
     4. Second cycle:
          chat → Analyse → skip perspective card shots (already done)
          → Help me respond → drafting → click "Move to Archive" →
          saved-archive-screen.png

   Family-member resolution: the draft contains "dad" so detectPerson
   pins activePerson to the dummy Dad member (ISTJ). The MBTI character
   rendered on angle 01 is therefore `ISTJ_Man.png` from the mbti-
   characters asset set, matching the reference shot.
   ============================================================ */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'captures');
const BASE    = 'http://localhost:5173';

const SAMPLE = "My dad checked my exam scores and immediately asked why they weren't higher. It made me feel like my effort didn't matter.";

/* First-turn coach reply — same shape as snap-chat-states.mjs. The
   opener italicises naturally; the body paragraph falls below the
   divider. Only needed here so the Analyse button mounts (it requires
   at least one coach reply, see bottomCta logic in ChatScreen). */
const CHAT_REPLY = "That immediate 'why weren't they higher' is what stays with you. Like the work you put in became invisible the second the number wasn't what he wanted. Effort without recognition just sits there, unwitnessed.";

/* Canned perspective angles — matches the reference's first page
   exactly. Angles 02-04 exist so pagination reads "01 / 04" and the
   dots row shows four dots, but their copy doesn't ship on screen
   unless the user swipes — so keep them short + serviceable rather
   than spending effort on text we don't capture. */
const CANNED_ANGLES = [
  {
    title: "His ISTJ wiring",
    body: "ISTJs measure care through improvement, not praise. He saw the number first because that's his concrete anchor, the part he knows how to assess.",
    quote: "If it's good, it can be better.",
    mbtiFeatured: true,
  },
  {
    title: "What he was protecting",
    body: "His question was likely him trying to keep you accountable, the way he thinks dependable people do. Pushing you forward felt like the responsible thing, not the cold thing.",
    quote: "I don't want them getting comfortable with less than they can do.",
    mbtiFeatured: false,
  },
  {
    title: "Where it landed hard",
    body: "Being rushed into the next target before the current one gets acknowledged probably mirrors how he feels most days. He skips celebrating himself too, so pausing to name your effort might not register as the missing step.",
    quote: "We don't sit around patting ourselves on the back, we just keep going.",
    mbtiFeatured: false,
  },
  /* Index 3 = memory card. FAKE_MEMORIES_BY_INDEX[3] = { title: 'The
     hospital waiting room' } overrides whatever `title` we set here —
     ChatScreen renders that memory title under a "From a memory"
     kicker instead of the LLM's title. Leave this title as a
     fallback label in case the memory resolver ever changes; body
     is what actually ships on screen under the memory title. Empty
     quote suppresses the blockquote block (the reference card 04
     has no pink-bar quote). */
  {
    title: "The softer read",
    body: "He saw the scores because he checked them, which means he cares enough to look. His care just sounds like a question about the gap instead of a sentence about what you did right.",
    quote: "",
    mbtiFeatured: false,
  },
];

const CANNED_DRAFT_PAYLOAD = {
  nudge: "One way to make the work visible.",
  action: "Wait until you're alone with him, not right after a report card. Bring it up while you're doing something ordinary together so the conversation has somewhere to breathe.",
  variants: [
    {
      label: "Honest and direct",
      tone: "honest",
      text: "Dad, when you saw my scores and asked why they weren't higher, it felt like the months I spent studying just disappeared. I'm not asking you to pretend they're perfect. I just need you to see that I worked hard for these, even if they're not what you expected.",
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

/* ── Cycle-aware route handler ──────────────────────────────
   Same three-branch shape as before (chat / perspective / draft)
   but now the slots live on a cycle object the handler reads.
   resetCycle() rebinds the slots + the park-resolution promises
   so we can replay the whole flow after page.reload(). The
   handler itself is registered ONCE at context start — the
   `cycle` reference is what changes between runs. */
let cycle = null;
function resetCycle() {
  cycle = {
    chatFulfilled: false,
    perspectiveRoute: null,
    draftRoute: null,
    perspectiveResolve: null,
    draftResolve: null,
  };
  cycle.perspectivePromise = new Promise((res) => { cycle.perspectiveResolve = res; });
  cycle.draftPromise       = new Promise((res) => { cycle.draftResolve       = res; });
}
resetCycle();

await page.route('**/api.anthropic.com/**', async (route) => {
  if (!cycle.chatFulfilled) {
    cycle.chatFulfilled = true;
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(buildAnthropicResponse({
        reply: CHAT_REPLY,
        sections: [],
        suggestions: [],
      })),
    });
  } else if (!cycle.perspectiveRoute) {
    cycle.perspectiveRoute = route;
    cycle.perspectiveResolve();
  } else if (!cycle.draftRoute) {
    cycle.draftRoute = route;
    cycle.draftResolve();
  } else {
    await route.abort();
  }
});

const phone = page.locator('#root > div').first();

/* ── Flow helper ────────────────────────────────────────────
   Runs the chat → analyse (loading) → perspective cards →
   help-me-respond (shaping loading) → drafting sequence.
   With `capture=true` it also snaps each loading frame +
   the perspective cards. With `capture=false` it does the
   same state transitions but skips the per-step screenshots
   (used by the second cycle where we only want the final
   saved-archive shot). */
async function runThroughDrafting({ capture }) {
  await page.goto(BASE, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => window.__hvReady === true, { timeout: 10000 });
  await page.evaluate(() => window.__hv.navigate('home'));
  await new Promise((r) => setTimeout(r, 500));

  // Open the slide-up chat bar, type the draft, submit.
  await page.locator('button[aria-label="New chat"]').first().click();
  await new Promise((r) => setTimeout(r, 400));
  await page.locator('textarea').first().fill(SAMPLE);
  await new Promise((r) => setTimeout(r, 150));
  await page.locator('button[aria-label="Send message"]').first().click();

  // Coach reply + cascade + CTA fade-in. 2800ms covers everything.
  await new Promise((r) => setTimeout(r, 2800));

  // Analyse → analysisLoading
  await page.locator('button.heroNext, [class*="inputBarCta"]').first().click();
  await cycle.perspectivePromise;
  await new Promise((r) => setTimeout(r, 650));

  if (capture) {
    await page.locator('[class*="inputBarCta"]').first().screenshot({
      path: path.join(OUT_DIR, 'analysing-button.png'),
    });
    console.log('  ✓ analysing-button.png');
  }

  // Fulfil perspective → 'analysis' phase
  await cycle.perspectiveRoute.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(buildAnthropicResponse({ angles: CANNED_ANGLES })),
  });
  await new Promise((r) => setTimeout(r, 2800));

  if (capture) {
    await phone.screenshot({
      path: path.join(OUT_DIR, 'perspective-screen.png'),
    });
    console.log('  ✓ perspective-screen.png');

    // Per-card loop. See the scroll-snap workaround for
    // `.angleDeck` (smooth behaviour + mandatory snap) in the
    // original comment — same trick: flip to auto, scrollLeft,
    // reflow, restore.
    const analysisCard = page.locator('[class*="analysisCard"]').first();
    const angleDeck    = page.locator('[class*="angleDeck"]').first();
    const deckBox      = await angleDeck.boundingBox();
    const pageWidth    = deckBox.width;

    for (let i = 0; i < CANNED_ANGLES.length; i++) {
      await angleDeck.evaluate((el, left) => {
        const prev = el.style.scrollBehavior;
        el.style.scrollBehavior = 'auto';
        el.scrollLeft = left;
        void el.offsetWidth;
        el.style.scrollBehavior = prev;
      }, i * pageWidth);
      await new Promise((r) => setTimeout(r, 450));
      const filename = `perspective-card-0${i + 1}.png`;
      await analysisCard.screenshot({
        path: path.join(OUT_DIR, filename),
        omitBackground: true,
      });
      console.log(`  ✓ ${filename}`);
    }
  }

  // Help me respond → draftLoading
  await page.locator('[class*="inputBarCta"]').first().click();
  await cycle.draftPromise;
  await new Promise((r) => setTimeout(r, 650));

  if (capture) {
    await page.locator('[class*="inputBarCta"]').first().screenshot({
      path: path.join(OUT_DIR, 'shaping-button.png'),
    });
    console.log('  ✓ shaping-button.png');
  }

  // Fulfil draft → 'drafting' phase
  await cycle.draftRoute.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify(buildAnthropicResponse(CANNED_DRAFT_PAYLOAD)),
  });
  await new Promise((r) => setTimeout(r, 2800));
}

/* ═══════════════════════════════════════════════════════════
   CYCLE 1 — full capture pass ending with Move to Vessel
   ═══════════════════════════════════════════════════════════ */
await runThroughDrafting({ capture: true });

/* drafting-screen.png — full 393×852 phone with the dual
   destination rail at the bottom (what the user sees). Captured
   BEFORE the full-card layout override so the rail is still
   present. */
await phone.screenshot({
  path: path.join(OUT_DIR, 'drafting-screen.png'),
});
console.log('  ✓ drafting-screen.png');

/* ── Individual dual-destination buttons ────────────────────
   The .destDualRow holds two .destDualBtn siblings (Vessel,
   Archive). Each carries the same pink liquid-glass surface
   as the solo Analyse pill; capturing them at element level
   lets the dark phone background bleed around the pill so
   the button can be composited onto any background. Per user:
   "1번 이미지에서 얘네도 각각 따로 빼줘." */
const destBtns = page.locator('[class*="destDualBtn"]');
await destBtns.first().screenshot({
  path: path.join(OUT_DIR, 'move-to-vessel-button.png'),
});
console.log('  ✓ move-to-vessel-button.png');
await destBtns.nth(1).screenshot({
  path: path.join(OUT_DIR, 'move-to-archive-button.png'),
});
console.log('  ✓ move-to-archive-button.png');

/* ── Full .draftCard with disclaimer (shot 9) ───────────────
   The card stacks character hero → tone pill → editor → Copy
   text → AI disclaimer, which is taller than 852px. Playwright
   element.screenshot clips to what's actually painted in the
   viewport, so we grow the viewport vertically, scroll the card
   to the top of .heroScroll, and zero out .heroScroll's 120px
   top / 126px bottom padding + .bottomArea so nothing competes
   with the card in the screenshot region.

   All three overrides live on an ID'd <style> so we can yank
   them before the final "Move to Vessel" click restores the
   normal 393×852 layout for the saved-vessel capture. */
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
// Hide the chat screen's own top chrome (the "< Dad" header)
// during the card shot. CSS Modules hash class names (the rule
// ends up as `._header_xwk7w_9`), so we find it by walking for
// top-anchored absolute/fixed nodes and hide them inline. Tag
// them so we can un-hide later.
await page.evaluate(() => {
  document.querySelectorAll('*').forEach((el) => {
    const cls = typeof el.className === 'string' ? el.className : '';
    if (/(^|\s)_header_[A-Za-z0-9]+_\d+(\s|$)/.test(cls)) {
      el.setAttribute('data-hv-hidden-header', '');
      el.style.display = 'none';
    }
  });
});
// Scroll heroScroll so the draft card sits at the very top.
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

const draftCard = page.locator('[class*="draftCard"]').first();
await draftCard.screenshot({
  path: path.join(OUT_DIR, 'drafting-card.png'),
  omitBackground: true,
});
console.log('  ✓ drafting-card.png');

const draftWordsBox = page.locator('[class*="draftWordsBox"]').first();
await draftWordsBox.screenshot({
  path: path.join(OUT_DIR, 'drafting-inner-card.png'),
  omitBackground: true,
});
console.log('  ✓ drafting-inner-card.png');

/* ── Restore layout for the saved-vessel shot ───────────────
   Remove the override style tag, un-hide the chat header,
   and pop the viewport back to 393×852 so the saved overlay
   renders in its real phone frame. */
await page.evaluate(() => {
  const s = document.getElementById('hv-draft-fullshot-style');
  if (s) s.remove();
  document.querySelectorAll('[data-hv-hidden-header]').forEach((el) => {
    el.style.display = '';
    el.removeAttribute('data-hv-hidden-header');
  });
});
await page.setViewportSize({ width: 393, height: 852 });
await new Promise((r) => setTimeout(r, 400));

/* Click "Move to Vessel" → setSaved('vessel') + setPhase('saved').
   The saved overlay mounts with the heart image, "Tucked into
   your Vessel." headline, the supporting sentence, "Open Heart
   Vessel" primary CTA, and "Back to Home" secondary. Overlay has
   a soft fade-in — 900ms is comfortable. */
await page.locator('[class*="destDualBtn"]').first().click();
await new Promise((r) => setTimeout(r, 900));
await phone.screenshot({
  path: path.join(OUT_DIR, 'saved-vessel-screen.png'),
});
console.log('  ✓ saved-vessel-screen.png');

/* ═══════════════════════════════════════════════════════════
   CYCLE 2 — reload, rerun flow, click Move to Archive
   ═══════════════════════════════════════════════════════════ */
resetCycle();
await runThroughDrafting({ capture: false });

/* Click "Move to Archive" (the SECOND .destDualBtn) → setSaved('archive')
   + setPhase('saved'). Overlay shows the archive folder image,
   "Filed in Archive." headline, "Kept as a reminder that you
   showed up." body, and "Open Archive" primary CTA. */
await page.locator('[class*="destDualBtn"]').nth(1).click();
await new Promise((r) => setTimeout(r, 900));
await phone.screenshot({
  path: path.join(OUT_DIR, 'saved-archive-screen.png'),
});
console.log('  ✓ saved-archive-screen.png');

await browser.close();
console.log(`\n✓ Saved to ${OUT_DIR}`);
