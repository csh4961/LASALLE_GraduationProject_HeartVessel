import { useApp } from './store/AppContext';
import { useState, useRef, useEffect, useLayoutEffect } from 'react';
import SplashScreen from './screens/SplashScreen';
import HomeScreen from './screens/HomeScreen';
import OnboardingScreen from './screens/OnboardingScreen';
import VesselScreen from './screens/VesselScreen';
import VesselDetailScreen from './screens/VesselDetailScreen';
import ArchiveScreen from './screens/ArchiveScreen';
import ArchiveDetailScreen from './screens/ArchiveDetailScreen';
import ChatScreen from './screens/ChatScreen';
import FamilyScreen from './screens/FamilyScreen';
import FamilyDetailScreen from './screens/FamilyDetailScreen';
import styles from './App.module.css';

const SCREENS = {
  splash: SplashScreen,
  home: HomeScreen,
  onboarding: OnboardingScreen,
  vessel: VesselScreen,
  'vessel-detail': VesselDetailScreen,
  archive: ArchiveScreen,
  'archive-detail': ArchiveDetailScreen,
  chat: ChatScreen,
  family: FamilyScreen,
  'family-detail': FamilyDetailScreen,
};

// 이 화면들에서는 네비게이션 바 숨김
const NO_NAV = new Set(['splash', 'onboarding', 'chat', 'family', 'family-detail']);

