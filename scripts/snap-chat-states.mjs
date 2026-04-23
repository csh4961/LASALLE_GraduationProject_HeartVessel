/* ============================================================
   snap-chat-states.mjs — Two chat-surface states, full screen

   The user supplied two reference shots from a live chat:

     1) LOADING — right after their first message lands. The
        chat scroll shows the user bubble at top, the character
        floating in the middle of the card, and the "thinking"
        word-wave underneath. This is ChatScreen's isTyping state
        with no coach reply yet.

     2) RESULT — same surface after the coach reply arrives. The
        character is still in the card, but below it the hero
        card has typed out its italic opener ("That golf pivot
        from your birthday already stung, and now this.") then
        a divider line, then the body paragraph. The bottom
        button rail now shows the pink "Analyse" button on the
        left + the mini chat pill on the right.

   Both states sit in the same phase ('chatting') — the only
   difference is whether the Anthropic API call has resolved.
   So we intercept api.anthropic.com BEFORE the user submits:
     • First snap: the route handler parks the request (never
       fulfils) so isTyping stays true → LOADING captured.
     • Second snap: we fulfil the parked route with a canned
       JSON payload crafted to produce the exact italic opener
       + analysis body the reference expects → RESULT captured.

   Family data: ChatScreen's detectPerson scans the draft for
   relation keywords ("dad") — our sample message contains "dad"
   so the header label auto-resolves to the dummy Dad member
   without us needing to touch context.

   Output:
     • chat-loading.png  — full .phone viewport (393×852 @3x)
     • chat-result.png   — same viewport, after coach reply lands
   ============================================================ */
import { chromium } from 'playwright';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const OUT_DIR = path.resolve(__dirname, '..', 'captures');
const BASE    = 'http://localhost:5173';

// The sample message the user asked us to type in. Contains "dad"
// so detectPerson() pins the header to the Dad dummy-family member.
const SAMPLE = "My dad checked my exam scores and immediately asked why they weren't higher. It made me feel like my effort didn't matter.";

/* Canned coach reply — shaped to hit ChatScreen's renderer exactly:

   splitEmphasis() italicises the first sentence ending in .!?,
   so the opener run becomes the big italic title at the top of
   the hero card ("That golf pivot … and now this."). Everything
   after the opener's terminal period falls into the body half,
   rendered below the divider line as regular-weight paragraph
   text. The first four words floor (see splitEmphasis) is
   easily met — the opener is 11 words.

   No sections/suggestions needed for this screen: sections'
   eye/chat text would render as an ADDITIONAL paragraph below
   the body, but the reference shot shows just the italic opener
   + divider + a single body paragraph. Keeping sections empty
   matches that layout. */
const CANNED_REPLY = "That immediate 'why weren't they higher' is what stays with you. Like the work you put in became invisible the second the number wasn't what he wanted. Effort without recognition just sits there, unwitnessed.";

const CANNED_PAYLOAD = {
  reply: CANNED_REPLY,
  sections: [],
  suggestions: [],
};

/* Anthropic Messages API response envelope — content[0].text
   holds the stringified JSON that chatWithCoach will parseJSON
   back out. Fields the client doesn't read (id/model/usage) are
   included anyway for realism; parseJSON just pulls {reply,
   sections, suggestions} out of the inner string. */
function buildAnthropicResponse(payload) {
  return {
    id: 'msg_mock',
    type: 'message',
    role: 'assistant',
    model: 'claude-sonnet-4-5-20250929',
    content: [
      { type: 'text', text: JSON.stringify(payload) },
    ],
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

await page.goto(BASE, { waitUntil: 'networkidle' });
await page.waitForFunction(() => window.__hvReady === true, { timeout: 10000 });

// Home first so the chat button is present in GlobalNav.
await page.evaluate(() => window.__hv.navigate('home'));
await new Promise((r) => setTimeout(r, 500));

/* Install the route BEFORE the user submits. We save the
   incoming `route` handle on the outer scope so we can fulfil
   it later (between the loading and result snaps). While the
   route is parked the component stays stuck in isTyping=true
   and renders the thinking card — that's exactly the loading
   frame we want. */
let parkedRoute = null;
let parkedResolve = null;
const parked = new Promise((res) => { parkedResolve = res; });

await page.route('**/api.anthropic.com/**', async (route) => {
  // First call: park it. Second or later calls (shouldn't happen
  // in this run, but defensive) just abort so we don't leak.
  if (!parkedRoute) {
    parkedRoute = route;
    parkedResolve();
  } else {
    await route.abort();
  }
});

/* Open the global slide-up chat bar and type the message.
   aria-label flips from "New chat" (closed) to "Send message"
   (open + has content), so we target the closed state first to
   open, then fill the textarea, then re-target "Send message"
   to fire the submit. handleSend reads inputVal, writes to
   chatDraft, closes the bar, and navigates to 'chat'. */
await page.locator('button[aria-label="New chat"]').first().click();
await new Promise((r) => setTimeout(r, 400));
await page.locator('textarea').first().fill(SAMPLE);
await new Promise((r) => setTimeout(r, 150));
await page.locator('button[aria-label="Send message"]').first().click();

// Wait for the fetch to fire + the thinking card to settle into
// its centered "thinking" position. The chat-screen mount + first
// layout + snap-scroll tween land inside ~900ms; pad to 1600ms so
// the character is fully settled and the thinking-wave's per-letter
// cascade is well into its cycle (looks "alive" rather than mid-intro).
await parked;                                    // fetch is now parked
await new Promise((r) => setTimeout(r, 1600));   // let UI settle

// Prefer screenshotting the .phone node (the 393×852 frame) rather
// than the whole page — avoids the pink body-surround that flex-
// centres the phone, and matches the aspect ratio of the reference.
const phone = page.locator('#root > div').first();

await phone.screenshot({
  path: path.join(OUT_DIR, 'chat-loading.png'),
});
console.log('  ✓ chat-loading.png');

/* Release the parked fetch with the canned JSON. ChatScreen's
   fetchCoachReply resolves, appends the coach message, flips
   isTyping off, triggers the snap-scroll to the new card, and
   kicks off the word-by-word opener reveal (BASE_DELAY_MS 600,
   WORD_GAP_MS 30). The 'Analyse' CTA mounts once phase is back
   at 'chatting' with a coach reply present.

   Timing budget after fulfil:
     ~80ms   scroll tween starts
     ~600ms  first word of opener begins revealing
     ~600 + 11*30 = ~930ms  opener fully revealed
     ~930 + ~15*30 = ~1380ms  body paragraph fully revealed
     ~1650ms Analyse button fade-in completes
   Wait 2800ms to be safely past all of that. */
await parkedRoute.fulfill({
  status: 200,
  contentType: 'application/json',
  body: JSON.stringify(buildAnthropicResponse(CANNED_PAYLOAD)),
});
await new Promise((r) => setTimeout(r, 2800));

await phone.screenshot({
  path: path.join(OUT_DIR, 'chat-result.png'),
});
console.log('  ✓ chat-result.png');

await browser.close();
console.log(`\n✓ Saved to ${OUT_DIR}`);
