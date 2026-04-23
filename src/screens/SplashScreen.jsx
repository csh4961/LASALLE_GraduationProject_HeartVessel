import { useApp } from '../store/AppContext';
import styles from './SplashScreen.module.css';

export default function SplashScreen() {
  const { navigate } = useApp();

  return (
    <div className={styles.screen}>

      {/* ── 캐릭터 이미지 (4001:499)
          Figma 원위치: x=4 y=209 w=395 h=397
          entry anim: 화면 하단 바깥(translateY(+120%))에서 시작해
          resting 위치(translateY(0))까지 천천히 떠오름. CSS 키프레임
          `charRise`가 0–900ms 동안 재생. 화면 켠 직후 사용자 눈이
          아래에서 먼저 캐릭터를 감지하고, 올라오는 궤적을 따라
          자연스럽게 중앙 로고 영역까지 시선이 이끌리게 한다. */}
      <img
        className={styles.character}
        src="/asset/splash-character.png"
        alt=""
      />

      {/* ── Heart Vessel 로고 이미지
          entry anim: 캐릭터 정착(≈900ms) 이후 1s 구간에서 slow fade-in.
          opacity 0→1 + translateY(8px→0) 으로 "서서히 떠오르는"
          인상 유지. CSS `logoReveal` 키프레임 사용. */}
      <img
        className={styles.logo}
        src="/asset/Heart Vessel Logo.png"
        alt="Your Heart Vessel"
      />

      {/* ── Get Started 버튼
          per user: "지금 홈 화면에 있는 버튼 사이즈로 똑같이 너가
          직접 만들어서 그 하단에 배치해줘. 지금꺼는 제거하고."
          기존 GetStartedButton.png (164×46) 제거하고, 홈 네비게이션
          바(.navBar, 265×66 liquid-glass pill)와 동일한 footprint 로
          CSS 로 직접 조형. 같은 반투명 다크 tint + backdrop filter
          + ::before/::after 하이라이트 레시피를 써서 홈에 도착했을
          때 재질이 이어지는 인상을 유지한다.

          entry anim: 로고 페이드가 거의 끝난 시점(≈2s)에서 등장.
          opacity 0→1 + translateY(10px→0) — 세 요소 중 마지막
          순차적 reveal 로 사용자의 "탭 가능한 포인트" 인식이
          가장 끝에 오게 설계. */}
      <button
        className={styles.getStartedBtn}
        onClick={() => navigate('home')}
        aria-label="Get Started"
      >
        <span className={styles.getStartedLabel}>Get Started</span>
      </button>

    </div>
  );
}
