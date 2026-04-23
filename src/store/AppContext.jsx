import { createContext, useContext, useState, useEffect } from 'react';

const AppContext = createContext(null);

// localStorage 헬퍼 — 읽기/쓰기 안전하게
function load(key, fallback) {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    // 빈 배열이면 fallback 사용 (더미 데이터 표시)
    if (Array.isArray(parsed) && parsed.length === 0 && Array.isArray(fallback) && fallback.length > 0) {
      return fallback;
    }
    return parsed;
  } catch {
    return fallback;
  }
}

function save(key, value) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // storage full 등 무시
  }
}

const DATA_VERSION = 6; // bump to reset localStorage dummy data

/* ──────────────────────────────────────────────────────────────
   Replay-payload helpers for the dummy Vessel / Archive entries.

   The user asked the sample chats to feel like a real venting
   journal — each one should express a complaint, a sadness, a
   disappointment, or something the user wished they could have
   said but didn't ("상대방에게 어떤 불만이나 특정 상황에서
   사용자가 슬펐던거 아쉬웠던거, 어떤 말을 하고 싶은데 못했던거").
   To support that, each dummy entry ships the SAME replay payload
   shape that a real committed entry carries, so that when you tap
   into a sample from Vessel/Archive you drop straight into the
   three-card replay surface (observation → perspectives → words)
   exactly as if you had written it yourself.

   A few choices worth spelling out:

   - Gradient shape paths mirror the pool in ChatScreen
     (GRADIENT_SHAPE_NUMS). We pick 4 for themeShapes and 2 for
     draftShapes per entry — cycled rather than randomised so the
     dummy set stays deterministic across sessions.
   - analysisAngles[0] is flagged `mbtiFeatured: true`; ChatScreen
     renders the MBTI character portrait on card 01 only when this
     flag is present AND the person's MBTI is known. themeShapes[0]
     goes unused in that case, which is fine.
   - draftVariants / variantDrafts are kept in sync (same text
     array) — variantDrafts is the "user's edited copy" cache;
     seeding it with the original draft text means no forced edits.
   - The coach transcript line starts with `**…**` italic markup so
     the hero card's splitEmphasis renderer lays out the italic
     opener / divider / body cadence the same way a real reply
     from the API would. */
const SHAPE_POOL = [
  '/asset/gradient shapes/Shape/Shape 02.png',
  '/asset/gradient shapes/Shape/Shape 04.png',
  '/asset/gradient shapes/Shape/Shape 18.png',
  '/asset/gradient shapes/Shape/Shape 21.png',
  '/asset/gradient shapes/Shape/Shape 24.png',
  '/asset/gradient shapes/Shape/Shape 25.png',
  '/asset/gradient shapes/Shape/Shape 30.png',
  '/asset/gradient shapes/Shape/Shape 32.png',
  '/asset/gradient shapes/Shape/Shape 33.png',
  '/asset/gradient shapes/Shape/Shape 35.png',
  '/asset/gradient shapes/Shape/Shape 36.png',
];
function pickShapes(seed, count) {
  // Deterministic, index-stable pick so the same entry always renders
  // the same visuals across reloads.
  const out = [];
  for (let i = 0; i < count; i++) {
    out.push(SHAPE_POOL[(seed + i * 3) % SHAPE_POOL.length]);
  }
  return out;
}
function makeReplay({ angles, drafts, nudge, action, seed }) {
  return {
    analysisAngles: angles,
    themeShapes: pickShapes(seed, 4),
    draftVariants: drafts,
    variantDrafts: drafts.map(d => d.text),
    draftShapes: pickShapes(seed + 7, 2),
    draftNudge: nudge,
    draftAction: action,
    draftIdx: 0,
    analysisIdx: 0,
    activeVariantIdx: 0,
  };
}
function makeTranscript({ userText, coachOpener, coachBody, eyeText }) {
  return [
    { id: 1, role: 'user', text: userText, sections: null, suggestions: null },
    {
      id: 2,
      role: 'coach',
      text: `**${coachOpener}** ${coachBody}`,
      sections: eyeText ? [{ icon: 'eye', text: eyeText }] : null,
      suggestions: null,
    },
  ];
}

