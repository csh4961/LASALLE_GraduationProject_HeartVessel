import { useApp } from '../store/AppContext';
import styles from './FamilyScreen.module.css';
import BackButton from '../components/BackButton';

/* People list — liquid-glass pass.

   Per user ("저 mbti 저것들 제거해. 그리고 휴지통 이모지 제거해.
   그리고 여기도 liquid glass 스타일로 적용해"):
     - The MBTI chip under each name is gone (it was design noise
       and doesn't carry weight on this surface anymore).
     - The trash-can row action is gone. Delete used to live only
       here; it's being removed in this pass per direct request.
       If delete needs to come back, reintroduce it inside
       FamilyDetailScreen as a destructive menu item rather than
       re-adding clutter to every row.
     - Confirm/dim state and handlers that guarded the old delete
       flow are removed too — they'd be dead code otherwise.
   Visual treatment (translucent glass cards, soft specular rim,
   pill add-button) lives in FamilyScreen.module.css. */
export default function FamilyScreen() {
  const { goBack, navigate, familyMembers, setEditingMember, setSelectedFamilyMember } = useApp();

  function handleCardTap(member) {
    setSelectedFamilyMember(member);
    navigate('family-detail');
  }

  return (
    <div className={styles.screen}>

      {/* ── Header ── */}
      <div className={styles.header}>
        <BackButton className={styles.backBtn} onClick={goBack} />
        <span className={styles.title}>People</span>
      </div>

      {/* ── List ── */}
      <div className={styles.list}>
        {familyMembers.length === 0 ? (
          <div className={styles.empty}>
            <p className={styles.emptyTitle}>No one added yet.</p>
            <p className={styles.emptySub}>
              Add someone so Heart Vessel understands who you're opening up to.
            </p>
          </div>
        ) : (
          familyMembers.map(p => (
            <button key={p.id} className={styles.card} onClick={() => handleCardTap(p)}>
              <div className={styles.cardAvatar}>
                {p.relation?.[0]?.toUpperCase() ?? '?'}
              </div>
              <div className={styles.cardInfo}>
                <span className={styles.cardName}>
                  {(p.relation || '').replace(/\n/g, ' ')}
                </span>
              </div>

              {/* Tap affordance — single quiet chevron, glass-family
                  hint that this row opens a detail view. */}
              <span className={styles.cardChevron} aria-hidden>
                <svg width="7" height="12" viewBox="0 0 7 12" fill="none">
                  <path d="M1 1l5 5-5 5"
                    stroke="currentColor" strokeWidth="1.8"
                    strokeLinecap="round" strokeLinejoin="round"/>
                </svg>
              </span>
            </button>
          ))
        )}
      </div>

      {/* ── Add button ── */}
      <div className={styles.footer}>
        <button className={styles.addBtn} onClick={() => { setEditingMember(null); navigate('onboarding'); }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
            <path d="M12 5v14M5 12h14" stroke="#fff" strokeWidth="2.2" strokeLinecap="round"/>
          </svg>
          Add person
        </button>
      </div>

    </div>
  );
}
