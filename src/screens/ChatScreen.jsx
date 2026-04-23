import { useApp } from '../store/AppContext';
import { useState, useRef, useEffect, useLayoutEffect, useMemo, Fragment } from 'react';
import { chatWithCoach, generateGuidedDraft, analyzePerspective } from '../utils/claude';
import styles from './ChatScreen.module.css';
import BackButton from '../components/BackButton';

/* ──────────────────────────────────────────────────────────────
   tweenScrollTop — custom-duration smooth scroll.

   The browser's built-in `scrollTo({behavior:'smooth'})` ships a
   ~300ms snap with no easing knob. For the hero → card transition
   that pace was reading as "the bubble just disappeared" (user
   feedback: "이 카드가 딱 바로 위로 붙어버리니까... 채팅 박스가 그냥 사라진
   거같은 느낌"). We want a slower, deliberate ride — the user sees
   their bubble VISIBLY travel upward instead of vanishing — so we
   drive scrollTop ourselves with a longer duration and an expo
   out-ease (the same easing the rest of the app uses for arrivals).
   ─────────────────────────────────────────────────────────── */
const easeOutExpo = (t) => (t === 1 ? 1 : 1 - Math.pow(2, -10 * t));

function tweenScrollTop(el, targetTop, duration = 900, ease = easeOutExpo) {
  if (!el) return;
  const startTop = el.scrollTop;
  const distance = targetTop - startTop;
  if (Math.abs(distance) < 0.5) return;
  const startTime = performance.now();
  function step(now) {
    const elapsed = now - startTime;
    const t = Math.min(1, elapsed / duration);
    el.scrollTop = startTop + distance * ease(t);
    if (t < 1) requestAnimationFrame(step);
  }
  requestAnimationFrame(step);
}

/* Word-reveal constants — shared by the hero card rendering and the
   derived delays (divider, CTA). Kept at module scope so the CSS
   and JSX stay in lockstep without prop-drilling magic numbers.

   Per user ("thinking하는 과정의 시간이 너무 길어. 좀 더 효율적으로
   빠르게 해"): the whole thinking→reveal sequence was trimmed ~42%.
   Pair-edits made alongside this constant change:
     - .heroCharSlot margin-top transition  1.4s → 0.85s
     - .heroCharImg  width/height transitions 1.4s → 0.85s
     - hero scroll tween: 200ms delay / 1200ms dur → 80ms / 720ms
     - heroNextEntered fallback timer: 6000ms → 3500ms
   All four live in ChatScreen.module.css / ChatScreen.jsx and must
   move together — the character's ride clock is what BASE_DELAY_MS
   is sized against.

   BASE_DELAY_MS 600 (was 1050) — first word starts revealing AFTER
     the character has nearly finished its 0.85s thinking→settled
     ride. This sequencing means the user's eye follows the character
     first, and the text only starts writing once the character has
     taken its seat above. Avoids the busy look of text arriving
     while the character is still travelling.
   WORD_GAP_MS 30 (was 48) — faster per-word cascade. Reads as
     deliberate but no longer leisurely; over a 30-word observation
     this saves ~540ms versus the previous value. */
const BASE_DELAY_MS = 600;
const WORD_GAP_MS   = 30;

const countWords = (s) => (s ? (s.match(/\S+/g) || []).length : 0);

/* ──────────────────────────────────────────────────────────────
   Keyword extractor — feeds the .heroKeywords pill row below the
   observation body. Takes the free-form reply text, strips stop-
   words, and returns up to `max` distinctive words in reading
   order. Intentionally dumb (no POS tagging, no TF-IDF): we're
   pulling small "tag" pills out of a single paragraph, and the
   extracted words just need to evoke the theme — precision isn't
   needed.

   Per user: "첫 카드 밑에 약간 키워드 같은거 넣어볼까? 알약 모양
   으로 해서 흰색 스트로크 줘서 말이야." — the pills are decorative
   summary, not a functional affordance.

   Design choices:
     • Minimum word length 4 so one-letter fragments and 2-3 letter
       filler words (mom, you, it) don't polute the result.
     • Dedupes (case-insensitive) while preserving first-seen order.
     • Title-cases the output so pills read as nouns/phrases, not
       stream-of-consciousness prose.
     • Korean fallback: lower-casing + basic punctuation strip works
       on Hangul too (regex is Unicode-aware). No stopword list for
       Korean in this pass — if the app ships in Korean the body
       text is typically short enough that any 3 long words land
       reasonable pills.
   ────────────────────────────────────────────────────────────── */
const KEYWORD_STOPWORDS = new Set([
  'the','that','this','these','those','there','their','them','they','then','than',
  'with','without','from','into','onto','over','under','after','before','because',
  'when','while','what','where','which','whose','whom','your','yours','about',
  'been','being','have','has','had','does','did','doing','done','will','would',
  'could','should','might','must','just','only','very','really','still','always',
  'never','ever','even','some','such','here','like','also','more','most','much',
  'many','other','another','each','both','either','neither','kind','sort',
  'something','someone','somewhere','anything','everything','nothing','thing',
  'things','moment','moments','time','times','way','ways','feel','feels','felt',
  'feeling','feelings','thought','thoughts','thinking','knew','know','known',
  'saying','said','says','tell','told','telling','talk','talked','talking',
  'make','makes','made','making','come','came','comes','coming','going','went',
  'gone','look','looks','looked','looking','seem','seems','seemed','seeming',
  'mine','ours','yours','theirs',
]);
function extractKeywords(text, max = 3) {
  if (!text) return [];
  const tokens = text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 4 && !KEYWORD_STOPWORDS.has(w));
  const seen = new Set();
  const out = [];
  for (const w of tokens) {
    if (seen.has(w)) continue;
    seen.add(w);
    out.push(w.charAt(0).toUpperCase() + w.slice(1));
    if (out.length >= max) break;
  }
  return out;
}

/* ──────────────────────────────────────────────────────────────
   MBTI character asset lookup.

   Assets live in /public/asset/mbti characters/, named like:
     Analysts_ENTJ (Commander) Woman.png
     Diplomats_INFP (Mediator) Man.png
     Sentinals_ISFJ (Defender) Woman.png   (note: "Sentinals" typo in files)
     Explorers_ESTP (Entrepreneur) Man.png

   The set is 16 MBTI × 2 genders = 32 files, with two asymmetries:
     - ENTJ has no Man file (folder ships Woman + Woman-1 variants) →
       fall back to Woman for ENTJ-male recipients.
     - ESFP has no Woman file (ships Man + Man-1 variants) → fall back
       to Man for ESFP-female recipients.

   MBTI_META encodes the category prefix and personality-name token
   each MBTI uses in its filename, so callers just supply the 4-letter
   code + gender and we compose the exact filepath.
   ─────────────────────────────────────────────────────────── */
const MBTI_META = {
  INTJ: { cat: 'Analysts',  name: 'Architect'    },
  INTP: { cat: 'Analysts',  name: 'Logician'     },
  ENTJ: { cat: 'Analysts',  name: 'Commander'    },
  ENTP: { cat: 'Analysts',  name: 'Debater'      },
  INFJ: { cat: 'Diplomats', name: 'Advocate'     },
  INFP: { cat: 'Diplomats', name: 'Mediator'     },
  ENFJ: { cat: 'Diplomats', name: 'Protagonist'  },
  ENFP: { cat: 'Diplomats', name: 'Campaigner'   },
  ISTJ: { cat: 'Sentinals', name: 'Logistician'  },
  ISFJ: { cat: 'Sentinals', name: 'Defender'     },
  ESTJ: { cat: 'Sentinals', name: 'Executive'    },
  ESFJ: { cat: 'Sentinals', name: 'Consul'       },
  ISTP: { cat: 'Explorers', name: 'Virtuoso'     },
  ISFP: { cat: 'Explorers', name: 'Adventurer'   },
  ESTP: { cat: 'Explorers', name: 'Entrepreneur' },
  ESFP: { cat: 'Explorers', name: 'Entertainer'  },
};

function getMbtiImageSrc(mbti, gender) {
  if (!mbti || typeof mbti !== 'string') return null;
  const code = mbti.trim().toUpperCase();
  const meta = MBTI_META[code];
  if (!meta) return null;
  let g = gender === 'Woman' ? 'Woman' : 'Man';
  // Asset-map gaps → pick the variant that actually exists on disk.
  if (code === 'ENTJ' && g === 'Man')   g = 'Woman';
  if (code === 'ESFP' && g === 'Woman') g = 'Man';
  return `/asset/mbti characters/${meta.cat}_${code} (${meta.name}) ${g}.png`;
}

/* Gender inference — the person record has no explicit gender field,
   so we derive it from relation (primary) + name (fallback). The lists
   cover common English + Korean kinship terms; anything unmatched
   defaults to 'Man' so we always have SOME image to render rather
   than silently hiding the visual. Order matters: masculine checked
   first, but since the two keyword sets don't share substrings that
   would cross-match (e.g. "grandmother" only hits "mother" not
   "father"), the outcome is stable either way. */
function inferGender(person) {
  const probe = `${person?.relation || ''} ${person?.name || ''}`.toLowerCase();
  const MASCULINE = [
    'grandfather', 'father', 'dad', 'papa',
    'husband', 'son', 'brother', 'grandpa', 'grandson',
    'uncle', 'nephew', 'boyfriend',
    '아빠', '아버지', '남편', '아들', '형', '오빠', '남동생', '할아버지', '삼촌', '고모부', '이모부', '남자친구',
  ];
  const FEMININE = [
    'grandmother', 'mother', 'mom', 'mama', 'mum',
    'wife', 'daughter', 'sister', 'grandma', 'granddaughter',
    'aunt', 'niece', 'girlfriend',
    '엄마', '어머니', '아내', '와이프', '딸', '언니', '누나', '여동생', '할머니', '이모', '고모', '여자친구',
  ];
  for (const k of MASCULINE) if (probe.includes(k)) return 'Man';
  for (const k of FEMININE)  if (probe.includes(k)) return 'Woman';
  return 'Man';
}

/* ──────────────────────────────────────────────────────────────
   FAKE_MEMORIES_BY_INDEX — placeholder "past memory" references.

   One of the app's concepts is that Heart Vessel remembers past
   things the user chatted about with a given person, and grounds
   new analysis angles in those remembered events (a callback
   breadcrumb like "this angle is informed by the time you told
   me about X"). The real pipeline will pull these from the
   persisted chat history + a retrieval layer once that's built;
   for now we show static placeholders so the UI reads as
   memory-aware. Per user: "일단 데이터가 없으니 지어내."

   Indexed 0-3 because the angle deck ships 4 cards. Index 0 is
   the MBTI-featured card and already carries its own visual
   (the character illustration), so we return null there — the
   memory chip only appears on pages 02-04. The titles stay
   relation-agnostic so the same placeholders read plausibly
   whether the recipient is a parent, sibling, partner, etc.
   ─────────────────────────────────────────────────────────── */
/* Only ONE card carries a past-memory reference now (the last one,
   index 3). Per user pivot: "from a memory는 하나의 카드에만
   들어가게 하자. 아예 이전 기록이 메인으로 들어가는 페이지인거지."
   The memory card is no longer a breadcrumb pattern spread across
   pages 02-04 — it's a dedicated perspective where the past event
   IS the headline, and the body analyzes the current situation
   through that lens. Other pages stay memory-agnostic. */
const FAKE_MEMORIES_BY_INDEX = [
  null,
  null,
  null,
  { title: 'His first-job story' },
];

/* ──────────────────────────────────────────────────────────────
   ANGLE_THEME_SHAPES — gradient-shape imagery for the non-MBTI
   angle cards (deck pages 02-04).

   The earlier version of this slot tried to ship bespoke inline
   SVGs (shield / ripple / sprout). User feedback on that approach:
   "너가 만든 애들은 삭제해. 퀄리티가 너무 낮아" — hand-authored
   vectors couldn't match the visual quality of the rest of the
   app's 3D-rendered artwork. Instead we now pull from the
   pre-existing `/asset/gradient shapes/` library (8 blurred
   gradient PNGs) and pick 3 at random per analysis mount.

   Why file paths, not imported modules:
   - These assets live in /public, so Vite just serves them as-is
     via their absolute URL. Importing would force them through
     the bundler for no benefit.
   - The filename format `gradient-shape-blur [Converted]-NN.png`
     contains spaces + brackets; the browser handles those fine
     as a URL (no encoding needed when the asset is under /public
     and the browser already decoded the path once).

   The "random per analysis" selection is implemented via useMemo
   inside ChatScreen keyed on the analysis' identity — see the
   `themeShapes` memo further down. That way the user gets a fresh
   triplet every time they open a new analysis, but the triplet
   stays stable across re-renders / swipes within that analysis
   (so pages 02-04 don't reshuffle mid-session).

   Source pool: actual PNGs that exist under /public/asset/gradient
   shapes/Shape/. The folder is NOT a contiguous 01-36 range — the
   real filenames skip many numbers (06, 07, 08, 09, 10, 11, 12, 14,
   15, 16, 17, 19, 22, 23, 27 are all absent). An earlier version of
   this list was generated with Array.from({length: 36}), which
   fabricated paths to missing files; Vite's dev server then fell
   back to serving /index.html for those paths (200 OK with text/html
   body), and the browser rendered a broken-image glyph for any
   card whose random pick happened to land on a missing number.

   Fix per user ("지금 이런식으로 이미지 못찾는 오류가 있는거같은데,
   다시 점검하고 등록해"): hand-list the files that genuinely exist
   on disk. Verified by `ls` against the filesystem. If new Shape
   files are added later — or existing ones removed — update this
   array explicitly rather than reaching for a range generator; the
   source folder's numbering gaps make ranges unsafe.

   Last sync: per user "Shape파일 다시 점검. 내가 몇개 또 삭제해서
   그런거같아" — resynced after another deletion pass. Removed
   01, 03, 20, 26, 28 which are no longer on disk. 11 files remain.
   Previous pass had dropped 05, 13, 31, 34. */
const GRADIENT_SHAPE_NUMS = [
  '02', '04', '18', '21', '24', '25',
  '30', '32', '33', '35', '36',
];
const GRADIENT_SHAPE_SRCS = GRADIENT_SHAPE_NUMS.map(
  (n) => `/asset/gradient shapes/Shape/Shape ${n}.png`,
);

/* Fisher–Yates shuffle + take N. Kept as a helper so the useMemo
   call site stays readable. Doesn't mutate the input. */
