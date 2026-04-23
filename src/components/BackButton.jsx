import styles from './BackButton.module.css';

/**
 * BackButton — reusable glass-circle back affordance.
 *
 * Replaces every `<button className={styles.backBtn}><img src="/asset/Button/BackButton.png"/></button>`
 * pattern across the app. The old PNG baked an opaque dark disc + white
 * arrow into a single raster; now that the rest of the chrome has moved
 * to a translucent liquid-glass material the back button follows suit,
 * and the arrow is a drawn SVG (vector — crisp at any DPR, and light/
 * dark can be swapped via `arrowColor` per screen if ever needed).
 *
 * Consumers keep their screen-specific positioning on the `.backBtn`
 * CSS class in their own module and pass that class through `className`.
 * All visual properties (size, glass material, chevron) live inside
 * BackButton.module.css — the consumer class should only set position,
 * top/left, and any screen-specific transition tweaks.
 *
 * @param {() => void} onClick — fired on tap.
 * @param {string} [className] — additional classes (usually positioning).
 * @param {string} [arrowColor] — stroke for the chevron. Defaults white.
 * @param {string} [aria-label] — falls back to "Back" when omitted.
 */
export default function BackButton({
  onClick,
  className = '',
  arrowColor = '#FFFFFF',
  'aria-label': ariaLabel = 'Back',
}) {
  return (
    <button
      type="button"
      className={`${styles.btn} ${className}`}
      onClick={onClick}
      aria-label={ariaLabel}
    >
      <svg
        width="18"
        height="18"
        viewBox="0 0 24 24"
        fill="none"
        className={styles.chevron}
        aria-hidden="true"
      >
        <path
          d="M15 5L8 12L15 19"
          stroke={arrowColor}
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}
