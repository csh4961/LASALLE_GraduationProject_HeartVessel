import { useState, useRef, useEffect } from 'react';
import { useApp } from '../store/AppContext';
import styles from './OnboardingScreen.module.css';
import BackButton from '../components/BackButton';

// ── 관계 선택 그리드 데이터 ──────────────────────────────
// Per user ("이모지 넣지 말고 깔끔하게 텍스트만 넣어"): the
// cartoony emoji faces that used to sit above each label are
// gone. Each entry is now just the relation name — the grid reads
// as typography, consistent with the rest of the liquid-glass
// surfaces in the app.
const RELATION_GROUPS = [
  {
    label: 'Family',
    items: ['Mom', 'Dad', 'Older sister', 'Younger sister',
            'Older brother', 'Younger brother', 'Grandma', 'Grandpa'],
  },
  {
    label: 'Close',
    items: ['Partner', 'Best friend'],
  },
  {
    label: 'Others',
    items: ['Friend', 'Colleague', 'Mentor', 'Acquaintance', 'Other'],
  },
];

// ── 성별 기반 대명사 ────────────────────────────────────
const FEMALE_RELATIONS = ['Mom', 'Older sister', 'Younger sister', 'Grandma'];
const MALE_RELATIONS = ['Dad', 'Older brother', 'Younger brother', 'Grandpa'];

function getPronoun(rel) {
  if (FEMALE_RELATIONS.includes(rel)) return 'her';
  if (MALE_RELATIONS.includes(rel)) return 'his';
  return 'their';
}

// ── 대화 단계 (관계 선택 이후) ───────────────────────────
const STEPS = [
  {
    id: 'age',
    question: (rel) => `How old is your ${rel.toLowerCase()}?`,
    hint: 'Approximate is fine.',
    inputType: 'text',
    placeholder: 'Or type...',
    chips: ['Under 20', '20s', '30s', '40s', '50s', '60s', '70+'],
  },
  {
    id: 'mbti',
    question: (rel) => `Do you know ${getPronoun(rel)} MBTI?`,
    hint: 'Tap to pick, or skip.',
    inputType: 'text',
    placeholder: 'e.g. ISTJ, ENFP... (optional)',
    chips: ['ISTJ','ISFJ','INFJ','INTJ','ISTP','ISFP','INFP','INTP',
            'ESTP','ESFP','ENFP','ENTP','ESTJ','ESFJ','ENFJ','ENTJ'],
    layout: 'mbtiGrid',
  },
  {
    id: 'personality',
    question: (rel) => `How would you describe ${getPronoun(rel)} personality?`,
    hint: 'Tap to add, or write your own.',
    inputType: 'textarea',
    placeholder: 'e.g. Quiet, hard-working, shows love through actions...',
    chips: ['Quiet and reserved','Warm and expressive','Hard-working',
            'Practical, solution-focused','Emotionally sensitive',
            'Direct and blunt','Caring but not vocal',
            'Funny and light-hearted','Stubborn','Perfectionist','Easy-going'],
  },
  {
    id: 'likes',
    question: (rel) => `What does ${getPronoun(rel) === 'their' ? 'this person' : (FEMALE_RELATIONS.includes(rel) ? 'she' : 'he')} like or care about?`,
    hint: 'Tap to add, or write your own.',
    inputType: 'textarea',
    placeholder: 'e.g. Football, family dinners, being respected...',
    chips: ['Family time','Hard work & achievement','Sports','Music',
            'Cooking / Food','Travel','Reading','Being respected',
            'Spending time together','Giving advice','Stability & routine'],
  },
  {
    id: 'dislikes',
    question: (rel) => `Anything ${FEMALE_RELATIONS.includes(rel) ? 'she dislikes' : MALE_RELATIONS.includes(rel) ? 'he dislikes' : 'they dislike'} or react${FEMALE_RELATIONS.includes(rel) || MALE_RELATIONS.includes(rel) ? 's' : ''} strongly to?`,
    hint: 'Helps guide your words. Tap to add, or skip.',
    inputType: 'textarea',
    placeholder: 'Optional — tap or write...',
    chips: ['Emotional conversations','Conflict or confrontation',
            'Being interrupted','Feeling criticised','Feeling ignored',
            'Surprises or sudden changes','Showing vulnerability',
            'Being talked down to'],
  },
  {
    id: 'extra',
    question: (rel) => `Anything else that feels important about ${getPronoun(rel) === 'their' ? 'them' : (FEMALE_RELATIONS.includes(rel) ? 'her' : 'him')}?`,
    hint: 'No right or wrong — or skip.',
    inputType: 'textarea',
    placeholder: 'Optional...',
    chips: ["We don't talk much",'We argue often','They mean a lot to me',
            'Communication is difficult',"We're getting closer",
            "There's unspoken tension"],
  },
];

