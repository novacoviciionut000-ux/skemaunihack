/**
 * Centralized Priority Speech Queue for AccessMap
 *
 * Features:
 * - Priority-based: danger > urgent > high > normal
 *   Items with higher danger rating are spoken FIRST (sorted on each insertion)
 * - TTL: items older than 10 seconds are dropped before processing
 * - No setTimeout for speak() — uses utterance.onend chain (mobile-safe)
 * - Browser's speechSynthesis processes one utterance at a time; we manage order ourselves
 * - Alarm beep (Web Audio) plays concurrently with TTS — does NOT go through the queue
 */

// Priority levels → numeric weight (higher = spoken sooner)
const PRIORITY_WEIGHT = {
  danger: 4,
  urgent: 3,
  high: 2,
  normal: 1,
};

const TTL_MS = 4_000; // Drop queue items older than 4 seconds

const IS_IOS =
  typeof navigator !== 'undefined' &&
  (/iPad|iPhone|iPod/.test(navigator.userAgent || '') ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1));

// ---------------------------------------------------------------------------
// Alarm / beep tones (Web Audio) — separate from TTS, plays in parallel
// ---------------------------------------------------------------------------
let _alarmCtx = null;

function _getAudioCtx() {
  if (_alarmCtx && _alarmCtx.state !== 'closed') return _alarmCtx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) _alarmCtx = new Ctx();
  } catch {}
  return _alarmCtx;
}

/**
 * Play an urgent alarm beep (3 fast descending pulses).
 * Used when path/sidewalk is blocked — plays concurrently with TTS.
 */
export function playAlarmBeep() {
  const ctx = _getAudioCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    // Three rapid pulses: 880 Hz → 660 Hz → 440 Hz
    [880, 660, 440].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + i * 0.18);
      gain.gain.setValueAtTime(0.001, now + i * 0.18);
      gain.gain.exponentialRampToValueAtTime(0.28, now + i * 0.18 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.18 + 0.14);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.18);
      osc.stop(now + i * 0.18 + 0.15);
    });
  } catch {}
}

/**
 * Play a gentle orientation feedback tone (tilt warning).
 * Two soft sine pulses.
 */
export function playTiltBeep() {
  const ctx = _getAudioCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    [300, 240].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(freq, now + i * 0.14);
      gain.gain.setValueAtTime(0.001, now + i * 0.14);
      gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.14 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.14 + 0.095);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.14);
      osc.stop(now + i * 0.14 + 0.1);
    });
  } catch {}
}

/**
 * Unlock AudioContext on first user gesture — call from touchstart/click handler.
 */
