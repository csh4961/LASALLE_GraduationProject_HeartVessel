import { useState, useEffect, useRef } from 'react';
import { useApp } from '../store/AppContext';
import styles from './ArchiveScreen.module.css';
import BackButton from '../components/BackButton';

// Collapse math
const HERO_MAX = 158;           // original displayed width
const HERO_MIN = 56;            // 51 × 1.10 (10% larger than previous min)
const HERO_TOP_MAX = 63;        // original top (58 + 5px lower)
const BACK_CENTER_Y = 82;       // back button center (top 60 + height 44 / 2)
const CARD_TOP_MAX = 243;
const CARD_TOP_MIN = 119;       // 60 (back top) + 44 (back height) + 15 gap
const THRESHOLD = CARD_TOP_MAX - CARD_TOP_MIN; // 124

const TAGLINES = [
  { before: 'Archived ', em: 'Minds', after: '' },
  { before: 'Messages you\'ve ', em: 'already sent.', after: '' },
];

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${String(d.getMonth()+1).padStart(2,'0')}/${String(d.getDate()).padStart(2,'0')}/${d.getFullYear()}`;
}

/* Previously we rendered the date as a big day numeral in its own
   left column ("06 / APR · 2026") plus a separate time footer
   underneath the preview. Per user ("저 날짜 저거 저렇게 들어가는게
   최선인가? 잘 모르겠네") — the stacked numeral block was crowding
   the card and the card's job is to surface *who* and *what*,
   not the day-of-the-month. This pass collapses the whole thing
   into a single quiet metadata line below the preview:

       "Apr 6, 2026 · 03:29"

   So scanning goes recipient → preview → date, rather than
   numeral-block → recipient → preview → time. */
const MONTHS_SHORT = ['Jan','Feb','Mar','Apr','May','Jun',
                      'Jul','Aug','Sep','Oct','Nov','Dec'];
function formatMeta(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  const h = String(d.getHours()).padStart(2, '0');
  const m = String(d.getMinutes()).padStart(2, '0');
  return `${MONTHS_SHORT[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()} · ${h}:${m}`;
}

export default function ArchiveScreen() {
  const { navigate, goHome, archiveEntries, setSelectedArchiveEntry, setReplayEntry, setReplaySource, familyMembers } = useApp();

  /* Family relations are stored with `\n` for the orbit-layout linebreak
     (e.g. "Older\nSister"). Those linebreaks leak into the filter pills
     and make them wrap mid-word, which looked broken in the tab row.
     Strip them here so the tab label reads as a single clean token
     ("Older Sister"), while the underlying `entry.person.relation` match
     still compares against the original (preserved via `raw`). */
  const tabs = [
    { label: 'All', raw: 'All' },
    ...familyMembers.map(m => ({
      label: (m.relation || '').replace(/\n/g, ' '),
      raw: m.relation,
    })),
  ];
  const [activeTab, setActiveTab] = useState('All');
  const [taglineIdx, setTaglineIdx] = useState(0);
  const [fade, setFade] = useState(false);
  const [scrollY, setScrollY] = useState(0);
  const [imgRatio, setImgRatio] = useState(1); // naturalH / naturalW, updated onLoad
  const listRef = useRef(null);

  function handleListScroll(e) {
    setScrollY(e.currentTarget.scrollTop);
  }

  const progress = Math.min(1, Math.max(0, scrollY / THRESHOLD));
  const heroSize = HERO_MAX - (HERO_MAX - HERO_MIN) * progress;
  // Collapsed top: vertical center (box top + rendered-height/2) = BACK_CENTER_Y
  const heroTopMin = BACK_CENTER_Y - (HERO_MIN * imgRatio) / 2;
  const heroTop = HERO_TOP_MAX + (heroTopMin - HERO_TOP_MAX) * progress;
  const cardTop = CARD_TOP_MAX - THRESHOLD * progress;
  const innerTranslate = Math.min(scrollY, THRESHOLD);

  useEffect(() => {
    requestAnimationFrame(() => setFade(true));
    const interval = setInterval(() => {
      setFade(false);
      setTimeout(() => {
        setTaglineIdx(prev => (prev + 1) % TAGLINES.length);
        setFade(true);
      }, 1000);
    }, 6000);
    return () => clearInterval(interval);
  }, []);

  const tag = TAGLINES[taglineIdx];

  const filtered = activeTab === 'All'
    ? archiveEntries
    : archiveEntries.filter(e =>
        e.person?.relation === activeTab
        || e.person?.name === activeTab
      );

  /* Per user ("Archive Minds가 문제인데, 여기도 채팅하던 그 화면들이
     똑같이 들어와있어야하는거야. Vessel에도 똑같이 들어가있는것처럼
     말이야."): Archive entry taps now drop into the same ChatScreen
     replay surface that Vessel uses — the three cards (observation,
     perspective deck, words) rebuild from the saved replay payload,
     so the user re-enters the EXACT conversation they shipped from.
     `replaySource='archive'` tells ChatScreen this is an archived
     send rather than a vessel draft, so it renders the
     "How did they respond?" capture + reflection section instead of
     the "Move to Archive" commit rail. selectedArchiveEntry is still
     set so the legacy ArchiveDetailScreen route keeps working as a
     fallback for any deep-link / back-compat path. */
  function handleEntryClick(entry) {
    setSelectedArchiveEntry(entry);
    setReplayEntry(entry);
    setReplaySource('archive');
    navigate('chat');
  }

  return (
    <div className={styles.screen}>

      {/* Back button — shared glass component. */}
      <BackButton className={styles.backBtn} onClick={goHome} />

      {/* Hero */}
      <img
        src="/asset/Archived Icon 3.png"
        alt=""
        className={styles.heroImg}
        style={{
          top: `${heroTop}px`,
          width: `${heroSize}px`,
        }}
        onLoad={(e) => {
          const { naturalWidth, naturalHeight } = e.currentTarget;
          if (naturalWidth) setImgRatio(naturalHeight / naturalWidth);
        }}
      />

      {/* Tagline (rotating) */}
      <div
        className={styles.taglineWrap}
        style={{
          opacity: 1 - progress,
          transform: `translateY(${-90 * progress}px) scale(${1 - 0.35 * progress})`,
        }}
      >
        <p className={`${styles.tagline} ${fade ? styles.taglineVisible : styles.taglineHidden}`}>
          {tag.before}<em className={styles.taglineEm}>{tag.em}</em>{tag.after}
        </p>
      </div>

      {/* Content card */}
      <div className={styles.card} style={{ top: `${cardTop}px` }}>

        {/* Filter tabs — each tab is a quiet liquid-glass pill. The
            active one lifts to a brighter translucent fill with a soft
            specular rim so it reads as the "current" filter without
            shouting. Per user: 다른 페이지들 liquid glass 느낌 깔끔하게
            적용. ux 고려해서 흐름 개선. */}
        <div className={styles.tabs}>
          {tabs.map(({ label, raw }) => (
            <button
              key={raw}
              className={`${styles.tab} ${activeTab === raw ? styles.tabActive : ''}`}
              onClick={() => setActiveTab(raw)}
            >
              {label}
            </button>
          ))}
        </div>

        {/* List */}
        <div className={styles.list} ref={listRef} onScroll={handleListScroll}>
          <div
            className={styles.listInner}
            style={{ transform: `translateY(${innerTranslate}px)` }}
          >
            {filtered.length === 0 ? (
              <div className={styles.empty}>
                <p className={styles.emptyTitle}>Nothing archived yet.</p>
                <p className={styles.emptySub}>When you send a message, it will live here.</p>
              </div>
            ) : (
              filtered.map(entry => {
                const ts = entry.sentAt || entry.createdAt;
                const meta = formatMeta(ts);
                /* Preview: the full message — CSS line-clamps to two
                   lines so the emotional specificity doesn't get
                   hard-cut early. */
                const rawPreview = entry.message || entry.rawText || '';
                const preview = rawPreview.length > 0 ? rawPreview : 'Untitled';
                /* Recipient reads "To Mom" in normal case. Strip the
                   `\n` used by the orbit layout for two-line relations
                   like "Older\nSister". */
                const recipientRaw = entry.person?.relation || entry.person?.name || 'someone';
                const recipient = recipientRaw.replace(/\n/g, ' ');
                return (
                  <button
                    key={entry.id}
                    className={styles.entryCard}
                    onClick={() => handleEntryClick(entry)}
                  >
                    {/* Per user ("저 초록색 replied waiting 저건 빼")
                        the status pill (Replied / Waiting) is gone.
                        Per user ("저 날짜 저거 저렇게 들어가는게
                        최선인가?") the big day-numeral column is gone
                        too — the date is now a single quiet line at
                        the bottom. Card scan order: recipient, preview,
                        date — exactly how you'd read a letter. */}
                    <div className={styles.entryMain}>
                      <span className={styles.entryRecipient}>To {recipient}</span>
                      <p className={styles.entryPreview}>{preview}</p>
                      <span className={styles.entryMeta}>{meta}</span>
                    </div>
                    {/* Chevron — tap affordance. */}
                    <span className={styles.entryChevron} aria-hidden>
                      <svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round">
                        <path d="M9 6 L15 12 L9 18" />
                      </svg>
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

      </div>
    </div>
  );
}
