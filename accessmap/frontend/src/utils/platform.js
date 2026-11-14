// Shared platform checks. iOS Safari differs from Chrome on Android in ways that affect
// speech, device orientation and geolocation, so several modules need the same answer.

export const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
    // iPadOS reports itself as a Mac, and is only distinguishable by touch support
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));