export function unlockAudioContext() {
  const ctx = _getAudioCtx();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// SpeechQueueManager
// ---------------------------------------------------------------------------

class SpeechQueueManager {
  constructor() {
    /** @type {Array<{text:string, priority:string, weight:number, lang:string, rate:number, pitch:number, addedAt:number}>} */
    this.queue = [];
    this.isSpeaking = false;
    this.voiceEnabled = true;
    this.voices = [];
    this._unlocked = false;
    this._currentUtterance = null;
    this._watchdogTimer = null;
    this._audioEl = null;
    this._audioUnlocked = false;

    if (typeof window !== 'undefined') {
      this._init();
    }
  }

  _init() {
    this._loadVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => this._loadVoices();
    }

    // Unlock on first valid activation gesture — synchronous in event handler
    // Note: iOS Safari requires touchend/click (touchstart is often ignored for speechSynthesis)
    const unlockOnce = () => {
      if (this._unlocked) return;
      this.unlock();
      unlockAudioContext();
    };
    ['touchend', 'click', 'keydown'].forEach((evt) => {
      window.addEventListener(evt, unlockOnce, { capture: true, passive: true });
    });
  }

  _loadVoices() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try { this.voices = window.speechSynthesis.getVoices() || []; } catch { this.voices = []; }
  }

  getRomanianVoice() {
    if (!this.voices.length) this._loadVoices();
    return (
      this.voices.find((v) =>
        v.lang &&
        (v.lang.toLowerCase() === 'ro-ro' ||
          v.lang.toLowerCase() === 'ro_ro' ||
          v.lang.toLowerCase().startsWith('ro'))
      ) || null
    );
  }

  _getAudioElement() {
    if (!this._audioEl && typeof Audio !== 'undefined') {
      this._audioEl = new Audio();
      this._audioEl.preload = 'auto';
      this._audioEl.playsInline = true;
    }
    return this._audioEl;
  }

  unlock(force = false) {
    if (typeof window === 'undefined') return;

    // 1. Unlock HTMLAudioElement for iOS reliable server-backed TTS
    if (!this._audioUnlocked || force) {
      try {
        const audio = this._getAudioElement();
        if (audio && audio.paused) {
          // Tiny valid silent WAV so iOS Safari permanently unlocks audio.play()
          audio.src = 'data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA';
          const p = audio.play();
          if (p && typeof p.then === 'function') {
            p.then(() => {
              this._audioUnlocked = true;
            }).catch(() => {});
          } else {
            this._audioUnlocked = true;
          }
        }
      } catch {}
    }

    // 2. Unlock Web Speech API as well
    if (this._unlocked && !force) return;
    if (!('speechSynthesis' in window)) return;
    try {
      window.speechSynthesis.resume();
      if (!window.speechSynthesis.speaking) {
        const silent = new SpeechSynthesisUtterance('');
        silent.volume = 0;
        silent.lang = 'ro-RO';
        window.speechSynthesis.speak(silent);
      }
      this._unlocked = true;
    } catch {}
  }

  setVoiceEnabled(enabled) {
    this.voiceEnabled = Boolean(enabled);
    if (!this.voiceEnabled) this.cancel();
  }

  getVoiceEnabled() { return this.voiceEnabled; }

  /**
   * Add text to the priority queue.
   *
   * @param {string} text
   * @param {object} [options]
   *   - priority: 'danger' | 'urgent' | 'high' | 'normal'  (default: 'normal')
   *   - interrupt: boolean — cancel everything and speak immediately
   *   - rate: number (default 1.0)
   *   - pitch: number (default 1.0)
   *   - lang: string (default 'ro-RO')
   */
  speak(text, options = {}) {
    const {
      rate = 1.1,
      pitch = 1.0,
      lang = 'ro-RO',
      interrupt = false,
      priority = 'normal',
      onEnd = null,
    } = options;

    if (!this.voiceEnabled) {
      if (onEnd) onEnd();
      return;
    }
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      if (onEnd) onEnd();
      return;
    }

    const trimmed = String(text).trim();
    if (!trimmed) {
      if (onEnd) onEnd();
      return;
    }

    const weight = PRIORITY_WEIGHT[priority] ?? PRIORITY_WEIGHT.normal;

    if (interrupt) {
      const wasActive =
        this.isSpeaking ||
        (typeof window !== 'undefined' &&
          window.speechSynthesis &&
          (window.speechSynthesis.speaking || window.speechSynthesis.pending));
      if (wasActive) {
        this.cancel();
        this._enqueue({ text: trimmed, priority, weight, lang, rate, pitch, onEnd });
        // iOS Safari needs ~150ms after cancel() before speak() works reliably
        setTimeout(() => this._processQueue(), IS_IOS ? 160 : 60);
      } else {
        // Avoid calling speechSynthesis.cancel() when idle — it can mute next speak() on iOS
        this.queue = [];
        this._enqueue({ text: trimmed, priority, weight, lang, rate, pitch, onEnd });
        this._processQueue();
      }
      return;
    }

    // Deduplication: skip if same text already in queue or currently speaking
    if (this.queue.some((item) => item.text === trimmed)) {
      if (onEnd) onEnd();
      return;
    }

    // Drop low-priority items when queue is full (keep up to 3 items max)
    if (this.queue.length >= 3) {
      // Remove lowest-priority non-danger item
      const lowestIdx = this._findLowestIndex();
      if (lowestIdx !== -1 && this.queue[lowestIdx].weight < weight) {
        this.queue.splice(lowestIdx, 1);
      } else {
        if (onEnd) onEnd();
        return; // Queue full with higher priority items — skip this one
      }
    }

    this._enqueue({ text: trimmed, priority, weight, lang, rate, pitch, onEnd });

    if (!this.isSpeaking) {
      this._processQueue();
    }
  }

  _enqueue(item) {
    item.addedAt = Date.now();
    this.queue.push(item);
    // Sort by weight descending so highest priority is at index 0
    this.queue.sort((a, b) => b.weight - a.weight);
  }

  _findLowestIndex() {
    if (!this.queue.length) return -1;
    let idx = 0;
    for (let i = 1; i < this.queue.length; i++) {
      if (this.queue[i].weight < this.queue[idx].weight) idx = i;
    }
    return idx;
  }

  /** Drop items older than TTL_MS */
  _pruneExpired() {
    const cutoff = Date.now() - TTL_MS;
    this.queue = this.queue.filter((item) => item.addedAt >= cutoff);
  }

  _processQueue() {
    this._pruneExpired();

    if (this.queue.length === 0) {
      this.isSpeaking = false;
      return;
    }

    this.isSpeaking = true;
    const item = this.queue.shift();

    // Resume unconditionally (iOS Safari can suspend speechSynthesis without setting paused=true)
    try {
      window.speechSynthesis.resume();
    } catch {}

    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.lang = item.lang || 'ro-RO';
    utterance.rate = IS_IOS ? Math.min(item.rate || 1.0, 1.05) : (item.rate || 1.0);
    utterance.pitch = item.pitch || 1.0;
    this._currentUtterance = utterance;

    if (!this.voices.length) this._loadVoices();
    const roVoice = this.getRomanianVoice();
    // On iOS, non-local voices can fail silently; only bind local voices or let iOS pick via lang
    if (roVoice && (!IS_IOS || roVoice.localService !== false)) {
      utterance.voice = roVoice;
    }

    let finished = false;
    let started = false;
    let startCheckTimer = null;

    const finish = () => {
      if (finished) return;
      finished = true;
      if (startCheckTimer) {
        clearTimeout(startCheckTimer);
        startCheckTimer = null;
      }
      if (this._watchdogTimer) {
        clearTimeout(this._watchdogTimer);
        this._watchdogTimer = null;
      }
      this._currentUtterance = null;
      this.isSpeaking = false;
      if (item.onEnd) {
        try { item.onEnd(); } catch {}
      }
      this._processQueue();
    };

    utterance.onstart = () => {
      started = true;
    };

    // If iOS hasn't started speaking within 750ms, nudge resume()
    startCheckTimer = setTimeout(() => {
      if (!started && !finished) {
        try { window.speechSynthesis.resume(); } catch {}
      }
    }, 750);

    // Watchdog in case mobile Safari drops onend
    this._watchdogTimer = setTimeout(finish, Math.max(4500, item.text.length * 130));

    // On iOS Safari, Web Speech API (speechSynthesis) is frequently muted or broken
    // when getUserMedia camera is active; play via unlocked HTMLAudio + /api/v1/tts first.
    if (IS_IOS) {
      const audio = this._getAudioElement();
      if (audio) {
        const langCode = (item.lang || 'ro').slice(0, 2).toLowerCase();
        const ttsUrl = `/api/v1/tts?lang=${encodeURIComponent(langCode)}&text=${encodeURIComponent(item.text)}`;
        let fellBack = false;
        const fallbackToSpeechSynth = () => {
          if (fellBack || finished) return;
          fellBack = true;
          audio.onended = null;
          audio.onerror = null;
          this._speakViaWebSpeech(utterance, item, finish, () => { started = true; });
        };

        audio.onended = () => {
          audio.onended = null;
          audio.onerror = null;
          finish();
        };
        audio.onerror = fallbackToSpeechSynth;
        audio.src = ttsUrl;
        audio.playbackRate = Math.min(item.rate || 1.0, 1.15);
        try {
          const playPromise = audio.play();
          if (playPromise && typeof playPromise.catch === 'function') {
            playPromise.catch(fallbackToSpeechSynth);
          }
          return;
        } catch {
          fallbackToSpeechSynth();
          return;
        }
      }
    }

    this._speakViaWebSpeech(utterance, item, finish, () => { started = true; });
  }

  _speakViaWebSpeech(utterance, item, finish, onStarted) {
    utterance.onstart = onStarted;
    utterance.onend = finish;
    utterance.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        console.warn('[SpeechQueue] error:', e.error, '—', item.text.slice(0, 40));
      }
      finish();
    };

    try {
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('[SpeechQueue] speak() threw:', err);
      finish();
    }
  }

  clearPendingNonDanger() {
    this.queue = this.queue.filter((item) => item.priority === 'danger');
  }

  cancel() {
    this.queue = [];
    this.isSpeaking = false;
    if (this._watchdogTimer) {
      clearTimeout(this._watchdogTimer);
      this._watchdogTimer = null;
    }
    this._currentUtterance = null;
    if (this._audioEl) {
      try {
        this._audioEl.onended = null;
        this._audioEl.onerror = null;
        this._audioEl.pause();
      } catch {}
    }
    try {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    } catch {}
  }

  // Stub — backward compat
  playBeep() {}
}

export const speechQueue = new SpeechQueueManager();
