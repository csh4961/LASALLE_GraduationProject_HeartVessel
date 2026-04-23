import { useState, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import styles from './HomeScreen.module.css';

const SUB_WORDS = ['words', 'tone'];

export default function HomeScreen() {
  const { navigate, familyMembers } = useApp();
  const [wordIdx, setWordIdx] = useState(0);
  const [wordFade, setWordFade] = useState(false);

  useEffect(() => {
    requestAnimationFrame(() => setWordFade(true));
    const interval = setInterval(() => {
      setWordFade(false);
      setTimeout(() => {
        setWordIdx(prev => (prev + 1) % SUB_WORDS.length);
        setWordFade(true);
      }, 800);
    }, 6000);

    return () => clearInterval(interval);
  }, []);

  return (
    <div className={styles.screen}>

      {/* ── Profile button (25,60) 44×44 ── */}
      <button className={styles.profileBtn} onClick={() => navigate('family')}>
        <img src="/asset/Button/Profile.png" alt="Profile" />
      </button>

      {/* ── Greeting text — vertically aligned with profile btn ── */}
      <div className={styles.greeting}>
        <p className={styles.greetName}>Hi, there.</p>
        <p className={styles.greetSub}>Your words are waiting.</p>
      </div>

      {/* ── Alarm button (333,60) 44×44 ── */}
      <button className={styles.alarmBtn} onClick={() => {}}>
        <img src="/asset/Button/Alarm.png" alt="Notifications" />
      </button>

      {/* Character은 App.jsx의 SharedCharacter가 렌더링한다 — Vessel 화면과
          공유되는 영속 엘리먼트라, 화면 전환 시 리마운트 없이 크기만 부드럽게
          변한다. */}

      {/* ── Tagline (47,409) ──
          "Send love, not regret."
          "love" and "regret" → PP Editorial New italic */}
      <p className={styles.tagline}>
        Send{' '}
        <em className={styles.italic}>love</em>
        , not{' '}
        <em className={styles.italic}>regret</em>
        .
      </p>

      {/* ── Sub tagline (67,466) ──
          "Let's find the right words together."
          "right words" → PP Editorial New italic */}
      <p className={styles.subTagline}>
        Let's find the <em className={styles.italic}>right</em>{' '}
        <span className={styles.swapWord}>
          <span className={styles.swapSizer}>words.</span>
          <em className={`${styles.italic} ${styles.swapText} ${wordFade ? styles.wordVisible : styles.wordHidden}`}>
            {SUB_WORDS[wordIdx]}.
          </em>
        </span>
      </p>

      {/* Nav & Chat 버튼은 App.jsx GlobalNav에서 렌더링 */}

    </div>
  );
}
