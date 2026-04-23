import { useApp } from '../store/AppContext';
import styles from './FamilyDetailScreen.module.css';
import BackButton from '../components/BackButton';

/* Profile detail — liquid-glass pass.

   Per user ("애매한 이모지들 제거해 … liquid glass 스타일 적용 …
   뒤로가기 버튼 위치가 올라갔어 … 사용자가 직접 줄글로 이 사람에
   대해 적은것들을 더미로"):

     - The cartoony emoji column (🧠✨💚⚡🎂📝) is removed. The rows
       now read as plain journal-style labeled blocks, matching the
       soft editorial feel of the rest of the app.
     - FIELDS switches to four prose sections ("Who they are",
       "What I love about them", "What's hard between us", "A
       memory that stays with me"). These map to the long-form
       dummy text in DUMMY_FAMILY (see AppContext.jsx) — the user
       writing about the person in their own voice.
     - Legacy fields (personality / likes / dislikes / age / extra)
       are preserved in LEGACY_FIELDS so any user-created entries
       from OnboardingScreen still render — they just appear under
       a "More" section below the prose.
     - Back button position is pulled out of the flex topBar and
       pinned at the standard `left:25px; top:60px` used by
       Archive / Family / Home, so the button doesn't float higher
       than on the rest of the app. */
const PROSE_FIELDS = [
  { id: 'whoTheyAre', label: 'Who they are' },
  { id: 'whatILove',  label: 'What I love about them' },
  { id: 'whatIsHard', label: "What's hard between us" },
  { id: 'memory',     label: 'A memory that stays with me' },
];

const LEGACY_FIELDS = [
  { id: 'personality', label: 'Personality' },
  { id: 'likes',       label: 'Likes' },
  { id: 'dislikes',    label: 'Dislikes' },
  { id: 'age',         label: 'Age' },
  { id: 'extra',       label: 'Extra notes' },
];

export default function FamilyDetailScreen() {
  const { goBack, navigate, selectedFamilyMember, setEditingMember } = useApp();

  const member = selectedFamilyMember;
  if (!member) { goBack(); return null; }

  const proseFilled  = PROSE_FIELDS.filter(f => member[f.id]);
  const legacyFilled = LEGACY_FIELDS.filter(f => member[f.id]);
  const empty        = [...PROSE_FIELDS, ...LEGACY_FIELDS].filter(f => !member[f.id]);

  function handleEdit() {
    setEditingMember(member);
    navigate('onboarding');
  }

  /* Strip the orbit-layout "\n" newlines from the hero name so
     "Older\nSister" reads as "Older Sister" in the title. */
  const displayName = (member.relation || '').replace(/\n/g, ' ');

  return (
    <div className={styles.screen}>

      {/* ── Top bar — back is absolutely positioned at the app-wide
          standard spot (left:25 / top:60); edit button floats
          right, vertically aligned to the back button's center. */}
      <BackButton className={styles.backBtn} onClick={goBack} />
      <button className={styles.editBtn} onClick={handleEdit}>
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none">
          <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
          <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
        </svg>
        <span>Edit</span>
      </button>

      {/* ── Avatar + name ── */}
      <div className={styles.heroArea}>
        <div className={styles.avatar}>
          {member.relation?.[0]?.toUpperCase() ?? '?'}
        </div>
        <p className={styles.heroName}>{displayName}</p>
        {member.mbti && <span className={styles.heroMbti}>{member.mbti}</span>}
      </div>

      {/* ── Info card ── */}
      <div className={styles.card}>
        <div className={styles.cardScroll}>

          {/* Prose sections — each is its own glass panel so the
              paragraph gets to breathe. Labels are soft, lowercase
              editorial — not caps-lock form labels. */}
          {proseFilled.length > 0 && (
            <div className={styles.proseStack}>
              {proseFilled.map(f => (
                <div key={f.id} className={styles.proseBlock}>
                  <span className={styles.proseLabel}>{f.label}</span>
                  <p className={styles.proseText}>{member[f.id]}</p>
                </div>
              ))}
            </div>
          )}

          {/* Legacy structured fields — only appear if a user-created
              profile (from OnboardingScreen) filled any of them.
              Rendered inside one glass panel with hairline dividers
              between rows for the tighter attribute-style read. */}
          {legacyFilled.length > 0 && (
            <div className={styles.legacyCard}>
              <span className={styles.legacyLabel}>More</span>
              {legacyFilled.map((f, i) => (
                <div key={f.id} className={styles.legacyRow}>
                  <div className={styles.legacyRowContent}>
                    <span className={styles.legacyRowLabel}>{f.label}</span>
                    <span className={styles.legacyRowValue}>{member[f.id]}</span>
                  </div>
                  {i < legacyFilled.length - 1 && <div className={styles.divider} />}
                </div>
              ))}
            </div>
          )}

          {/* Empty fields — kept as a subtle reminder there's room
              to fill in. Muted, no emoji. */}
          {empty.length > 0 && (
            <div className={styles.legacyCard + ' ' + styles.legacyCardEmpty}>
              <span className={styles.legacyLabel}>Not filled in</span>
              {empty.map((f, i) => (
                <div key={f.id} className={styles.legacyRow}>
                  <div className={styles.legacyRowContent}>
                    <span className={styles.legacyRowLabel}>{f.label}</span>
                    <span className={styles.legacyRowValueEmpty}>—</span>
                  </div>
                  {i < empty.length - 1 && <div className={styles.divider} />}
                </div>
              ))}
            </div>
          )}

          <div style={{ height: 40 }} />
        </div>
      </div>

    </div>
  );
}
