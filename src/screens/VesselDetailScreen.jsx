import { useApp } from '../store/AppContext';
import styles from './VesselDetailScreen.module.css';
import BackButton from '../components/BackButton';

/**
 * VesselDetailScreen — drill-down letter view for a single Vessel entry.
 *
 * Opens from VesselScreen when the user taps the center content / "See
 * details →" affordance on the expanded overlay. Reads the entry straight
 * off context (set by VesselScreen's `handleOpenDetail`) so this screen is
 * pure render with no fetching / side effects.
 *
 * Sections from top:
 *   1. To {name} — editorial italic header, date metadata underneath
 *   2. Message — the final drafted text, italic serif with curly quotes
 *   3. Conversation — the full chat transcript that shaped the message
 *   4. Coach context — nudge + action (if entry has draftContext)
 *
 * Entry shape (from ChatScreen.jsx::buildEntryForDestination):
 *   { person, rawText, transcript[], draftContext, message, createdAt }
 *
 * Legacy entries (saved before transcript was added) fall back gracefully:
 *   - `transcript` absent → empty-state copy under the kicker
 *   - `draftContext` absent → context footer suppressed entirely
 */
export default function VesselDetailScreen() {
  const { selectedVesselEntry, goHome } = useApp();
  const entry = selectedVesselEntry;

  // Guard — if someone somehow navigated here with no entry selected
  // (e.g. a hard refresh), bail back to home rather than render a
  // broken page.
  if (!entry) { goHome(); return null; }

  const personName = entry.person?.relation || entry.person?.name || '';
  const hasTranscript = Array.isArray(entry.transcript) && entry.transcript.length > 0;
  const hasContext =
    entry.draftContext &&
    (entry.draftContext.nudge || entry.draftContext.action);

  return (
    <div className={styles.screen}>
      <BackButton className={styles.backBtn} />

      <div className={styles.scrollArea}>
        {/* ── Header ────────────────────────────────────── */}
        <div className={styles.header}>
          <span className={styles.toLabel}>A message for</span>
          <h1 className={styles.recipient}>
            {personName.replace('\n', ' ')}
            <img
              src="/asset/Vector1.png"
              alt=""
              className={styles.recipientOrnament}
              aria-hidden="true"
            />
          </h1>
          <div className={styles.metaRow}>
            <span>{formatDate(entry.createdAt)}</span>
            <span className={styles.metaDot} />
            <span>
              held {daysHeld(entry.createdAt)}{' '}
              {daysHeld(entry.createdAt) === 1 ? 'day' : 'days'}
            </span>
          </div>
        </div>

        {/* ── Final message (hero) ──────────────────────── */}
        <div className={styles.sectionKicker}>The message</div>
        <div className={styles.messageBlock}>
          <p className={styles.messageText}>
            {entry.message || entry.rawText || ''}
          </p>
        </div>

        <hr className={styles.divider} />

        {/* ── Conversation transcript ────────────────────── */}
        <div className={styles.sectionKicker}>The conversation</div>
        {hasTranscript ? (
          <div className={styles.transcript}>
            {entry.transcript.map((turn, i) => {
              const isUser = turn.role === 'user';
              return (
                <div key={i} className={styles.turn}>
                  <span
                    className={isUser ? styles.turnRoleUser : styles.turnRoleCoach}
                  >
                    {isUser ? 'You' : 'Coach'}
                  </span>
                  <p className={styles.turnBody}>{turn.text || ''}</p>
                </div>
              );
            })}
          </div>
        ) : (
          <p className={styles.transcriptEmpty}>
            No conversation was saved with this entry.
          </p>
        )}

        {/* ── Coach draft context (optional) ─────────────── */}
        {hasContext && (
          <>
            <hr className={styles.divider} />
            <div className={styles.sectionKicker}>What the coach noticed</div>
            <div className={styles.context}>
              {entry.draftContext.nudge && (
                <div className={styles.contextItem}>
                  <span className={styles.contextLabel}>Nudge</span>
                  <p className={styles.contextBody}>{entry.draftContext.nudge}</p>
                </div>
              )}
              {entry.draftContext.action && (
                <div className={styles.contextItem}>
                  <span className={styles.contextLabel}>Suggested action</span>
                  <p className={styles.contextBody}>{entry.draftContext.action}</p>
                </div>
              )}
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return d.toLocaleDateString('en-US', {
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
}

function daysHeld(ts) {
  if (!ts) return 0;
  const diff = Date.now() - ts;
  return Math.max(0, Math.floor(diff / 86400000));
}