function pickRandomShapes(n) {
  const pool = GRADIENT_SHAPE_SRCS.slice();
  for (let i = pool.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  return pool.slice(0, n);
}

/* ──────────────────────────────────────────────────────────────
   TypedCoachText — ChatGPT 스타일 타이핑 렌더러.
   coach 의 prose (empathy reply + eye-section) 를 글자 단위로 드러낸다.

   왜 카드 안 "표현 블록" 을 따로 컴포넌트로 뽑나:
   - state(cursor)를 메시지 단위로 보유해야 해서. map 안에서 useState 금지.
   - onDone 콜백으로 부모에게 "타이핑 다 됐음" 을 알려줘야
     선택지/직접입력/dig 버튼이 stagger fade-up 으로 이어지게 됨.
   - 타이핑 중엔 markdown 파싱을 건너뛰고 원문 텍스트에서 `**` 만 지워
     깨지지 않은 중간 상태로 보여준다. 완료 시에만 bold/paragraph 포맷.

   onTick: 글자가 한 칸 나아갈 때마다 부모가 스크롤을 바닥으로 당기게
     하는 콜백. 장문일 때 사용자가 텍스트가 올라오는 걸 놓치지 않도록.
   ─────────────────────────────────────────────────────────── */
function TypedCoachText({ text, eyeText, onDone, onTick }) {
  const full = text + (eyeText ? '\n\n' + eyeText : '');
  const [cursor, setCursor] = useState(0);
  const doneRef = useRef(false);
  // ref 로 감싸서 callback identity 가 바뀌어도 typing 타이머가 재시작되지
  // 않게 한다. 부모 re-render 마다 새 함수가 들어와도 안전.
  const onDoneRef = useRef(onDone);
  const onTickRef = useRef(onTick);
  onDoneRef.current = onDone;
  onTickRef.current = onTick;

  useEffect(() => {
    if (cursor >= full.length) {
      if (!doneRef.current) {
        doneRef.current = true;
        onDoneRef.current?.();
      }
      return;
    }
    // 첫 글자 전에 짧은 간격 — 캐릭터 rise-in 끝나기 직전쯤 타이핑이
    // 시작하도록. 이후엔 14ms/char 로 꽤 빠르게 흘린다 (ChatGPT 감각).
    // 줄바꿈이나 공백 뒤엔 살짝 리듬감을 주기 위해 조금 더 긴 pause.
    const prev = full[cursor - 1];
    const isPause = prev === '.' || prev === '!' || prev === '?' || prev === ',';
    const delay = cursor === 0 ? 380 : isPause ? 90 : 14;
    const id = setTimeout(() => {
      setCursor(c => c + 1);
      onTickRef.current?.();
    }, delay);
    return () => clearTimeout(id);
  }, [cursor, full]);

  const renderInline = (t) => {
    const parts = t.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((p, i) =>
      p.startsWith('**') && p.endsWith('**')
        ? <strong key={i} className={styles.coachBold}>{p.slice(2, -2)}</strong>
        : p
    );
  };

  if (cursor >= full.length) {
    // 완성 — bold/paragraph 포맷으로 교체
    const ps = text.split(/\n\n+/);
    return (
      <>
        {ps.length <= 1
          ? renderInline(text)
          : ps.map((p, i) => (
              <span key={i} className={styles.coachParagraph}>{renderInline(p.trim())}</span>
            ))}
        {eyeText && (
          <span className={styles.coachParagraph}>{renderInline(eyeText)}</span>
        )}
      </>
    );
  }

  // 타이핑 중 — plain text + blinking cursor
  const shown = full.slice(0, cursor).replace(/\*\*/g, '');
  return (
    <>
      {shown}
      <span className={styles.typingCursor} aria-hidden="true" />
    </>
  );
}

/* ──────────────────────────────────────────────────────────────
   splitEmphasis — pull-quote typography splitter.

   The Figma hero quote mixes italic PP Editorial New with sans
   PP Neue Montreal on the SAME line (e.g. "*That's frustrating,*
   especially when you were opening up about *something that
   matters to you.*"). Two conventions feed it:

   1. `**phrase**` markers in the coach reply → italic serif span.
      The Claude prompt already uses bold for emphasis; we just
      reinterpret that visual role as italic serif here.
   2. If no markers are present, we auto-italicise the OPENING
      clause (short run ending in `,` or `.` within ~32 chars).
      This mirrors the Figma pattern of starting with a short
      italic empathy beat.

   Returns an array of runs: [{italic: boolean, text: string}].
   ─────────────────────────────────────────────────────────── */
function splitEmphasis(text) {
  if (!text) return [];
  // Explicit markers win.
  if (/\*\*[^*]+\*\*/.test(text)) {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts
      .filter(p => p.length > 0)
      .map(p => {
        const italic = p.startsWith('**') && p.endsWith('**');
        return { italic, text: italic ? p.slice(2, -2) : p };
      });
  }
  // Fallback: ALWAYS italicise the opening sentence — it's the
  // emotional hit. First sentence terminator (. ! ?) closes the run,
  // rest of the message runs as the body.
  //
  // BUT: single-word / ultra-short openers like "Ouch." or "Oof."
  // read as a one-word italic and look broken in the card (user
  // feedback: "첫번째 문장은 지금처럼 한 단어만 나오면 안돼"). When the
  // first sentence is < 4 words, we greedily pull the SECOND sentence
  // into the italic opener too — so "Ouch. That golf thing hurts."
  // becomes one italic run rather than "Ouch." italic + rest body.
  const m = text.match(/^([^.!?\n]+[.!?]['")\]]?)(\s+)(.*)$/s);
  if (m && m[3].trim().length > 0) {
    const firstWords = m[1].trim().split(/\s+/).filter(Boolean).length;
    if (firstWords < 4) {
      // Try to absorb sentence #2 into the opener. Regex: two full
      // sentences joined by whitespace, then tail.
      const combo = text.match(/^([^.!?\n]+[.!?]['")\]]?\s+[^.!?\n]+[.!?]['")\]]?)(\s+)(.*)$/s);
      if (combo && combo[3].trim().length > 0) {
        return [
          { italic: true,  text: combo[1] },
          { italic: false, text: combo[2] + combo[3] },
        ];
      }
      // Only 2 sentences total → italicise both, no body.
      const two = text.match(/^([^.!?\n]+[.!?]['")\]]?\s+[^.!?\n]+[.!?]['")\]]?)\s*$/s);
      if (two) return [{ italic: true, text: two[1] }];
    }
    return [
      { italic: true,  text: m[1] },
      { italic: false, text: m[2] + m[3] },
    ];
  }
  return [{ italic: true, text }];
}

/* ──────────────────────────────────────────────────────────────
   analyzeDraftFit — local, zero-latency "does this reach them?"
   heuristic for the Words card's Fit Check panel. Per user:
   "뭔가 키워드나 그래프? 뭐 시각적으로 지금 글이 상대방 특성을
   고려했을때 괜찮은지 그런거를 말해주면 좋겠어. 뭔가 우리 메인
   캐릭터가 어딘가에 위치해있고 그 친구가 지금 글이 어떤지
   평가해주듯이 그런게 있으면 재밌을거같은데."

   Kept purely client-side (no API round-trip) so the meter can
   update live as the user edits — an LLM call per keystroke
   would be both expensive and laggy. The heuristic leans on a
   handful of cheap lexical signals (warmth verbs, "I" vs
   accusatory "you always/never", softeners, length, questions)
   cross-referenced with the recipient's MBTI to tilt the
   weighting (introverts prefer softeners, feelers reward warmth
   and questions, etc.). The output is a score (0–100), a short
   one-line verdict the character "speaks", and 2–3 keyword
   chips that read as detected signals — enough visual detail
   to feel informative without pretending to be a grader.
   ─────────────────────────────────────────────────────────── */
function analyzeDraftFit(text, person) {
  const raw = (text || '').trim();
  if (!raw) {
    return {
      score: 0,
      verdict: 'start typing — i\'ll read along',
      chips: [],
      issues: [],
      empty: true,
    };
  }
  const t = text.toLowerCase();
  const wordCount = (t.match(/\S+/g) || []).length;

  // ── Issue scan — problematic spans the character flags in red.
  //    Per user: "제거했으면 하는 부분은 빨갛게 표시해주면
  //    좋을거같아. 이유도 알려주고 저 캐릭터 말풍선 같은거에서
  //    말이야." Each issue carries an offset range so we can paint
  //    a red highlight behind those characters via a mirror-div,
  //    plus a short human reason the character speaks when that
  //    issue is the "top concern" right now.
  //
  //    Patterns deliberately conservative: only flag things that
  //    almost always hurt the delivery ("you always", ALL CAPS,
  //    absolutes, stacked exclamations, harsh labels). Nothing
  //    borderline — over-flagging would turn the editor into a
  //    red mess and make the tool feel nannying.
  const issues = [];
  // pushMatches — scan `text` for one regex family and enqueue
  // each hit as an issue with {start, end, text, reason, suggestion}.
  // `suggestionFn(hit)` returns the canned replacement text that the
  // fix-chip inserts when the user taps it. `opts.skipIfNegated`
  // drops matches that sit inside a negation context ("I wasn't
  // being lazy" — "lazy" shouldn't fire), looking 25 chars upstream
  // for a negation marker. Without this guard the word "lazy" in a
  // defensive frame ("I wasn't being lazy") would be flagged as a
  // harsh label, which is the opposite of the user's intent.
  const pushMatches = (pattern, reasonFn, suggestionFn, opts = {}) => {
    const re = pattern instanceof RegExp
      ? (pattern.global ? pattern : new RegExp(pattern.source, pattern.flags + 'g'))
      : new RegExp(pattern, 'gi');
    const NEG_BEFORE = /\b(?:wasn['\u2019]?t|isn['\u2019]?t|aren['\u2019]?t|am\s+not|don['\u2019]?t|doesn['\u2019]?t|didn['\u2019]?t|not|never|no)\s+(?:being\s+|really\s+|that\s+|so\s+)?$/i;
    let m;
    while ((m = re.exec(text)) !== null) {
      if (m[0].length === 0) { re.lastIndex++; continue; }
      if (opts.skipIfNegated) {
        const before = text.slice(Math.max(0, m.index - 25), m.index);
        if (NEG_BEFORE.test(before)) continue;
      }
      issues.push({
        start: m.index,
        end: m.index + m[0].length,
        text: m[0],
        reason: reasonFn(m[0]),
        suggestion: suggestionFn(m[0]),
      });
    }
  };
  // Accusatory "you + absolute/modal" — classic blame-frame.
  // NB: all apostrophes are class-matched as [''\u2019] because iOS
  // auto-curls straight ' into \u2019 (right-single-quote). Without
  // the class, "didn\u2019t" (what the OS inserts) would slip past
  // our "didn't" literal — silently disabling the whole scan for
  // iOS users, which is the environment this screen is designed in.
  pushMatches(
    /\byou (?:always|never|should(?:n['\u2019]?t)?|don['\u2019]?t|didn['\u2019]?t|aren['\u2019]?t|can['\u2019]?t|won['\u2019]?t|wouldn['\u2019]?t|need\s+to|have\s+to|must|make\s+me)\b/gi,
    (hit) => `"${hit}" reads like blame — try an "I" frame`,
    () => 'I feel'
  );
  // Standalone absolutes ("always", "never", "every time", "no one").
  pushMatches(
    /\b(?:always|never|every\s+time|no\s+one|nobody\s+ever|everyone\s+else)\b/gi,
    (hit) => `absolutes like "${hit}" rarely land fair`,
    () => 'sometimes'
  );
  // Harsh labels — word choice that lands as an attack regardless
  // of tone. skipIfNegated so "I wasn't being lazy" / "I don't hate
  // you" don't fire (the negation inverts the meaning).
  pushMatches(
    /\b(?:stupid|idiot|hate|dumb|worthless|pathetic|annoying|ridiculous|selfish|lazy|useless|awful|horrible|terrible|spoiled|ungrateful)\b/gi,
    (hit) => `"${hit}" is a label, not a feeling`,
    () => 'hurt',
    { skipIfNegated: true }
  );
  // Stacked exclamations — reads as shouting.
  pushMatches(
    /!{2,}/g,
    () => `stacked "!" can feel like yelling`,
    () => '.'
  );
  // ALL-CAPS words (4+ letters) — same shouting read. Suggestion is
  // the same word lowercased.
  pushMatches(
    /\b[A-Z]{4,}\b/g,
    (hit) => `"${hit}" in ALL CAPS reads as shouting`,
    (hit) => hit.toLowerCase()
  );
  // ── Emotional-threat phrasing ─────────────────────────────────
  // "I will be so pissed off" / "I'll be mad" / "I'm gonna be
  // furious" — threatens future escalation instead of naming the
  // hurt. These slip past the "you-frame" scan because the subject
  // is "I", but the effect on the recipient is the same or worse.
  // Per user's own test: "'If you say that again, I will be so
  // pissed off' 라고 적었는데 달라지는게 없네" — this is exactly
  // the class of phrase they expected to be flagged.
  pushMatches(
    /\bi(?:['\u2019]?ll|\s+will|['\u2019]?m\s+gonna\s+be|['\u2019]?m\s+going\s+to\s+be)\s+(?:be\s+)?(?:so\s+|really\s+|very\s+|extremely\s+)?(?:mad|angry|pissed|furious|done|upset|livid|fuming)(?:\s+off)?\b/gi,
    (hit) => `"${hit}" threatens — share the hurt, not the anger`,
    () => "it'll really hurt"
  );
  // Standalone escalation verbs — rage vocabulary that reads as
  // attack language regardless of grammar. Negation-skipped so
  // "I'm not pissed" doesn't fire.
  pushMatches(
    /\b(?:pissed(?:\s+off)?|furious|fuming|livid|fed\s+up|sick\s+of|done\s+with)\b/gi,
    (hit) => `"${hit}" escalates — name what's underneath`,
    () => 'hurt',
    { skipIfNegated: true }
  );
  // "If you … again" — conditional-warning frame. Always reads as
  // a threat ("if you do X again, I'll…") regardless of what fills
  // the blank. Suggestion reframes as an "I-feel" observation.
  pushMatches(
    /\bif\s+you\s+[^.!?\n]{1,50}?\bagain\b/gi,
    (hit) => `"${hit}" is a warning — try stating the need, not the ultimatum`,
    () => 'when that happens,'
  );
  // Same conditional-warning shape but anchored by "like that" /
  // "this way" instead of "again". Per user: "'If you say like
  // that, it makes me…' 이런 문장도 레드 표시하고 tone shifting
  // 추천해줘야지." — without this matcher the "again"-less variant
  // of the same threat frame slips past. {1,30} non-greedy keeps
  // the match to the if-clause so the red highlight doesn't bleed
  // into the consequence clause that follows.
  pushMatches(
    /\bif\s+you\s+(?:keep\s+)?[^.!?\n]{1,30}?\b(?:like\s+that|like\s+this|that\s+way|this\s+way)\b/gi,
    (hit) => `"${hit}" reads as a warning — name the feeling, not the condition`,
    () => 'when that happens'
  );
  // Dismissive shutdowns — closing the door instead of talking.
  pushMatches(
    /\b(?:whatever|shut\s+up|leave\s+me\s+alone)\b/gi,
    (hit) => `"${hit}" shuts the door — what do you actually want?`,
    () => ''
  );
  // ── Withdrawal / shutdown threats ────────────────────────────
  // Parallel to the anger-threat matcher above, for the
  // door-closing variant: "makes me want to stop opening up" /
  // "shut everything down" / "I'll just close myself off". These
  // read as threats to withdraw — as hurtful to the recipient as
  // anger threats, just via silence instead of volume. Per user:
  // "'If you say like that, it makes me want to stop opening up
  // and shut everything down.' 이런 문장도 레드 표시하고 tone
  // shifting 추천해줘야지." — the narrow "whatever/shut up/leave
  // me alone" matcher above misses every multi-word shutdown
  // phrase, which is where most actual withdrawal threats live.
  //
  // Two matchers because the phrases appear in two shapes:
  //   A. Framed by "(it) makes me want to / wanna X"
  //      — the consequence-threat construction. The enumerated
  //        verb bodies (stop opening up / shut down / close off /
  //        walk away / etc.) keep the match tight so the red
  //        span covers the meaningful threat phrase, not an
  //        arbitrary tail.
  //   B. Standalone shutdown verbs without the "makes me" frame,
  //      e.g. "I'll just shut everything down." Conservative set
  //      — each phrase is almost always a shutdown (not an
  //      incidental phrasing like "the store shut down"), so we
  //      can match without a preceding "I" hook. skipIfNegated
  //      so "I won't shut down" doesn't fire.
  //
  // The dedupe pass at the bottom handles overlap between A and
  // B naturally — A's "makes me want to stop opening up" wins
  // over B's shorter "stop opening up" where they overlap; B's
  // standalone "shut everything down" stays because A doesn't
  // cover it here (it sits after "and", not after "makes me").
  pushMatches(
    /\b(?:it\s+)?makes?\s+me\s+(?:want\s+to\s+|wanna\s+)?(?:stop\s+(?:opening\s+up|talking|trying|sharing|caring|listening|communicating)|shut\s+(?:down|off|everything\s+down|it\s+(?:all\s+)?down)|close\s+(?:off|myself\s+off)|walk\s+away|give\s+up|pull\s+back|check\s+out|tune\s+out|withdraw|disconnect)\b/gi,
    (hit) => `"${hit}" threatens withdrawal — name the hurt, not the exit`,
    () => 'I start to pull away'
  );
  pushMatches(
    /\b(?:stop\s+opening\s+up|shut\s+(?:everything|it\s+all|it)\s+down|close\s+myself\s+off|walk\s+away\s+from\s+(?:you|us|this))\b/gi,
    (hit) => `"${hit}" is a shutdown — name what you actually need`,
    () => 'step back',
    { skipIfNegated: true }
  );
  // Sort + dedupe overlapping issues: keep the longest of any
  // overlapping group so the red highlight doesn't double-paint
  // (a match on "you never" would otherwise also flag "never"
  // inside it as its own issue).
  issues.sort((a, b) => a.start - b.start);
  const mergedIssues = [];
  for (const iss of issues) {
    const last = mergedIssues[mergedIssues.length - 1];
    if (last && iss.start < last.end) {
      if (iss.end - iss.start > last.end - last.start) {
        mergedIssues[mergedIssues.length - 1] = iss;
      }
    } else {
      mergedIssues.push(iss);
    }
  }

  // ── Lexical signals for the positive side. Reuse the issue
  //     scan results where appropriate so the two layers stay
  //     consistent (we don't want a 'sharp' chip if there's no
  //     actual highlighted span).
  const hasWarmth     = /\b(miss|love|care|thank|grateful|glad|hope|mean (?:a lot|so much)|appreciate|proud)\b/.test(t);
  const hasSoftener   = /\b(maybe|perhaps|just|kinda|sort of|a little|lately|recently|sometimes|i think|i feel|i felt)\b/.test(t);
  const hasIStatement = /\bi(?:'|\b)/.test(t);
  const hasQuestion   = /\?/.test(raw);
  const tooShort      = wordCount < 6;
  const tooLong       = wordCount > 90;

  // ── MBTI preference axes ───────────────────────────────────
  const mbti = (person?.mbti || '').toUpperCase();
  const isIntrovert = mbti[0] === 'I';
  const isFeeler    = mbti[2] === 'F';
  const isJudger    = mbti[3] === 'J';

  // ── Score ──────────────────────────────────────────────────
  let score = 58; // neutral baseline
  if (hasWarmth)                                     score += 12;
  if (hasIStatement && mergedIssues.length === 0)    score += 9;
  if (hasSoftener && (isIntrovert || isFeeler))      score += 8;
  if (hasQuestion && isFeeler)                       score += 6;
  if (hasQuestion && !isFeeler)                      score += 2;
  // Each flagged issue pulls the score down proportionally — so
  // writing with two blame-frames is noticeably worse than one.
  score -= Math.min(42, mergedIssues.length * 14);
  if (tooShort)                                      score -= 12;
  if (tooLong && isJudger)                           score -= 6;
  if (tooLong && !isJudger)                          score -= 3;
  score = Math.max(6, Math.min(98, score));

  // ── Chips — detected signals, max 3, ranked by visual
  //     usefulness so the most revealing ones show first.
  const chips = [];
  if (mergedIssues.length > 0)                       chips.push({ label: 'sharp',      tone: 'warn' });
  if (tooShort)                                      chips.push({ label: 'very brief', tone: 'warn' });
  if (hasWarmth)                                     chips.push({ label: 'warm',       tone: 'good' });
  if (hasIStatement && mergedIssues.length === 0)    chips.push({ label: 'honest',     tone: 'good' });
  if (hasSoftener)                                   chips.push({ label: 'gentle',     tone: 'good' });
  if (hasQuestion)                                   chips.push({ label: 'opens up',   tone: 'good' });
  if (tooLong)                                       chips.push({ label: 'long',       tone: 'info' });
  if (chips.length === 0)                            chips.push({ label: 'even',       tone: 'info' });
  const visibleChips = chips.slice(0, 3);

  // ── Verdict — the character's one-line "read" on the current
  //     draft. If there's an active issue, the verdict IS the
  //     reason for the first issue so the user immediately
  //     connects the red highlight in the editor to its
  //     explanation in the bubble. Otherwise it's a summary of
  //     how the draft is landing.
  const who = person?.name || person?.relation?.replace(/\s+/g, ' ') || 'them';
  let verdict;
  if (mergedIssues.length > 0) {
    verdict = mergedIssues[0].reason;
  } else if (score >= 82)      verdict = `this lands for ${who}`;
  else if  (score >= 68)       verdict = `reads pretty well`;
  else if  (score >= 54)       verdict = `okay — could land softer`;
  else if  (score >= 38)       verdict = `might come off sharp`;
  else                         verdict = `try gentler with ${who}`;

  return {
    score,
    verdict,
    chips: visibleChips,
    issues: mergedIssues,
    empty: false,
  };
}

/* ──────────────────────────────────────────────────────────────
   ChatScreen — Option B: conversational, earned reveal.

   Design stance (from user):
   - 유도형 (leading, not prescriptive). Coach offers shapes, user decides.
   - 한 번에 모든 섹션을 쏟아내지 말 것 — 읽기 싫어진다.
   - 분석 카드(테이블/차트/스텝)는 "Dig into the why" 칩으로 earned-reveal.
   - 초안은 "이렇게 말해" 가 아니라 "이런 시작점은 어때?" 두 변주 제시.
   - 마지막은 Heart Vessel / Archive / Let it go 를 고르는 전용 페이지.

   Coach 메시지 구조는 기존 sections 스키마 그대로 유지(서버/API 재훈련 불필요).
   대신 렌더링에서 "primary" (eye + reply) 와 "deep" (table/chart/target/leaf/chat)
   를 나누고, deep은 사용자가 explicit하게 요청할 때만 stagger fade-up 으로 등장.
   ─────────────────────────────────────────────────────────── */

export default function ChatScreen() {
  const {
    goBack, chatDraft, familyMembers, currentPerson,
    addVesselEntry, addArchiveEntry, moveToArchive, updateArchiveEntry, navigate,
    // vesselEntries / archiveEntries — read-only here. We pipe the
    // user's past messages to THIS recipient into the draft prompt
    // so the generated Action + Words are shaped by the user's own
    // voice history (how they usually talk to Mom / Dad / sister),
    // not just by the recipient's personality. Per user: "이걸 클릭
    // 하면... '상대방'의 데이터와 '나'(사용자)의 데이터를 기반으로
    // 이상황에 대한 최적의 해결법을 제안하는거지."
    vesselEntries, archiveEntries,
    // Replay mode — when set by VesselScreen / ArchiveScreen on
    // detail-open, the chat surface mounts pre-populated from the
    // saved entry and all API calls / commit affordances are suppressed.
    // Cleared on unmount so a subsequent fresh chat isn't poisoned.
    replayEntry, setReplayEntry,
    // replaySource tells us where the saved entry lives right now
    // ('vessel' | 'archive' | null). Drives the replay commit rail —
    // a vessel entry being re-read should only show "Move to Archive"
    // since it already lives in Vessel. Per user: "여긴 이미 vessel에
    // 들어와있는걸 보는거니까 move to archive 버튼만 있게 해줘."
    replaySource, setReplaySource,
  } = useApp();

  /* Replay mode — frozen into a ref on first render so:
       1) React StrictMode's effect cleanup → re-setup pass (which can
          fire setReplayEntry(null) during the dev simulate-unmount)
          CANNOT flip replayMode to false while the hydrated state
          (messages, draftVariants, …) stays in useState. Without the
          ref, replayEntry would go null mid-session and the bottom
          CTA branch would render dual-commit buttons even though we
          set up the surface as a read-only replay.
       2) Subsequent navigations that touch replayEntry don't leak
          into this already-mounted instance. The frozen payload here
          is whatever was live when ChatScreen mounted.
     `replayEntryFrozen` is safe to read at render time — the context
     update that set it finished its batch before ChatScreen mounted. */
  const replayFrozenRef = useRef(null);
  if (replayFrozenRef.current === null && replayEntry) {
    replayFrozenRef.current = replayEntry;
  }
  const replayEntryFrozen = replayFrozenRef.current;
  const replayMode = !!replayEntryFrozen;
  const replayData = replayEntryFrozen?.replay || null;
  const replayTranscript = Array.isArray(replayEntryFrozen?.transcript)
    ? replayEntryFrozen.transcript
    : null;
  // Freeze replaySource the same way — so the context clearing on
  // unmount / home return can't flip the commit rail mid-session.
  const replaySourceFrozenRef = useRef(null);
  if (replaySourceFrozenRef.current === null && replaySource) {
    replaySourceFrozenRef.current = replaySource;
  }
  const replaySourceFrozen = replaySourceFrozenRef.current;
  const isArchiveReplay = replayMode && replaySourceFrozen === 'archive';

  // 텍스트에서 어떤 가족인지 감지
  const RELATION_KEYWORDS = {
    mom: ['mom', 'mother', '엄마', '어머니', '어무니'],
    dad: ['dad', 'father', '아빠', '아버지'],
    sister: ['sister', '언니', '누나', '여동생'],
    brother: ['brother', '형', '오빠', '남동생'],
    grandma: ['grandma', 'grandmother', '할머니', '외할머니'],
    grandpa: ['grandpa', 'grandfather', '할아버지', '외할아버지'],
    wife: ['wife', '아내', '와이프', '부인'],
    husband: ['husband', '남편'],
    friend: ['friend', '친구'],
  };

  function detectPerson(text) {
    const lower = text.toLowerCase();
    for (const member of familyMembers) {
      if (member.name && lower.includes(member.name.toLowerCase())) return { match: member };
      if (member.relation && lower.includes(member.relation.toLowerCase())) return { match: member };
    }
    for (const [relation, keywords] of Object.entries(RELATION_KEYWORDS)) {
      for (const kw of keywords) {
        if (lower.includes(kw)) {
          const found = familyMembers.find(m => m.relation?.toLowerCase() === relation);
          if (found) return { match: found };
          return { unregistered: relation };
        }
      }
    }
    return { match: null };
  }

  // Prefer detection over any messages already in history too — if the
  // user's latest message explicitly names a different family member,
  // that signal should win over a stale `chatDraft` that's been
  // consumed. Falls back to chatDraft (the inbound text from home /
  // WriteScreen) when there's no sent-message history yet.
  const latestUserText = chatDraft.trim() || '';
  // In replay mode we skip relation detection entirely — the saved
  // entry already carries the recipient, and running the detector on
  // a stale chatDraft could mis-route the header label.
  const detected = replayMode ? {} : (latestUserText ? detectPerson(latestUserText) : {});

  /* Priority for the "who this conversation is about" label shown in
     the top bar + used throughout the screen:
       1. detected.match — the draft text EXPLICITLY mentions (by name
          or by relation keyword like "sister" / "엄마" / "dad") a
          registered family member. This is the strongest signal the
          user can give; if the text is about sister, the header must
          read sister regardless of any prior selection. Per user:
          "사용자가 어떤 텍스트를 넣더라도 그 글을 읽고, 너가 텍스트를
          인식해서 저 위에 네이밍을 바꿔줘야해."
       2. currentPerson — the person the user manually picked on
          WriteScreen's PersonPicker or a prior explicit context.
          Used only when the draft has no family mention to go on.
       3. familyMembers[0] — last-ditch fallback so the screen never
          renders with a null recipient.
     Previously 1 and 2 were swapped, which caused the bug in the
     user's screenshot: draft mentioned "sister" but currentPerson
     (leftover "Dad" from a prior session) overrode detection and
     the header showed Dad. */
  // In replay mode the saved entry's person wins — it's the recipient
  // this transcript is about, regardless of who currentPerson happens
  // to be right now.
  const activePerson = replayMode
    ? (replayEntryFrozen.person || currentPerson || (familyMembers.length > 0 ? familyMembers[0] : null))
    : (detected.match || currentPerson || (familyMembers.length > 0 ? familyMembers[0] : null));

  /* headerPerson — what the TOP BAR label reads. Extends activePerson
     with the UNREGISTERED detection case: if the draft text clearly
     names a relation ("sister" / "누나" / "여동생") but no family
     member is registered for that relation, the header should still
     switch to show that relation label. Functional operations (API
     calls, entry saves) keep using `activePerson` which requires a
     registered person's id/mbti/personality — this synthetic stub
     only drives the top-bar text and the Why-might've heading.
     Without this, `detected.unregistered === 'sister'` would leave
     the header on stale currentPerson (Dad) even though the UI also
     renders a "register sister?" popup right below — contradictory
     signals. Title-casing via charAt.toUpperCase matches how the
     registered members render (e.g. relation "mother" → "Mother"). */
  const headerPerson = detected.match
    ? detected.match
    : detected.unregistered
      ? { relation: detected.unregistered.charAt(0).toUpperCase() + detected.unregistered.slice(1) }
      : activePerson;

  const [showRegisterPopup, setShowRegisterPopup] = useState(!replayMode && !!detected.unregistered);
  const [unregisteredRelation] = useState(detected.unregistered || '');

  /* Replay-mode messages hydration — computed ONCE per mount via a ref
     so `messages` and `typedIds` useState inits (which both need the
     same set of stable coach-ids) don't diverge by running Date.now()
     at different microseconds. Ref means the expensive walk only
     happens on first render and isn't recomputed on every re-render. */
  const replayMessagesRef = useRef(null);
  if (replayMode && replayMessagesRef.current === null) {
    const base = Date.now();
    if (replayTranscript && replayTranscript.length > 0) {
      replayMessagesRef.current = replayTranscript.map((m, i) => ({
        id: m.id || (base + i),
        role: m.role,
        text: m.text || '',
        sections: m.sections || null,
        suggestions: m.suggestions || null,
      }));
    } else {
      /* Legacy fallback — entries created before we started persisting
         the full transcript (dummy data / very old saves) only carry
         `rawText` and `message`. Synthesise a minimal user bubble +
         coach card so the replay surface isn't blank. */
      const synth = [];
      if (replayEntryFrozen?.rawText) {
        synth.push({ id: base, role: 'user', text: replayEntryFrozen.rawText });
      }
      if (replayEntryFrozen?.message) {
        synth.push({
          id: base + 1, role: 'coach', text: replayEntryFrozen.message,
          sections: null, suggestions: null,
        });
      }
      replayMessagesRef.current = synth;
    }
  }

  // ── Messages ──
  // 각 coach 메시지에 `deepOpen` 플래그를 로컬 상태로 들고 있어서
  // 사용자가 "Dig into the why" 를 탭하면 해당 메시지에 한해 분석 카드들이
  // 드러난다. 다른 coach 메시지는 건드리지 않는다.
  const [messages, setMessages] = useState(() => {
    if (replayMode) {
      return replayMessagesRef.current || [];
    }
    return chatDraft.trim() && !detected.unregistered
      ? [{ id: Date.now(), role: 'user', text: chatDraft }]
      : [];
  });
  const [inputVal, setInputVal]   = useState('');
  const [isTyping, setIsTyping]   = useState(false);

  // ── Slide-up chat bar state ───────────────────────────────
  // The bottom row follows home's layout (265×66 CTA + 66×66 chat
  // button). Tapping the chat button opens a slide-up .slideChatBar
  // overlay whose textarea replaces the old inline .inputBar. Per
  // user: "텍스트 버튼은 홈 화면처럼 똑같이 하고, 누르면 나오는
  // 그 모션 그런 방식도 똑같이 채용해." The motion primitives
  // (chatOpen, kbOffset, inputRef-focus on open) are direct ports
  // of App.jsx GlobalNav's local state.
  const [chatBarOpen, setChatBarOpen] = useState(false);
  const [kbOffset, setKbOffset]       = useState(0);

  // 어떤 coach 메시지의 deep-dive 가 펼쳐졌는가 (id 집합)
  const [deepOpenIds, setDeepOpenIds] = useState(() => new Set());
  // 각 coach 메시지 안에서 "더 보기" 가 눌렸는가 (target/leaf 추가 reveal)
  const [moreOpenIds, setMoreOpenIds] = useState(() => new Set());
  // 타이핑이 끝난 coach 메시지 id 집합. 타이핑 중엔 선택지/직접입력/dig 를
  // 숨겨둔다 — ChatGPT 처럼 먼저 답변이 완성되고, 그 다음 인터랙션이 따라온다.
  //
  // Replay mode: pre-fill with every coach msg id so all affordances
  // render in their "typed" resting state from frame one — no word
  // reveal cascade, no thinking wave. The user is re-reading a saved
  // conversation, not watching it unfold.
  const [typedIds, setTypedIds] = useState(() => {
    if (replayMode) {
      const set = new Set();
      (replayMessagesRef.current || []).forEach(m => {
        if (m.role === 'coach') set.add(m.id);
      });
      return set;
    }
    return new Set();
  });

  // ── View mode ──
  // The legacy chat-stream surface (avatar-card bubbles, chip
  // suggestions, per-msg typing effect) was retired per user:
  // "내가 후속 채팅을 치면, 예전에 했던 디자인이 나오면서 이상해져.
  //  이건 완전 삭제해야돼. 첫번째 이미지처럼 나오고 만약에 사용자가
  //  후속 채팅을 쳤다면, 똑같이 카드 디자인으로 그냥 밑에 나와야해.
  //  1번 카드가 다시 한번 나오는거지." Every turn now renders in the
  // hero-card vocabulary: each user message as a right-aligned bubble,
  // each coach reply as its own stacked hero card. The follow-on
  // card's phase-aware bottom CTA (Analyse / Help me respond) is
  // still driven by the LATEST coach message — same bottomCta logic
  // as before, just re-applied to whatever turn is currently at the
  // bottom of the scroll.

  // ── Draft flow ──
  // phase:
  //   'chatting'        — 대화 모드. 초안은 아직 없음. observation 카드 표시.
  //   'analysisLoading' — observation Next 누른 직후. perspective analysis API 호출 중.
  //   'analysis'        — 4-angle perspective deck 표시. 사용자가 가로 스와이프.
  //   'draftLoading'    — analysis Next 누른 후 초안 생성 중.
  //   'drafting'        — 초안 변주 2개를 보여주는 중. 아직 채택 전.
  //   'destination'     — 초안 채택 후, Vessel/Archive/Discard 선택 오버레이.
  //   'saved'           — 저장 완료 컨펌.
  // Replay mode starts directly in 'drafting' — the saved entry is a
  // completed conversation with observation + analysis deck + words
  // card, and 'drafting' is the phase where all three stack together.
  const [phase, setPhase] = useState(() => (replayMode ? 'drafting' : 'chatting'));
  // Perspective-analysis deck — array of { title, body, quote }. Populated
  // when the user taps observation's Next. Rendered as a 4-card swipe deck
  // inside the same hero-card envelope (see analysis render block below).
  const [analysisAngles, setAnalysisAngles] = useState(
    () => (replayMode && replayData?.analysisAngles) ? replayData.analysisAngles : []
  );
  // Which angle card is currently centered in the horizontal scroll.
  // Tracked via scroll-snap + onScroll handler; feeds the pagination dots.
  const [analysisIdx, setAnalysisIdx] = useState(
    () => (replayMode && replayData?.analysisIdx) || 0
  );
  // Draft-deck index — twin of analysisIdx for the 3rd card's
  // Action / Words swipe deck. Per user: "action 카드 에서 밑으로
  // 연결짓지 말고 오른쪽으로 스와이프 되게 해줘". Starts at 0
  // (Action) and flips to 1 when the user swipes to Words. Drives
  // the pagination dots and the header index badge.
  const [draftIdx, setDraftIdx] = useState(
    () => (replayMode && replayData?.draftIdx) || 0
  );
  // Random gradient-shape PNGs for the non-MBTI angle cards (pages 02-04).
  // Recomputed every time a fresh analysis lands (keyed on array length
  // so new analyses -> new triplet; same-analysis re-renders keep the
  // same shapes so swiping doesn't reshuffle the deck mid-session).
  // See GRADIENT_SHAPE_SRCS / pickRandomShapes above for rationale.
  // Picks 4 (one per angle card, 0-3). Page 0 may or may not use
  // its slot depending on whether the LLM flagged that angle with
  // `mbtiFeatured` — if so the MBTI portrait wins and this shape
  // stays unused; if not, the shape takes over as the page 01
  // visual anchor. Picking 4 upfront keeps the logic simple: every
  // card always has a shape reserved, indexing is just `themeShapes[i]`.
  // In replay mode the saved themeShapes are used verbatim so the
  // visuals are pixel-identical to what the user saw at commit time.
  // Fresh chat sessions still roll random shapes on each analysis.
  const themeShapes = useMemo(
    () => {
      if (replayMode && Array.isArray(replayData?.themeShapes) && replayData.themeShapes.length > 0) {
        return replayData.themeShapes;
      }
      return analysisAngles.length > 0 ? pickRandomShapes(4) : [];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [analysisAngles.length],
  );
  const [draftVariants, setDraftVariants] = useState(
    () => (replayMode && Array.isArray(replayData?.draftVariants)) ? replayData.draftVariants : []
  );
  const [draftNudge, setDraftNudge]       = useState(
    () => (replayMode && replayData?.draftNudge) || ''
  );
  // draftAction = 행동(Action) half of Phase 3. 말(Words) = variants.
  // Flow spec splits the solution into "what to DO" and "what to SAY".
  // Without this the user only ever got Words — now they see both, and
  // the action card sits above the variant picker in the drafting phase.
  const [draftAction, setDraftAction]     = useState(
    () => (replayMode && replayData?.draftAction) || ''
  );
  // Per-variant editable text buffer — the "Words" half now ships as
  // a live-editable textarea inside each variant card (user: "말은
  // 텍스트 편집 기능이 들어가야해"). variantDrafts[i] mirrors
  // draftVariants[i].text at mount and diverges as the user types;
  // handleChooseVariant reads from variantDrafts[i] so any edits
  // carry forward to the destination / vessel / archive. Initialised
  // alongside draftVariants in handleOfferDraft and cleared in
  // handleKeepTalking so stale edits never leak across requests. */
  const [variantDrafts, setVariantDrafts] = useState(
    () => (replayMode && Array.isArray(replayData?.variantDrafts)) ? replayData.variantDrafts : []
  );
  const [chosenDraft, setChosenDraft]     = useState(null);
  const [editing, setEditing]             = useState(false);
  const [editDraft, setEditDraft]         = useState('');
  const [saved, setSaved]                 = useState(null);
  /* Archive replay (v2) — the earlier "How did they respond?" +
     coach reflection block was retired per user: the archive replay
     surface now ends in a permanent chat bar styled like slideChatBar
     ("그 디자인을 넣어줘… 'What happened next?'라고 해줘"). Typing
     in this bar continues the conversation: new user message stacks
     in `messages`, coach replies append below, and the transcript is
     persisted back to the archive entry so the continuation survives
     app reloads. No separate response/reflection state is kept. */
  /* activeVariantIdx — which draft variant the user is "on right now."
     Per user: while the drafting card is open we now expose two commit
     buttons in the bottom row (Move to Vessel / Move to Archive) that
     skip the destination overlay. Those need to know which variant's
     text to commit. We default to 0 (first variant) and move the
     pointer to whichever textarea the user last focused — the most
     natural "active" signal without adding visible radio affordances
     that would clutter the card. If only one variant exists this stays
     at 0 and the UX is identical to a single-draft commit. */
  const [activeVariantIdx, setActiveVariantIdx] = useState(
    () => (replayMode && replayData?.activeVariantIdx) || 0
  );

  /* copiedVariantIdx — short-lived "Copied!" confirmation state for
     the Words card's copy-text button (replacing the old "Use this →"
     commit button per user: "use this 라고 되어있는데 그거 말고 copy
     text할수있는 버튼으로 바꿔줘"). Holds the index of the variant
     that was just copied; the button label swaps to "Copied" for a
     beat, then clears back to null so the affordance returns to its
     idle "Copy" state. Scoping by index (not a boolean) means if we
     ever go back to multiple variants again, each can track its own
     confirmation independently. */
  const [copiedVariantIdx, setCopiedVariantIdx] = useState(null);

  /* draftShapes — two random gradient shapes drawn from the same
     pool as the analysis deck's .angleThemeArt. One decorates the
     Action sub-card, one decorates the Words sub-card. Per user
     "2번째 카드에서 무작위로 사용하는 애들을 가져와서 무작위로
     사용하자. 위치를 action 카드 안에 넣도록 하자. words카드에도
     넣어줘." Fresh picks each time the draft card arrives —
     dependency keyed on draftVariants.length transitioning to > 0
     so re-running the draft cycle (Keep talking → new draft)
     reshuffles the visuals. Declared here (after draftVariants
     state) to avoid TDZ. */
  const draftShapes = useMemo(
    () => {
      if (replayMode && Array.isArray(replayData?.draftShapes) && replayData.draftShapes.length > 0) {
        return replayData.draftShapes;
      }
      return draftVariants.length > 0 ? pickRandomShapes(2) : [];
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [draftVariants.length],
  );

  const inputRef       = useRef(null);
  const messagesRef    = useRef(null);
  const hasFetchedRef  = useRef(false);
  // Hero card (observation card) + its scroll container. When the coach's
  // first response arrives, we snap the scroll so the card fills the
  // viewport. The user-message bubble stays above in DOM order — user can
  // scroll UP to see it. Bubble is NOT sticky; card is NOT fixed.
  const heroCardRef      = useRef(null);
  const heroScrollRef    = useRef(null);
  const heroSnappedRef   = useRef(false);
  // analysisCardRef + analysisSnappedRef — used to auto-tween the
  // heroScroll's scrollTop to the analysis card once it lands. Per
  // user ("tuning in 하고 나면 새로운 페이지로 넘어가는게 아니라 채팅
  // 하듯이 그 밑으로 새로운 카드가 나오고 자동으로 또 위치 세팅되게 해"),
  // the analysis now renders INSIDE heroScroll (stacked below the
  // observation card), and this snap effect delivers the "chat-like"
  // feel of the new card arriving and the viewport scrolling to meet
  // it. snappedRef guards against repeated tweens if the effect
  // re-runs while we're already on the analysis card.
  const analysisCardRef  = useRef(null);
  const analysisSnappedRef = useRef(false);
  // draftCardRef + draftSnappedRef — mirror of the analysis snap
  // pattern for the third stacked card. Per user ("두번째 카드 나오고
  // draft a message하면 지금 그 두번째 카드가 사라지고 완전 이상한
  // 디자인의 action, words 이게 나오네. 기존 카드 디자인으로 디자인
  // 유지하고, 모션으로 이제 새로운 카드가 등장하는걸로 해야돼"), the
  // drafting UI no longer replaces the observation/analysis deck — it
  // mounts as a new .draftCard BELOW them in the same heroScroll,
  // wearing the same liquid-glass shell as its siblings. This ref +
  // snap effect tweens the scroller to meet the new card as it
  // arrives, so the motion reads as "another chat card slid in" rather
  // than "screen swapped."
  const draftCardRef  = useRef(null);
  const draftSnappedRef = useRef(false);
  // draftDeckRef + deck-height effect — keep the horizontal-swipe
  // deck's height in sync with the CURRENTLY VISIBLE page, not the
  // TALLER of the two. Without this, Words (which contains a tall
  // variant textarea) would dictate the deck's intrinsic height and
  // Action (which is shorter) would sit with a large empty rail
  // below — the exact thing the user called out:
  // "말 카드가 길다고 해서 action 카드를 그거에 맞춘다고 잔뜩 길게
  // 늘려놨는데, 디자인적으로 보기 안좋으니까." Each page is
  // align-self:flex-start so it renders at natural height; this
  // effect then resizes the deck so the pagination dots sit right
  // below whichever page is active, and swipes land tightly.
  const draftDeckRef = useRef(null);

  // heroNextEntered — true once the Next button has completed its
  // one-shot entrance animation (heroNextIn). While false, we apply
  // `.heroNextEntering` which triggers the opacity: 0 → 1 rise. Once
  // true, the button's class no longer includes the entrance, so
  // subsequent className changes (e.g. adding/removing heroNextLoading
  // during the analysisLoading phase) CANNOT retrigger heroNextIn and
  // flash the button back to opacity: 0.
  //
  // This fixes: user tapped "See their side" → phase flipped to
  // analysisLoading → button's `animation` CSS property swapped from
  // heroNextIn to heroNextPulse → when the phase later flipped to
  // analysis and the loading class fell away, `animation` reverted to
  // heroNextIn and the browser restarted it from frame 0 (opacity: 0
  // + animation-delay: ctaDelayMs), blanking the button for seconds.
  // Per user: "See their side 버튼 누르면 잠깐 사라졌다가 다시 생기고
  // 있어. 고쳐줘. 사라지면 안돼."
  const [heroNextEntered, setHeroNextEntered] = useState(false);

  const userMessageCount = messages.filter(m => m.role === 'user').length;
  // 초안 제안 CTA 는 coach 응답이 최소 1번 돌고 user가 2회 이상 입력한 후에만
  // 등장 — 너무 일찍 나오면 "대놓고 draft 줄게" 느낌이 되서 유도형이 깨진다.
  const coachHasResponded = messages.some(m => m.role === 'coach');
  const canOfferDraft = userMessageCount >= 2 && coachHasResponded
                      && phase === 'chatting' && !isTyping;

  useEffect(() => {
    // In replay mode we never kick off the coach-reply API — the
    // transcript is already saved and we just re-render it.
    if (replayMode) {
      hasFetchedRef.current = true;
      return;
    }
    if (messages.length === 1 && messages[0].role === 'user' && !hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchCoachReply([{ role: 'user', content: messages[0].text }]);
    }
    // Autofocus was previously on the inline textarea; now the textarea
    // lives inside the slide-up .slideChatBar which starts closed, so
    // focusing the hidden input would be a no-op. Focus instead happens
    // in `openLocalChat` when the user taps the 66×66 chat button.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  /* NOTE: no unmount cleanup here. A previous attempt at
     `return () => setReplayEntry(null)` inside a useEffect fought
     React 19 StrictMode in dev: the simulated unmount→remount pair
     cleared context during the "unmount" step, and the remount got
     fresh refs with no context entry to re-freeze, which flipped
     replayMode to false mid-session and unmasked the dual-commit
     rail the frozen-ref pattern is meant to suppress. Clearing now
     happens in AppContext.goBack / goHome so subsequent fresh chats
     still get a clean slate, without any StrictMode race. */

  /* Archive replay — persist follow-up turns back to the archive
     entry's transcript. Per user: after the original three-card
     replay the user can type in the "What happened next?" bar and
     continue the conversation; those new messages should survive
     app reloads / re-entries to the same entry. Every time
     `messages` grows (or any ID shifts), serialise the full message
     list and push it into the archive entry via updateArchiveEntry.
     Skipped in non-archive-replay sessions so we don't overwrite
     fresh chat state or vessel entries. */
  useEffect(() => {
    if (!isArchiveReplay || !replayEntryFrozen?.id) return;
    const transcript = messages.map(m => ({
      id: m.id,
      role: m.role,
      text: m.text,
      sections: m.sections || null,
      suggestions: m.suggestions || null,
    }));
    updateArchiveEntry(replayEntryFrozen.id, { transcript });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [messages, isArchiveReplay]);

  // iOS keyboard offset — mirrors App.jsx GlobalNav. When the keyboard
  // comes up, window.visualViewport shrinks; we add that delta to the
  // chat bar's bottom offset so the bar rides the top of the keyboard
  // instead of being hidden behind it.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    function onViewportResize() {
      const kb = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      setKbOffset(kb);
    }
    vv.addEventListener('resize', onViewportResize);
    vv.addEventListener('scroll', onViewportResize);
    return () => {
      vv.removeEventListener('resize', onViewportResize);
      vv.removeEventListener('scroll', onViewportResize);
    };
  }, []);

  // Slide-up chat bar open/close — direct port of App.jsx GlobalNav.
  function openLocalChat() {
    setChatBarOpen(true);
    setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
      autoResize(inputRef.current);
    }, 300);
  }
  function closeLocalChat() {
    setChatBarOpen(false);
    // Preserve inputVal so a half-typed draft survives a misfired tap
    // on the dim overlay. User can always reopen and continue.
    if (inputRef.current) inputRef.current.style.height = 'auto';
  }

  // Auto-close the chat bar when we transition into a phase that
  // doesn't render a trigger button (destination / saved). Prevents
  // an orphaned chat bar from lingering when the rest of the bottom
  // rail has vanished behind a save confirmation overlay.
  useEffect(() => {
    if (phase === 'destination' || phase === 'saved') setChatBarOpen(false);
  }, [phase]);

  // Measures the scroller's viewport height and sets `--thinking-offset`
  // on the hero card so the thinking-state character slot pushes the
  // character to the visual center of the available viewport. Using
  // measured pixels (instead of `vh` or %) makes it robust across
  // phone frames and device viewports. Re-measures on any size change.
  //
  // Formula: centerY_in_scroller = 0.5 * clientHeight. Character's
  // center sits at slotMarginTop + 136 (half of 272-tall char) below
  // card.offsetTop. So slotMarginTop = centerY - cardTop - 136.
  // We clamp to a sensible minimum so the character never overlaps
  // the user bubble on very short viewports.
  useEffect(() => {
    const scroller = heroScrollRef.current;
    if (!scroller) return;
    const update = () => {
      const card = heroCardRef.current;
      if (!card) return;
      const centerY = 0.5 * scroller.clientHeight;
      const cardTop = card.offsetTop;
      const offset  = Math.max(60, centerY - cardTop - 136);
      card.style.setProperty('--thinking-offset', `${Math.round(offset)}px`);
    };
    // Defer one frame so refs are guaranteed populated after the
    // first paint (card mounts the same frame as this effect runs).
    const raf = requestAnimationFrame(update);
    const ro = new ResizeObserver(update);
    ro.observe(scroller);
    return () => { cancelAnimationFrame(raf); ro.disconnect(); };
    // Depend on messages.length so the effect re-runs when the first
    // user message lands (card mounts the same tick) and again whenever
    // the message list grows. ResizeObserver covers viewport changes in
    // between.
  }, [messages.length]);

  useEffect(() => {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [messages, isTyping, phase, draftVariants, deepOpenIds, moreOpenIds]);

  // Snap the heroScroll so the LATEST coach card's top lands at the top
  // of the viewport whenever a new coach reply arrives. Each new turn
  // (user follow-up → coach reply) stacks below the prior cards and
  // should pull the scroll down to meet it — "card 1 again" cadence per
  // user. The guard is keyed on the coach message ID so re-renders for
  // an already-snapped reply don't yank the scroll, but a brand-new
  // reply does trigger a fresh snap.
  useEffect(() => {
    /* Replay mode skips the auto-snap cadence entirely — all three
       cards (observation, analysis deck, words) are already in the
       DOM at mount, so there's no "newly arrived" card to snap to.
       We let the scroll rest at its natural top so the user reads
       through the saved conversation top-down, the way it originally
       unfolded. Per user: "저길 들어가면 2,3,4번 이미지처럼 내가 했던
       대화 그대로 똑같이 들어가있어야돼." Image 2 is the observation
       at the top — that's where replay should land first. */
    if (replayMode) return;
    const coach = [...messages].reverse().find(m => m.role === 'coach');
    if (!coach) {
      heroSnappedRef.current = null;          // reset if we go back to loading
      return;
    }
    if (heroSnappedRef.current === coach.id) return;
    const card = heroCardRef.current;
    const scroller = heroScrollRef.current;
    if (!card || !scroller) return;
    heroSnappedRef.current = coach.id;
    // Per user ("thinking하는 과정의 시간이 너무 길어"), the whole
    // sequence was tightened ~40%. The scroll tween still OVERLAPS
    // with the character's thinking→settled margin ride so both
    // motions read as one unified "the card is coming forward"
    // gesture instead of two sequential events. New choreography:
    //   0ms    coach reply arrives; slot margin-top starts tween to 0
    //          (character begins rising from its thinking position)
    //   80ms   scroll tween begins — bubble starts leaving the frame
    //   600ms  first word of observation starts revealing (post-settle)
    //   ~850ms character fully settled + scroll landed
    //   ~1500ms last word lands (depending on observation length)
    //   ~1650ms Next button fades in
    const timer = setTimeout(() => {
      const top = card.offsetTop - scroller.offsetTop;
      tweenScrollTop(scroller, top, 720, easeOutExpo);
    }, 80);
    return () => clearTimeout(timer);
  }, [messages]);

  // Analysis-card auto-snap — when the perspective deck finishes
  // loading and renders below the observation card, tween the
  // heroScroll's scrollTop so the new card lands at the top of the
  // viewport. Matches the observation card's snap pattern but for
  // the stacked follow-up. Guarded by analysisSnappedRef so we don't
  // re-yank the scroll while the user is already viewing/swiping the
  // angles.
  //
  // Reset logic: when we leave the analysis phase (back to 'chatting'
  // via the back chevron, or forward to draft), flip the guard off so
  // a SUBSEQUENT re-entry into analysis lands cleanly again.
  useEffect(() => {
    if (replayMode) return; // replay mounts all cards together — no snap
    if (phase !== 'analysis') {
      analysisSnappedRef.current = false;
      return;
    }
    if (analysisAngles.length === 0) return;
    if (analysisSnappedRef.current) return;
    const card = analysisCardRef.current;
    const scroller = heroScrollRef.current;
    if (!card || !scroller) return;
    analysisSnappedRef.current = true;
    // Small delay so the card's entrance animation (heroFadeIn, 0.6s
    // from 0.08s) has a moment to START before we pull the scroll —
    // that way the user sees the card fade-in WHILE the viewport is
    // travelling to meet it, reading as a single "arriving" motion.
    // Delay 120 → 60 and tween 1000 → 620 per user "thinking하는 과정의
    // 시간이 너무 길어" — the analysis card now arrives noticeably
    // sooner after Analyse is tapped.
    const timer = setTimeout(() => {
      // Target: the 2nd card's top lands exactly 120px below the
      // TOP OF THE SCREEN. Per user: "두번째 카드의 상단이 화면 위에서
      // 100px 아래에 위치되게 해달라고" → follow-up "조금 더 내려야할듯.
      // 120px로" (nudge down from 100 to 120).
      //
      // Math: .heroScroll is position:absolute; top:0 inside .screen,
      // and .screen fills the phone canvas — so scroller's top edge
      // is at screen y=0. A card inside the scroller appears on
      // screen at y = (card.offsetTop - scroller.scrollTop). Setting
      // scrollTop = card.offsetTop - 120 therefore places the card's
      // top edge exactly 120px down from the screen top, regardless
      // of whatever the user message bubble / scroller padding-top
      // adds above the card.
      const top = card.offsetTop - scroller.offsetTop - 120;
      tweenScrollTop(scroller, top, 620, easeOutExpo);
    }, 60);
    return () => clearTimeout(timer);
  }, [phase, analysisAngles.length]);

  // Draft-card auto-snap — identical pattern to the analysis card
  // above, one level deeper in the stack. When phase flips to
  // 'drafting' and the .draftCard mounts below the analysis card, we
  // tween heroScroll to the new card so the user's viewport lands on
  // it automatically. Guarded by draftSnappedRef so a re-render during
  // drafting (e.g. variant hover) doesn't yank scroll. Reset fires
  // whenever we leave drafting so coming back triggers a fresh snap.
  useEffect(() => {
    if (replayMode) return; // replay mounts all cards together — no snap
    if (phase !== 'drafting') {
      draftSnappedRef.current = false;
      return;
    }
    if (draftVariants.length === 0) return;
    if (draftSnappedRef.current) return;
    const card = draftCardRef.current;
    const scroller = heroScrollRef.current;
    if (!card || !scroller) return;
    draftSnappedRef.current = true;
    const timer = setTimeout(() => {
      // Match the 2nd card's snap offset so the 3rd card also lands
      // with its top edge exactly 120px below the screen top. Per
      // user: "두번째 카드 나오면 상단에서 120px 떨어지게 위치시
      // 키잖아, 그 세번째 카드도 마찬가지로 120px에서 위치시켜줘."
      // Keeps both stacked cards arriving with the same header
      // breathing room — one snap rhythm across the flow.
      const top = card.offsetTop - scroller.offsetTop - 120;
      tweenScrollTop(scroller, top, 620, easeOutExpo);
    }, 60);
    return () => clearTimeout(timer);
  }, [phase, draftVariants.length]);

  // Sync the .draftDeck's height to the currently-active page so
  // the shorter page (Action) doesn't leave a tall empty rail below
  // it — see the comment on draftDeckRef above for rationale.
  // useLayoutEffect (not useEffect) so the height lands in the same
  // paint cycle as the swipe; otherwise the user would see a flash
  // of old-height on page change. ResizeObserver tracks the Words
  // page's variant textarea auto-grow — when the user types into it
  // the deck expands in lockstep.
  useLayoutEffect(() => {
    if (phase !== 'drafting') return;
    const deck = draftDeckRef.current;
    if (!deck) return;
    const pages = Array.from(deck.children);
    if (pages.length === 0) return;
    const activePage = pages[Math.min(draftIdx, pages.length - 1)];
    if (!activePage) return;

    const syncHeight = () => {
      deck.style.height = activePage.offsetHeight + 'px';
    };
    syncHeight();

    // Observe the active page for size changes (variant textarea
    // auto-grow inside Words) so the deck follows along without a
    // re-render needing to fire.
    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(syncHeight);
      ro.observe(activePage);
    }
    return () => {
      if (ro) ro.disconnect();
    };
  }, [phase, draftIdx, draftVariants.length, variantDrafts]);

  // Re-size every variant editor whenever `variantDrafts` changes.
  // The onChange handler inside the textarea already auto-grows on
  // keystroke, but fix-chip taps splice text into state directly
  // (applyFix) and bypass onChange — without this effect the
  // textarea keeps its old inline height after a splice that
  // shortens the text, leaving a phantom blank line. Queried by
  // [data-variant-editor] so we don't have to thread refs through
  // the map callback.
  useLayoutEffect(() => {
    if (phase !== 'drafting') return;
    const editors = document.querySelectorAll('[data-variant-editor]');
    editors.forEach((el) => {
      el.style.height = 'auto';
      el.style.height = el.scrollHeight + 'px';
    });
  }, [phase, draftIdx, variantDrafts]);

  // (The heroNextEntered timer useEffect lives further down, AFTER
  //  `latestCoach` is declared — keeping it up here would hit a
  //  temporal-dead-zone ReferenceError because `const latestCoach`
  //  hasn't been initialized yet at this point in the component body.)

  function autoResize(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  function toAPIMessages(msgs) {
    return msgs.map(m => ({
      role: m.role === 'user' ? 'user' : 'assistant',
      content: m.text,
    }));
  }

  async function fetchCoachReply(apiMessages) {
    setIsTyping(true);
    try {
      const { reply, sections, suggestions } = await chatWithCoach(activePerson, apiMessages);
      setMessages(prev => [...prev, { id: Date.now(), role: 'coach', text: reply, sections, suggestions }]);
    } catch {
      setMessages(prev => [...prev, { id: Date.now(), role: 'coach', text: "I'm here. What's going on?", suggestions: [] }]);
    } finally {
      setIsTyping(false);
    }
  }

  async function handleOfferDraft() {
    setPhase('draftLoading');
    // Reset draft deck to Action (page 0) on every fresh draft load
    // so the user sees the behaviour move first, then swipes right
    // to Words — mirrors analysisIdx reset at the top of
    // handleEnterAnalysis.
    setDraftIdx(0);
    try {
      // Build the USER's history with THIS specific recipient — filter vessel
      // + archive by activePerson.id. Fallback to name match when ids are
      // missing (older entries). generateGuidedDraft uses this as the "나
      // (user)" half of the "상대방+나 기반 최적의 해결법" the user asked for.
      const personId   = activePerson?.id;
      const personName = activePerson?.name;
      const matchesPerson = (e) => {
        if (!e?.person) return false;
        if (personId && e.person.id) return e.person.id === personId;
        return personName && e.person.name === personName;
      };
      const userHistoryForPerson = [
        ...(vesselEntries || []).filter(matchesPerson),
        ...(archiveEntries || []).filter(matchesPerson),
      ]
        // newest first, cap at 6 inside the util anyway
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
        .slice(0, 6);

      const { nudge, action, variants } = await generateGuidedDraft(
        activePerson,
        toAPIMessages(messages),
        userHistoryForPerson,
      );
      setDraftNudge(nudge);
      setDraftAction(action || '');
      setDraftVariants(variants);
      // Seed the edit buffer with the model's text. Each variant gets its own
      // slot so typing in one doesn't bleed into the other. handleChooseVariant
      // reads from here, not from `variants`, so user edits ship to vessel /
      // archive verbatim.
      setVariantDrafts(variants.map(v => v.text || ''));
      setPhase('drafting');
    } catch {
      setPhase('chatting');
    }
  }

  function handleChooseVariant(variant, index) {
    // Prefer the edited buffer if the user has been typing; fall back to the
    // original model text. Guarded so a missing index (e.g. escape paths)
    // still has a sensible text to ship.
    const edited = typeof index === 'number' ? variantDrafts[index] : undefined;
    const finalText = (edited != null ? edited : variant.text) || '';
    setChosenDraft(finalText);
    setEditDraft(finalText);
    setPhase('destination');
  }

  /* Copy the active Words draft (edited text if the user typed, else the
     seeded model text) to the clipboard. Replaces the old "Use this →"
     CTA per user: "use this 라고 되어있는데 그거 말고 copy text할수있는
     버튼으로 바꿔줘." The navigator.clipboard API is the modern path
     (requires HTTPS / localhost) with an execCommand fallback for
     in-app webviews that don't expose it. On success we flip the
     button into its "Copied" confirmation state for 1.6s — long enough
     to read, short enough that the idle "Copy" affordance reappears
     before the user loses context. */
  async function handleCopyVariant(index, variant) {
    const edited = typeof index === 'number' ? variantDrafts[index] : undefined;
    const text = (edited != null ? edited : variant.text) || '';
    if (!text.trim()) return;
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        // Fallback for environments without async clipboard API.
        const ta = document.createElement('textarea');
        ta.value = text;
        ta.setAttribute('readonly', '');
        ta.style.position = 'absolute';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        try { document.execCommand('copy'); } catch { /* noop */ }
        document.body.removeChild(ta);
      }
    } catch {
      /* Clipboard blocked — swallow silently; the idle "Copy" state
         returns on the next tap attempt. We intentionally don't surface
         an error toast here because the failure surface is small and
         the user can always long-press to copy manually. */
    }
    setCopiedVariantIdx(index);
    setTimeout(() => {
      setCopiedVariantIdx(prev => (prev === index ? null : prev));
    }, 1600);
  }

  function handleKeepTalking() {
    // 초안을 닫고 대화로 돌아감.
    setPhase('chatting');
    setDraftVariants([]);
    setVariantDrafts([]);
    setDraftNudge('');
    setDraftAction('');
    setTimeout(() => inputRef.current?.focus({ preventScroll: true }), 100);
  }

  /* Shared helper — builds the persistable entry shape used by BOTH
     the legacy destination-overlay path (handleDestinationVessel /
     handleDestinationArchive) AND the drafting-phase direct-commit
     path (commitActiveVariant). Ensures both routes ship the same
     snapshot so a vessel entry committed via either UI looks
     identical when viewed later.

     The entry carries EVERYTHING the read-only replay mode needs to
     reconstruct the exact three-card chat view the user saw at
     commit time — messages, perspective-deck angles, draft variants
     (both original model text AND any user edits), coach nudge /
     action copy, the random gradient shape picks so visuals stay
     stable across re-opens, and the indices the user last navigated
     to (which angle card, which draft page, which variant was
     focused). `transcript` preserves msg.id alongside role/text/
     sections/suggestions so the replay can pre-fill `typedIds` with
     the same IDs and skip word-reveal animations. Per user: "저길
     들어가면 2,3,4번 이미지처럼 내가 했던 대화 그대로 똑같이 들어가
     있어야돼. 하나도 바뀌는거 없이." */
  function buildEntryForDestination(finalText, variantOverride) {
    const transcript = messages.map(m => ({
      id: m.id || null,
      role: m.role,
      text: m.text || '',
      sections: m.sections || null,
      suggestions: m.suggestions || null,
    }));
    const firstUserText = messages.find(m => m.role === 'user')?.text || '';
    return {
      person: activePerson,
      rawText: firstUserText,
      transcript,
      /* Full replay payload — consumed by ChatScreen's replay-mode
         hydration (see `replayEntry` in AppContext). Safe to be
         absent on legacy entries: replay mode falls back to empty
         arrays and just shows whatever transcript does exist. */
      replay: {
        analysisAngles: Array.isArray(analysisAngles) ? analysisAngles : [],
        themeShapes: Array.isArray(themeShapes) ? themeShapes : [],
        draftVariants: Array.isArray(draftVariants)
          ? draftVariants.map(v => ({
              label: v.label || '',
              tone: v.tone || '',
              text: v.text || '',
            }))
          : [],
        variantDrafts: Array.isArray(variantDrafts) ? [...variantDrafts] : [],
        draftShapes: Array.isArray(draftShapes) ? draftShapes : [],
        draftNudge: draftNudge || '',
        draftAction: draftAction || '',
        draftIdx: draftIdx || 0,
        analysisIdx: analysisIdx || 0,
        activeVariantIdx: activeVariantIdx || 0,
      },
      draftContext: {
        nudge: draftNudge || '',
        action: draftAction || '',
        variant: variantOverride
          ? {
              label: variantOverride.label || '',
              tone: variantOverride.tone || '',
              originalText: variantOverride.text || '',
            }
          : { label: '', tone: '', originalText: '' },
      },
      message: finalText,
      result: {},
      createdAt: Date.now(),
    };
  }

  function handleDestinationVessel() {
    if (!chosenDraft) return;
    addVesselEntry(buildEntryForDestination(editing ? editDraft : chosenDraft));
    setSaved('vessel');
    setPhase('saved');
  }

  function handleDestinationArchive() {
    if (!chosenDraft) return;
    addArchiveEntry(buildEntryForDestination(editing ? editDraft : chosenDraft));
    setSaved('archive');
    setPhase('saved');
  }

  function handleDestinationDiscard() {
    // 저장 안하고 돌아감 — 가끔은 그냥 말해본 것만으로도 충분하다.
    setSaved('discarded');
    setPhase('saved');
  }

  /* ── Direct-commit handlers for the drafting-phase bottom bar ──
     Per user (3rd pass): "3번째 카드가 나오면 그 핑크 버튼이 없어지고
     채팅 버튼만 있어. 여기서는 채팅 버튼 기존 위치 그대로 가면서, 그
     좌측에 원래 하나 있던 버튼이 2개로 또 나뉘어서 move to heart
     vessel 그리고 move to archive버튼 이렇게 나뉘어야해." Two buttons
     in the bottom row replace the single pink CTA on the drafting
     phase and commit the active variant straight to its destination
     — skipping the per-variant "Use this →" → destination-overlay
     flow entirely. The overlay still exists as a fallback path for
     backwards-compat, but the bottom-bar commits are the primary UX.

     `activeVariantIdx` is updated on textarea focus (see the variant
     render block), so the user's last-touched draft is the one that
     ships. Default 0 means a user who hasn't focused anything still
     gets a sensible commit (first variant). */
  function commitActiveVariant(destination) {
    const idx = activeVariantIdx;
    const variant = draftVariants[idx] || draftVariants[0];
    if (!variant) return;
    // Prefer the edited buffer if the user has been typing; fall back
    // to the original model text. Same logic as handleChooseVariant
    // so the drafting-phase shortcut path doesn't diverge from the
    // legacy destination-overlay path.
    const text = (variantDrafts[idx] ?? variant.text) || '';
    if (!text.trim()) return;
    // Per user (this pass): "하단 두 버튼 vessel, archive 버튼 누르면
    // 실제로 거기로 이 대화 기록이 그대로 이동해야해." + follow-up
    // ("2,3,4번 이미지처럼 내가 했던 대화 그대로 똑같이 들어가있어야
    // 돼") → entry shape now carries the full replay payload so the
    // detail view can reconstruct the three-card chat surface exactly.
    // Serialisation lives in buildEntryForDestination which both
    // commit paths share; pass the focused variant so its label /
    // tone travel into draftContext unchanged.
    const entry = buildEntryForDestination(text, variant);
    if (destination === 'vessel') {
      addVesselEntry(entry);
      setSaved('vessel');
    } else {
      addArchiveEntry(entry);
      setSaved('archive');
    }
    // Seed chosenDraft too — the saved-confirmation overlay reads it
    // to show the final message as a preview, same as the legacy path.
    setChosenDraft(text);
    setEditDraft(text);
    setPhase('saved');
  }

  function handleSend() {
    const text = inputVal.trim();
    if (!text || isTyping) return;
    // Follow-up user messages now stay in the hero surface — a new
    // user bubble + coach hero card simply stack below the existing
    // ones (per user: "사용자가 후속 채팅을 쳤다면, 똑같이 카드
    // 디자인으로 그냥 밑에 나와야해. 1번 카드가 다시 한번 나오는
    // 거지"). No more chatMode switch to the legacy chat-stream.
    const newMsg = { id: Date.now(), role: 'user', text };
    const next = [...messages, newMsg];
    setMessages(next);
    setInputVal('');
    if (inputRef.current) inputRef.current.style.height = 'auto';
    // Collapse the slide-up chat bar on send — matches home's
    // chat-send → closeChat flow in App.jsx GlobalNav.
    setChatBarOpen(false);
    fetchCoachReply(toAPIMessages(next));
  }

  function toggleDeepOpen(id) {
    setDeepOpenIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }
  function toggleMoreOpen(id) {
    setMoreOpenIds(prev => {
      const n = new Set(prev);
      if (n.has(id)) n.delete(id); else n.add(id);
      return n;
    });
  }

  function renderInline(text) {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return parts.map((part, i) =>
      part.startsWith('**') && part.endsWith('**')
        ? <strong key={i} className={styles.coachBold}>{part.slice(2, -2)}</strong>
        : part
    );
  }
  function renderCoachText(text) {
    const paragraphs = text.split(/\n\n+/);
    if (paragraphs.length <= 1) return renderInline(text);
    return paragraphs.map((p, i) => (
      <span key={i} className={styles.coachParagraph}>{renderInline(p.trim())}</span>
    ));
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    // Escape collapses the chat bar without clearing the draft —
    // same behaviour as App.jsx GlobalNav's handler.
    if (e.key === 'Escape') closeLocalChat();
  }

  function handleSuggestion(text) {
    if (isTyping) return;
    const newMsg = { id: Date.now(), role: 'user', text };
    const next = [...messages, newMsg];
    setMessages(next);
    fetchCoachReply(toAPIMessages(next));
  }

  // Analysis 카드들이 있는지 — eye 외 섹션들
  function hasDeep(sections) {
    if (!Array.isArray(sections)) return false;
    return sections.some(s => s.icon === 'table' || s.icon === 'chart'
                           || s.icon === 'target' || s.icon === 'leaf'
                           || s.icon === 'chat');
  }

  // 사용자가 "Say it yourself" 탭 시 하단 채팅바에 포커스 +
  // 메시지 영역을 한번 더 스크롤해서 입력창을 인지시킨다.
  function focusChatInput() {
    inputRef.current?.focus({ preventScroll: false });
    setTimeout(() => {
      const el = messagesRef.current;
      if (el) el.scrollTop = el.scrollHeight;
    }, 40);
  }

  // TypedCoachText 가 글자 한 칸 내릴 때마다 호출해서 스크롤을 바닥에 고정.
  // 장문 타이핑 중 텍스트가 viewport 밑으로 밀려 안 보이는 걸 방지.
  function scrollToBottomNow() {
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }

  // Hero "Next" 버튼 동작:
  //   observation 카드에서 Next = perspective analysis 화면으로 전환.
  //   analysis 화면에서 Next = 기존 guided-draft 플로우 (handleOfferDraft).
  // 코치가 아직 타이핑 중이면 비활성.
  function handleHeroNext() {
    if (isTyping || phase !== 'chatting') return;
    handleEnterAnalysis();
  }

  // Kick off perspective-analysis:
  //   1. flip phase → 'analysisLoading' so the card swaps to a loading shell
  //   2. call analyzePerspective() with the raw vent + the latest observation
  //   3. on success → populate angles + flip phase to 'analysis'
  //   4. on failure → fall back to 'chatting' (silent; user can hit Next again)
  //
  // The raw vent is the user's FIRST message (the original unload), not any
  // follow-up the coach prompted. That's the "situation" we want the other
  // person's interior read on. The observation body is whatever latestCoach
  // currently holds — deep-read text if Mode B, surface reply if Mode A.
  async function handleEnterAnalysis() {
    setPhase('analysisLoading');
    setAnalysisIdx(0);
    const firstVent = messages.find(m => m.role === 'user')?.text || '';
    const observationText =
      [...messages].reverse().find(m => m.role === 'coach')?.text || '';
    try {
      const { angles } = await analyzePerspective(
        activePerson,
        firstVent,
        observationText,
      );
      if (!angles || angles.length === 0) {
        // Model returned nothing usable — skip the analysis screen entirely
        // and fall straight into draft so the user isn't stuck on an empty
        // deck. (Rare; analyzePerspective only returns [] on parse failure.)
        handleOfferDraft();
        return;
      }
      setAnalysisAngles(angles);
      setPhase('analysis');
    } catch {
      setPhase('chatting');
    }
  }

  // Deck → Draft transition. Exposed as the analysis screen's Next button.
  function handleAnalysisNext() {
    handleOfferDraft();
  }

  // (handleAnalysisBack removed — the analysis card no longer needs a
  //  back chevron. It now stacks below the observation card in the same
  //  heroScroll, so scrolling up IS the back affordance.)

  // 가장 최근 coach 메시지 — hero 카드의 소스
  const latestCoach = [...messages].reverse().find(m => m.role === 'coach');
  const firstUser   = messages.find(m => m.role === 'user');

  // heroNextEntered timer — placed AFTER `latestCoach` is computed so
  // the closure sees the initialized binding (const TDZ would throw if
  // this effect lived above the declaration). Once the coach reply
  // arrives, the Next button mounts with `.heroNextEntering` which runs
  // the one-shot heroNextIn cascade (respecting its inline
  // animation-delay derived from ctaDelayMs). After a conservative
  // 6000ms we flip the flag so the entering class is removed. By that
  // point the animation has finished; removing the class does NOT
  // cause a visible jump because fill-mode: both locks the final frame.
  // From here on, adding/removing heroNextLoading (during the API wait
  // for analysis) swaps animations between "nothing" and heroNextPulse,
  // never restarting heroNextIn — which was the root cause of "See
  // their side 버튼 누르면 잠깐 사라졌다가 다시 생기고 있어".
  //
  // Reset to false whenever no coach reply exists (user returned to
  // empty chat) so a fresh arrival re-triggers the entrance cleanly.
  useEffect(() => {
    if (!latestCoach) {
      setHeroNextEntered(false);
      return;
    }
    if (heroNextEntered) return;
    // Trimmed 6000 → 3500 alongside the thinking-flow tightening
    // per user ("thinking하는 과정의 시간이 너무 길어"). 3500ms still
    // comfortably outlasts the new reveal cascade (~1650ms for a
    // typical observation + CTA fade) while preventing the entering
    // class from sticking around long enough to be re-triggered by
    // later className toggles.
    const timer = setTimeout(() => setHeroNextEntered(true), 3500);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [latestCoach?.id, latestCoach?.text]);

  function markTyped(id) {
    setTypedIds(prev => {
      if (prev.has(id)) return prev;
      const n = new Set(prev);
      n.add(id);
      return n;
    });
  }

  /* ── bottomCta — phase-aware CTA descriptor for the bottom row.
     Per user: "카드들에서 하단 핑크색 버튼을 제거하고, 그 버튼을
     interactive하게 지금 현재 채팅바에 위치시키고 싶어. 대신 가로를
     반 잘라서, 왼쪽에 지금 저 핑크색 버튼으로 들어가고 (이게 카드들에
     있는 버튼) 그리고 그 오른쪽은 채팅 바가 들어가있게 해보고싶어."

     The CTA used to live inside each card (heroCard, analysisCard) as
     a stretched pink pill. With the CTA lifted to the bottom row, ONE
     pill slot handles every transition — label/handler swap as phase
     advances. Returning `null` hides the CTA entirely (chat bar then
     takes full width via flex:1 on .inputBar).

     States:
       chatting + coach not typing + coach reply present → Analyse
         (calls handleHeroNext → perspective-analysis API)
       chatting + no coach yet → null (chat input takes full row —
         user is still composing the first vent)
       chatting + isTyping → Analyse (disabled, gray PNG)
       analysisLoading → Analysing (disabled, per-letter wave via
         .heroNextLoadingWave)
       analysis → Help me respond (calls handleAnalysisNext)
       draftLoading → Shaping (disabled, .heroNextLoading pulse)
       drafting / destination / saved → null (user is editing / has
         chosen; no CTA makes sense while they're inside the draft
         card's own keep-talking / variant-pick flow)

     Why a descriptor rather than inline JSX in the bottom row?
     Centralising label+handler+className makes the bottom-row JSX
     a simple `{bottomCta && <button {...bottomCta.bind} />}` —
     keeps the render tree flat and makes the phase→visual mapping
     auditable at one site. */
  let bottomCta = null;
  if (phase === 'chatting' && latestCoach) {
    bottomCta = {
      label: 'Analyse',
      onClick: handleHeroNext,
      disabled: isTyping,
      stateClass: isTyping ? styles.heroNextDisabled : '',
      /* Wave rendering only when we're actively loading the next
         phase; in plain `chatting` the label is static text. */
      waveLetters: false,
    };
  } else if (phase === 'analysisLoading') {
    bottomCta = {
      /* Loading label + per-letter wave — the prior pink-interior
         breath experiment was rolled back per user ("버튼 관련한
         모션은 기존 버전으로 돌려"). Back to the established idiom:
         label swaps to the gerund ("Analysing") and each letter
         rides the .heroNextLoadingWave cycle so the word itself
         reads as "thinking". */
      label: 'Analysing',
      onClick: undefined,
      disabled: true,
      stateClass: styles.heroNextLoadingWave,
      waveLetters: true,
    };
  } else if (phase === 'analysis') {
    /* Idle CTA — no wave. Per user's follow-up ("지금 두번째 카드
       등장하자마자 바로 help me respond 버튼에 모션이 들어가있는데,
       그러면 안되지. 모션은 저걸 클릭하고 다음 컨텐츠가 나오기
       전에만 등장해야되는거지"): the letter-wave should ONLY run while
       we're actively waiting for the next phase's content, not on a
       resting clickable button. Wave now lives exclusively on the two
       loading states (analysisLoading → "Analysing", draftLoading →
       "Shaping…"). The resting Help me respond is a plain static
       label — visually calm until tapped. */
    bottomCta = {
      label: 'Help me respond',
      onClick: handleAnalysisNext,
      disabled: false,
      stateClass: '',
      waveLetters: false,
    };
  } else if (phase === 'draftLoading') {
    bottomCta = {
      /* Per user ("Analysing 될때 저 단어 모션 좋은데, 그걸 그
         shaping 여기에도 반영해줘"): Shaping now borrows the exact
         same motion package as Analysing — .heroNextLoadingWave
         for the ambient breath + pink pressed surface, and
         waveLetters:true so each glyph rides the travelling
         opacity wave (.heroNextWaveLetter spans with negative
         staggered animation-delays, rendered below). The old
         whole-button heroNextPulse was visually quieter but the
         user wanted the two loading labels to share one motion
         vocabulary so both "working" states read as "the model
         is thinking" in the same way. */
      label: 'Shaping',
      onClick: undefined,
      disabled: true,
      stateClass: styles.heroNextLoadingWave,
      waveLetters: true,
    };
  } else if (phase === 'drafting' && draftVariants.length > 0) {
    if (replayMode && replaySourceFrozen === 'vessel') {
      /* Replay of a Vessel entry — the draft already lives in Vessel,
         so the only meaningful forward action is migrating it to
         Archive (i.e. "I actually sent this"). Per user: "여긴 이미
         vessel에 들어와있는걸 보는거니까 move to archive 버튼만 있게
         해줘." Clicking fires moveToArchive(id), which (a) removes
         the entry from vesselEntries and (b) inserts it into
         archiveEntries with a fresh sentAt, preserving the full
         replay payload on the way across. The saved-confirmation
         overlay then reads `saved === 'archive'` to show its
         Archive-flavoured copy. */
      bottomCta = {
        replayArchive: true,
        onArchive: () => {
          moveToArchive(replayEntryFrozen.id);
          setSaved('archive');
          setPhase('saved');
        },
      };
    } else if (!replayMode) {
      /* DUAL-destination mode — per user's 3rd pass: while the draft
         card is open, the single pink pill splits into two commit
         buttons that save the active variant straight to its
         destination. `dualDestination` flag tells the JSX to render
         two half-width pill buttons (Vessel + Archive) in place of
         the single pill. */
      bottomCta = {
        dualDestination: true,
        onVessel: () => commitActiveVariant('vessel'),
        onArchive: () => commitActiveVariant('archive'),
      };
    }
    // Replay of an Archive entry (or any other source) → bottomCta
    // stays null. Archive replay already has no further "commit"
    // destination (it's been sent) so the rail stays empty.
  }
  /* phase === 'destination' / 'saved' → bottomCta stays null; chat
     input fills the row. The destination overlay + saved overlay
     host their own flows. */

  return (
    <div className={styles.screen}>

      {/* Register popup */}
      {showRegisterPopup && (
        <div className={styles.popupOverlay}>
          <div className={styles.popup}>
            <p className={styles.popupTitle}>
              "{unregisteredRelation}" is not registered yet.
            </p>
            <p className={styles.popupSub}>
              Register them first so I can give you better advice.
            </p>
            <div className={styles.popupActions}>
              <button className={styles.popupPrimary} onClick={() => navigate('onboarding')}>
                Register now
              </button>
              <button className={styles.popupSecondary} onClick={() => {
                setShowRegisterPopup(false);
                if (chatDraft.trim()) {
                  setMessages([{ id: Date.now(), role: 'user', text: chatDraft }]);
                }
              }}>
                Skip for now
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Header */}
      <div className={styles.header}>
        <BackButton className={styles.backBtn} onClick={goBack} />
        {headerPerson && (
          <div className={styles.personLabel}>
            {/* Uses headerPerson (not activePerson) so an unregistered
                detected relation like "sister" still updates the
                top-bar label — per user: "사용자가 어떤 텍스트를
                넣더라도 그 글을 읽고, 너가 텍스트를 인식해서 저
                위에 네이밍을 바꿔줘야해." */}
            <span className={styles.personName}>{headerPerson.name || headerPerson.relation}</span>
          </div>
        )}
      </div>

      {/* ═══════════════════════════════════════════════════════
           HERO OBSERVATION VIEW — the one and only chat surface.
           Per user's latest pass: the old chat-stream fallback
           (avatar-bubble cards + chip suggestions + per-msg typing
           effect) is deleted entirely — any follow-up user message
           just appends a new user bubble + a new hero-style coach
           card beneath the existing conversation. Everything here
           is a single scroll of stacked turns.
           ═════════════════════════════════════════════════════ */}
      {(phase === 'chatting' || phase === 'draftLoading' || phase === 'analysisLoading' || phase === 'analysis' || phase === 'drafting') && (
        <div
          className={`${styles.heroScroll} ${isArchiveReplay ? styles.heroScrollArchiveReplay : ''}`}
          ref={heroScrollRef}
        >
          {/* Conversation stream rendered as alternating user bubbles
              and hero coach cards. The last-pending turn (user msg
              with no coach reply yet) gets an additional thinking-
              state hero card appended to its right, carrying the
              centered character + "thinking" wave. heroCardRef tracks
              whichever card is terminal (latest coach card when settled,
              or the thinking card while awaiting) so the snap-scroll
              effect keeps pulling the viewport to the newest content. */}
          {(() => {
            const isAwaitingReply =
              messages.length > 0 && messages[messages.length - 1].role === 'user';
            const terminalCoachId = isAwaitingReply ? null : latestCoach?.id ?? null;

            // Helper — renders the quote/body content block for a
            // coach message. Kept as a local closure so it closes over
            // BASE_DELAY_MS / WORD_GAP_MS / styles from the render
            // scope without needing props threading.
            const renderCoachBody = (coachMsg) => {
              const runs = splitEmphasis(coachMsg.text);
              // hasSplit decides whether to render opener + DIVIDER
              // LINE + body (the two-part empathy/understanding
              // structure the user keeps asking us to preserve:
              // "글을 두개로 나누고 그 사이에 선 들어가잖아...
              //  (공감, 이해) 그 전제는 바뀌지않아").
              //
              // Regex accepts a terminal .!?, with an OPTIONAL
              // trailing quote/paren — without that, an opener like
              // `That's a sharp sting, the word 'wasted.'` fails the
              // check (last char is `'`, not `.`) and the whole
              // message collapses into a single paragraph, erasing
              // the divider.
              const hasSplit =
                runs.length >= 2 &&
                runs[0].italic &&
                /[,.!?]['")\]]?$/.test(runs[0].text.trim());

              const openerText = hasSplit ? runs[0].text : '';
              const bodyRuns   = hasSplit ? runs.slice(1) : runs;
              const bodyTextJoined = bodyRuns.map(r => r.text).join('');
              const eyeSec  = coachMsg.sections?.find(s => s.icon === 'eye');
              const chatSec = coachMsg.sections?.find(s => s.icon === 'chat');
              const heroBodyText = eyeSec?.text || chatSec?.text || '';

              const openerWC   = countWords(openerText);
              const bodyWC     = countWords(bodyTextJoined);
              const heroBodyWC = countWords(heroBodyText);
              void heroBodyWC;

              const dividerDelayMs =
                BASE_DELAY_MS + openerWC * WORD_GAP_MS + 140;

              const renderWords = (text, italic, baseIdx) => {
                if (!text) return null;
                const tokens = text.match(/\S+|\s+/g) || [];
                let sub = 0;
                return tokens.map((t, i) => {
                  if (/^\s+$/.test(t)) {
                    return (
                      <Fragment key={`ws-${coachMsg.id}-${baseIdx}-${i}`}>{t}</Fragment>
                    );
                  }
                  const idx = baseIdx + sub;
                  sub += 1;
                  const delay = BASE_DELAY_MS + idx * WORD_GAP_MS;
                  const cls = italic
                    ? `${styles.heroWord} ${styles.heroQuoteItalic}`
                    : styles.heroWord;
                  return (
                    <span
                      key={`w-${coachMsg.id}-${baseIdx}-${idx}`}
                      className={cls}
                      style={{ animationDelay: `${delay}ms` }}
                    >
                      {t}
                    </span>
                  );
                });
              };

              let cursor = openerWC;
              const bodyChildren = bodyRuns.map((r, i) => {
                const node = renderWords(r.text, r.italic, cursor);
                cursor += countWords(r.text);
                return <Fragment key={`br-${coachMsg.id}-${i}`}>{node}</Fragment>;
              });

              const heroBodyStartIdx = openerWC + bodyWC;

              return (
                <>
                  <div className={styles.heroQuote}>
                    {hasSplit ? (
                      <>
                        <p className={styles.heroQuoteOpener}>
                          {renderWords(openerText, true, 0)}
                        </p>
                        <div
                          className={styles.heroDivider}
                          style={{ animationDelay: `${dividerDelayMs}ms` }}
                        />
                        <p className={styles.heroQuoteBody}>
                          {bodyChildren}
                        </p>
                      </>
                    ) : (
                      <p className={styles.heroQuoteBody}>
                        {bodyRuns.map((r, i) => {
                          const base =
                            openerWC +
                            bodyRuns
                              .slice(0, i)
                              .reduce((n, x) => n + countWords(x.text), 0);
                          return (
                            <Fragment key={`fb-${coachMsg.id}-${i}`}>
                              {renderWords(r.text, r.italic, base)}
                            </Fragment>
                          );
                        })}
                      </p>
                    )}
                  </div>
                  {heroBodyText && (
                    <p className={styles.heroBody}>
                      {renderWords(heroBodyText, false, heroBodyStartIdx)}
                    </p>
                  )}
                </>
              );
            };

            const nodes = [];
            // Track coach-turn index so we can mark every coach card
            // AFTER the first with .heroCardFill. Per user: "첫번째
            // 카드는 짧을수있으니까 첫번째 카드는 예외. 두번째 카드
            // 부터 그 이후에 나오는 모든 것들에만 적용." The first
            // coach card stays content-driven (can be tiny if the
            // observation is short); every subsequent coach card
            // gets min-height so that, when scrolled to max, its
            // bottom sits exactly ~30px above the bottom button bar
            // rather than floating halfway up the viewport.
            let coachIdx = 0;
            messages.forEach(msg => {
              if (msg.role === 'user') {
                nodes.push(
                  <div key={`u-${msg.id}`} className={styles.userMsgRow}>
                    <div className={styles.userMsgBubble}>{msg.text}</div>
                  </div>
                );
                return;
              }
              // coach — render as a stacked hero card. Only the terminal
              // coach card gets heroCardRef so the snap-scroll effect
              // targets the newest reply.
              const isTerminal = msg.id === terminalCoachId;
              const isFollowUp = coachIdx > 0;
              coachIdx += 1;
              nodes.push(
                <div
                  key={`c-${msg.id}`}
                  className={`${styles.heroCard} ${isFollowUp ? styles.heroCardFill : ''}`}
                  ref={isTerminal ? heroCardRef : null}
                >
                  <div className={styles.heroCharSlot}>
                    <div className={styles.heroChar} aria-hidden="true">
                      <div className={styles.heroCharHalo} />
                      <img
                        src="/asset/splash-character.png"
                        alt=""
                        className={styles.heroCharImg}
                      />
                    </div>
                  </div>
                  {renderCoachBody(msg)}
                </div>
              );
            });

            // Pending-turn thinking card. Same chrome as the settled
            // card (.heroCard) but with the thinking modifier classes so
            // the character centers vertically and the "thinking" wave
            // shows below it. When the coach reply lands, this unmounts
            // and the next iteration through the map paints the
            // fully-settled card at the same stack position.
            // The thinking card itself is also a "follow-up" if any
            // coach card has already rendered (coachIdx > 0) — apply
            // the fill rule so its bottom lands 30px above the button
            // bar instead of floating. If no coach card has rendered
            // yet, this is the first-turn thinking state and should
            // stay content-driven (no forced fill).
            if (isAwaitingReply) {
              const thinkingIsFollowUp = coachIdx > 0;
              nodes.push(
                <div
                  key="thinking"
                  className={`${styles.heroCard} ${styles.heroCardThinking} ${thinkingIsFollowUp ? styles.heroCardFill : ''}`}
                  ref={heroCardRef}
                >
                  <div className={`${styles.heroCharSlot} ${styles.heroCharSlotThinking}`}>
                    <div className={styles.heroChar} aria-hidden="true">
                      <div className={styles.heroCharHalo} />
                      <img
                        src="/asset/splash-character.png"
                        alt=""
                        className={`${styles.heroCharImg} ${styles.heroCharImgThinking}`}
                      />
                    </div>
                    <div className={styles.heroThinking}>
                      {/* Per-letter wave per user: each glyph fades in
                          on its own phase via .heroThinkingLetter
                          nth-child delays. */}
                      <span className={styles.heroThinkingWord} aria-label="thinking">
                        <span aria-hidden="true" className={styles.heroThinkingLetter}>t</span>
                        <span aria-hidden="true" className={styles.heroThinkingLetter}>h</span>
                        <span aria-hidden="true" className={styles.heroThinkingLetter}>i</span>
                        <span aria-hidden="true" className={styles.heroThinkingLetter}>n</span>
                        <span aria-hidden="true" className={styles.heroThinkingLetter}>k</span>
                        <span aria-hidden="true" className={styles.heroThinkingLetter}>i</span>
                        <span aria-hidden="true" className={styles.heroThinkingLetter}>n</span>
                        <span aria-hidden="true" className={styles.heroThinkingLetter}>g</span>
                      </span>
                    </div>
                  </div>
                </div>
              );
            }
            return nodes;
          })()}

          {/* ═══════════════════════════════════════════════════════════
              PERSPECTIVE ANALYSIS CARD — stacks BELOW the observation
              card inside the same heroScroll. Per user ("tuning in 하고
              나면 새로운 페이지로 넘어가는게 아니라 채팅하듯이 그 밑으로
              새로운 카드가 나오고 자동으로 또 위치 세팅되게 해"), we do
              NOT swap to a separate screen anymore — the analysis card
              simply appears in the same vertical scroll, chat-style.
              The auto-scroll tween (see the useEffect targeting
              analysisCardRef) delivers the "arrive + viewport meets it"
              motion that sells the chat-like cadence.

              Both .heroCard and .analysisCard carry min-height: 100%
              so each fills the scroller's visible area — stacking them
              yields ~2× scrollable content, so when the viewport snaps
              to the analysis card the observation card recedes off-top
              and the user can scroll back up to re-read it.
              ═══════════════════════════════════════════════════════════ */}
          {/* Analysis card stays mounted through 'draftLoading' too —
              otherwise the moment the user taps "Help me respond" the phase
              flips to draftLoading and this condition used to unmount the
              card, which visually snapped the scroller back up to the
              observation card until the API returned and phase became
              'drafting'. Per user: "두번째 카드에서 Help me respond 버튼
              누르면 그 두번째 카드가 사라지고 첫번째 카드로 돌아왔다가
              완료되면 그제서야 3번째 카드가 나오고있어. 두번째 카드에서
              눌렀으면 두번째 카드 버튼에서 모션 생기고 그리고 세번째
              카드가 그 밑에 나와야지." Adding 'draftLoading' keeps the
              analysis card rendered, the Help-me-respond button shows its
              loading motion in place, and the draft card slides in below
              when it arrives — no jump-back. */}
          {(phase === 'analysis' || phase === 'draftLoading' || phase === 'drafting') && analysisAngles.length > 0 && (
            <div className={styles.analysisCard} ref={analysisCardRef}>
              {/* Header: stacked-card style header without a back
                  chevron. Per user ("이제 그 버튼 눌러서 나온 컨텐츠에서
                  back button은 없어도 돼"), the analysis is a stacked card
                  inside the same scroller as the observation card —
                  scrolling up is the natural "back".

                  The character badge that used to live at top-right was
                  replaced with the deck index (01/04) per user ("우측에
                  캐릭터 제거하고 그 위치에 01/04 저거 넣자"). The index
                  reads from analysisIdx so it stays in sync as the user
                  swipes horizontally through the angle deck below —
                  functionally identical to the per-card .angleIndex
                  (which we're dropping to avoid duplication), but
                  anchored in the header so it's always visible and the
                  deck itself can breathe. */}
              <div className={styles.analysisHeader}>
                <div className={styles.analysisTitleWrap}>
                  <div className={styles.analysisTitleLabel}>perspective</div>
                  <div className={styles.analysisTitle}>
                    Why {activePerson?.name || activePerson?.relation || 'they'} might&apos;ve…
                  </div>
                </div>
                <div className={styles.analysisHeaderIndex} aria-hidden="true">
                  {String(analysisIdx + 1).padStart(2, '0')}
                  <span className={styles.analysisHeaderIndexSep}> / </span>
                  {String(analysisAngles.length).padStart(2, '0')}
                </div>
              </div>

              {/* Horizontal snap deck — one mini-card per angle. flex:0 0 100%
                  makes each card take the full deck width so scroll-snap
                  stops cleanly at each. */}
              <div
                className={styles.angleDeck}
                onScroll={e => {
                  const scroller = e.currentTarget;
                  const cardWidth = scroller.clientWidth;
                  const idx = Math.round(scroller.scrollLeft / Math.max(cardWidth, 1));
                  if (idx !== analysisIdx) setAnalysisIdx(idx);
                }}
              >
                {analysisAngles.map((angle, i) => {
                  /* MBTI portrait is locked to the first page of the
                     deck only. Per user: "mbti 캐릭터는 첫페이지에만
                     쓰자." The LLM sometimes flags multiple angles with
                     `mbtiFeatured: true`, which would show the same
                     MBTI character on several cards and break the
                     visual variety that the gradient-shape rotation
                     is meant to provide. Gating on `i === 0` keeps
                     the portrait as a one-shot opener even if the
                     model is over-eager with the flag. */
                  const mbtiSrc = (i === 0 && angle.mbtiFeatured)
                    ? getMbtiImageSrc(activePerson?.mbti, inferGender(activePerson))
                    : null;
                  /* Placeholder past-memory reference — shown on the
                     non-MBTI cards (indexes 01-03 of the deck). The
                     chip acts as a breadcrumb: "this angle was
                     informed by the time you told me about …".
                     Real data to come from the chat-history retrieval
                     layer; for now the values are static fakes. */
                  const memory = !mbtiSrc ? FAKE_MEMORIES_BY_INDEX[i] : null;
                  /* Gradient-shape PNG for cards that aren't showing the
                     MBTI portrait. Per user: "asset파일 속 gradient shapes
                     파일 속에 있는 애들을 무작위로 선정해서 넣어줘."
                     themeShapes is a length-4 array picked at analysis-
                     mount time (one slot per angle card, indexed directly
                     by i). When the MBTI portrait wins on page 0, the
                     matching themeShapes[0] just goes unused — simpler
                     than shifting indices. */
                  const themeShape = !mbtiSrc ? themeShapes[i] : null;

                  /* Word-by-word reveal for the analysis card — mirrors
                     the observation card's `.heroWord` cascade so the
                     two cards feel like they share the same typographic
                     voice. Per user: "see their side 버튼 누르고 나오는
                     두번째 카드 나올때도 첫번째와 같이 컨텐츠들이 타자
                     치듯이 물 흐르듯 부드럽게 나와야하는데."

                     Timing:
                       BASE 260ms — lets `.analysisCard`'s entrance
                         fade-in (0.6s @ 0.08s delay) get most of the
                         way through before the first word ticks on.
                       GAP  42ms — slightly snappier than the hero
                         card's 48ms cadence because each angle has
                         more text overall (label + body + quote);
                         keeping 48 here would drag. 42 still reads as
                         deliberate, not rushed.

                     Scope: the counter `wc` is card-local, so every
                     angle's cascade starts from delay 0 relative to
                     mount. All four angle cards mount simultaneously
                     when the deck appears, so their cascades run in
                     parallel — the user only sees card 01 animating
                     live; 02-04 finish their cascade while offscreen,
                     then read as pre-settled when swiped in. That's
                     fine because the "typewriter reveal" is part of
                     the *arrival* moment, not a per-swipe flourish.

                     Reuses `.heroWord` CSS — identical opacity+translate
                     shape, no need to duplicate the rule. Keys are
                     stable (token-index within each text run), so
                     horizontal swipes don't re-mount spans and the
                     animation doesn't re-fire. */
                  // Trimmed 260/42 → 160/26 alongside the broader thinking-flow
                  // speedup per user "thinking하는 과정의 시간이 너무 길어". The
                  // angle deck now finishes its reveal quickly enough that the
                  // first card's cascade is largely done by the time the auto-
                  // snap tween lands, so the card reads as "arrived" rather
                  // than "still typing."
                  const ANGLE_BASE_MS = 160;
                  const ANGLE_GAP_MS = 26;
                  const wc = { count: 0 };
                  const renderAngleWords = (text, runKey) => {
                    if (!text) return null;
                    const tokens = text.split(/(\s+)/);
                    return tokens.map((tok, idx) => {
                      if (/^\s+$/.test(tok) || tok === '') {
                        return <Fragment key={`${runKey}-ws-${idx}`}>{tok}</Fragment>;
                      }
                      const delay = ANGLE_BASE_MS + wc.count * ANGLE_GAP_MS;
                      wc.count += 1;
                      return (
                        <span
                          key={`${runKey}-w-${idx}`}
                          className={styles.heroWord}
                          style={{ animationDelay: `${delay}ms` }}
                        >
                          {tok}
                        </span>
                      );
                    });
                  };
                  return (
                    <article key={i} className={styles.angleCard}>
                      {/* Per-card index moved to the card header (see
                          .analysisHeaderIndex). Removing the duplicate
                          here lets the character illustration breathe
                          at the top of each card. */}
                      {mbtiSrc && (
                        <img
                          src={mbtiSrc}
                          alt=""
                          aria-hidden="true"
                          className={styles.angleMbtiChar}
                        />
                      )}
                      {themeShape && (
                        <img
                          src={themeShape}
                          alt=""
                          aria-hidden="true"
                          className={styles.angleThemeArt}
                        />
                      )}
                      {/* Memory card (index 3): the past-record is the
                          headline. A small pink kicker sits above the hero
                          label, and the label itself is the memory title
                          (replacing the LLM's angle.title on this one card).
                          angle.body still comes from the LLM and reads as
                          "analysis of the current situation informed by
                          that past event." Other cards render angle.title
                          directly as before. Per user: "이전 기록이 메인으로
                          들어가는 페이지인거지. 이전기록에 따라서 분석해준
                          거지 이번 상황에 대해." */}
                      {memory ? (
                        <>
                          <span className={styles.angleMemoryKicker}>
                            {renderAngleWords('From a memory', 'mem-kicker')}
                          </span>
                          <div className={styles.angleLabel}>
                            {renderAngleWords(memory.title, 'mem-title')}
                          </div>
                        </>
                      ) : (
                        <div className={styles.angleLabel}>{renderAngleWords(angle.title, 'lbl')}</div>
                      )}
                      <p className={styles.angleBody}>{renderAngleWords(angle.body, 'body')}</p>
                      {angle.quote && (
                        <blockquote className={styles.angleQuote}>
                          &ldquo;{renderAngleWords(angle.quote, 'qt')}&rdquo;
                        </blockquote>
                      )}
                    </article>
                  );
                })}
              </div>

              {/* Pagination dots — one per angle, active one highlighted. */}
              <div className={styles.angleDots}>
                {analysisAngles.map((_, i) => (
                  <span
                    key={i}
                    className={`${styles.angleDot} ${i === analysisIdx ? styles.angleDotActive : ''}`}
                    aria-hidden="true"
                  />
                ))}
              </div>

              {/* CTA removed per user: the "Help me respond" pill now
                  lives in the bottom .inputRow next to the chat input,
                  sharing the half-width slot with the phase-aware
                  Analyse button. Keeping a single CTA slot across every
                  phase means the user's eye never has to re-scan the
                  card for the next action — the button stays anchored
                  at the thumb zone regardless of which card they're
                  looking at. */}
            </div>
          )}

          {/* ═══════════════════════════════════════════════════════════
              DRAFT CARD — third stacked card, same liquid-glass shell.
              Per user ("두번째 카드 나오고 draft a message하면 지금 그
              두번째 카드가 사라지고 완전 이상한 디자인의 action, words
              이게 나오네. 기존 카드 디자인으로 디자인 유지하고, 모션
              으로 이제 새로운 카드가 등장하는걸로 해야돼. 전체적으로
              개선해"), the guided-draft UI no longer unmounts the
              observation + analysis deck and replaces the viewport
              with a differently-styled block. Instead it mounts INSIDE
              the same heroScroll below the analysis card, inheriting
              the same .liquid-glass surface treatment
              (backdrop-filter, pink wash ::before, iridescent ring
              ::after) so all three cards read as one visual family.
              The draftSnappedRef snap effect above tweens the scroll
              to land on this card when it arrives.

              Content order:
                ┌─ header (kicker "next step" + title nudge)
                ├─ Action section (if present)  — the behaviour move
                ├─ Words section — two variant buttons
                └─ Keep-talking escape hatch
              ═══════════════════════════════════════════════════════════ */}
          {phase === 'drafting' && draftVariants.length > 0 && (() => {
            // Single-page draft card — just Words.
            // Earlier iterations paired an Action page with Words in a
            // horizontal swipe deck (see .draftDeck below + retired
            // pagination dots), but per user (this pass): "Action 카드는
            // 그냥 삭제하고, 저 카드는 Words 만 나오게 하자. 카드 맨 위에
            // Next Step 을 그냥 words로 바꾸고 지금 있는 words 저기는
            // 그냥 없애도 될거같아." So:
            //   • header kicker flipped from "next step" → "Words"
            //     (single source of truth for what the card is)
            //   • Action sub-section removed from the render (we still
            //     let the claude util populate draftAction, just no
            //     longer surface it — cheaper than rewiring the whole
            //     draft pipeline)
            //   • the inner per-section "Words" kicker is retired since
            //     the header already carries that label
            //   • "01/02" page-counter badge is gone along with it —
            //     only one page remains
            //   • pagination dots suppressed (totalPages === 1)
            //   • the .draftDeck wrapper is kept as-is to avoid churning
            //     the scroll-snap CSS; with one child it's inert
            const totalPages = 1;
            return (
            <div className={styles.draftCard} ref={draftCardRef}>
              <div className={styles.draftCardHeader}>
                <div className={styles.analysisTitleWrap}>
                  {/* Kicker: "What to Say" — per user (this pass):
                      "3번째 카드 맨 위에 Words라고 하지말고 What to
                      Say라고 하자." Reads more like a promise of
                      content ("here is what you could say") than
                      an abstract content-type label ("Words"), and
                      matches the "Next step / What to Say" rhythm
                      of the cards above. */}
                  <div className={styles.analysisTitleLabel}>What to Say</div>
                  <div className={styles.analysisTitle}>
                    {draftNudge || 'Here\u2019s a starting shape'}
                  </div>
                </div>
              </div>

              {/* Horizontal snap deck — Action page + Words page. Same
                  scroll-snap + onScroll index sync as .angleDeck on the
                  2nd card, so the two cards swipe identically. */}
              <div
                className={styles.draftDeck}
                ref={draftDeckRef}
                onScroll={e => {
                  const scroller = e.currentTarget;
                  const cardWidth = scroller.clientWidth;
                  const idx = Math.round(scroller.scrollLeft / Math.max(cardWidth, 1));
                  if (idx !== draftIdx) setDraftIdx(idx);
                }}
              >
                {/* ── Page 01 — Words (말).
                    (The Page-01 "Action" sub-card that used to live
                    here was removed per user: "Action 카드는 그냥
                    삭제하고, 저 카드는 Words 만 나오게 하자." The
                    draftAction state + its claude.js generation are
                    still around so nothing downstream breaks — they
                    just no longer have a render target.)
                    Per user this pass:
                    1) drop the random Shapes art at the top — the
                       character itself becomes the Words page's
                       visual anchor ("words 그 부분에서는 그 Shapes
                       파일 이미지들을 랜덤으로 사용하는게 아니라
                       저 캐릭터 이미지 배치해놓고 개가 평가하는거
                       그것만 ux 적으로 잘 배치해보면 좋을거같아.")
                    2) put the character's evaluation ABOVE the
                       textarea, not below ("캐릭터가 평가해주는
                       부분은 위로 배치해줘").
                    3) widen the glass box (reduce internal
                       padding) so the editor has more horizontal
                       room.
                    4) live-highlight problematic spans in red
                       INSIDE the editor + surface the reason in
                       the character's bubble ("제거했으면 하는
                       부분은 빨갛게 표시해주면 좋을거같아. 이유도
                       알려주고 저 캐릭터 말풍선 같은거에서 말이야.")

                    Layout stack:
                      ┌─ character anchor (image + live bubble) ─┐
                      │  Words · edit freely                     │
                      │  [liquid-glass box]                      │
                      │    [fit meter + chip row]                │
                      │    [textarea w/ red-highlight mirror]    │
                      │  [copy-text footer]                      │
                      └──────────────────────────────────────────┘
                    */}
                <div className={styles.draftCardSection}>
                  {(() => {
                    // Compute fit against the ACTIVE variant's current
                    // text so the character's anchor bubble reflects
                    // whatever draft the user is editing. Re-evaluates
                    // every render (cheap, pure lexical scan).
                    const activeTextTop =
                      variantDrafts[activeVariantIdx] ??
                      draftVariants[activeVariantIdx]?.text ??
                      '';
                    const fitTop = analyzeDraftFit(activeTextTop, activePerson);
                    /* Character anchor, hero-card rhythm.
                       Per user this pass: "이거 이렇게 넣지 말고, 1번
                       카드처럼 캐릭터 중앙에 좀 크게 들어가고, 말풍선
                       밑으로 해줘." Previously the character rode a
                       tiny 42px pill next to an inline verdict, which
                       looked like a chip, not a narrator. Now it
                       mirrors the 1st card's .heroChar layout —
                       large centered portrait (~180px) with the
                       evaluator's reading as a subtitle line BELOW
                       it. Same splash-character.png + float-breath
                       animation, same vertical-stack discipline,
                       just scoped to the Words page so the draft
                       feedback feels voiced by the same companion
                       that greeted the user on card 1. */
                    return (
                      <div className={styles.draftWordsCharHero}>
                        <div className={styles.draftWordsCharHeroImgWrap} aria-hidden="true">
                          <img
                            src="/asset/splash-character.png"
                            alt=""
                            className={styles.draftWordsCharHeroImg}
                          />
                        </div>
                        <div className={styles.draftWordsCharHeroBubble}>
                          {fitTop.verdict}
                        </div>
                      </div>
                    );
                  })()}
                  {/* The external "edit freely" hint that used to live
                      here was retired per user: "edit freely 저거
                      뭔가 그냥 잘 보이지도 않고 그래서 그냥 빼는건
                      어떨까 싶은데." Agreed — a micro-hint floating
                      above the box was a weak signal (small, easy to
                      miss, and sat outside the field it described).
                      Replaced with an in-box tap-to-edit affordance
                      that lives where the user's eye is already
                      looking (see .draftWordsTapHint inside the
                      .draftWordsBox below). */}
                  {draftVariants.map((v, i) => {
                    const currentText = variantDrafts[i] ?? v.text ?? '';
                    // Live fit-check — recomputes on every render
                    // (every keystroke triggers a re-render because
                    // the editor's value is controlled by
                    // variantDrafts state). analyzeDraftFit is pure
                    // lexical scan, safe to run per render.
                    const fit = analyzeDraftFit(currentText, activePerson);
                    return (
                      /* Liquid-glass box contains the fit meter + chips
                         stacked ABOVE the editor (per user's "위로
                         배치" request), and the editor itself now has
                         a mirror-div behind it that paints red
                         highlights over problematic spans. */
                      <div
                        key={i}
                        className={`${styles.draftWordsBox} ${activeVariantIdx === i ? styles.draftWordsBoxActive : ''}`}
                        onClick={() => setActiveVariantIdx(i)}
                      >
                        {/* Fit meter with plain-language label.
                            Per user: "저기 게이지 바가 나타내는게
                            뭐야? 모든거에 의미가 있어야해." The gauge
                            now anchors its own meaning — an uppercase
                            kicker on the left ("TONE READING FOR
                            [name]") says what it IS, a one-word live
                            descriptor on the right says what the
                            current score READS as, and both update
                            as the user types. The signal chips that
                            used to live below the meter (sharp /
                            gentle / opens up) are gone — they were
                            redundant with the bubble above and
                            floated unlabeled, adding cognitive load
                            without adding clarity. The bubble's
                            verdict covers the same ground in plain
                            sentences. */}
                        {/* Tone meter wrapped as its own liquid-glass
                            mini-card per user (this pass): "저 tone
                            for dad 저 카드도 좀 더 liquid glass
                            스타일 반영해줘." The label + gauge now
                            live inside .draftToneMeterCard — a
                            translucent inner pill with hairline rim,
                            top specular, and an inset shade, so the
                            tone row reads as its own object inside
                            the outer Words glass box (glass-within-
                            glass, not flat content on glass). */}
                        <div className={styles.draftToneMeterCard}>
                          {(() => {
                            const whoShort =
                              activePerson?.name ||
                              activePerson?.relation ||
                              'them';
                            // Band → descriptor + color class. Tracks
                            // the same thresholds analyzeDraftFit uses
                            // for its fallback verdicts so the word
                            // under the meter agrees with the bubble
                            // when there's no active issue.
                            const s = fit.score;
                            let valueText;
                            let valueToneClass;
                            if (fit.empty) {
                              valueText = 'waiting…';
                              valueToneClass = '';
                            } else if (s >= 82) {
                              valueText = 'lands warmly';
                              valueToneClass = styles.draftFitMeterLabelValueHigh;
                            } else if (s >= 68) {
                              valueText = 'reads gently';
                              valueToneClass = styles.draftFitMeterLabelValueHigh;
                            } else if (s >= 54) {
                              valueText = 'mostly lands';
                              valueToneClass = styles.draftFitMeterLabelValueMid;
                            } else if (s >= 38) {
                              valueText = 'a touch sharp';
                              valueToneClass = styles.draftFitMeterLabelValueMid;
                            } else {
                              valueText = 'reads sharp';
                              valueToneClass = styles.draftFitMeterLabelValueLow;
                            }
                            return (
                              <div className={styles.draftFitMeterLabel}>
                                {/* Kicker shortened per user: "Tone
                                    reading for dad 라고 하지말고 좀
                                    간단하게 핵심만 넣으면 좋겠어."
                                    "Tone for {name}" keeps the two
                                    load-bearing words (the dimension
                                    being measured + who it's aimed
                                    at) and drops the ceremony. */}
                                <span className={styles.draftFitMeterLabelKicker}>
                                  Tone for {whoShort}
                                </span>
                                <span
                                  className={`${styles.draftFitMeterLabelValue} ${valueToneClass}`}
                                >
                                  {valueText}
                                </span>
                              </div>
                            );
                          })()}
                          <div
                            className={styles.draftFitMeter}
                            role="meter"
                            aria-valuemin={0}
                            aria-valuemax={100}
                            aria-valuenow={fit.score}
                            aria-label={`Tone for ${activePerson?.name || activePerson?.relation || 'recipient'}`}
                          >
                            <div
                              className={styles.draftFitMeterFill}
                              style={{ width: `${fit.score}%` }}
                            />
                            <div
                              className={styles.draftFitMeterMarker}
                              style={{ left: `${fit.score}%` }}
                            />
                          </div>
                        </div>

                        {/* Editor stack — a mirror div (transparent
                            text, red-bg <mark> spans at issue offsets)
                            + the real textarea on top, grid-stacked
                            so they perfectly overlap. The textarea
                            renders the visible text + caret; the
                            mirror paints red highlights that show
                            through behind those letters (the textarea
                            has transparent background).
                            Both must share font/size/line-height/
                            white-space exactly — otherwise the
                            highlights drift off the letters. */}
                        <div className={styles.draftEditorWrap}>
                          <div
                            className={styles.draftEditorMirror}
                            aria-hidden="true"
                          >
                            {(() => {
                              if (fit.issues.length === 0) {
                                // No highlights — render plain text
                                // (still transparent, just no marks).
                                // Trailing zero-width space makes the
                                // mirror's last line match the
                                // textarea's one (otherwise a blank
                                // trailing line wouldn't take height).
                                return <>{currentText}{'\u200B'}</>;
                              }
                              const parts = [];
                              let pos = 0;
                              fit.issues.forEach((iss, idx) => {
                                if (pos < iss.start) {
                                  parts.push(
                                    <Fragment key={`t-${idx}`}>
                                      {currentText.slice(pos, iss.start)}
                                    </Fragment>
                                  );
                                }
                                parts.push(
                                  <mark
                                    key={`m-${idx}`}
                                    className={styles.draftEditorMark}
                                  >
                                    {currentText.slice(iss.start, iss.end)}
                                  </mark>
                                );
                                pos = iss.end;
                              });
                              if (pos < currentText.length) {
                                parts.push(
                                  <Fragment key="t-end">
                                    {currentText.slice(pos)}
                                  </Fragment>
                                );
                              }
                              parts.push(<Fragment key="eol">{'\u200B'}</Fragment>);
                              return parts;
                            })()}
                          </div>
                          <textarea
                            className={styles.draftVariantEditor}
                            data-variant-editor={i}
                            value={currentText}
                            onFocus={() => setActiveVariantIdx(i)}
                            onChange={(e) => {
                              const val = e.target.value;
                              setVariantDrafts(prev => {
                                const next = [...prev];
                                next[i] = val;
                                return next;
                              });
                              // Auto-grow — also lets the mirror
                              // follow via the shared grid cell.
                              e.target.style.height = 'auto';
                              e.target.style.height = e.target.scrollHeight + 'px';
                            }}
                            ref={(el) => {
                              // Size once on mount to match seeded text.
                              if (el && el.dataset.sized !== '1') {
                                el.style.height = 'auto';
                                el.style.height = el.scrollHeight + 'px';
                                el.dataset.sized = '1';
                              }
                            }}
                            rows={1}
                            spellCheck
                            readOnly={replayMode}
                          />
                        </div>
                        {/* Tap-to-soften chip row — appears below the
                            editor whenever the live fit-check flags one
                            or more spans. Each chip shows the red-
                            highlighted phrase + its canned replacement
                            ("you didn't → I feel"), and tapping it
                            splices that replacement into the textarea
                            at the exact offsets the highlight covers.
                            Per user: "빨갛게 처리하고 그 부분 클릭하면
                            tone 과 words를 바꾼 형태로 바꿔주는 옵션을
                            넣으면 어떨까?" — this is that affordance.
                            Lives on a separate row (rather than popovers
                            anchored to each mark) so the user can scan
                            all flagged phrases at once and pick which
                            to accept, without having to precisely tap a
                            highlighted span inside the editing surface
                            (which would compete with caret placement). */}
                        {fit.issues.length > 0 && (
                          <div
                            className={styles.draftFixRow}
                            aria-label="Suggested tone fixes"
                          >
                            {fit.issues.map((iss, issIdx) => (
                              <button
                                key={`fix-${i}-${iss.start}-${iss.end}-${issIdx}`}
                                type="button"
                                className={styles.draftFixChip}
                                onClick={(e) => {
                                  // Don't bubble up to .draftWordsBox's
                                  // onClick (which only sets active
                                  // variant) — we want the tap to read
                                  // as "apply fix", not "pick variant".
                                  e.stopPropagation();
                                  setActiveVariantIdx(i);
                                  setVariantDrafts(prev => {
                                    const next = [...prev];
                                    const t = next[i] ?? currentText;
                                    // Splice suggestion over the exact
                                    // [start, end) range of the flagged
                                    // match. Because we recompute fit
                                    // on every render, a stale issue
                                    // can't exist — the offsets here
                                    // are always fresh against the
                                    // current text.
                                    next[i] =
                                      t.slice(0, iss.start) +
                                      iss.suggestion +
                                      t.slice(iss.end);
                                    return next;
                                  });
                                }}
                                aria-label={`Replace "${iss.text}" with "${iss.suggestion || '(remove)'}"`}
                                title={iss.reason}
                              >
                                <span className={styles.draftFixChipLabel}>
                                  {iss.text.length > 22
                                    ? iss.text.slice(0, 21).trimEnd() + '…'
                                    : iss.text}
                                </span>
                                <span className={styles.draftFixChipArrow} aria-hidden="true">
                                  &rarr;
                                </span>
                                <span className={styles.draftFixChipSuggestion}>
                                  {iss.suggestion || '(remove)'}
                                </span>
                              </button>
                            ))}
                          </div>
                        )}
                        {/* Copy-text — MOVED INSIDE the glass box per
                            user: "copy text 버튼은 저 박스 안쪽으로
                            넣어야될거같아." Previously it sat below
                            the box as a post-edit action rail, but
                            that read as disconnected from the text it
                            was copying. Inside + right-aligned, it
                            reads clearly as "the action attached to
                            THIS text." Only rendered for the active
                            variant so we don't stack N buttons when
                            multiple drafts are present. */}
                        {i === activeVariantIdx && (() => {
                          const isCopied = copiedVariantIdx === i;
                          return (
                            <div className={styles.draftVariantFooterInner}>
                              <button
                                type="button"
                                className={`${styles.draftVariantCopy} ${isCopied ? styles.draftVariantCopyDone : ''}`}
                                onClick={(e) => { e.stopPropagation(); handleCopyVariant(i, v); }}
                                aria-label={isCopied ? 'Copied to clipboard' : 'Copy text to clipboard'}
                              >
                                <span className={styles.draftVariantCopyIcon} aria-hidden="true">
                                  {isCopied ? (
                                    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
                                      <path d="M3 8.5 L6.5 12 L13 4.5" />
                                    </svg>
                                  ) : (
                                    <svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round">
                                      <rect x="5" y="5" width="8.5" height="9" rx="1.6" />
                                      <path d="M10.5 5 V3.6 A1.6 1.6 0 0 0 8.9 2 H3.6 A1.6 1.6 0 0 0 2 3.6 V9 A1.6 1.6 0 0 0 3.6 10.5 H5" />
                                    </svg>
                                  )}
                                </span>
                                {isCopied ? 'Copied' : 'Copy text'}
                              </button>
                            </div>
                          );
                        })()}
                        {/* (Retired) in-box pulsing tap-to-edit
                            affordance — removed per user (this pass):
                            "내가 첨부한 이미지 이거 tone for dad
                            이거 우측에 있는건데 클릭하면 저런 이상한게
                            나와서 overlap되면서 이상해. 그냥 뭐
                            안뜨게 해줘." The absolute-positioned pill
                            sat at top-right of the box, directly over
                            the meter label's right-aligned value
                            ("mostly lands"), so clicking near that
                            area made the two elements visually
                            collide. Affordance is now carried by:
                            (a) a strong :focus-within ring on the
                                .draftWordsBox (pink rim + inner bloom
                                that clearly says "you're editing
                                this"), see the new focus-within rule
                                in ChatScreen.module.css,
                            (b) the textarea's existing cursor:text
                                + tap-anywhere-in-box focus behaviour,
                            (c) the non-italic sans typography that
                                reads as a proper input field. */}
                      </div>
                    );
                  })}
                </div>
              </div>

              {/* AI disclaimer — small grounded reminder that the
                  Words above are AI-drafted and the user is the
                  authority on their own relationship. Per user
                  (this pass): "disclaimer 부분 'This message was
                  drafted by AI. Please review and edit before
                  sending — you know your relationship best.' 이
                  문구로 바꿔줘." New copy explicitly frames the
                  draft as a starting point to be edited, and
                  names the "send" step so the user is reminded
                  this is still their decision to push. */}
              <p className={styles.draftDisclaimer}>
                This message was drafted by AI. Please review and edit before sending &mdash; you know your relationship best.
              </p>

              {/* Pagination dots — Action • Words. Twin of .angleDots
                  on the 2nd card, so both swipe decks share one
                  affordance vocabulary. Now sits as the card's
                  bottom-most element (per user: "점이 제일 밑에
                  있게. 점들 배치는 2번째 카드와 같게"). Only shown
                  when there's more than one page to swipe between. */}
              {totalPages > 1 && (
                <div className={styles.angleDots}>
                  {Array.from({ length: totalPages }).map((_, i) => (
                    <span
                      key={i}
                      className={`${styles.angleDot} ${i === draftIdx ? styles.angleDotActive : ''}`}
                      aria-hidden="true"
                    />
                  ))}
                </div>
              )}
            </div>
            );
          })()}

          {/* (Archive replay v1 response capture retired — the
              chat bar now lives at the screen root, see .archiveChatBar
              below the .slideChatBar block.) */}
        </div>
      )}

      {/* Legacy chat-stream messagesArea block removed entirely per
          user: "예전에 했던 디자인이 나오면서 이상해져. 이건 완전
          삭제해야돼. 첫번째 이미지처럼 나오고 만약에 사용자가 후속
          채팅을 쳤다면, 똑같이 카드 디자인으로 그냥 밑에 나와야해."
          The avatar-bubble coach cards, chip suggestions, deep-dive
          table/chart/steps/expanded blocks, per-msg TypedCoachText
          typing effect, and chat-stream draft variant renders are all
          gone — every follow-up turn now stacks inside the heroScroll
          above as a new user bubble + hero coach card pair. */}

      {/* ── Destination overlay — 최종 선택 페이지 ─────────────
           채택한 초안을 어디에 둘지.
           • Heart Vessel: 아직 보낼 타이밍이 아니야. 담아두자.
           • Archive:      이미 전했거나 해결했어. 기록으로 남기자.
           • Let it go:    말해본 것만으로 충분해. 저장 안해.
           ──────────────────────────────────────────────── */}
      {phase === 'destination' && chosenDraft && (
        <div className={styles.destinationOverlay}>
          <div className={styles.destinationScroll}>
            <div className={styles.destinationHeader}>
              <button
                className={styles.destBackBtn}
                onClick={() => { setPhase('drafting'); setEditing(false); }}
              >
                <svg width="20" height="20" viewBox="0 0 24 24" fill="none">
                  <path d="M15 18l-6-6 6-6" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </button>
              <p className={styles.destStep}>Final step</p>
            </div>

            <h2 className={styles.destTitle}>
              Where does this <em>live</em>?
            </h2>
            <p className={styles.destSubtitle}>
              You wrote something that matters. You decide what happens to it.
            </p>

            {/* Draft preview — editable */}
            <div className={styles.destDraftCard}>
              <div className={styles.destDraftHeader}>
                <span className={styles.destDraftLabel}>Your message</span>
                <button
                  className={styles.destEditToggle}
                  onClick={() => setEditing(e => !e)}
                >
                  {editing ? 'Done' : 'Edit'}
                </button>
              </div>
              {editing ? (
                <textarea
                  className={styles.destDraftEdit}
                  value={editDraft}
                  onChange={e => { setEditDraft(e.target.value); setChosenDraft(e.target.value); autoResize(e.target); }}
                  autoFocus
                />
              ) : (
                <p className={styles.destDraftText}>{chosenDraft}</p>
              )}
            </div>

            {/* Choice cards */}
            <div className={styles.destChoices}>
              <button className={styles.destChoiceCard} onClick={handleDestinationVessel}>
                <div className={styles.destChoiceIcon}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <path d="M12 21.593c-5.63-5.539-11-10.297-11-14.402 0-3.791 3.068-5.191 5.281-5.191 1.312 0 4.151.501 5.719 4.457 1.59-3.968 4.464-4.447 5.726-4.447 2.54 0 5.274 1.621 5.274 5.181 0 4.069-5.136 8.625-11 14.402z" fill="currentColor"/>
                  </svg>
                </div>
                <div className={styles.destChoiceBody}>
                  <p className={styles.destChoiceTitle}>Save to Heart Vessel</p>
                  <p className={styles.destChoiceSub}>
                    Not ready to send yet. Keep it close, come back when the moment lands.
                  </p>
                </div>
                <span className={styles.destChoiceArrow}>→</span>
              </button>

              <button className={styles.destChoiceCard} onClick={handleDestinationArchive}>
                <div className={`${styles.destChoiceIcon} ${styles.destChoiceIconArchive}`}>
                  <svg width="22" height="22" viewBox="0 0 24 24" fill="none">
                    <path d="M5 8h14M5 8a2 2 0 01-2-2V6a2 2 0 012-2h14a2 2 0 012 2v0a2 2 0 01-2 2M5 8v10a2 2 0 002 2h10a2 2 0 002-2V8" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
                  </svg>
                </div>
                <div className={styles.destChoiceBody}>
                  <p className={styles.destChoiceTitle}>Move to Archive</p>
                  <p className={styles.destChoiceSub}>
                    Already said it, or already resolved. Log it as a moment you showed up.
                  </p>
                </div>
                <span className={styles.destChoiceArrow}>→</span>
              </button>

              <button className={styles.destChoiceSecondary} onClick={handleDestinationDiscard}>
                Let it go. Saying it once was enough.
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Saved confirmation overlay ─────────────────────── */}
      {phase === 'saved' && (
        <div className={styles.savedOverlay}>
          <div className={styles.savedInner}>
            {/* Icon slot — both Vessel and Archive confirmations now render
                the real destination-screen asset instead of a system emoji.
                - Vessel: VesselHeartImageNew.png (same as Vessel orbit)
                - Archive: Archived Icon 3.png (same hero image used on
                  ArchiveScreen), per user: "여기 이미지도 그 archive
                  화면에 사용되고 있는 그 핑크색 이미지 그걸로 넣어."
                Using each destination's own asset ties the confirmation
                beat visually to the place the entry just went — "this is
                where your words live now" — and keeps the overlay off the
                cartoon 3D-emoji register. Discarded still uses an emoji
                (🌬️) because there's no destination screen for it to
                echo; the whiff glyph is still the clearest cue. */}
            <div className={styles.savedIcon}>
              {saved === 'vessel'    && (
                <img
                  src="/asset/VesselHeartImageNew.png"
                  alt=""
                  className={styles.savedHeartImg}
                />
              )}
              {saved === 'archive'   && (
                <img
                  src="/asset/Archived Icon 3.png"
                  alt=""
                  className={styles.savedArchiveImg}
                />
              )}
              {saved === 'discarded' && '🌬️'}
            </div>
            <h3 className={styles.savedHeadline}>
              {saved === 'vessel'    && 'Tucked into your Vessel.'}
              {saved === 'archive'   && 'Filed in Archive.'}
              {saved === 'discarded' && 'Released into the air.'}
            </h3>
            <p className={styles.savedBody}>
              {saved === 'vessel'    && "It'll wait for you. No pressure, no deadline."}
              {saved === 'archive'   && 'Kept as a reminder that you showed up.'}
              {saved === 'discarded' && 'Some words do their work just by being said, even to yourself.'}
            </p>
            <div className={styles.savedActions}>
              {/* Primary CTA copy — user: "Open Vessel은 Open Heart Vessel
                  이라고 해주고" — full product-name form matches how the
                  destination is referred to on the Home nav bar + Splash. */}
              {/* Label wrapped in a <span> so it sits above the liquid-
                  glass ::before / ::after specular layers on
                  .savedPrimary. `.savedPrimary > *` gives the span
                  z-index: 1, matching the same pattern used by
                  .draftVariantCopy. Without this wrap, the radial
                  specular would paint over the text. */}
              {saved === 'vessel'  && (
                <button className={styles.savedPrimary} onClick={() => navigate('vessel')}>
                  <span>Open Heart Vessel</span>
                </button>
              )}
              {saved === 'archive' && (
                <button className={styles.savedPrimary} onClick={() => navigate('archive')}>
                  <span>Open Archive</span>
                </button>
              )}
              {/* Secondary — "Done" was ambiguous ("done with what? done
                  saving?"). Per user: "Done 말고 Back to Home으로 해줘" —
                  explicit destination wording makes the action legible. */}
              <button className={styles.savedSecondary} onClick={goBack}>
                Back to Home
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Bottom area — 항상 보이는 채팅 입력창.
          Hero 모드에서도 사용자가 바로 타이핑할 수 있도록 노출.
          send 하면 새 user bubble + coach hero 카드가 heroScroll
          안에 스택으로 쌓임 (후속 턴도 첫 턴과 동일한 카드 디자인).
          suggestion 칩은 coach 카드 내부로 옮겨서 여기서 제거.

          analysisLoading / analysis 포함 per user ("Next 버튼 누르면
          지금 채팅바 사라지는데 없어지면 안돼. 카드 사이즈 그냥 유지해").
          observation 때 input이 아래에 있었던 것처럼, analysis 화면
          에서도 동일한 위치에 계속 보이게. 두 카드 모두 min-height: 100%
          스크롤 영역을 채우므로, bottom bar가 같이 렌더되면 observation
          과 analysis 카드가 완전히 동일한 높이를 유지 — "카드 사이즈
          그대로"는 자연스럽게 따라온다. */}
      {/* Added 'drafting' per user: "채팅바도 사라져 여기서. 채팅바는
          있어야해." The chat bar previously only rendered through
          analysisLoading / analysis; once the draft card appeared (phase
          = 'drafting') the whole .bottomArea unmounted, taking the input
          with it. User expects the chat bar to stay available at the
          bottom while they review / edit the draft card — they might
          want to keep the conversation going even after the draft arrives.
          Including 'drafting' here keeps the input mounted; it only
          disappears once the user actually commits to a destination
          (phase → 'destination' or 'saved'). */}
      {!isArchiveReplay && (phase === 'chatting' || phase === 'draftLoading' || phase === 'analysisLoading' || phase === 'analysis' || phase === 'drafting') && (
        <div className={styles.bottomArea}>

          {/* 유도형 초안 제안 — "Draft a message" 가 아니라 "같이 다듬어볼까?" */}
          {canOfferDraft && (
            <button className={styles.draftOfferTrigger} onClick={handleOfferDraft}>
              <span className={styles.draftOfferTriggerIcon}>✦</span>
              Want to shape something you could actually send?
            </button>
          )}

          {/* Bottom row — HOME-style layout. Pink CTA (265×66, same
              footprint as home's nav bar) on the left, 66×66 chat
              trigger button on the right. When bottomCta is null
              the chat button sits alone, right-aligned to match the
              phone-rail position of home's chat button. Per user:
              "핑크 버튼 사이즈를 그 홈 화면에서 home,vessel,archive
              담고있는 애랑 같은 크기로 배치하고, 그 옆에 텍스트
              버튼을 배치하고 싶어. 텍스트 버튼은 홈 화면처럼 똑같이
              하고, 누르면 나오는 그 모션 그런 방식도 똑같이 채용해." */}
          <div className={`${styles.inputRow} ${!latestCoach ? styles.inputRowHidden : ''} ${chatBarOpen ? styles.inputRowChatOpen : ''}`}>
            {bottomCta && !bottomCta.dualDestination && !bottomCta.replayArchive && (
              <button
                type="button"
                /* Same .heroNext asset family as the old in-card
                   button — same pink clicked PNG, same pill shape —
                   now at the fixed 265×66 rail footprint that mirrors
                   home's nav bar. */
                className={`${styles.heroNext} ${styles.inputBarCta} ${bottomCta.stateClass || ''}`}
                onClick={bottomCta.onClick}
                disabled={bottomCta.disabled}
              >
                <span className={styles.heroNextLabel}>
                  {bottomCta.waveLetters
                    ? (() => {
                        // Negative per-letter delays so every letter is
                        // already mid-cycle at t=0 — kills the "first
                        // wave looks wrong, second wave onwards is
                        // correct" glitch (before this fix, letters 2+
                        // sat at their resting opacity=1 during their
                        // positive-delay pre-window, then snapped into
                        // the cycle — visible as a wrong-looking first
                        // pass). With d_k = -(N-1-k)*stagger, the
                        // right-most letter starts at cycle position 0
                        // and the left-most starts furthest along the
                        // cycle, so the wave already appears to be
                        // propagating left-to-right from frame one.
                        // Stagger-per-letter is held at 0.18s to match
                        // the original cadence; spaces get a non-
                        // breaking character so the inline-block wrap
                        // doesn't collapse them. */
                        const chars = bottomCta.label.split('');
                        const total = chars.length;
                        const stagger = 0.18;
                        return chars.map((ch, i) => (
                          <span
                            key={i}
                            className={styles.heroNextWaveLetter}
                            style={{ animationDelay: `${(-(total - 1 - i) * stagger).toFixed(2)}s` }}
                          >
                            {ch === ' ' ? '\u00A0' : ch}
                          </span>
                        ));
                      })()
                    : bottomCta.label}
                </span>
              </button>
            )}

            {/* DUAL-destination row — drafting phase only. The 265px
                pill slot hosts TWO buttons side-by-side (each half
                width minus gap). Per user: "원래 하나 있던 버튼이
                2개로 또 나뉘어서 move to heart vessel 그리고 move
                to archive버튼 이렇게 나뉘어야해." Icons reuse the
                nav-bar heart-vessel / archive glyphs so the
                destination identity carries through from home's nav
                to this commit surface. */}
            {bottomCta?.dualDestination && (
              <div className={styles.destDualRow}>
                <button
                  type="button"
                  className={`${styles.heroNext} ${styles.destDualBtn}`}
                  onClick={bottomCta.onVessel}
                  aria-label="Move to Heart Vessel"
                >
                  <img
                    src="/asset/VesselHeartImageNew.png"
                    alt=""
                    className={`${styles.destDualIcon} ${styles.destDualIconVessel}`}
                    aria-hidden="true"
                  />
                  <span className={styles.destDualLabel}>
                    <span className={styles.destDualLabelTop}>Move to</span>
                    <span className={styles.destDualLabelBottom}>Vessel</span>
                  </span>
                </button>
                <button
                  type="button"
                  className={`${styles.heroNext} ${styles.destDualBtn}`}
                  onClick={bottomCta.onArchive}
                  aria-label="Move to Archive"
                >
                  <img
                    src="/asset/Archived Icon 3.png"
                    alt=""
                    className={`${styles.destDualIcon} ${styles.destDualIconArchive}`}
                    aria-hidden="true"
                  />
                  <span className={styles.destDualLabel}>
                    <span className={styles.destDualLabelTop}>Move to</span>
                    <span className={styles.destDualLabelBottom}>Archive</span>
                  </span>
                </button>
              </div>
            )}

            {/* Replay-of-Vessel commit rail — a single "Move to Archive"
                button. Same .destDualRow container + .destDualBtn
                styling as the dual rail so layout/visual language
                stays consistent; a solo child naturally takes the
                full rail width (.destDualBtn is flex:1 1 0). Per user:
                "vessel에 넣은거를 보니까 … 여긴 이미 vessel에 들어와
                있는걸 보는거니까 move to archive 버튼만 있게 해줘." */}
            {bottomCta?.replayArchive && (
              <div className={styles.destDualRow}>
                <button
                  type="button"
                  className={`${styles.heroNext} ${styles.destDualBtn}`}
                  onClick={bottomCta.onArchive}
                  aria-label="Move to Archive"
                >
                  <img
                    src="/asset/Archived Icon 3.png"
                    alt=""
                    className={`${styles.destDualIcon} ${styles.destDualIconArchive}`}
                    aria-hidden="true"
                  />
                  <span className={styles.destDualLabel}>
                    <span className={styles.destDualLabelTop}>Move to</span>
                    <span className={styles.destDualLabelBottom}>Archive</span>
                  </span>
                </button>
              </div>
            )}

          </div>
        </div>
      )}

      {/* ── 66×66 chat trigger — rendered at the .screen ROOT (sibling
          of .bottomArea and .slideChatBar), not inside .bottomArea.
          Per user: "후속 채팅하려고 채팅 버튼 누르면 채팅 버튼도
          왼쪽으로 빠지면서 아예 아무것도 없게 돼. 이러면 안되고,
          홈버튼에서 최초 채팅칠때 채팅 버튼 작아지면서 배치되는거랑
          똑같이 작동해야지."
          Moving it out of .bottomArea lets it escape that element's
          stacking context (z:10) — at the screen root its own
          z-index:200 now wins against .slideChatDim (z:130) + the
          shrunk-but-visible button can serve as the send affordance
          exactly like home's .chatBtn does. Same phase-gate as
          .bottomArea below so it only appears while the chat flow
          is active.
          `onClick` forks: while the chat bar is OPEN, tap → handleSend
          (send); while CLOSED, tap → openLocalChat (bring up bar). */}
      {/* Chat trigger is deliberately HIDDEN during 'drafting' — per user:
          "세번째 카드가 등장하면 저기 채팅 버튼은 필요없으니까 빼고,
          vessel archive 저거 두개로 꽉 채우자." In drafting the user has
          already produced a draft and is about to commit it to Vessel or
          Archive — "ask another question" has no meaning here, the
          conversation thread is effectively closed until a commit. The
          bottom row becomes a two-button destination rail instead of
          "destination + chat" split. */}
      {!replayMode && (phase === 'chatting' || phase === 'draftLoading' || phase === 'analysisLoading' || phase === 'analysis') && latestCoach && (
        <button
          type="button"
          className={`${styles.chatTriggerBtn} ${chatBarOpen ? styles.chatTriggerBtnSmall : ''}`}
          onClick={chatBarOpen ? handleSend : openLocalChat}
          aria-label={chatBarOpen ? 'Send message' : 'Open chat'}
        >
          {/* Glyph = /asset/Button/Group 1625372.png at reduced
              opacity (see `.chatTriggerGlyph`) so the sticker
              blends into the glass material. Per user (this pass):
              "채팅 버튼 속 이미지 Group 1625372.png 이걸로 교체."
              (Previous asset was Group 162537.png; the 7-digit
              variant is the newer version the user is shipping.) */}
          <img
            src="/asset/Button/Group 1625372.png"
            alt=""
            className={styles.chatTriggerGlyph}
          />
        </button>
      )}

      {/* ── Dim overlay — darkens the rest of the screen while the
          chat bar is open. Click anywhere on it to dismiss (same as
          App.jsx GlobalNav). z-index 130 sits above the bottomArea
          and cards but below the slide-up bar (150). */}
      {chatBarOpen && <div className={styles.slideChatDim} onClick={closeLocalChat} />}

      {/* ── Slide-up chat bar — decants from below when the chat
          button is tapped. Exactly mirrors home's chat bar motion;
          kbOffset adjustment keeps it above the iOS keyboard.
          Rendered at the ChatScreen root (outside the bottomArea
          phase-gated block) so it's available even when phase
          transitions unmount the inline row. Skipped entirely in
          archive replay mode — the persistent .archiveChatBar takes
          over there, so rendering both would double-bind `inputRef`
          to two DOM nodes and the archive bar wouldn't actually
          receive focus calls. */}
      {!isArchiveReplay && (
        <div
          className={`${styles.slideChatBar} ${chatBarOpen ? styles.slideChatBarOpen : ''}`}
          style={kbOffset > 0 ? { bottom: `${kbOffset + 12}px` } : undefined}
        >
          <textarea
            ref={inputRef}
            className={styles.slideChatInput}
            value={inputVal}
            onChange={e => { setInputVal(e.target.value); autoResize(e.target); }}
            onKeyDown={handleKeyDown}
            /* Placeholder flips to "Tell me more" when a CTA sits to
               the left — the chat bar then reads as the alternative
               path ("tap Analyse, or tell me more to keep talking").
               Without a CTA the bar stands alone and the original
               invitation copy makes more sense. Per user's follow-up:
               "or Text라고 되어있는데, Tell me more 로 바꾸자." */
            placeholder={bottomCta ? 'Tell me more' : 'Tell me anything, anytime.'}
            disabled={isTyping}
          />
        </div>
      )}

      {/* ── Archive replay chat bar ──────────────────────────────
          Permanent, always-visible input pinned to the bottom of
          the screen while the user is replaying an archived entry.
          Per user: "저기에다가는 이 디자인을 넣어줘. 대신에 저기
          적혀있는거를 'What happened next?'라고 해줘. 그리고 여기에
          이용자가 채팅을 치면 이제 그 밑에 새로운 카드들이 등장하면서
          또 대화하는거야." — typing here appends a new user message
          to `messages`, kicks the coach API, and the reply stacks as
          a fresh hero card inside heroScroll (same pattern as the
          normal chat flow). Visually mirrors .slideChatBar (same
          liquid-glass material) but is always open and has an
          integrated send button in the bottom-right instead of the
          separate floating .chatTriggerBtn pill. Follows the same
          kbOffset recipe so it rides the top of the iOS keyboard
          when the textarea focuses. */}
      {isArchiveReplay && (
        <div
          className={styles.archiveChatBar}
          style={kbOffset > 0 ? { bottom: `${kbOffset + 12}px` } : undefined}
        >
          <textarea
            ref={inputRef}
            className={styles.archiveChatInput}
            value={inputVal}
            onChange={e => { setInputVal(e.target.value); autoResize(e.target); }}
            onKeyDown={handleKeyDown}
            placeholder="What happened next?"
            disabled={isTyping}
          />
          {/* Send button — restored to the original /asset/Button/
              Group 1625372.png glyph (same asset used by the home +
              ChatScreen .chatTriggerBtn pill). Previous iteration
              rendered an ad-hoc inline SVG arrow that didn't match the
              rest of the chrome; per user: "지금 왜 저 버튼이 달라
              졌어? 저거 기존꺼 그대로 써줘야지 이미지 갖고와서." */}
          <button
            type="button"
            className={styles.archiveChatSend}
            onClick={handleSend}
            disabled={!inputVal.trim() || isTyping}
            aria-label="Send message"
          >
            <img
              src="/asset/Button/Group 1625372.png"
              alt=""
              className={styles.archiveChatSendGlyph}
            />
          </button>
        </div>
      )}

    </div>
  );
}