function GlobalNav() {
  const { screen, navigate, familyMembers, setChatDraft } = useApp();
  const [chatOpen, setChatOpen] = useState(false);
  const [inputVal, setInputVal] = useState('');
  const [kbOffset, setKbOffset] = useState(0);
  const inputRef = useRef(null);
  const pillRef = useRef(null);
  const navRefs = useRef([null, null, null]);
  // First-run flag for the pill: the very first positioning must be
  // transition-less so the pill doesn't visibly slide from its CSS
  // default (translateX(0), flush-left) into the correct slot. On
  // mount we snap, then re-enable the transition so subsequent
  // nav clicks still animate the pill across.
  const pillHasPositioned = useRef(false);

  // 화면 전환되면 chat bar 닫기
  useEffect(() => { setChatOpen(false); setInputVal(''); }, [screen]);

  // Pill indicator: measure active button and position pill
  const activeNavIdx = screen === 'vessel' ? 1
    : ['archive','archive-detail'].includes(screen) ? 2
    : 0;

  // useLayoutEffect (not useEffect) so the measurement & transform
  // write happen synchronously before the browser paints the first
  // frame of the nav bar. With useEffect, the user briefly saw the
  // pill at translateX(0) (its CSS default left: 0) and then animate
  // into the active slot over the 0.4s transition — that was the
  // "pill pushed to the left" flash on cold-load.
  //
  // Also re-measures:
  //   • on the icon images' load event — <img> nat widths can shift
  //     the button's getBoundingClientRect once the PNGs decode
  //   • on window resize — orientation / devtools changes
  //   • on every screen change — the nav bar is unmounted on
  //     NO_NAV screens (splash/onboarding/chat/family/…), so when
  //     the user first lands on /home from /splash the refs are
  //     fresh and we need to position again
  // If the current screen hides the nav, skip all the pill work
  // entirely — the JSX returns null below anyway, and trying to
  // measure null refs here would prematurely flip pillHasPositioned
  // to true (the "did we snap yet?" flag), defeating the
  // snap-on-first-appearance guarantee when the user actually
  // lands on a nav-visible screen.
  const navVisible = !NO_NAV.has(screen);
  useLayoutEffect(() => {
    if (!navVisible) return;

    function positionPill(snap) {
      const pill = pillRef.current;
      const btn = navRefs.current[activeNavIdx];
      if (!pill || !btn) return false;
      const bar = pill.parentElement;
      if (!bar) return false;
      const barRect = bar.getBoundingClientRect();
      const btnRect = btn.getBoundingClientRect();
      // If the bar isn't laid out yet (0 width), bail — will retry
      // when images load or on next render.
      if (barRect.width === 0) return false;
      const pillW = pill.offsetWidth;
      const cx = btnRect.left + btnRect.width / 2 - barRect.left;
      const x = cx - pillW / 2;
      if (snap) {
        // Snap into place without animation on first run; re-enable
        // the transition after the transform has been committed.
        const prev = pill.style.transition;
        pill.style.transition = 'none';
        pill.style.transform = `translateX(${x}px)`;
        // Force a reflow so the "none" transition applies to this
        // transform assignment, then restore the stylesheet default.
        // Reading offsetWidth flushes pending style changes.
        // eslint-disable-next-line no-unused-expressions
        pill.offsetWidth;
        pill.style.transition = prev || '';
      } else {
        pill.style.transform = `translateX(${x}px)`;
      }
      return true;
    }

    // Snap on the first successful positioning after mount; animate
    // thereafter so nav-click transitions still feel fluid.
    const snap = !pillHasPositioned.current;
    if (positionPill(snap) && snap) pillHasPositioned.current = true;

    // Re-measure once each icon image finishes decoding (they can
    // nudge the button widths by a pixel or two, enough to leave
    // the pill visibly off-center otherwise). If the image loads
    // before we've had our first successful snap, snap on that
    // load event too.
    const icons = navRefs.current
      .map((btn) => btn?.querySelector('img'))
      .filter(Boolean);
    const onImgLoad = () => {
      const stillNeedSnap = !pillHasPositioned.current;
      if (positionPill(stillNeedSnap) && stillNeedSnap) {
        pillHasPositioned.current = true;
      }
    };
    icons.forEach((img) => {
      if (!img.complete) img.addEventListener('load', onImgLoad);
    });

    // Window resize → reposition (no snap, let it slide if needed).
    const onResize = () => positionPill(false);
    window.addEventListener('resize', onResize);

    return () => {
      icons.forEach((img) => img.removeEventListener('load', onImgLoad));
      window.removeEventListener('resize', onResize);
    };
  }, [activeNavIdx, screen, navVisible]);

  // iOS 키보드 올라올 때 chatBar도 위로 올리기
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;

    function onViewportResize() {
      // 키보드 높이 = 전체 innerHeight - 현재 보이는 viewport 높이 - offsetTop
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

  if (NO_NAV.has(screen)) return null;

  const isOnboarded = familyMembers.length > 0;

  // textarea 높이 자동 조절
  function autoResize(el) {
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = el.scrollHeight + 'px';
  }

  function openChat() {
    setChatOpen(true);
    setTimeout(() => {
      inputRef.current?.focus({ preventScroll: true });
      autoResize(inputRef.current);
    }, 300);
  }

  function closeChat() {
    setChatOpen(false);
    setInputVal('');
    // textarea 높이 리셋
    if (inputRef.current) inputRef.current.style.height = 'auto';
  }

  function handleSend() {
    if (!inputVal.trim()) return;
    setChatDraft(inputVal.trim());
    closeChat();
    navigate('chat');
  }

  function handleKeyDown(e) {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    if (e.key === 'Escape') closeChat();
  }

  return (
    <>
      {/* ── Navigation bar — chatOpen 시 왼쪽으로 슬라이드 아웃.
          Background is now a pure CSS liquid-glass pill on .navBar
          itself (see App.module.css); the old NavigationBar.png
          backing plate was retired. */}
      <div className={`${styles.navBar} ${chatOpen ? styles.navHidden : ''}`}>
        {/* Sliding indicator pill — aligned by measuring DOM */}
        <div className={styles.navPill} ref={pillRef} />

        <button
          ref={el => (navRefs.current[0] = el)}
          className={`${styles.navItem} ${screen === 'home' ? styles.navActive : ''}`}
          onClick={() => navigate('home')}
        >
          <img src="/asset/Button/Navigation Bar/Home Icon.png" alt="" className={styles.navIcon} />
          <span>Home</span>
        </button>
        <button
          ref={el => (navRefs.current[1] = el)}
          className={`${styles.navItem} ${screen === 'vessel' ? styles.navActive : ''}`}
          onClick={() => navigate('vessel')}
        >
          <img src="/asset/Button/Navigation Bar/Heart Vessel Icon.png" alt="" className={styles.navIcon} />
          <span>Vessel</span>
        </button>
        <button
          ref={el => (navRefs.current[2] = el)}
          className={`${styles.navItem} ${['archive','archive-detail'].includes(screen) ? styles.navActive : ''}`}
          onClick={() => navigate('archive')}
        >
          <img src="/asset/Button/Navigation Bar/Archive Icon.png" alt="" className={styles.navIcon} />
          <span>Archive</span>
        </button>
      </div>

      {/* ── 배경 딤 — chatOpen 시 콘텐츠 어둡게 ── */}
      {chatOpen && <div className={styles.chatDim} onClick={closeChat} />}

      {/* ── Chat button — chatOpen 시 36×36으로 scale down.
          The CSS-drawn glass circle lives on .chatBtn itself now
          (see App.module.css) — the old NewChat.png / NewChat2.png
          sprites (which baked a grey circle + emoji into one PNG)
          are retired. The standalone 채팅버튼이모지.png sits at
          the circle's centre as the glyph; the typing-state swap
          that used to alternate PNGs is no longer needed since
          the button's material is now CSS and the glyph identity
          doesn't change between idle and typing. */}
      <button
        className={`${styles.chatBtn} ${chatOpen ? styles.chatBtnSmall : ''}`}
        onClick={chatOpen ? handleSend : openChat}
        aria-label={chatOpen ? 'Send message' : 'New chat'}
      >
        {/* Glyph = /asset/Button/Group 1625372.png, rendered at reduced
            opacity in CSS so the sticker blends into the liquid-glass
            material instead of reading as a solid decal glued onto it.
            Per user (this pass): "채팅 이모지 Group 1625372.png 이걸로
            다 바꿔줘야돼. 적용 안된 페이지들도 있네." — the ChatScreen
            chat-trigger was already updated, but this GlobalNav chat
            button (surfaced on Home / Vessel / Archive via App.jsx)
            was still pointing at the older Group 162537.png (6-digit)
            asset. Switched to the 7-digit variant so every chat
            surface across the app uses the same glyph. */}
        <img
          src="/asset/Button/Group 1625372.png"
          alt=""
          className={styles.chatBtnGlyph}
        />
      </button>

      {/* ── Chat bar — Figma 4047:599
          rect (25,648) 352×196 r=34
          Per user: "채팅치는 박스 위치 하단이 저 내비게이션 하단측이랑
          동일해야해." The chat bar and the nav bar both anchor to
          `bottom: calc(30px + env(safe-area-inset-bottom, 0px))`, so
          in CSS they should land at the same Y — but the inline
          style override below was firing on ANY non-zero kbOffset,
          even a 1–40px visualViewport delta reported by the browser
          without a real keyboard (iOS home-indicator region, address
          bar collapse, window resize jitter). That silently lifted
          the chat bar above the nav-rail plane when chat was opened
          on the home / archive / vessel screens, even though no
          keyboard was visible.

          Gate switched to `kbOffset > 150` so only an actual software
          keyboard (easily 200+px on every modern mobile OS) triggers
          the lift. Any sub-150px offset is treated as noise and the
          chat bar stays on the default bottom rail exactly aligned
          with where `.navBar` sits. */}
      <div
        className={`${styles.chatBar} ${chatOpen ? styles.chatBarOpen : ''}`}
        style={kbOffset > 150 ? { bottom: `${kbOffset + 12}px` } : undefined}
      >
        {/* 텍스트 입력 영역 */}
        <textarea
          ref={inputRef}
          className={styles.chatInput}
          value={inputVal}
          onChange={e => { setInputVal(e.target.value); autoResize(e.target); }}
          onKeyDown={handleKeyDown}
          placeholder="Tell me anything, anytime."
        />
      </div>
    </>
  );
}

/**
 * SharedCharacter — persistent across Home ↔ Vessel transitions.
 *
 * The main phone container re-mounts its child screen on every navigation
 * (`<div key={screen}>`), so anything living inside a screen is destroyed on
 * change. That would flash-cut the character between its Home size (435×437)
 * and its Vessel size (144×144). Instead we host ONE character at the .phone
 * level, outside the re-mounted .screenWrap, and drive its size/position via
 * a CSS class bound to the current screen. The shared element then smoothly
 * morphs while the surrounding text (taglines, orbit, etc.) swaps.
 *
 * Hidden on every screen except home/vessel. Also hidden while a Vessel entry
 * is expanded — the expanded detail layer takes over the centre of the canvas
 * there, and the character must not peek through from underneath.
 */
function SharedCharacter() {
  const { screen, vesselExpanded } = useApp();
  const isHomeOrVessel = screen === 'home' || screen === 'vessel';
  const hidden = !isHomeOrVessel || (screen === 'vessel' && vesselExpanded);
  const positionClass = screen === 'vessel' ? styles.sharedCharVessel : styles.sharedCharHome;
  return (
    <div
      className={`${styles.sharedChar} ${positionClass} ${hidden ? styles.sharedCharHidden : ''}`}
      aria-hidden="true"
    >
      <img src="/asset/splash-character.png" alt="" className={styles.sharedCharImg} />
    </div>
  );
}

/* Dev-only capture hook — exposes window.__hv in DEV so a Playwright
   script can seed state (set replayEntry, pick a family member, etc.)
   and then navigate to any screen to take a clean screenshot. Stripped
   out of production builds by import.meta.env.DEV, so there's zero
   prod surface area. Used by scripts/capture-screens.mjs. */
function CaptureHook() {
  const ctx = useApp();
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    window.__hv = {
      navigate: ctx.navigate,
      setReplayEntry: ctx.setReplayEntry,
      setReplaySource: ctx.setReplaySource,
      setSelectedVesselEntry: ctx.setSelectedVesselEntry,
      setSelectedArchiveEntry: ctx.setSelectedArchiveEntry,
      setSelectedFamilyMember: ctx.setSelectedFamilyMember,
      setEditingMember: ctx.setEditingMember,
      get vesselEntries() { return ctx.vesselEntries; },
      get archiveEntries() { return ctx.archiveEntries; },
      get familyMembers() { return ctx.familyMembers; },
      get screen() { return ctx.screen; },
    };
    window.__hvReady = true;
  }, [ctx]);
  return null;
}