export default function OnboardingScreen() {
  const { goBack, addFamilyMember, updateFamilyMember, navigate, editingMember, setEditingMember } = useApp();

  const isEditing = !!editingMember;

  // 편집 모드면 relation-pick 건너뛰고 chat 바로 시작
  const [phase, setPhase] = useState(() => isEditing ? 'chat' : 'relation-pick');
  const [relation, setRelation] = useState(() => isEditing ? editingMember.relation : '');

  const [step, setStep]         = useState(0);
  const [answers, setAnswers]   = useState(() => isEditing ? {
    age: editingMember.age || '',
    mbti: editingMember.mbti || '',
    personality: editingMember.personality || '',
    likes: editingMember.likes || '',
    dislikes: editingMember.dislikes || '',
    extra: editingMember.extra || '',
  } : {});
  const [inputVal, setInputVal] = useState('');
  const [messages, setMessages] = useState([]);
  const [isAnimating, setIsAnimating] = useState(false);

  const inputRef    = useRef(null);
  const messagesRef = useRef(null);

  const currentStep = STEPS[step];
  const isOptional  = currentStep?.placeholder?.toLowerCase().includes('optional');

  // 편집 모드 — 첫 질문 세팅 (relation-pick 생략)
  useEffect(() => {
    if (isEditing && phase === 'chat' && messages.length === 0) {
      const q = STEPS[0].question(relation);
      const existing = editingMember[STEPS[0].id];
      setMessages([
        { type: 'bot', text: q, hint: STEPS[0].hint },
        ...(existing ? [{ type: 'bot', text: `Current: "${existing}" — type to change, or tap Send to keep it.` }] : []),
      ]);
      setInputVal(existing || '');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 관계 선택 → 대화 시작
  function pickRelation(rel) {
    setRelation(rel);
    setPhase('chat');
    const q = STEPS[0].question(rel);
    setMessages([{ type: 'bot', text: q, hint: STEPS[0].hint }]);
  }

  // 새 메시지 → 스크롤 + 포커스
  useEffect(() => {
    if (phase !== 'chat') return;
    const el = messagesRef.current;
    if (el) el.scrollTop = el.scrollHeight;
    if (!isAnimating) inputRef.current?.focus({ preventScroll: true });
  }, [messages, isAnimating, phase]);

  function autoResize(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  function submitAnswer(val) {
    if (isAnimating) return;
    const newAnswers = { ...answers, [currentStep.id]: val };
    setAnswers(newAnswers);
    setInputVal('');
    if (inputRef.current) inputRef.current.style.height = 'auto';

    const userMsg = { type: 'user', text: val || '(skipped)' };
    const nextStep = step + 1;

    if (nextStep >= STEPS.length) {
      const doneText = isEditing
        ? `Updated. I've refreshed what I know about your ${relation.toLowerCase()}. 💛`
        : `Got it. I now have a much better sense of your ${relation.toLowerCase()}. Let's help you find the right words. 💛`;

      setMessages(prev => [...prev, userMsg, { type: 'bot', text: doneText }]);
      setIsAnimating(true);

      const payload = {
        name:        relation,
        relation:    relation,
        age:         newAnswers.age,
        mbti:        newAnswers.mbti,
        personality: newAnswers.personality,
        likes:       newAnswers.likes,
        dislikes:    newAnswers.dislikes,
        extra:       newAnswers.extra,
      };

      if (isEditing) {
        updateFamilyMember(editingMember.id, payload);
        setEditingMember(null);
        setTimeout(() => navigate('family'), 1800);
      } else {
        addFamilyMember(payload);
        setTimeout(() => navigate('home'), 1800);
      }
    } else {
      const next     = STEPS[nextStep];
      const nextQ    = next.question(relation);
      const existing = isEditing ? editingMember[next.id] : '';
      setMessages(prev => [
        ...prev, userMsg,
        { type: 'bot', text: nextQ, hint: next.hint },
        ...(existing ? [{ type: 'bot', text: `Current: "${existing}" — type to change, or Send to keep.` }] : []),
      ]);
      setInputVal(existing || '');
      if (inputRef.current) {
        inputRef.current.style.height = 'auto';
        setTimeout(() => autoResize(inputRef.current), 0);
      }
      setStep(nextStep);
    }
  }

  function handleNext() {
    if (!inputVal.trim() && !isOptional) return;
    submitAnswer(inputVal.trim());
  }

  function handleChip(chip) {
    if (isAnimating) return;
    if (currentStep.inputType === 'textarea') {
      const next = inputVal ? `${inputVal}, ${chip}` : chip;
      setInputVal(next);
      setTimeout(() => autoResize(inputRef.current), 0);
    } else {
      submitAnswer(chip);
    }
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      if (inputVal.trim() || isOptional) handleNext();
    }
  }

  // ── 관계 선택 화면 ─────────────────────────────────────
  if (phase === 'relation-pick') {
    return (
      <div className={styles.screen}>
        <div className={styles.topBar}>
          <BackButton className={styles.backBtn} onClick={goBack} />
        </div>

        <div className={styles.pickHeader}>
          <p className={styles.pickTitle}>Who is this person to you?</p>
          <p className={styles.pickSub}>Choose your relationship.</p>
        </div>

        <div className={styles.pickScroll}>
          {RELATION_GROUPS.map(group => (
            <div key={group.label} className={styles.pickGroup}>
              <span className={styles.pickGroupLabel}>{group.label}</span>
              <div className={styles.pickGrid}>
                {group.items.map(value => (
                  <button
                    key={value}
                    className={styles.pickCard}
                    onClick={() => pickRelation(value)}
                  >
                    <span className={styles.pickLabel}>{value}</span>
                  </button>
                ))}
              </div>
            </div>
          ))}
        </div>
      </div>
    );
  }

  // ── 대화 단계 ──────────────────────────────────────────
  return (
    <div className={styles.screen}>
      <div className={styles.topBar}>
        <BackButton className={styles.backBtn} onClick={() => isEditing ? goBack() : setPhase('relation-pick')} />
        <div className={styles.progress}>
          {STEPS.map((_, i) => (
            <div key={i} className={`${styles.dot} ${i <= step ? styles.dotActive : ''}`} />
          ))}
        </div>
      </div>

      <div className={styles.messages} ref={messagesRef}>
        {messages.map((msg, i) => (
          <div key={i} className={`${styles.bubble} ${styles[msg.type]}`}>
            <p>{msg.text}</p>
            {msg.hint && <p className={styles.hint}>{msg.hint}</p>}
          </div>
        ))}
        <div style={{ flexShrink: 0, height: 4 }} />
      </div>

      {!isAnimating && (
        <div className={styles.inputWrap}>
          {currentStep.layout === 'mbtiGrid' ? (
            <div className={styles.mbtiSection}>
              <div className={styles.mbtiGrid}>
                {currentStep.chips.map(chip => (
                  <button key={chip} className={styles.mbtiChip} onClick={() => handleChip(chip)}>
                    {chip}
                  </button>
                ))}
              </div>
              <button className={styles.dontKnowBtn} onClick={() => submitAnswer('')}>
                Don't know
              </button>
            </div>
          ) : currentStep.chips?.length > 0 ? (
            <div className={styles.chipsRow}>
              {currentStep.chips.map(chip => (
                <button key={chip} className={styles.chip} onClick={() => handleChip(chip)}>
                  {chip}
                </button>
              ))}
            </div>
          ) : null}
          <div className={styles.inputArea}>
            {currentStep.inputType === 'textarea' ? (
              <textarea
                ref={inputRef}
                className={styles.input}
                value={inputVal}
                onChange={e => { setInputVal(e.target.value); autoResize(e.target); }}
                onKeyDown={handleKeyDown}
                placeholder={currentStep.placeholder}
                rows={1}
              />
            ) : (
              <input
                ref={inputRef}
                className={styles.input}
                type="text"
                value={inputVal}
                onChange={e => setInputVal(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder={currentStep.placeholder}
              />
            )}
            <button
              className={styles.sendBtn}
              onClick={handleNext}
              disabled={!inputVal.trim() && !isOptional}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M12 5L12 19M12 5L6 11M12 5L18 11"
                  stroke="rgba(255,255,255,0.85)" strokeWidth="2.2"
                  strokeLinecap="round" strokeLinejoin="round"/>
              </svg>
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
