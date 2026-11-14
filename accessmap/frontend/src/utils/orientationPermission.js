// Shared iOS DeviceOrientation permission helper.
// iOS 13+ only allows DeviceOrientationEvent.requestPermission() inside a user gesture
// and only the first call matters, so we cache the result and never call it twice.

let state = 'unknown'; // 'unknown' | 'granted' | 'denied' | 'unsupported'
let pending = null;

export function needsOrientationPermission() {
  return (
    typeof DeviceOrientationEvent !== 'undefined' &&
    typeof DeviceOrientationEvent.requestPermission === 'function'
  );
}

export function getOrientationPermissionState() {
  if (!needsOrientationPermission()) return 'granted'; // Android / desktop: no prompt needed
  return state;
}

// MUST be called synchronously from a tap/click handler on iOS.
export function requestOrientationPermission() {
  if (!needsOrientationPermission()) return Promise.resolve('granted');
  if (state === 'granted') return Promise.resolve('granted');
  if (pending) return pending;
  pending = DeviceOrientationEvent.requestPermission()
    .then((res) => {
      state = res === 'granted' ? 'granted' : 'denied';
      return state;
    })
    .catch(() => {
      state = 'denied';
      return state;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}
