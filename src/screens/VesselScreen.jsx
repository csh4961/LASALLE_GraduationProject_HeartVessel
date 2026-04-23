import { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { useApp } from '../store/AppContext';
import styles from './VesselScreen.module.css';
import BackButton from '../components/BackButton';

/**
 * VesselScreen — Orbit + Expanded Detail with shared-element morph
 *
 * Two stacked layers:
 *   • Orbit layer (collapsed) — 8 hearts rotate slowly around a center character.
 *   • Expanded layer (detail) — FIXED layout: one big centered heart with the
 *     message overlaid, plus decorative peek hearts cascading to the right.
 *
 * On tap we capture the clicked heart's screen position, then imperatively
 * drive CSS transitions on the main heart (from clicked-orbit position @ orbit
 * size → screen center @ full size) and the peek hearts (bloom from center to
 * fixed slots). We use `useLayoutEffect` + a forced reflow so the start
 * transform is committed before the browser paints, guaranteeing the
 * transition animates from the clicked position rather than flashing past it.
 *
 * The FINAL composition is deterministic — peek hearts always land in the
 * same fixed slots, independent of which heart was clicked or where the
 * orbit was rotated to at click time.
 */

// 8 positions around a circle, starting from top (0°), going clockwise
function getOrbitPositions(count) {
  const positions = [];
  const startAngle = -90;
  for (let i = 0; i < count; i++) {
    const angleDeg = startAngle + (360 / count) * i;
    const angleRad = (angleDeg * Math.PI) / 180;
    positions.push({
      angle: angleDeg + 90,
      x: Math.cos(angleRad),
      y: Math.sin(angleRad),
    });
  }
  return positions;
}

const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function formatDate(ts) {
  if (!ts) return '';
  const d = new Date(ts);
  return `${MONTH_NAMES[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`;
}

function daysHeld(ts) {
  if (!ts) return 0;
  return Math.max(0, Math.floor((Date.now() - ts) / 86400000));
}

const RADIUS = 125;
const ORBIT_HEART_SIZE = 101;
const MAIN_HEART_SIZE = 600;                 // canonical size; all hearts render at 600px
// Visual-only shrink applied to the rendered heart image. Swapping the PNG
// (Group 162562 → VesselHeartImageNew) introduced slightly tighter intrinsic
// bleed, making the heart read ~10% larger even though all container
// dimensions and layout math were unchanged. Rather than modify MAIN/ORBIT
// sizes (which would ripple into RADIUS spacing, peek offsets, and morph
// math), we just multiply the final render scale by this factor. All
// positioning, motion, and arrangement stay pixel-identical; only the
// heart's rasterized bitmap shrinks around its own center.
const HEART_VISUAL_SCALE = 0.936;
const MORPH_DURATION = 620;            // ms — main heart grow time
const MORPH_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
// How long the "extra" hearts (|signed| >= 2) take to fade out when the
// user taps a heart and the 3-card stack morphs into view. Much shorter
// than the main morph so 5 off-camera-destined hearts don't linger in
// peripheral vision while the 3 visible cards are being composed.
// They still physically travel to their hidden slots over MORPH_DURATION
// (for swipe continuity) — just silently after the opacity has collapsed.
const HIDDEN_FADE_DURATION = 220;
// Final rotation of the main heart when expanded. Negative = counterclockwise
// ("tilted to the left") per the target composition.
const MAIN_END_ROTATION = -90;
// Target center offset (px) of the main heart relative to screen center.
// Keeps the LEFT edge at the same x as the original 440px heart (-220) —
// every size increase pushes only the RIGHT edge further right, overshooting
// the 393px viewport on purpose.
const MAIN_END_CENTER_X = 80; // = -220 + (600/2)
const MAIN_END_CENTER_Y = 0;

/**
 * FIXED peek heart positions for the expanded state.
 * Exactly 2 peek slots — one above the main heart, one below. Together with
 * the main heart they form a 3-card stack: the composition is designed for a
 * future up/down swipe interaction where the center heart is the current
 * message and the two peeks are the adjacent messages in the person's history.
 *   [0] = above main (tilted +30° from main's -90° → -60°)
 *   [1] = below main (tilted -30° from main's -90° → -120°)
 */
const PEEK_POSITIONS = [
  // [0] upper peek — previous/next message preview
  { dx: 150, dy: -180, size: 500, rotate: -60, opacity: 0.7 },
  // [1] lower peek — next/previous message preview
  { dx: 150, dy:  180, size: 500, rotate: -120, opacity: 0.7 },
];

// ── Swipe-carousel constants ─────────────────────────────────
//   Inside an expanded person's vessel, swiping up/down cycles through that
//   person's messages (card-stack pattern). Boundary behavior = LOOP.
const SWIPE_DURATION = 420;                              // ms — card cycle
const SWIPE_EASING = 'cubic-bezier(0.22, 1, 0.36, 1)';
const SWIPE_THRESHOLD = 55;                              // px
const SWIPE_VELOCITY = 0.4;                              // px/ms
// Vertical offset applied to hidden slots beyond the peeks. Each step further
// into the hidden stack adds another HIDDEN_STEP to dy, pushing the heart
// further off-screen. Opacity 0, so user never sees them at rest, but they
// exist so morph-in and swipe-in always have a heart ready.
const HIDDEN_SLOT_STEP = 220;

/**
 * Signed slot distance from the currently-displayed "main" heart, as a
 * function of the orbit-relative index `rel` ∈ [0, N-1]:
 *   rel = 0 (clicked heart)    → 0 (main)
 *   rel = 1 (right-1 neighbor) → -1 (upper peek — above main)
 *   rel = 2 (right-2 neighbor) → -2 (hidden above upper peek)
 *   rel = N-1 (left-1)         → +1 (lower peek — below main)
 *   rel = N-2 (left-2)         → +2 (hidden below lower peek)
 * For even N, the antipode (rel = N/2) lives on the "below" side as +N/2.
 * This preserves the prior UX convention (right-1 of clicked heart surfaces
 * as the upper peek neighbor) while giving EVERY orbit member a well-defined
 * slot in the expanded stack.
 */
function signedFromRel(rel, N) {
  if (rel === 0) return 0;
  if (N % 2 === 0 && rel === N / 2) return N / 2;
  if (rel * 2 < N) return -rel;
  return N - rel;
}

/**
 * Geometry for a heart at a given signed slot distance. Returns an object
 * with `{dx, dy, rotate, scale, opacity}` — applied via imperative transform:
 *   translate(dx - HALF, dy - HALF) rotate(rotate) scale(scale)
 * (Hearts are rendered at canonical MAIN_HEART_SIZE in the DOM; `scale`
 * visually shrinks peeks/hidden slots. HALF = MAIN_HEART_SIZE/2.)
 *
 *   signed  0    → main (center, full-size, visible)
 *   signed ±1    → upper/lower peek (visible at PEEK_POSITIONS opacity)
 *   |signed|≥2   → hidden offscreen stack above/below the peeks (opacity 0)
 */
function getSlotPos(signed) {
  if (signed === 0) {
    return {
      dx: MAIN_END_CENTER_X,
      dy: MAIN_END_CENTER_Y,
      rotate: MAIN_END_ROTATION,
      scale: 1,
      opacity: 1,
    };
  }
  if (signed === -1) {
    const p = PEEK_POSITIONS[0];
    return {
      dx: p.dx, dy: p.dy, rotate: p.rotate,
      scale: p.size / MAIN_HEART_SIZE, opacity: p.opacity,
    };
  }
  if (signed === +1) {
    const p = PEEK_POSITIONS[1];
    return {
      dx: p.dx, dy: p.dy, rotate: p.rotate,
      scale: p.size / MAIN_HEART_SIZE, opacity: p.opacity,
    };
  }
  // Hidden slots — step further above (-) or below (+) the peek position.
  const side = signed < 0 ? -1 : 1;
  const distAbs = Math.abs(signed);
  const baseP = side < 0 ? PEEK_POSITIONS[0] : PEEK_POSITIONS[1];
  return {
    dx: baseP.dx,
    dy: baseP.dy + side * (distAbs - 1) * HIDDEN_SLOT_STEP,
    rotate: baseP.rotate,
    scale: baseP.size / MAIN_HEART_SIZE,
    opacity: 0,
  };
}

export default function VesselScreen() {
  const { goHome, navigate, familyMembers, vesselEntries, setVesselExpanded, setSelectedVesselEntry, setReplayEntry, setReplaySource } = useApp();
  const [fade, setFade] = useState(false);
  const [pressedIndex, setPressedIndex] = useState(null);
  const [expandedIndex, setExpandedIndex] = useState(null);
  // `lastExpandedIndex` outlives `expandedIndex` during the collapse animation
  // so the originating orbit heart stays hidden until the main heart has
  // fully shrunk back into its position — no "double heart" flash.
  const [lastExpandedIndex, setLastExpandedIndex] = useState(null);
  const [mountExpanded, setMountExpanded] = useState(false);
  // The clicked heart's screen-relative offset AND its on-screen rotation at
  // click time — both drive the morph start state so the main heart picks up
  // where the orbit heart left off.
  const [morphStart, setMorphStart] = useState(null);

  // Card-stack carousel state: which message of the expanded person is currently
  // in the "main" slot, whether a swipe animation is in flight, and whether the
  // text is in the short "fade back in with new content" post-swipe window
  // (needed to override the 0.4s delay CSS applies on the INITIAL expand).
  const [entryIndex, setEntryIndex] = useState(0);
  const [isSwiping, setIsSwiping] = useState(false);
  const [textRefading, setTextRefading] = useState(false);

  const screenRef = useRef(null);
  // ONE ref array — every orbit member has a corresponding heart in the
  // expanded layer (not just the clicked one + 2 peeks). The 3 visible hearts
  // at any time are the ones at signed slot distance -1, 0, +1; the rest are
  // stacked offscreen with opacity 0 so the stack is always populated.
  const heartRefs = useRef([]);
  const heartsOrbitRef = useRef(null);
  // Swipe gesture state — pointer down position, timestamp, etc.
  const swipeGestureRef = useRef({ active: false, startY: 0, startT: 0, pointerId: null });

  useEffect(() => {
    requestAnimationFrame(() => setFade(true));
  }, []);

  // ── Orbit heart sequential fade-in ─────────────────────────
  //   On first mount, each heart fades in with a staggered delay (see per-
  //   button `transition` in the map below) so they appear clockwise, one
  //   by one, around the character. Once the stagger window completes we
  //   flip `staggerDone` and drop the transition entirely — that way
  //   subsequent opacity changes (expand hides all orbit hearts via
  //   `isSource`; collapse reveals them again) snap instantly, matching
  //   the original "no cross-fade during morph" intention that keeps the
  //   shared-element heart illusion crisp.
  const [staggerDone, setStaggerDone] = useState(false);
  useEffect(() => {
    // Last heart (i=7) starts at 140+7*50 = 490ms, duration 560ms → settles
    // at 1050ms. 1200ms leaves a small buffer before we drop the transition
    // and return to snap behaviour for expand/collapse interactions.
    const t = setTimeout(() => setStaggerDone(true), 1200);
    return () => clearTimeout(t);
  }, []);

  const isExpanded = expandedIndex !== null;

  // Sync local expand state to context so the App-level SharedCharacter can
  // hide while the detail layer is in view (the expanded heart sits where
  // the character would otherwise be — we don't want the character showing
  // through from underneath). Reset on unmount so leaving Vessel always
  // restores the character for the next screen.
  useEffect(() => {
    setVesselExpanded(isExpanded);
    return () => setVesselExpanded(false);
  }, [isExpanded, setVesselExpanded]);

  // ── Mount the expanded layer immediately on expand, and unmount after the
  //    reverse animation finishes on collapse. ──
  useEffect(() => {
    if (isExpanded) {
      setMountExpanded(true);
      return;
    }
    if (!mountExpanded) return;
    const t = setTimeout(() => {
      setMountExpanded(false);
      setMorphStart(null);
      setLastExpandedIndex(null);
    }, MORPH_DURATION + 80);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded]);

  // ── Drive the shared-element morph via imperative CSS transitions, for
  //    EVERY orbit member's heart (not just the clicked one + 2 peeks).
  //    On expand: each heart animates from its live orbit world-position →
  //       its expanded slot position (main for rel=0, upper/lower peek for
  //       rel=±1, hidden offscreen stack for |signed|≥2).
  //    On collapse: each heart animates from wherever it currently is (which
  //       depends on entryIndex after any swipes) → its orbit world-position,
  //       and the 5 hidden hearts fade in as they travel, so the orbit layer
  //       is "already full" the moment it becomes visible again.
  //    useLayoutEffect + forced reflow commits the start state before paint. ──
  useLayoutEffect(() => {
    if (!mountExpanded) return;
    if (lastExpandedIndex === null) return;
    if (!morphStart) return;
    const N = members.length;
    if (N === 0) return;

    const HALF = MAIN_HEART_SIZE / 2;
    const orbitRot = morphStart.orbitRot || 0;
    const orbitRad = (orbitRot * Math.PI) / 180;
    const cosR = Math.cos(orbitRad);
    const sinR = Math.sin(orbitRad);
    const orbitScale = ORBIT_HEART_SIZE / MAIN_HEART_SIZE;
    const clickedIdx = lastExpandedIndex;

    for (let i = 0; i < N; i++) {
      const el = heartRefs.current[i];
      if (!el) continue;
      const pos = positions[i];
      if (!pos) continue;

      // Orbit-world position for heart i = rotate local orbit coord by orbitRot.
      const lx = pos.x * RADIUS;
      const ly = pos.y * RADIUS;
      const oDx = lx * cosR - ly * sinR;
      const oDy = lx * sinR + ly * cosR;

      // Relative orbit index from clicked heart — stable for this expand session.
      const rel = ((i - clickedIdx) % N + N) % N;
      // Target slot: fresh-expand cycle (entryIndex=0) on expand; CURRENT cycle
      // on collapse (so the heart collapses from wherever swipes left it).
      const targetCycle = isExpanded ? 0 : entryIndex;
      const targetRel = ((rel + targetCycle) % N + N) % N;
      const targetSigned = signedFromRel(targetRel, N);
      const targetSlot = getSlotPos(targetSigned);

      // Short-arc normalize the heart's orbit rotation toward its slot rotation.
      let oRot = orbitRot + pos.angle;
      while (oRot - targetSlot.rotate > 180) oRot -= 360;
      while (oRot - targetSlot.rotate <= -180) oRot += 360;

      const orbitXfm =
        `translate(${-HALF + oDx}px, ${-HALF + oDy}px) ` +
        `rotate(${oRot}deg) scale(${orbitScale * HEART_VISUAL_SCALE})`;
      const slotXfm =
        `translate(${-HALF + targetSlot.dx}px, ${-HALF + targetSlot.dy}px) ` +
        `rotate(${targetSlot.rotate}deg) scale(${targetSlot.scale * HEART_VISUAL_SCALE})`;

      if (isExpanded) {
        // Pin at orbit position (no transition) → force reflow → animate to slot.
        el.style.transition = 'none';
        el.style.transform = orbitXfm;
        el.style.opacity = '1'; // every orbit heart starts fully visible
        // eslint-disable-next-line no-unused-expressions
        el.offsetWidth;
        // Hidden-slot destinations (opacity 0) fade out fast so they don't
        // linger in peripheral vision while the 3-card stack forms. Visible
        // destinations (main/peek) keep the full morph-duration opacity
        // transition so their brightness shift matches the transform arc.
        const isHiddenDest = targetSlot.opacity === 0;
        const opacityDuration = isHiddenDest ? HIDDEN_FADE_DURATION : MORPH_DURATION;
        el.style.transition =
          `transform ${MORPH_DURATION}ms ${MORPH_EASING}, ` +
          `opacity ${opacityDuration}ms ease`;
        el.style.transform = slotXfm;
        el.style.opacity = String(targetSlot.opacity);
      } else {
        // Collapse: element is already at its current inline transform (from
        // the last morph-in or most-recent swipe). Just set the transition
        // and the new orbit-world end state — browser animates the delta.
        el.style.transition =
          `transform ${MORPH_DURATION}ms ${MORPH_EASING}, ` +
          `opacity ${MORPH_DURATION}ms ease`;
        el.style.transform = orbitXfm;
        el.style.opacity = '1'; // hidden slots (opacity 0) fade in en route
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isExpanded, mountExpanded, morphStart]);

  // ── Reset the card-stack index whenever the user enters a different
  //    person's vessel. Latest message is always shown first. ──
  useEffect(() => {
    if (expandedIndex !== null) {
      setEntryIndex(0);
    }
  }, [expandedIndex]);

  // ── Commit a swipe — shift the ENTIRE N-heart stack by one slot and
  //    advance (or regress) the cycle counter. Every heart gets animated
  //    (visible or hidden) so no slot is ever empty waiting for a new
  //    card to materialize. Boundary behavior: LOOP (modular wrap). ─────
  function commitSwipe(direction) {
    if (isSwiping) return;
    if (totalEntries < 2) return; // need at least two messages to cycle
    const N = members.length;
    if (N === 0) return;
    const clickedIdx = lastExpandedIndex;
    if (clickedIdx === null) return;

    const HALF = MAIN_HEART_SIZE / 2;
    const step = direction === 'up' ? 1 : -1;

    setIsSwiping(true);

    for (let i = 0; i < N; i++) {
      const el = heartRefs.current[i];
      if (!el) continue;
      const rel = ((i - clickedIdx) % N + N) % N;

      // Current & next signed distance for this heart.
      const currRel = ((rel + entryIndex) % N + N) % N;
      const nextRel = ((rel + entryIndex + step) % N + N) % N;
      const currSigned = signedFromRel(currRel, N);
      const nextSigned = signedFromRel(nextRel, N);
      const currSlot = getSlotPos(currSigned);
      const nextSlot = getSlotPos(nextSigned);

      // Short-arc normalize next rotation toward current rotation so the
      // transition doesn't take the long way around.
      let nextRot = nextSlot.rotate;
      while (nextRot - currSlot.rotate > 180) nextRot -= 360;
      while (nextRot - currSlot.rotate <= -180) nextRot += 360;

      // Z-index boost — the heart that's about to become the new main
      // gets pulled to the top of the stack BEFORE motion starts. With
      // the old main still at z=10 (React hasn't re-rendered yet) and the
      // incoming heart now at z=20, the incoming heart visibly slides
      // OVER the outgoing main during their mid-swipe path crossing.
      // That reads as "a new card being dealt on top of the old" rather
      // than two silhouettes blending ambiguously. The imperative style
      // sticks through the React re-render that `setIsSwiping(true)`
      // triggers (no prop change means no DOM write), then gets naturally
      // corrected back to z=10 when `entryIndex` updates post-swipe.
      const isIncomingMain = nextSigned === 0;
      if (isIncomingMain) {
        el.style.zIndex = '20';
      }

      // Decouple opacity from transform timing.
      //   transform: runs the full SWIPE_DURATION so the positional arc
      //     reads as a smooth slide.
      //   opacity: completes in ~45% of that window (front-loaded) so each
      //     heart settles into its NEW per-slot opacity before reaching
      //     the spatial midpoint — where the outgoing main and the incoming
      //     peek would otherwise overlap at awkward in-between alpha
      //     values and visually "muddy". Combined with the z-index boost
      //     above, the crossing reads as a crisp over/under rather than a
      //     translucent haze.
      el.style.transition =
        `transform ${SWIPE_DURATION}ms ${SWIPE_EASING}, ` +
        `opacity 200ms ease`;
      el.style.transform =
        `translate(${-HALF + nextSlot.dx}px, ${-HALF + nextSlot.dy}px) ` +
        `rotate(${nextRot}deg) scale(${nextSlot.scale * HEART_VISUAL_SCALE})`;
      el.style.opacity = String(nextSlot.opacity);
    }

    // After the card cycle finishes, advance entryIndex (unbounded integer —
    // the heart slot function wraps it mod N, and the text uses it mod
    // personEntries.length). Also trigger the text refading window.
    setTimeout(() => {
      setEntryIndex((c) => c + step);
      setIsSwiping(false);
      setTextRefading(true);
      // Window must cover the re-fade's delay + duration (40 + 280 =
      // 320ms); 380ms leaves a small buffer before we drop back to the
      // default CSS opacity.
      setTimeout(() => setTextRefading(false), 380);
    }, SWIPE_DURATION);
  }

  // ── Swipe gesture handlers (pointer events — unified mouse/touch). ────
  function handleSwipePointerDown(e) {
    if (!isExpanded || isSwiping) return;
    swipeGestureRef.current = {
      active: true,
      startY: e.clientY,
      startT: Date.now(),
      pointerId: e.pointerId,
    };
  }
  function handleSwipePointerUp(e) {
    const g = swipeGestureRef.current;
    if (!g.active) return;
    swipeGestureRef.current = { active: false, startY: 0, startT: 0, pointerId: null };
    const deltaY = e.clientY - g.startY;
    const dt = Math.max(1, Date.now() - g.startT);
    const velocity = Math.abs(deltaY) / dt;
    if (Math.abs(deltaY) > SWIPE_THRESHOLD || velocity > SWIPE_VELOCITY) {
      commitSwipe(deltaY < 0 ? 'up' : 'down');
    }
  }
  function handleSwipePointerCancel() {
    swipeGestureRef.current = { active: false, startY: 0, startT: 0, pointerId: null };
  }

  const members = familyMembers.length > 0 ? familyMembers : [];
  const positions = getOrbitPositions(members.length);

  function handleHeartTap(i, e) {
    if (isExpanded) return;

    // ── Capture the orbit wrapper's live spin angle. Everything else about
    //    the morph (each heart's world-space position, rotation, target slot)
    //    is derivable from this + positions[i] + the clicked index. ──
    let orbitRot = 0;
    if (heartsOrbitRef.current && typeof window !== 'undefined' && window.DOMMatrix) {
      const t = getComputedStyle(heartsOrbitRef.current).transform;
      if (t && t !== 'none') {
        try {
          const m = new DOMMatrix(t);
          orbitRot = (Math.atan2(m.b, m.a) * 180) / Math.PI;
        } catch {
          orbitRot = 0;
        }
      }
    }

    // Any interaction ends the mount-in stagger window immediately. If we
    // don't do this and the user taps a heart before the 1.4s timeout, the
    // residual staggered opacity transitions would re-run on the post-
    // collapse reveal, making the orbit fade back in heart-by-heart when it
    // should just snap back into place.
    setStaggerDone(true);
    setMorphStart({ orbitRot });
    setLastExpandedIndex(i);
    setExpandedIndex(i);
  }

  // ── Drill-down into the full detail view for the current expanded entry.
  //    Wired per user: "지금 heart vessel 들어가서 이제 하트들 위아래로
  //    스와이프하잖아, 근데 거기서 지금 메인 중앙 화면을 누르면 그 채팅
  //    했던 내역이 쭉 나와야해." Sets the selected entry on context so the
  //    'vessel-detail' screen can read it from anywhere, then navigates.
  //    Guard on expandedEntry being a real saved entry — the stubbed
  //    placeholder object VesselScreen renders for empty persons has no
  //    transcript to show, so we noop in that case. */
  /* Per user ("저길 들어가면 2,3,4번 이미지처럼 내가 했던 대화 그대로
     똑같이 들어가있어야돼"): tapping the expanded vessel card doesn't
     go to a summary / letter view — it reopens the EXACT chat surface
     (observation hero + perspective deck + words card) as the user
     saw it at commit time. We do this by planting the saved entry as
     `replayEntry` in AppContext and navigating to the same 'chat'
     route a fresh conversation uses. ChatScreen detects the replay
     entry on mount, hydrates all its state from it, pre-fills
     `typedIds` with every coach message so nothing re-animates, and
     suppresses the bottom input + commit rails. Replay entry is
     cleared on ChatScreen unmount and on goHome() so subsequent
     fresh chats aren't poisoned by stale replay state. */
  function handleOpenDetail() {
    if (!expandedEntry || !expandedEntry.createdAt) return;
    setSelectedVesselEntry(expandedEntry);
    setReplayEntry(expandedEntry);
    // Tag the replay source so ChatScreen's commit rail knows the
    // entry already lives in Vessel — the only meaningful affordance
    // is "move to Archive". Per user: "여긴 이미 vessel에 들어와있는
    // 걸 보는거니까 move to archive 버튼만 있게 해줘."
    setReplaySource('vessel');
    navigate('chat');
  }

  function handleBack() {
    if (isExpanded) {
      setExpandedIndex(null);
    } else {
      goHome();
    }
  }

  const handlePressStart = (i) => { if (!isExpanded) setPressedIndex(i); };
  const handlePressEnd = () => setPressedIndex(null);

  // Derived detail content — all entries for the expanded person, newest first.
  const expandedMember = expandedIndex !== null ? members[expandedIndex] : null;
  // Keep the SAME member resolved while collapsing (expandedIndex → null) so
  // `personEntries` doesn't go empty mid-animation.
  const resolvedMember = expandedMember
    || (lastExpandedIndex !== null ? members[lastExpandedIndex] : null);
  const personEntries = resolvedMember
    ? vesselEntries
        .filter(e => e.person?.relation === resolvedMember.relation || e.person?.name === resolvedMember.name)
        .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
    : [];
  const totalEntries = personEntries.length;
  // Safe index — always wrap so the card stack keeps rendering if entries change.
  const safeEntryIndex = totalEntries > 0 ? ((entryIndex % totalEntries) + totalEntries) % totalEntries : 0;
  const expandedEntry = resolvedMember
    ? (personEntries[safeEntryIndex]
       || { person: resolvedMember, message: '', rawText: '', createdAt: Date.now() })
    : null;

  // ── Hide ALL orbit hearts during the expand/collapse lifecycle. Every
  //    orbit member now has a corresponding expanded-layer heart animating
  //    between orbit position and its slot, so the orbit layer must stay
  //    empty to avoid double-rendering. When mountExpanded flips false
  //    (end of collapse animation), all orbit hearts re-appear instantly —
  //    and since the expanded hearts have just finished animating TO orbit
  //    positions, the handoff is seamless. ──
  const hiddenOrbitSet = (() => {
    if (!mountExpanded) return null;
    const set = new Set();
    for (let i = 0; i < members.length; i++) set.add(i);
    return set;
  })();

  return (
    <div className={styles.screen} ref={screenRef}>

      {/* Back button — glass circle + drawn chevron (see
          src/components/BackButton). */}
      <BackButton className={styles.backBtn} onClick={handleBack} />

      {/* Top tagline */}
      <div className={`${styles.topText} ${fade && !isExpanded ? styles.fadeIn : styles.fadeOut}`}>
        <p className={styles.topLine}>
          This is your <em className={styles.em}>Heart Vessel</em>
        </p>
        <p className={styles.topLine}>
          where your <em className={styles.em}>words</em> wait to be sent.
        </p>
      </div>

      {/* ── Orbit layer (collapsed state) ───────────────────
          Central character is rendered by App.jsx's <SharedCharacter> and
          shared with HomeScreen — so Home ↔ Vessel navigation morphs the
          SAME element instead of swapping two different ones.
          Per-heart staggered fade (inline transition below) handles the
          mount-in reveal — the whole orbitWrap no longer flashes in as a
          single layer, instead each heart materialises one after another
          around the character. */}
      <div className={`${styles.orbitWrap} ${isExpanded ? styles.orbitHidden : ''}`}>
        <div
          ref={heartsOrbitRef}
          className={`${styles.heartsOrbit} ${(pressedIndex !== null || mountExpanded) ? styles.paused : ''}`}
        >
          {members.map((member, i) => {
            if (i >= positions.length) return null;
            const pos = positions[i];
            const offsetX = pos.x * RADIUS;
            const offsetY = pos.y * RADIUS;
            const label = member.relation || member.name || '?';
            const isPressed = pressedIndex === i;
            const scale = isPressed ? 1.3 : 1;
            // Keep the source heart (clicked + any peek neighbor) hidden for
            // the ENTIRE expand/collapse lifecycle — not just while
            // expandedIndex matches — so no migrating heart ever overlaps its
            // orbit twin.
            const isSource = hiddenOrbitSet ? hiddenOrbitSet.has(i) : false;

            // Staggered fade-in on mount only. Each heart keeps its own
            // unhurried 560ms fade, but the per-heart START delay is tight
            // (50ms) so the reveals overlap heavily — heart N begins while
            // N-1 is only ~9% through its fade. That reads as "the whole
            // orbit is blooming at once, just offset enough to feel
            // directional" rather than "popping in one by one." Once
            // `staggerDone` flips (~1.2s after mount), we drop back to
            // `transition: none` so expand/collapse hide transitions remain
            // snap-instant.
            const enterDelayMs = 140 + i * 50;
            const enterTransition = `opacity 560ms ease ${enterDelayMs}ms`;

            return (
              <button
                key={member.name || i}
                className={`${styles.heartBtn} ${isPressed ? styles.heartBtnPressed : ''}`}
                style={{
                  transform: `translate(${offsetX}px, ${offsetY}px) scale(${scale})`,
                  // Initial-mount (!fade) keeps every heart at opacity 0; once
                  // fade flips true on the next rAF, each heart's staggered
                  // transition runs it up to 1 in turn.
                  opacity: isSource ? 0 : (fade ? 1 : 0),
                  // Instant hide/reveal — no cross-fade. This is what sells the
                  // "same heart moving" illusion: there's only ever one heart
                  // rendered on screen at any given frame.
                  visibility: isSource ? 'hidden' : 'visible',
                  zIndex: isPressed ? 10 : 5,
                  transition: staggerDone ? 'none' : enterTransition,
                }}
                onPointerDown={() => handlePressStart(i)}
                onPointerUp={handlePressEnd}
                onPointerLeave={handlePressEnd}
                onPointerCancel={handlePressEnd}
                onClick={(e) => handleHeartTap(i, e)}
              >
                <div className={styles.heartInner} style={{ transform: `rotate(${pos.angle}deg)` }}>
                  <img src="/asset/VesselHeartImageNew.png" alt="" className={styles.heartImg} />
                  <span
                    className={styles.heartLabel}
                    style={{ opacity: mountExpanded ? 0 : 1 }}
                  >
                    {label.split('\n').map((line, j) => (
                      <span key={j}>
                        {j > 0 && <br />}
                        {line}
                      </span>
                    ))}
                  </span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Expanded layer (detail, fixed layout + CSS-transition morph) ─── */}
      {mountExpanded && (
        <div
          className={`${styles.expandedLayer} ${isExpanded ? styles.expandedVisible : ''}`}
          onPointerDown={handleSwipePointerDown}
          onPointerUp={handleSwipePointerUp}
          onPointerCancel={handleSwipePointerCancel}
          style={{ touchAction: 'none' }}
        >

          {/* One heart per family member, forming a vertical card stack.
              Transforms & opacity are driven imperatively (morph effect on
              expand/collapse, commitSwipe on swipe). Z-index follows
              |signed distance| so the main heart (signed 0) always paints
              on top of the peeks, which paint on top of hidden hearts. */}
          {members.map((_, i) => {
            const N = members.length;
            const clickedIdx = lastExpandedIndex ?? 0;
            const rel = ((i - clickedIdx) % N + N) % N;
            const currRel = ((rel + entryIndex) % N + N) % N;
            const signed = signedFromRel(currRel, N);
            // Main on top (10), peeks beneath (9), hidden stacks below (lower).
            const zIndex = 10 - Math.min(Math.abs(signed), 5);
            return (
              <img
                key={i}
                ref={el => (heartRefs.current[i] = el)}
                src="/asset/VesselHeartImageNew.png"
                alt=""
                className={styles.heartSlot}
                style={{ zIndex }}
              />
            );
          })}

          {/* Text overlay — sibling of the heart, always upright.
              Positioned at screen center; fades in after the heart settles.
              During a swipe commit, the text fades out so the OLD message
              doesn't linger while hearts cycle; it fades back in with the new
              message once entryIndex updates. */}
          {expandedEntry && (
            <div
              className={styles.detailContent}
              /* Tap anywhere in the center content block → open the full
                 detail page. Per user: "메인 중앙 화면을 누르면 그 채팅
                 했던 내역이 쭉 나와야해." The See details → button still
                 exists as the explicit affordance, but a plain tap on the
                 name / message / meta area now also navigates — users
                 expect the whole central card to be interactive, not just
                 one button.
                 Safe vs the swipe gesture: swipe commits on pointerUp when
                 deltaY > 40px OR velocity is high; a tap has ~0 deltaY so
                 onClick fires cleanly without triggering a swipe. */
              onClick={handleOpenDetail}
              style={
                isSwiping ? {
                  // Quick exit: 180ms clears the old message out of the
                  // way while hearts are still ~40% through their arc,
                  // so the text doesn't drag alongside the outgoing card.
                  opacity: 0,
                  transition: 'opacity 180ms ease',
                } : textRefading ? {
                  // Prompt re-entry: tiny 40ms delay to let the hearts
                  // visibly "click" into their new slots, then a 280ms
                  // fade. Matches the initial-expand tempo (0.32s delay
                  // + 0.36s duration) so both reveal moments feel the
                  // same on screen.
                  opacity: 1,
                  transition: 'opacity 280ms ease 40ms',
                } : undefined
              }
            >
              {totalEntries > 0 && (
                <p className={styles.detailIndex}>
                  {String(safeEntryIndex + 1).padStart(2, '0')}
                  <span className={styles.detailIndexSep}> / </span>
                  {String(totalEntries).padStart(2, '0')}
                </p>
              )}
              <h1 className={styles.detailName}>
                {(resolvedMember?.relation || resolvedMember?.name || '').replace('\n', ' ')}
                <img
                  src="/asset/Vector1.png"
                  alt=""
                  className={styles.detailNameIcon}
                />
              </h1>
              <div className={styles.detailDivider} />
              <p className={styles.detailMessage}>
                {expandedEntry.message || expandedEntry.rawText || ''}
              </p>
              <p className={styles.detailMeta}>
                <span>{formatDate(expandedEntry.createdAt)}</span>
                <span>
                  held {daysHeld(expandedEntry.createdAt)}{' '}
                  {daysHeld(expandedEntry.createdAt) === 1 ? 'day' : 'days'}
                </span>
              </p>
              <div className={styles.detailDivider} />
              <button
                type="button"
                className={styles.detailCta}
                onClick={handleOpenDetail}
              >
                See details
                <span className={styles.detailCtaArrow}>→</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Bottom tagline */}
      <div className={`${styles.bottomText} ${fade && !isExpanded ? styles.fadeIn : styles.fadeOut}`}>
        <p className={styles.bottomLine1}>Send them to</p>
        <p className={styles.bottomLine2}>
          your <em className={styles.em}>loved ones.</em>
        </p>
      </div>

    </div>
  );
}