function App() {
  const { screen } = useApp();
  const Screen = SCREENS[screen] || HomeScreen;

  return (
    <div className={styles.phone}>
      {/* ── SVG filter for the liquid-glass refraction. Hoisted to the
          top-level <App/> so every screen (including splash/onboarding
          where GlobalNav is hidden) can reference #liquidGlass via
          `backdrop-filter: url(#liquidGlass) blur(...)`.
          feTurbulence generates a soft fractal noise field; feDisplacement
          Map warps whatever sits under the filter according to that
          field, producing the bent-light refraction you see on Apple's
          liquid-glass material. `scale` controls the warp strength —
          5 is a gentle optical distortion that's visible as glass but
          doesn't compromise legibility of content behind. Chromium
          and Firefox honour `backdrop-filter: url(...)`; Safari falls
          back to the plain blur/saturate chain beside it, which still
          reads as glass. The SVG is absolutely hidden (width/height 0)
          so it doesn't affect layout. */}
      <svg
        width="0"
        height="0"
        aria-hidden="true"
        style={{ position: 'absolute', pointerEvents: 'none' }}
      >
        <defs>
          <filter id="liquidGlass" x="0%" y="0%" width="100%" height="100%">
            <feTurbulence
              type="fractalNoise"
              baseFrequency="0.012 0.018"
              numOctaves="2"
              seed="3"
              result="noise"
            />
            <feDisplacementMap
              in="SourceGraphic"
              in2="noise"
              scale="5"
              xChannelSelector="R"
              yChannelSelector="G"
            />
          </filter>
        </defs>
      </svg>

      {/* SharedCharacter lives OUTSIDE the re-mounted screen wrapper so it
          survives navigation and can morph smoothly between Home & Vessel. */}
      <SharedCharacter />
      <div key={screen} className={styles.screenWrap}>
        <Screen />
      </div>
      <GlobalNav />
      <CaptureHook />
    </div>
  );
}

export default App;