export function AppProvider({ children }) {
  // 데이터 버전 변경 시 localStorage 초기화
  if (Number(localStorage.getItem('hv_dataVersion')) !== DATA_VERSION) {
    localStorage.removeItem('hv_familyMembers');
    localStorage.removeItem('hv_vesselEntries');
    localStorage.removeItem('hv_archiveEntries');
    localStorage.setItem('hv_dataVersion', String(DATA_VERSION));
  }

  const [screen, setScreen] = useState('splash');
  const [screenHistory, setScreenHistory] = useState([]);

  /* ── DUMMY_FAMILY ──
     Per user ("예시들에 사용자가 직접 줄글로 이 사람에 대해 적은것들을
     더미로 만들어줘"): the profile detail now shows four prose sections
     that read like journal entries the user typed about this person —
     not structured "Likes / Dislikes" micro-chips. The fields map to:

        whoTheyAre   — who this person is in the user's life
        whatILove    — what the user cherishes about them
        whatIsHard   — the friction in the relationship
        memory       — one specific moment that stays with them

     Voices are kept consistent with each person's vent scenarios in
     DUMMY_VESSEL / DUMMY_ARCHIVE so the profile and the drafts feel
     like they come from the same narrator. MBTI / age are intentionally
     kept separate from these prose fields since they live as metadata
     on the hero and aren't part of what "the user wrote." */
  const DUMMY_FAMILY = [
    {
      id: 1,
      relation: 'Dad',
      mbti: 'ISTJ',
      whoTheyAre: "My dad is the quiet spine of our house. He doesn't say much at dinner, but he's the one who notices when the rice cooker is acting up or when I've been wearing the same hoodie three days in a row. He reads the paper every morning before anyone else wakes up. I think he measures love by things staying intact — the car serviced, the bills paid, the freezer stocked.",
      whatILove: "He shows up. Even when we're fighting, he's the first to warm up the car on the morning of a long drive. The care is always in what he's already done before I notice I needed it.",
      whatIsHard: "He calls anything creative a 'hobby.' It doesn't feel malicious, but it shrinks what I'm building until I don't want to talk about work at home. I've stopped telling him about projects until they're finished, which is its own kind of loneliness.",
      memory: "Summer I was fourteen, I failed a math test and hid the paper under my bed. He found it, didn't say a word, just sat with me at the kitchen table every night for two weeks until I could do the problems. He never brought it up again.",
    },
    {
      id: 2,
      relation: 'Mom',
      mbti: 'ISFJ',
      whoTheyAre: "My mom is the household's radar. She knows who's sick, who's fighting, who hasn't eaten, sometimes before we know it ourselves. She runs on worry the way other people run on coffee. Her love is delivered in tupperware and unannounced forehead checks.",
      whatILove: "She remembers the small things — the dentist's name I mentioned once, the friend I fought with in tenth grade. Every call starts with something specific, and that specificity is what tells me she's been thinking about me since we last hung up.",
      whatIsHard: "She compares me to my cousin Jiwon every holiday like it's a motivational tool. It lands as 'you're not there yet,' and I've started dreading Chuseok because I know the ledger is coming. I don't know how to tell her without breaking her heart.",
      memory: "When I moved out for college, she packed my kimchi jars in three layers of newspaper and drove four hours to make sure the glass didn't chip. She cried in the parking lot. I didn't know how to say thank you, so I just helped her carry them up.",
    },
    {
      id: 3,
      relation: 'Older\nSister',
      mbti: 'ENFP',
      whoTheyAre: "My older sister is the family's flare — the first person to laugh, the first person to cry, the one who turns Tuesday into an occasion. She lives in Seoul now and her life looks like a travel magazine. She loves us loudly, in all caps.",
      whatILove: "She remembers I exist even when she's drowning. Mid-launch, mid-breakup, she still texts me the dumbest memes at 2am. She's the person who made me feel like being weird was a good thing before I knew that was allowed.",
      whatIsHard: "When I call her sad, she pivots to her Bali trip within thirty seconds. I know it's her reflex — she uses brightness as a hug — but it makes me hang up feeling more alone than when I dialled. I've started calling her less about the heavy stuff.",
      memory: "She flew home for one day when I didn't get into the program I wanted. Twelve hours, one meal, one long walk along the river where she didn't try to fix it. Just walked next to me. That was the day I trusted her with the hard stuff.",
    },
    {
      id: 4,
      relation: 'Older\nBrother',
      mbti: 'INTP',
      whoTheyAre: "My older brother lives mostly in his head. He's the one who'll skip dinner because he's debugging something, who quotes obscure papers in the middle of grocery trips. He's gentle, but he processes feelings like code — read, parse, respond in an hour or a week.",
      whatILove: "When he does say something emotional, it's exact. No cliché, no softening. He'll say the one true sentence nobody else has dared to and then go back to his terminal. I've saved three of those sentences on a note in my phone.",
      whatIsHard: "He cracked my laptop hinge and just shrugged. It wasn't about the hinge — it was that he couldn't find the script for 'sorry.' I end up translating his silences into what I wish they meant, and some days I'm tired of translating.",
      memory: "The night I got dumped, he walked into my room without knocking, sat on the floor, handed me a glass of water, and played a game for an hour without speaking. He left. It was the most supportive thing anyone has ever done and he would refuse to call it that.",
    },
    {
      id: 5,
      relation: 'Younger\nSister',
      mbti: 'ESFJ',
      whoTheyAre: "My younger sister is the family's connective tissue. She's the reason group chats stay alive, the reason birthdays get remembered, the reason we still eat dinner together when we're all home. She bakes when she's anxious — the kitchen smells like cinnamon when something's wrong.",
      whatILove: "She organizes joy. She'll plan a small thing three weeks in advance and show up with the snacks pre-portioned, and it's the kind of care that looks like logistics but is actually love in disguise.",
      whatIsHard: "She reads silence as rejection. If I don't reply to a message within a few hours she spirals, and I've started feeling like I can't go offline without managing her. I love her, and I also need more room than she tends to give.",
      memory: "She made me a playlist the week I moved out — 27 songs, handwritten note, the covers of three of them she'd drawn herself. I didn't know she'd been watching me that closely. I still play it when I miss home.",
    },
    {
      id: 6,
      relation: 'Younger\nBrother',
      mbti: 'ESTP',
      whoTheyAre: "My younger brother is motion in human form. Football at dawn, driving at midnight, starting three projects before finishing one. He's the funniest person I know and the hardest to pin down for a real conversation. He answers emotional questions with a joke eighty percent of the time.",
      whatILove: "He's fearless in the ways I wish I could be. When I don't know whether to speak up, he's already three sentences deep. And when something actually matters, the joking drops and he's the most present person in the room.",
      whatIsHard: "I can't get him to sit still long enough to tell him anything heavy. By the time I've built up to the sentence, he's changed the subject or left the room. I've started writing him letters I never send.",
      memory: "Last winter he drove two hours through snow because I said 'I'm fine' in a way that wasn't fine. He didn't say anything when he arrived — just dropped his bag, made ramen, and sat on my couch until I cried. Then he drove back.",
    },
    {
      id: 7,
      relation: 'Grandpa',
      mbti: 'INTJ',
      whoTheyAre: "My grandpa is the family's historian. He remembers streets that don't exist anymore, and the names of everyone who used to live on them. He walks four kilometres every morning. He keeps a notebook of things he's been meaning to tell me and gives me a new page every time I visit.",
      whatILove: "He speaks to me like a person, not a child. When I was twelve he asked what I thought about something in the newspaper and actually waited for the answer. That was the first time an adult made me feel like my ideas were real.",
      whatIsHard: "He refuses to learn technology, which means I can't talk to him unless I'm physically there. Between visits, months go by where I don't know if he's lonely or well. The distance is geographic and I can't fix it with a phone.",
      memory: "When my grandma was in the hospital, he held her hand for seven hours without moving. I brought him water. He took a sip, put the cup down, and went right back to holding her hand. I learned what love looked like that afternoon.",
    },
    {
      id: 8,
      relation: 'Grandma',
      mbti: 'ESFJ',
      whoTheyAre: "My grandma is the reason the family has a shape. She's the keeper of recipes nobody else wrote down, the voice on the other end of every holiday call, the person whose opinion my mother still quietly seeks. She knits even when she isn't making anything — her hands just can't be empty.",
      whatILove: "She tells the same stories every visit and I've started realising it's because she wants us to have them when she's gone. The repetition is a gift. She's handing them over, slowly, one dinner at a time.",
      whatIsHard: "Her world has shrunk with the cold, and I watch her get smaller every winter. She won't say she's lonely. I don't know how to be a grandchild to someone who refuses to need me, but I'm learning.",
      memory: "She taught me to roll mandu when I was seven. Her hands on top of mine, no words, just the rhythm of dough and filling. When I roll them now they look exactly like hers, and that's the closest I've ever felt to being in two places at once.",
    },
  ];

  /* DUMMY_VESSEL — still-unsent vents. Each scenario is a specific
     moment where the user couldn't get the words out in the room:
     a comparison that stung, a dismissed phone call, a borrowed
     laptop returned without apology. These are drafts sitting in
     the chest — not yet delivered. */
  const DUMMY_VESSEL = [
    // 101 — Dad / ISTJ — the "safe choice" conversation
    {
      id: 101,
      rawText: "I'm so upset that Dad keeps calling my design major 'just a hobby' — it makes me feel like four years of my life don't count.",
      message: "Dad, when you called my design major a 'hobby' last Sunday, it felt like the four years I poured into it got erased at the dinner table. I'm not asking you to love what I do — I just need you to see that it's not a detour. It's the work.",
      person: DUMMY_FAMILY[0],
      createdAt: Date.now() - 86400000 * 1,
      transcript: makeTranscript({
        userText: "I'm so frustrated that my dad keeps calling my design major a hobby. Last Sunday he said 'let's be realistic' in front of everyone at dinner and I just sat there. It makes me feel like nothing I do will ever count to him.",
        coachOpener: "That kind of sentence cuts in a really specific way.",
        coachBody: "Not because it's cruel — because it's casual. He said it lightly, and the lightness is what tells you how he ranks it in his head. That's what actually hurt: the category, not the tone.",
        eyeText: "You weren't silent because you had no answer. You were silent because defending it in that moment would've made it feel smaller than it is.",
      }),
      replay: makeReplay({
        seed: 1,
        angles: [
          { title: "The ISTJ frame", body: "ISTJ Dads often translate love into risk-reduction. 'Be realistic' is his caretaking vocabulary, not his verdict on you.", mbtiFeatured: true },
          { title: "What the 'hobby' word did", body: "He named it hobby to shrink the stakes — for him, not for you. But a label said in front of others lands like a public filing, and that's why it stung at the table, not later." },
          { title: "The silence at dinner", body: "You didn't fail to speak up — you chose not to spend four years of work defending itself over a casserole. That's a boundary, not a loss." },
          { title: "From a memory", body: "You told me once he called the photography class 'cute' in 11th grade. Same pattern. The script is old, which means this isn't about design. It's about how he narrates what you love." },
        ],
        drafts: [
          { label: "Direct", tone: "clear · grounded", text: "Dad, when you called my design major a 'hobby' at dinner, it felt like four years of work got erased. I don't need you to love it. I need you to stop making it smaller than it is." },
          { label: "Softer", tone: "warm · inviting", text: "Dad, I've been sitting with something. When you said 'let's be realistic' on Sunday, I heard it as 'this isn't real.' I know you mean it as care. I just want you to know it lands differently." },
          { label: "Curious", tone: "open · questioning", text: "Dad — when you call what I do a hobby, what's the thing you're actually worried about? Because I think we've been arguing about the word when the worry is something else." },
        ],
        nudge: "ISTJ Dads respond better to specifics than to feelings. Anchor the moment (Sunday dinner) — don't generalise it.",
        action: "Pick one: ship it, or ask him to coffee first.",
      }),
    },
    // 102 — Mom / ISFJ — the cousin-comparison
    {
      id: 102,
      rawText: "I dread going home because Mom compares me to cousin Jiwon every single Chuseok and it makes me feel like I'm not enough on my own.",
      message: "Mom, I know when you talk about Jiwon you mean it as motivation. But I've started dreading Chuseok because I know the comparisons are coming. I'd rather hear about what you see in ME — even the small things. Please.",
      person: DUMMY_FAMILY[1],
      createdAt: Date.now() - 86400000 * 2,
      transcript: makeTranscript({
        userText: "I'm exhausted by the fact that every Chuseok my mom compares me to cousin Jiwon — his job, his apartment, his girlfriend. I've started dreading going home. It makes me feel like I only exist in the sentence next to him.",
        coachOpener: "That dread you feel before the drive home is data.",
        coachBody: "It's not oversensitivity — it's the body remembering a script it's been handed every year. Jiwon isn't the problem. The problem is that you only get described in comparison, and never on your own.",
        eyeText: "ISFJ moms often use comparison the way other people use praise — as encouragement. She probably thinks she's lighting a fire, not dimming one.",
      }),
      replay: makeReplay({
        seed: 2,
        angles: [
          { title: "The ISFJ frame", body: "ISFJ moms comfort through maintenance. If she's running the Jiwon comparison, she probably feels she's 'still parenting' — still sharpening you.", mbtiFeatured: true },
          { title: "Why it reads as erasure", body: "The issue isn't hearing about Jiwon. It's that you only exist in the sentence next to him. Your own life doesn't get its own line." },
          { title: "The holiday context", body: "Chuseok turns family into audience. A comment that would pass as small talk on a Tuesday becomes a public review when aunts and cousins are listening." },
          { title: "From a memory", body: "You said on your call last March that she did the same thing with Jiwon's law exam. This isn't a fluke year — it's a recurring ritual she doesn't realise she's running." },
        ],
        drafts: [
          { label: "Direct", tone: "clear · boundaried", text: "Mom, the Jiwon comparisons at holidays — they've started making me dread coming home. I love you and I want to see you. I just need us to talk about my life on its own, not next to his." },
          { label: "Softer", tone: "warm · protective", text: "Mom, I know when you talk about Jiwon you mean it as motivation. But I've started hearing it as 'you're not there yet.' Can we try a Chuseok where you just tell me what you've been thinking about lately — no cousins?" },
          { label: "Curious", tone: "inviting", text: "Mom — what's one thing about me right now that you'd tell the aunts about, without comparing it to anyone? I just want to hear it." },
        ],
        nudge: "Skip 'you always' phrasing. ISFJs hear that as accusation even when it's true.",
        action: "Send it before the next holiday, not during.",
      }),
    },
    // 103 — Older Sister / ENFP — the dismissed breakup call
    {
      id: 103,
      rawText: "I feel so dismissed that when I tried to tell my sister about my breakup, she pivoted to her Bali trip within thirty seconds.",
      message: "Unni, I called you last week because I wanted to talk about the breakup, and within thirty seconds you'd pivoted to Bali. I know you didn't mean it as dismissal. But I hung up feeling more alone than before I dialled. I need you to know that.",
      person: DUMMY_FAMILY[2],
      createdAt: Date.now() - 86400000 * 3,
      transcript: makeTranscript({
        userText: "I'm hurt that when I called my sister about my breakup, she barely asked how I was and pivoted straight to her Bali trip. I hung up and cried for an hour. It makes me feel like my pain is inconvenient for her.",
        coachOpener: "That pivot is the exact kind of small thing that weighs a lot.",
        coachBody: "ENFPs reach for the next bright thing when a conversation gets heavy — not because they don't care, but because they've been trained to lift the room. The problem is you didn't need the room lifted. You needed someone to stay in it with you.",
        eyeText: "You weren't asking her to fix it. You were asking her to feel it with you for a minute. That's a different job than she tried to do.",
      }),
      replay: makeReplay({
        seed: 3,
        angles: [
          { title: "The ENFP frame", body: "Energetic sisters redirect to joy as a reflex — they think they're throwing you a rope. You were already at the surface; you just wanted company down there.", mbtiFeatured: true },
          { title: "Why phone calls are harder", body: "On the phone she can't see your face. She couldn't tell whether you needed 'cheer me up' or 'stay with me.' She defaulted to the first. That's on her, but it's also information you can give her next time." },
          { title: "The 'kind of' pause", body: "You said 'kind of' instead of 'no.' That ambiguity gave her an exit she took. A clearer ask — 'I'm not okay, can you just listen' — would've redrawn the call in a sentence." },
          { title: "From a memory", body: "Last fall when you told her Dad was in hospital, she texted jokes for an hour. Same reflex. She uses brightness as a hug. You need to tell her when you want the hug plain." },
        ],
        drafts: [
          { label: "Direct", tone: "honest · vulnerable", text: "Unni, when I called you last week I needed you to stay with me, not to tell me about Bali. I'm not mad. I just want you to know the call made me feel more alone, not less. Next time, can you just listen for five minutes before you cheer me up?" },
          { label: "Softer", tone: "warm · naming a pattern", text: "Unni, I love how bright you are. I also need to tell you — when I'm sad on the phone, the pivot to your travel stories lands as 'my thing doesn't fit here.' Can we try a version where you ask one more question before you change the subject?" },
          { label: "Curious", tone: "open", text: "Unni — when I say 'kind of', what do you hear? Because I think we're getting different sentences out of that phrase." },
        ],
        nudge: "ENFPs take feedback as long as it doesn't land as 'you failed.' Frame it as a request, not a verdict.",
        action: "Say it in text, not on a call — she'll re-read it.",
      }),
    },
    // 104 — Older Brother / INTP — the laptop hinge
    {
      id: 104,
      rawText: "I'm really annoyed that my older brother cracked my laptop hinge and just shrugged instead of apologising — it wasn't the laptop, it was the shrug.",
      message: "Hyung, when you gave the laptop back with the cracked hinge and just shrugged, it wasn't the laptop that got to me. It was the shrug. I would've been fine if you'd just said 'sorry, I'll cover it.' That's all.",
      person: DUMMY_FAMILY[3],
      createdAt: Date.now() - 86400000 * 5,
      transcript: makeTranscript({
        userText: "I'm so frustrated that my brother borrowed my laptop, brought it back with a cracked hinge, and just shrugged when I pointed it out. No apology, no offer to fix it. The shrug is what's getting to me more than the damage.",
        coachOpener: "Right — this isn't about the hardware.",
        coachBody: "The damage is a fixable line item. The shrug is what you're actually processing: it said 'this isn't a thing worth addressing,' and that verdict landed on you, not the laptop. That's the part that stings.",
        eyeText: "INTPs often skip apology because they rank the issue by size, not by relationship. He probably thinks the hinge is trivial. He doesn't realise the trivial framing is itself the injury.",
      }),
      replay: makeReplay({
        seed: 4,
        angles: [
          { title: "The INTP frame", body: "INTPs process by proportion. If the damage feels small to him, he'll act like the repair conversation is small too. That's not malice — that's how he triages.", mbtiFeatured: true },
          { title: "Why the shrug is the wound", body: "A shrug doesn't carry information. It's a refusal to engage. The message you got wasn't 'I don't care about the laptop' — it was 'I don't care to discuss this with you.'" },
          { title: "What you actually want", body: "Not the money. Not the fix. The sentence 'I broke it, I'm sorry.' Seven words. You're not asking for a contract — you're asking for acknowledgement that the exchange happened." },
          { title: "From a memory", body: "This isn't the first shrug. You mentioned the same thing with the bike last summer — he returned it muddy, wouldn't clean it, said 'it's dirt.' Pattern, not incident." },
        ],
        drafts: [
          { label: "Direct", tone: "plain · dry", text: "Hyung, the laptop hinge is cracked. What's getting to me isn't the damage — it's that you didn't apologise. I don't need you to pay for it. I just need to hear 'I broke it, I'm sorry.'" },
          { label: "Softer", tone: "warm · brotherly", text: "Hyung — small thing, but the shrug when you gave the laptop back is sitting with me. I don't mind the hinge. I mind that we skipped the part where you said sorry. Can we do that part?" },
          { label: "Curious", tone: "Socratic · disarming", text: "Hyung, honest question — when you shrugged about the laptop, did it feel like a non-event to you? Because it didn't to me, and I'd rather figure out why we're reading it differently." },
        ],
        nudge: "INTPs respond to logic, not emotion. Frame the ask as 'this is the protocol we skipped,' not 'you hurt my feelings.'",
        action: "Send it when he's alone — group chat will make him defensive.",
      }),
    },
    // 105 — Younger Sister / ESFJ — the "always grumpy" comment
    {
      id: 105,
      rawText: "I'm hurt that my little sister called me 'always grumpy' in front of her friends — I laughed but I've thought about it every day since.",
      message: "Yuna, when you told your friends I'm 'always grumpy' at dinner last Friday, I laughed it off, but I've thought about it every day since. I don't want to be the punchline in your group. I want to be your unni.",
      person: DUMMY_FAMILY[4],
      createdAt: Date.now() - 86400000 * 6,
      transcript: makeTranscript({
        userText: "I'm really hurt that my little sister described me as 'always grumpy' to her friends while I was literally standing in the room. I laughed at the time. I've been thinking about it every day for a week. I hate being her punchline.",
        coachOpener: "Laughter in the moment is how you protected everyone else in the room.",
        coachBody: "It's also how the comment got to enter you unchallenged. The reason it's still sitting with you is that you absorbed it alone — the joke stayed in the room, but the label followed you out of it.",
        eyeText: "ESFJs perform social fluency hard. Your sister probably said it to feel connected to her friends, not to rank you below them. But that's the effect, and the effect is what you're carrying.",
      }),
      replay: makeReplay({
        seed: 5,
        angles: [
          { title: "The ESFJ frame", body: "ESFJs trade in group-energy. In front of her friends she was signalling 'I'm cool, my sister is the vibe-check.' She likely doesn't remember saying it by now. You still do.", mbtiFeatured: true },
          { title: "Why in front of friends is different", body: "A label said privately is a conversation. A label said to an audience is a casting. She cast you as 'the grumpy one' in a scene that keeps replaying in your head." },
          { title: "The laugh you gave", body: "You didn't lose the moment by laughing — you made it survivable in real time. The cost is that it looked like consent. This conversation is how you take that back without rewriting the original scene." },
          { title: "From a memory", body: "You said once she called you 'the serious one' at the graduation party. Pattern: she packages you with a label to make herself easier to explain. That's solvable, but only if named." },
        ],
        drafts: [
          { label: "Direct", tone: "sisterly · firm", text: "Yuna, when you called me 'always grumpy' in front of your friends last week, I laughed. I've thought about it every day since. I don't want to be your easy label. Pick something true and say it to my face, or don't say it at all." },
          { label: "Softer", tone: "warm · connecting", text: "Yuna — tiny thing you probably forgot: the 'always grumpy' comment on Friday is still sitting with me. I get that you were just being fun with your friends. Next time, can you leave me out of the bit?" },
          { label: "Curious", tone: "open · caring", text: "Yuna, what's the version of me you describe to your friends? I just realised I don't actually know — and last week I think I learned one of them, and it wasn't great." },
        ],
        nudge: "ESFJs feel called-out fast. Lead with 'I love you' so she doesn't spin into apology-mode before she hears you.",
        action: "Send it as a voice note — tone matters.",
      }),
    },
    // 106 — Younger Brother / ESTP — the graduation he skipped
    {
      id: 106,
      rawText: "I'm sad that my little brother skipped my graduation for a basketball game — I told him it was fine but I kept looking for him in the crowd.",
      message: "You told me it was fine to skip my graduation. I told you it was fine too. It wasn't. I scanned the crowd the whole ceremony. You're my little brother. I wanted you there.",
      person: DUMMY_FAMILY[5],
      createdAt: Date.now() - 86400000 * 7,
      transcript: makeTranscript({
        userText: "I'm really hurt that my younger brother skipped my graduation for a pickup basketball game. I told him it was fine but it wasn't — I kept scanning the crowd for him the whole ceremony. I've never told him that.",
        coachOpener: "The scanning is the whole story.",
        coachBody: "You said it was fine, and you meant it — right up until the actual ceremony, when your body disagreed with your mouth. The 'it's fine' was a guess about how you'd feel. The scanning was the truth when the moment arrived.",
        eyeText: "ESTP brothers often underestimate absence as a signal. He thinks showing up = admin. To him the graduation was a certificate. To you it was 'does he put me first for two hours.'",
      }),
      replay: makeReplay({
        seed: 6,
        angles: [
          { title: "The ESTP frame", body: "ESTPs optimise for the live moment. A graduation is static, a basketball game is alive — he picked the one that felt real to him. That's the bug, not a character flaw.", mbtiFeatured: true },
          { title: "Why 'it's fine' backfired", body: "You gave him a green light he was looking for. He probably didn't hear the reluctance inside 'fine.' ESTPs take words at face value; subtext is noise to them." },
          { title: "The scanning", body: "You didn't want him there for the diploma. You wanted him there as proof. Proof that when the milestone came, he'd show. He didn't, and the scan was you looking for the proof anyway." },
          { title: "From a memory", body: "He missed Mom's 50th for a tournament too. You were fine with it then. The difference now is that you've started counting — not to punish, but to see the pattern." },
        ],
        drafts: [
          { label: "Direct", tone: "plain · real", text: "You skipped my graduation. I told you it was fine. It wasn't. I scanned the crowd the whole time. I'm telling you now because next time, I want you to ignore me when I say it's fine." },
          { label: "Softer", tone: "honest · kind", text: "Hey — small thing that's been sitting with me. I told you my graduation didn't matter. Apparently it did, because I spent the ceremony looking for you. I'm not asking for an apology. I'm asking you to read 'fine' from me differently from now on." },
          { label: "Curious", tone: "real talk", text: "What would it have taken for you to be at the graduation? I'm not trying to guilt you. I actually want to know what makes something big enough for you to show up." },
        ],
        nudge: "ESTPs hate hearing 'you hurt me.' Frame it as a calibration ask: 'read me better next time.'",
        action: "Say it at the next hangout — not via text.",
      }),
    },
    // 107 — Grandpa / INTJ — the stories he still knows
    {
      id: 107,
      rawText: "I'm sad that Grandpa has never told me about his past and now his memory is slipping — I feel like he kept a door shut on me my whole life.",
      message: "Harabeoji, I'm frustrated that you've never told me about the years you lived through. I'm not asking to pry. I just want to know you before it's too late. Can I come this Sunday and listen? I'll bring the recorder.",
      person: DUMMY_FAMILY[6],
      createdAt: Date.now() - 86400000 * 8,
      transcript: makeTranscript({
        userText: "I'm sad and a little angry that my grandpa has never told me anything about his younger years. I kept waiting for him to open up. Now his memory is slipping and it feels like he kept a door shut on me my entire life.",
        coachOpener: "That mix of sadness and quiet anger is really fair.",
        coachBody: "INTJ grandfathers don't volunteer stories — they wait to be asked, and they mistake waiting for respect. What you experienced as a closed door was probably him thinking 'she'll ask when she's ready.' Two decades of that becomes silence indistinguishable from refusal.",
        eyeText: "You're not just grieving the stories. You're grieving the version of your relationship where he offered, unprompted, because he thought you mattered enough to tell.",
      }),
      replay: makeReplay({
        seed: 7,
        angles: [
          { title: "The INTJ frame", body: "INTJs don't volunteer stories — they wait to be asked. He probably thought you weren't interested, because you never came with the question. The ask itself is half the gift.", mbtiFeatured: true },
          { title: "What you're really mourning", body: "It isn't the stories you haven't heard. It's the version of you who would've had the composure to ask them earlier. That version didn't know they'd run out of time. Be gentle with that version." },
          { title: "The recorder idea", body: "A recorder turns the visit into a project, which relieves the pressure of making it a 'goodbye visit.' For him, 'help me make a record' is a job. For you, it's permission to ask without making him feel terminal." },
          { title: "From a memory", body: "You said once he lit up when the cousin from Busan asked about his ship. He still has the door. The door just needs someone to knock on it." },
        ],
        drafts: [
          { label: "Direct", tone: "gentle · resolute", text: "Harabeoji, I'm sorry I waited. I want to hear the years you don't talk about. Can I come Sunday with a recorder? Not for anyone else. Just for me." },
          { label: "Softer", tone: "warm · easeful", text: "Harabeoji, I've been thinking about you. I want to come sit with you this weekend — no rush, just to hear stories. Any story. I'll bring the cookies you like." },
          { label: "Curious", tone: "inviting", text: "Harabeoji, will you tell me about when you were my age? I realised I've never asked, and I want to know." },
        ],
        nudge: "INTJs warm up to focused questions, not open ones. Pick a specific decade to ask about.",
        action: "Call Halmoni first so she can prep him.",
      }),
    },
    // 108 — Grandma / ESFJ — sit down and eat with me
    {
      id: 108,
      rawText: "I feel so lonely because Halmoni feeds me but never sits down to eat with me — I drive hours to see her and I barely see her face.",
      message: "Halmoni, I come home for you, not for the food. Please sit with me and eat, even if it's just one bowl. The time with you is the meal. The rest is dessert.",
      person: DUMMY_FAMILY[7],
      createdAt: Date.now() - 86400000 * 9,
      transcript: makeTranscript({
        userText: "I'm lonely every time I visit halmoni. She cooks for me and then stands in the kitchen the whole meal. I've asked her to sit and she waves it off. I don't even care about the food — I just want her at the table with me and it never happens.",
        coachOpener: "That's such a specific kind of loneliness — being fed from across the room.",
        coachBody: "ESFJ grandmothers pour love out through service, and sitting down can feel to them like stopping the love from flowing. She isn't ignoring you. She's staying in the posture where she knows how to reach you. But the posture is keeping her out of your actual reach.",
        eyeText: "You don't want the meal. You want her shoulder next to yours for twenty minutes. That's a different request, and she's never heard it phrased that way.",
      }),
      replay: makeReplay({
        seed: 8,
        angles: [
          { title: "The ESFJ frame", body: "ESFJs feel most themselves when they're taking care of someone. If she sits down, she stops feeling useful — and uselessness feels like being unneeded, which is scarier to her than tired legs.", mbtiFeatured: true },
          { title: "Why service became distance", body: "You came home for connection; she's giving you cuisine. Both are real love. The mismatch is that her language is plates, and your language is eye contact." },
          { title: "Re-framing the ask", body: "Don't ask her to stop cooking. Ask her to sit for the part that matters most — the first bite. Give her a small, bounded yes that doesn't retire her role." },
          { title: "From a memory", body: "You said she finally sat during the tea after your college acceptance. She can do it — she needs the occasion to be marked. Mark it." },
        ],
        drafts: [
          { label: "Direct", tone: "tender · clear", text: "Halmoni, I come home for you, not for the food. Please sit with me and eat — even if it's one bowl. The time with you is the meal. Please." },
          { label: "Softer", tone: "sweet · coaxing", text: "Halmoni, I have an idea for Sunday. You make whatever you want, but we eat the first ten minutes together sitting down. That's the rule. I'll wash up after." },
          { label: "Curious", tone: "playful", text: "Halmoni — if I tell you I'm full on purpose, will you finally sit down? I just want to talk with you while the food is still warm." },
        ],
        nudge: "Avoid 'you never sit.' ESFJ grandmothers hear that as criticism of how they love. Frame it as what you want, not what she does wrong.",
        action: "Say it the moment you walk in — not mid-meal.",
      }),
    },
    // 109 — Mom (second) / ISFJ — internship rejection
    {
      id: 109,
      rawText: "I'm really hurt that when I told Mom I got rejected from the internship, her first words were 'you didn't try hard enough' instead of just being with me.",
      message: "Mom, when the internship rejected me and you said I didn't try hard enough — I know you were scared for me. But I wasn't looking for a lesson. I was looking for the person who taught me how to feel my feelings. Can we try again?",
      person: DUMMY_FAMILY[1],
      createdAt: Date.now() - 86400000 * 10,
      transcript: makeTranscript({
        userText: "I'm so hurt that when I told my mom I got rejected from the internship I really wanted, her first sentence was 'well, you didn't try hard enough.' I didn't need a verdict. I needed her to sit with me for five minutes. I hung up feeling smaller than before I called.",
        coachOpener: "That's one of the worst sentences to hear in that specific moment.",
        coachBody: "Not because it's cruel — because it's evaluative when you needed presence. ISFJ moms under stress reach for diagnosis: if they can name a cause, they can fix a cause. What that does is turn your grief into her homework, and now both of you are working on the rejection instead of surviving it.",
        eyeText: "She was trying to protect you by locating a reason. The side effect is that the reason landed on you, as a verdict, right when you were most porous.",
      }),
      replay: makeReplay({
        seed: 9,
        angles: [
          { title: "The ISFJ frame", body: "ISFJ moms comfort by problem-solving when the problem feels threatening. Rejection looked threatening, so she grabbed a diagnosis like a flashlight — and shone it right at you.", mbtiFeatured: true },
          { title: "The ask under the ask", body: "You weren't asking her for a post-mortem. You were asking her for the five minutes of sitting-together she used to give when you skinned a knee. That version of her exists. You just have to call her up by name." },
          { title: "What 'didn't try hard enough' actually meant", body: "It means she's scared. ISFJs name your flaws as a way to pre-empt the world naming them louder. She's trying to arm you. It reads as attack because armour and weapon look the same in the dark." },
          { title: "From a memory", body: "You said after the exam flunk in sophomore year she did the same thing — straight to 'study plan.' She has a groove. The groove wasn't made to hurt you. It was made to keep you safe. But it hurts you now." },
        ],
        drafts: [
          { label: "Direct", tone: "raw · clear", text: "Mom, when I told you about the internship and you said I didn't try hard enough — I wasn't asking for a verdict. I was asking for you. Can we try that call again? I just need you to be sad with me for ten minutes before the fixing starts." },
          { label: "Softer", tone: "warm · calibrating", text: "Mom — tiny request. Next time I call with bad news, can you just say 'that's hard' before you say anything else? Not a plan. Not a reason. Just 'that's hard.' That's the version of you I miss." },
          { label: "Curious", tone: "open", text: "Mom, when I tell you something hurt, what do you think I'm asking you to do? I realise we might be answering different questions." },
        ],
        nudge: "Don't list what she did wrong. ISFJs collapse under that. Ask for a one-sentence do-over.",
        action: "Call her back the same day. Don't let it calcify.",
      }),
    },
    // 110 — Dad (second) / ISTJ — have you ever been proud out loud
    {
      id: 110,
      rawText: "I'm sad that Dad yells at the TV for hours but goes silent whenever I share good news — I don't think he's ever said he's proud of me out loud.",
      message: "Dad, I've heard you shout at the football ref and whisper through my promotion news. I don't need a speech. I just want to hear, once, you say out loud that you're proud. Even if it's awkward. Especially if it's awkward.",
      person: DUMMY_FAMILY[0],
      createdAt: Date.now() - 86400000 * 12,
      transcript: makeTranscript({
        userText: "I'm really hurt that my dad can yell at the TV for an hour but when I told him I got promoted he just nodded and said 'good, good.' I've been sitting here wondering if he's ever said he's proud of me out loud. I don't think he has, and it's starting to weigh on me.",
        coachOpener: "That observation is sharp because it's exact.",
        coachBody: "It's not that your dad can't express — you can hear him roar at the TV. It's that the expression he lets out freely is criticism, and the expression he withholds is praise. That's not a temperament thing. That's a choice his generation made for him, and he's never revisited.",
        eyeText: "You don't actually need the speech. You need a single unambiguous sentence, in his voice, that names you as the source of pride. The absence of that one sentence is a specific weight.",
      }),
      replay: makeReplay({
        seed: 10,
        angles: [
          { title: "The ISTJ frame", body: "ISTJ dads equate praise with overstatement. Understatement is how they protect you from arrogance. But understatement over decades reads as absence. That's the math he's never done.", mbtiFeatured: true },
          { title: "The TV vs. you asymmetry", body: "He's fluent in disapproval because there's no intimacy cost to it. Praise costs him something — a small vulnerability. The silence around your wins is how he's been avoiding that cost." },
          { title: "What you actually want", body: "One sentence. Not a speech. Not a card. A sentence said in his kitchen voice that you can carry around for the rest of your life. That's a small ask with a large weight." },
          { title: "From a memory", body: "You said once Mom told you he cried when you got into college but didn't tell you. That story is proof the feeling is there. You're asking for the direct line, not for the feeling to be invented." },
        ],
        drafts: [
          { label: "Direct", tone: "brave · plain", text: "Dad, I've never heard you say out loud that you're proud of me. Not once. I'm not asking for a speech. I'm asking for one sentence. Even if it's awkward. Especially if it's awkward." },
          { label: "Softer", tone: "warm · small", text: "Dad — strange question. Could you tell me, in your own words, one thing about me you're proud of? Mom told me you were glad about the promotion. I'd like to hear it from you." },
          { label: "Curious", tone: "gentle challenge", text: "Dad, did your dad ever say he was proud of you? I've been thinking about it and I realised I've never asked you." },
        ],
        nudge: "ISTJ dads respond to structure. A short direct question is easier for him than an open-ended heart-to-heart.",
        action: "Ask him face-to-face. Don't give him an out via text.",
      }),
    },
  ];

  /* DUMMY_ARCHIVE — already-sent entries. Some got a response,
     some are still waiting. Each carries the same replay payload
     as Vessel so tapping into them drops you into the exact
     three-card conversation the user committed from. */
  const DUMMY_ARCHIVE = [
    // 201 — Mom — the "wasted the semester" reckoning (responded)
    {
      id: 201,
      rawText: "I'm really hurt that Mom said I 'wasted the semester' at dinner in front of everyone — she has no idea I was depressed the whole time.",
      message: "Mom, at dinner when you said I wasted the semester, something broke in me that I didn't tell you about. I wasn't asking you to celebrate the grades. I was asking you to ask how I was. Please ask me next time.",
      person: DUMMY_FAMILY[1],
      createdAt: Date.now() - 86400000 * 14,
      sentAt: Date.now() - 86400000 * 14,
      response: "She cried and said she'd been scared for me the whole semester. She said she didn't know how to ask.",
      transcript: makeTranscript({
        userText: "I'm really hurt that my mom said I 'wasted the semester' in front of my dad and sister at dinner. I got a 3.1. I was depressed the whole term. She has no idea. I just sat there pushing rice around the plate and I haven't told her how much it hurt.",
        coachOpener: "That sentence at that table is a specific kind of wound.",
        coachBody: "You didn't come home to be audited. You came home because you were exhausted. What she did by saying 'wasted' in front of everyone is skip the entire interior of the semester — the effort, the depression, the surviving — and grade only the outcome. That's why it broke something.",
        eyeText: "The 'in front of everyone' part matters. It turned a private struggle you hadn't yet shared into a public deficit.",
      }),
      replay: makeReplay({
        seed: 11,
        angles: [
          { title: "The ISFJ frame", body: "Your mom uses bluntness at the table as a pre-emptive strike — she's scared you won't take the problem seriously, so she names it loudest. It's anxiety dressed as discipline.", mbtiFeatured: true },
          { title: "Why 'wasted' lands so hard", body: "'Wasted' implies recoverable effort not spent. You spent everything you had. Naming the semester 'wasted' erased the depression as a legitimate cost." },
          { title: "The audience", body: "She said it with Dad and your sister there. That multiplied the wound — it turned a critique into a ruling the whole family heard. You haven't gotten to correct the record since." },
          { title: "From a memory", body: "You said she did the same thing after you quit the band in high school — 'wasted two years.' Same verb. The verb is her fear-word. It's not a verdict about you. It's her panic in vocabulary form." },
        ],
        drafts: [
          { label: "Direct", tone: "true · wounded", text: "Mom, at dinner when you said I wasted the semester, something broke in me I didn't tell you about. I didn't waste it. I survived it. There's a difference. I needed you to ask, not to grade." },
          { label: "Softer", tone: "warm · inviting repair", text: "Mom — can we talk about dinner last week? The 'wasted' comment has been sitting with me. I know you were worried. I just want to tell you what the semester actually was. Will you listen?" },
          { label: "Curious", tone: "honest question", text: "Mom, what did you think the semester was like for me? I realised we've never had the conversation, and I think you filled in the blanks with something that wasn't quite right." },
        ],
        nudge: "Lead with 'I didn't tell you something.' That disarms her fear-frame before it fires.",
        action: "Send tonight, before the next call.",
      }),
    },
    // 202 — Dad — missed the recital (waiting for response)
    {
      id: 202,
      rawText: "I'm sad that Dad missed my recital last month — I told him it was fine but I cried the whole drive home.",
      message: "Dad, you weren't at my recital last month. I told myself it was fine but I spent the whole drive home trying not to cry. I don't need an explanation. I just want you to know. And I want you to come next time.",
      person: DUMMY_FAMILY[0],
      createdAt: Date.now() - 86400000 * 20,
      sentAt: Date.now() - 86400000 * 20,
      transcript: makeTranscript({
        userText: "I'm really hurt that my dad missed my recital last month. He said it was work. I told him it was fine but it wasn't — I cried the whole drive home and I haven't said anything since. I don't know if he even knows how much it mattered.",
        coachOpener: "That drive home is the real recital.",
        coachBody: "The performance finished the second you walked offstage. What the drive home was — the crying, the not-calling, the thinking about him — that's the part he missed that you actually wanted him to see. Not the music. The wanting him there.",
        eyeText: "You didn't need him in the audience. You needed him in the fact of the day.",
      }),
      replay: makeReplay({
        seed: 12,
        angles: [
          { title: "The ISTJ frame", body: "ISTJ dads treat calendar conflicts as adult logistics — if he told work first, work wins. What he didn't compute is that the symbolic stakes outranked the logistics in your head.", mbtiFeatured: true },
          { title: "'It's fine' and what followed", body: "You protected him from your disappointment in real time. The cost was that he never got to see how much the day meant to you. Him not knowing is the thing you're actually carrying." },
          { title: "Why 'I want you there next time' is the key line", body: "This isn't a retrospective fight. It's a forward-looking contract. Moving the conversation from 'you missed it' to 'be there next' gives him a job, and ISTJs love jobs." },
          { title: "From a memory", body: "He missed your middle school graduation too, you told me. Pattern. What you're writing now is the letter 13-year-old you didn't know how to send." },
        ],
        drafts: [
          { label: "Direct", tone: "honest · direct", text: "Dad, you weren't at my recital. I told myself it was fine. I spent the whole drive home trying not to cry. I'm not asking for an apology. I'm asking you to be there next time. That's the ask." },
          { label: "Softer", tone: "quiet · real", text: "Dad — the recital last month was important to me in a way I didn't let you see. You couldn't come. I said it was fine. It wasn't. I just want the next one to have you in the row." },
          { label: "Curious", tone: "forward-facing", text: "Dad, when's a day in your calendar you'd clear for something like a recital? I'm asking because I want to schedule the next one when you can actually come." },
        ],
        nudge: "Don't relitigate. Make it a future booking.",
        action: "End with a specific next-time date.",
      }),
    },
    // 203 — Older Sister — the money that made me feel small (responded)
    {
      id: 203,
      rawText: "I'm frustrated that my older sister borrowed money last winter and I had to ask three times to get it back — it made me feel invisible to her.",
      message: "Unni, last winter you borrowed that money and never paid it back, and I hated that I had to ask. It wasn't the amount. It was how small I felt asking my sister for what was mine. I need us past this.",
      person: DUMMY_FAMILY[2],
      createdAt: Date.now() - 86400000 * 25,
      sentAt: Date.now() - 86400000 * 25,
      response: "She paid me back the next week and we actually talked for two hours. She said she'd been ashamed.",
      transcript: makeTranscript({
        userText: "I'm really annoyed that my sister borrowed money from me last winter and never paid it back. I had to bring it up three times. It made me feel so small each time — like asking my own sister for what's mine was somehow awkward. I haven't told her how much it hurt.",
        coachOpener: "Having to ask three times is its own separate injury.",
        coachBody: "The first ask is a transaction. The second is an awkwardness. By the third, you're performing a role you never agreed to — the accountant of your own sisterhood. That's the part that wears a groove. Not the money. The re-asking.",
        eyeText: "You weren't angry at the loan. You were grieving the ease of the relationship that the loan revealed wasn't there.",
      }),
      replay: makeReplay({
        seed: 13,
        angles: [
          { title: "The ENFP frame", body: "Your sister's avoidance isn't about the debt. It's about shame dressed as forgetfulness. ENFPs under shame disappear sideways — they pick up other topics until the original one atrophies.", mbtiFeatured: true },
          { title: "Why the amount is irrelevant", body: "You said 'it wasn't the money.' Believe yourself. The injury was that repayment required you to chase her, which re-coded the relationship from 'sisters' to 'creditor/debtor.' Nobody agreed to that." },
          { title: "What 'small' means", body: "Small meant: 'I am less important to her than her avoidance.' The dollar amount was just the receipt of that fact, not the fact itself." },
          { title: "From a memory", body: "She did the same thing with the plane ticket split in 2022. Same silence. Same you-initiating. This letter isn't just about last winter — it's about a pattern you're finally naming." },
        ],
        drafts: [
          { label: "Direct", tone: "real · sisterly", text: "Unni, the money last winter — it wasn't the amount, it was the three asks. I hated how small I felt chasing it. I don't want a repayment plan. I want us to not do this version of 'sisters' again." },
          { label: "Softer", tone: "open · warm", text: "Unni, can we talk about last winter? Not the loan — the silence around it. It's been sitting with me and I think it's been sitting with you too. Let's just name it and be done with it." },
          { label: "Curious", tone: "inviting", text: "Unni — what made the money hard for you? I don't think it was the money either. I'd rather have that conversation than the math one." },
        ],
        nudge: "ENFPs respond to warmth + specificity. Don't generalise — name the winter.",
        action: "Invite her to coffee first, then write the letter if it doesn't land.",
      }),
    },
    // 204 — Older Brother — the day Dad yelled (still waiting)
    {
      id: 204,
      rawText: "I'm really hurt that when Dad yelled at me last spring, Hyung just sat there and watched — I felt completely alone in that room.",
      message: "Hyung, I know you didn't want to get dragged into the fight with Dad last spring. But I was alone in that room and you were right there. I'm not mad. I just need you to know it mattered that you stayed quiet.",
      person: DUMMY_FAMILY[3],
      createdAt: Date.now() - 86400000 * 30,
      sentAt: Date.now() - 86400000 * 30,
      transcript: makeTranscript({
        userText: "I'm sad that my brother was in the room when Dad yelled at me last spring and he didn't say a single word. I understand he didn't want to get involved. But I was alone in that room and he was right there. He's never brought it up since and it's been weighing on me.",
        coachOpener: "A witness who stays silent is its own kind of participant.",
        coachBody: "INTPs avoid conflict by going statue. He probably thinks staying out of it protected the peace. The math he didn't do is that staying out of it left you holding the whole moment alone, which was a different injury than the original yelling.",
        eyeText: "You don't need him to relitigate Dad. You need him to acknowledge that he was in the room too.",
      }),
      replay: makeReplay({
        seed: 14,
        angles: [
          { title: "The INTP frame", body: "INTPs don't intervene in emotional scenes because they distrust their own real-time judgment. He wasn't dismissing you — he was frozen. But freeze looks like indifference from the receiving end.", mbtiFeatured: true },
          { title: "Witness vs. bystander", body: "The painful part isn't his silence during. It's his silence after. If he had texted you that night — 'hey, that was rough' — you wouldn't be writing this now. One sentence would've flipped him from bystander to witness." },
          { title: "What you're actually asking for", body: "Not 'stand up to Dad next time.' That's unrealistic and maybe unfair. You're asking: 'tell me you saw it.' Those are two very different asks, and he can give you the second easily." },
          { title: "From a memory", body: "You said he did this in high school too when Mom lost it about your grades. Same freeze, same no-follow-up. Pattern. Nameable. Fixable." },
        ],
        drafts: [
          { label: "Direct", tone: "plain · low-heat", text: "Hyung — the thing with Dad last spring. You were in the room. You didn't say anything. I get why. I just need to hear that you saw it. One sentence is enough." },
          { label: "Softer", tone: "brotherly · matter-of-fact", text: "Hyung, small thing. The fight with Dad in April — I've been waiting for you to mention it and I realised you probably never will unless I bring it up. I'm not mad. I just want us on the record that it happened." },
          { label: "Curious", tone: "even", text: "Hyung — what did you see that day with Dad? I'm curious what your version of the room looks like, because we've never talked about it." },
        ],
        nudge: "INTPs hate emotional stakes. Make it a data request: 'tell me what you saw.'",
        action: "Ask in text — he'll need time to compose a reply.",
      }),
    },
    // 205 — Younger Brother — the joke at Chuseok (responded)
    {
      id: 205,
      rawText: "I'm really angry that my little brother called me 'boring' at Chuseok in front of everyone — I laughed at the table but I cried in the bathroom for twenty minutes.",
      message: "Yerin, you called me boring at Chuseok in front of everyone and I laughed, and then I went and cried in the bathroom for twenty minutes. I'm sick of being the joke. I'm your hyung. Talk to me like one.",
      person: DUMMY_FAMILY[5],
      createdAt: Date.now() - 86400000 * 38,
      sentAt: Date.now() - 86400000 * 38,
      response: "He apologised two days later. Said he hadn't realised I'd heard it that way. We haven't fully repaired but it's in progress.",
      transcript: makeTranscript({
        userText: "I'm so hurt that my younger brother called me 'boring' at Chuseok in front of the whole family. I laughed at the table so no one would notice. Then I cried in the bathroom for twenty minutes. I'm sick of being the punchline in our family.",
        coachOpener: "Laughing at the table and crying in the bathroom are the same defence.",
        coachBody: "You performed fine so the family dinner wouldn't have to contain your hurt. The cost is that you ended up alone with it anyway, just in a different room. That's the double tax of being the one who keeps the peace.",
        eyeText: "ESTPs use teasing as bonding. He probably thought he was including you in the bit. What you got was a vote on your worth, said out loud in front of people whose opinions you actually care about.",
      }),
      replay: makeReplay({
        seed: 15,
        angles: [
          { title: "The ESTP frame", body: "ESTP brothers joke as a love language. The joke at Chuseok was 'I'm comfortable with you.' You received it as 'this is what you are.' Same sentence, two languages.", mbtiFeatured: true },
          { title: "Why 'boring' was the specific bruise", body: "'Boring' is an identity word, not a behaviour word. If he'd said 'you're being boring tonight,' it'd slide off. 'You're boring' stamps a whole shape on you — and at a family table, with witnesses." },
          { title: "The bathroom", body: "Twenty minutes alone after a joke is a signal, not an overreaction. Your body ran to find privacy because the table had become unsafe. That's information about the table, not about you being 'sensitive.'" },
          { title: "From a memory", body: "He did the same thing last Seollal with the 'grumpy' bit. This isn't one Chuseok. This is a pattern of you being his punchline and him not realising you've stopped laughing." },
        ],
        drafts: [
          { label: "Direct", tone: "big-brother · firm", text: "Yerin, at Chuseok you called me boring in front of everyone. I laughed. I cried in the bathroom for twenty minutes after. I'm done being the joke. Pick something else to bond over." },
          { label: "Softer", tone: "honest · inviting", text: "Yerin, small thing but it's not small. The 'boring' joke at Chuseok — I laughed at the table and then went and cried. I know you didn't mean it that way. I'm telling you so next time you can reach for a different joke." },
          { label: "Curious", tone: "real question", text: "Yerin — when you call me boring in front of people, what are you hoping they'll think of you? I'm asking because I realised I don't know, and I think knowing would help us." },
        ],
        nudge: "ESTPs tune out once they feel lectured. Keep it short, give him an action, end it.",
        action: "Tell him alone, not in the group chat.",
      }),
    },
    // 206 — Grandma — the food-but-not-time bruise (responded)
    {
      id: 206,
      rawText: "I'm lonely that I drove four hours to see Halmoni and she spent the entire visit in the kitchen instead of sitting with me.",
      message: "Halmoni, the last visit was so hard because I came home wanting hours with you and I got a feast instead. I love the food. I love the feeding me. I love you more. Please sit with me next time.",
      person: DUMMY_FAMILY[7],
      createdAt: Date.now() - 86400000 * 45,
      sentAt: Date.now() - 86400000 * 45,
      response: "She sat down for the whole next meal. Didn't say much. Held my hand under the table.",
      transcript: makeTranscript({
        userText: "I'm so lonely because I drove four hours to see my grandma and she spent the whole visit in the kitchen. I wanted her time, not her food. I left feeling more alone than before I came. I feel guilty even feeling this because she cooks out of love, but I came for her, not the meal.",
        coachOpener: "You're allowed to want the love in the shape you need.",
        coachBody: "Food is how she knows she's welcoming you. That's real love, and you're right to honour it. It's also real that the welcome you needed was her at the table, not her at the stove. Two real things can coexist — and one of them can still leave you lonely.",
        eyeText: "The loneliness isn't ingratitude. It's the gap between the love that arrived and the love you came for.",
      }),
      replay: makeReplay({
        seed: 16,
        angles: [
          { title: "The ESFJ frame", body: "ESFJ grandmothers fear being useless more than being tired. Sitting down feels to her like clocking out. You have to give her permission to rest without it meaning retirement.", mbtiFeatured: true },
          { title: "Food as armour", body: "When she doesn't know what to say, she makes more. The kitchen is a refuge for her too. It lets her love you without having to find the words she doesn't know she has." },
          { title: "Ask for the small unit", body: "Don't ask her to change the whole visit. Ask for one specific meal where she sits. 'One meal' is a shape she can commit to; 'eat with me more' is abstract and loses." },
          { title: "From a memory", body: "You said she sat with you during the tea ceremony after your acceptance. She can do this. She just needs the moment to be marked as one worth stopping for." },
        ],
        drafts: [
          { label: "Direct", tone: "tender · clear", text: "Halmoni, next visit please sit with me for one meal. I came home for you, not for the food. The food is the bonus. You are the reason." },
          { label: "Softer", tone: "sweet · coaxing", text: "Halmoni — I have a request for next month. Make whatever you want, but the first meal we eat together sitting down. No getting up. I'll do the cleaning after. Promise." },
          { label: "Curious", tone: "gentle", text: "Halmoni, what's it like for you when you sit down to eat with me? I realised we almost never do it, and I wondered if there's a reason I've missed." },
        ],
        nudge: "ESFJ grandmothers love a framed small commitment. Don't ask for more time — ask for one bounded ritual.",
        action: "Send it as a handwritten card. It matters to her.",
      }),
    },
  ];

  // ── 영구 저장 데이터 (localStorage 초기값으로 로드, 더미 fallback) ──
  const [familyMembers, setFamilyMembers] = useState(() => load('hv_familyMembers', DUMMY_FAMILY));
  const [vesselEntries, setVesselEntries]   = useState(() => load('hv_vesselEntries', DUMMY_VESSEL));
  const [archiveEntries, setArchiveEntries] = useState(() => load('hv_archiveEntries', DUMMY_ARCHIVE));

  // ── 세션 데이터 (저장 불필요) ──
  const [currentPerson, setCurrentPerson]     = useState(null);
  const [currentAnalysis, setCurrentAnalysis] = useState(null);
  const [chatDraft, setChatDraft]             = useState('');
  const [editingMember, setEditingMember]         = useState(null); // 수정 중인 멤버
  const [selectedFamilyMember, setSelectedFamilyMember] = useState(null); // 상세 보기 멤버
  const [selectedVesselEntry, setSelectedVesselEntry]   = useState(null);
  const [selectedArchiveEntry, setSelectedArchiveEntry] = useState(null);
  // Replay payload — when set, ChatScreen mounts in read-only replay
  // mode and hydrates its observation / analysis / drafting state from
  // this entry's `replay` block instead of starting a fresh chat. Lets
  // the user re-enter a saved Vessel/Archive entry and see the exact
  // three-card chat surface as it looked at commit time (per user:
  // "저길 들어가면 2,3,4번 이미지처럼 내가 했던 대화 그대로 똑같이
  // 들어가있어야돼. 하나도 바뀌는거 없이"). Cleared on goHome() and
  // whenever ChatScreen unmounts so a subsequent fresh chat doesn't
  // inherit stale replay state.
  const [replayEntry, setReplayEntry]                   = useState(null);
  // replaySource — where the replayEntry was opened FROM ('vessel' |
  // 'archive' | null). ChatScreen uses this to decide which commit
  // affordance to render at the bottom of a replay session: a vessel
  // entry being re-read only needs a "Move to Archive" button (the
  // entry is already in Vessel), whereas a chat opened fresh shows
  // the full Vessel + Archive dual rail. Null outside of replay.
  const [replaySource, setReplaySource]                 = useState(null);
  // Vessel 상세 확장 상태를 App 레벨까지 끌어올린다. 공유 캐릭터(SharedCharacter)
  // 가 Vessel 확장 순간 잠시 사라져야 하는데, 그 엘리먼트는 App.jsx에 살고
  // VesselScreen 밖에 있어서 내부 state에 접근할 수 없다. 그래서 Vessel이
  // isExpanded를 이 플래그로 동기화한다.
  const [vesselExpanded, setVesselExpanded]   = useState(false);

  // ── localStorage 동기화 ──
  useEffect(() => { save('hv_familyMembers', familyMembers); }, [familyMembers]);
  useEffect(() => { save('hv_vesselEntries', vesselEntries); }, [vesselEntries]);
  useEffect(() => { save('hv_archiveEntries', archiveEntries); }, [archiveEntries]);

  // ── 네비게이션 ──
  function navigate(to) {
    setScreenHistory(prev => [...prev, screen]);
    setScreen(to);
  }

  function goBack() {
    setScreenHistory(prev => {
      const next = [...prev];
      const last = next.pop();
      if (last) setScreen(last);
      return next;
    });
    // If we're leaving the chat screen, clear replay state so the next
    // entry (either a fresh chat started from home or a different
    // saved-entry replay) doesn't inherit a stale frozen payload.
    // Done here instead of in ChatScreen's unmount to avoid a
    // StrictMode race in dev — the effect-cleanup simulation fires
    // during the first mount and clears context before the real UI
    // stabilises, which flipped replayMode mid-session.
    if (screen === 'chat') {
      setReplayEntry(null);
      setReplaySource(null);
    }
  }

  function goHome() {
    setScreenHistory([]);
    // Clear replay state on home-return so a fresh chat session
    // isn't poisoned by a previously-viewed archived entry.
    setReplayEntry(null);
    setReplaySource(null);
    setScreen('home');
  }

  // ── 가족 멤버 ──
  function addFamilyMember(member) {
    setFamilyMembers(prev => [...prev, { ...member, id: Date.now() }]);
  }

  function removeFamilyMember(id) {
    setFamilyMembers(prev => prev.filter(m => m.id !== id));
  }

  function updateFamilyMember(id, updates) {
    setFamilyMembers(prev => prev.map(m => m.id === id ? { ...m, ...updates } : m));
  }

  // ── Vessel / Archive ──
  function addVesselEntry(entry) {
    setVesselEntries(prev => [{ ...entry, id: Date.now() }, ...prev]);
  }

  function addArchiveEntry(entry) {
    setArchiveEntries(prev => [{ ...entry, id: Date.now(), sentAt: Date.now() }, ...prev]);
  }

  function moveToArchive(vesselEntryId) {
    setVesselEntries(prev => {
      const entry = prev.find(e => e.id === vesselEntryId);
      if (entry) {
        setArchiveEntries(a => [{ ...entry, sentAt: Date.now() }, ...a]);
      }
      return prev.filter(e => e.id !== vesselEntryId);
    });
  }

  function updateArchiveEntry(id, updates) {
    setArchiveEntries(prev => prev.map(e => e.id === id ? { ...e, ...updates } : e));
  }

  return (
    <AppContext.Provider value={{
      screen, navigate, goBack, goHome,
      familyMembers, addFamilyMember, removeFamilyMember, updateFamilyMember,
      editingMember, setEditingMember,
      selectedFamilyMember, setSelectedFamilyMember,
      currentPerson, setCurrentPerson,
      currentAnalysis, setCurrentAnalysis,
      chatDraft, setChatDraft,
      vesselEntries, addVesselEntry, addArchiveEntry, moveToArchive,
      archiveEntries, updateArchiveEntry,
      selectedVesselEntry, setSelectedVesselEntry,
      selectedArchiveEntry, setSelectedArchiveEntry,
      replayEntry, setReplayEntry,
      replaySource, setReplaySource,
      vesselExpanded, setVesselExpanded,
    }}>
      {children}
    </AppContext.Provider>
  );
}

export function useApp() {
  return useContext(AppContext);
}
