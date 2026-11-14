/**
 * AccessVision design palette: the only colors the UI uses.
 *
 * One brand blue, a slate neutral scale, and three status colors. Every pair below is
 * chosen to pass WCAG AA (4.5:1) for its intended use, which matters more than usual
 * here: many users have low vision.
 *
 *   primary on white  6.7:1    white on primary   6.7:1
 *   danger  on white  6.5:1    success on white   5.0:1    warning on white   5.0:1
 *   *OnDark tones on ink (#0F172A) are all above 8:1
 *
 * tests/palette.test.mjs fails the build if a component uses a color not listed here.
 */
export const palette = {
  // Brand
  primary: '#1D4ED8',
  primaryHover: '#1E40AF',
  primaryOnDark: '#93C5FD', // links / icons on dark surfaces
  primarySoft: '#EFF6FF', // selected backgrounds
  primarySoftBorder: '#BFDBFE',

  // Neutrals (slate)
  ink: '#0F172A', // main text, dark surfaces
  inkRaised: '#1E293B', // cards on dark surfaces
  slate700: '#334155', // dark borders, strong secondary text
  slate600: '#475569', // secondary text
  slate500: '#64748B', // muted text, placeholders
  slate400: '#94A3B8', // disabled, captions on dark
  slate300: '#CBD5E1', // input borders
  slate200: '#E2E8F0', // dividers
  slate100: '#F1F5F9', // subtle fills
  slate50: '#F8FAFC', // page / panel background
  white: '#FFFFFF',

  // Status
  success: '#15803D',
  successDark: '#14532D', // success surface on dark UI
  successOnDark: '#86EFAC',
  successSoft: '#F0FDF4',

  warning: '#B45309',
  warningOnDark: '#FCD34D',
  warningSoft: '#FFFBEB',

  danger: '#B91C1C',
  dangerOnDark: '#FCA5A5',
  dangerSoft: '#FEF2F2',
  dangerSoftBorder: '#FECACA',
};

/** "r, g, b" for use in rgba(): `rgba(${rgb.primary}, 0.2)` */
export const rgb = {
  primary: '29, 78, 216',
  ink: '15, 23, 42',
  success: '21, 128, 61',
  warning: '180, 83, 9',
  danger: '185, 28, 28',
};

export const radius = { sm: 8, md: 12, lg: 16, pill: 999 };

export const shadow = {
  sm: '0 1px 2px rgba(15, 23, 42, 0.08)',
  md: '0 4px 12px rgba(15, 23, 42, 0.12)',
  lg: '0 12px 32px rgba(15, 23, 42, 0.18)',
};

export const font = "'Inter', system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif";

/** Third-party brand marks that must keep their own colors (Google "G" logo). */
export const brandExceptions = ['#4285F4', '#34A853', '#FBBC05', '#EA4335'];
