import { useState } from 'react';
import { useApp } from '../store/AppContext';
import { getReflection } from '../utils/claude';
import styles from './ArchiveDetailScreen.module.css';
import BackButton from '../components/BackButton';

/**
 * ArchiveDetailScreen — drill-down detail for a single Archive entry.
 *
 * Redesigned per user: the old form-style layout (cards for Your message /
 * Observation / Person perspective / Message sent / How did they respond /
 * Reflection) has been retired in favour of a letter-style reading page
 * that mirrors VesselDetailScreen — header + message hero + conversation
 * transcript — with Archive-only extras bolted on the bottom:
 *   • "How did they respond?" response capture
 *   • Coach-generated reflection once the response is saved
 *
 * Both detail screens now share one design language; Archive differs only
 * in the extra response + reflection blocks at the end.
 */
export default function ArchiveDetailScreen() {
  const { goHome, selectedArchiveEntry, updateArchiveEntry } = useApp();
  const entry = selectedArchiveEntry;

  // Response capture state — seeded from the entry so re-entering a
  // previously-responded archive entry still shows the saved text.
  const [responseText, setResponseText] = useState(entry?.response || '');
  const [isSaved, setIsSaved] = useState(!!entry?.response);
  const [isLoading, setIsLoading] = useState(false);
  const [reflection, setReflection] = useState(entry?.reflection || '');

  // Guard — hard refresh with no selected entry bounces back home rather
  // than rendering a broken page.
  if (!entry) { goHome(); return null; }

  async function handleSend() {
    const val = responseText.trim();
    if (!val || isLoading) return;
    setIsLoading(true);
    setIsSaved(true);
    updateArchiveEntry(entry.id, { response: val });
    try {
      const text = await getReflection(
        entry.person,
        entry.rawText,
        entry.message || entry.rawText,
        val,
      );
      setReflection(text);
      updateArchiveEntry(entry.id, { response: val, reflection: text });
    } catch {
      setReflection(
        'It takes courage to share how things went. Whatever happened, the fact that you reached out matters.',
      );
    } finally {
      setIsLoading(false);
    }
  }

  const personName = entry.person?.relation || entry.person?.name || '';
  const hasTranscript = Array.isArray(entry.transcript) && entry.transcript.length > 0;

  return (
    <div className={styles.screen}>
      <BackButton className={styles.backBtn} />

      <div className={styles.scrollArea}>
        {/* ── Header ────────────────────────────────────── */}
        <div className={styles.header}>
          <span className={styles.toLabel}>Sent to</span>
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
            <span>{formatDate(entry.sentAt || entry.createdAt)}</span>
            <span className={styles.metaDot} />
            <span>{isSaved ? 'responded' : 'awaiting reply'}</span>
          </div>
        </div>

        {/* ── Sent message (hero) ───────────────────────── */}
        <div className={styles.sectionKicker}>The message you sent</div>
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

        <hr className={styles.divider} />

        {/* ── Archive-only: how did they respond? ─────────── */}
        <div className={styles.sectionKicker}>How did they respond?</div>
        <div className={styles.responseBlock}>
          {isSaved ? (
            <p className={styles.savedResponse}>{responseText}</p>
          ) : (
            <>
              <textarea
                className={styles.responseInput}
                value={responseText}
                onChange={(e) => setResponseText(e.target.value)}
                placeholder="Write how they responded…"
                rows={3}
              />
              <div className={styles.responseActions}>
                <button
                  type="button"
                  className={styles.saveBtn}
                  onClick={handleSend}
                  disabled={!responseText.trim()}
                >
                  <span>Save</span>
                </button>
              </div>
            </>
          )}
        </div>

        {/* ── Reflection once response is saved ──────────── */}
        {(isLoading || reflection) && (
          <>
            <hr className={styles.divider} />
            <div className={styles.sectionKicker}>A small reflection</div>
            <div className={styles.reflectionBlock}>
              {isLoading ? (
                <div className={styles.dots}>
                  <span /><span /><span />
                </div>
              ) : (
                <p className={styles.reflectionText}>{reflection}</p>
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
