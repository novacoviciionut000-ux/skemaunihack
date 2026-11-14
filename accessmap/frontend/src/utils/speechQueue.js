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

    if (typeof window !== 'undefined') {
      this._init();
    }
  }

  _init() {
    this._loadVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => this._loadVoices();
    }

    // Unlock on first gesture — synchronous in event handler
    const unlockOnce = () => {
      if (this._unlocked) return;
      this._unlocked = true;
      this.unlock();
      unlockAudioContext();
    };
    ['touchstart', 'click', 'keydown'].forEach((evt) => {
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

  unlock() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      // Silent utterance to open audio channel on iOS/Android
      const silent = new SpeechSynthesisUtterance('\u200B');
      silent.volume = 0;
      silent.rate = 10;
      silent.lang = 'ro-RO';
      window.speechSynthesis.speak(silent);
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
    if (!this.voiceEnabled) return;
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const trimmed = String(text).trim();
    if (!trimmed) return;

    const {
      rate = 1.45,
      pitch = 1.0,
      lang = 'ro-RO',
      interrupt = false,
      priority = 'normal',
    } = options;

    const weight = PRIORITY_WEIGHT[priority] ?? PRIORITY_WEIGHT.normal;

    if (interrupt) {
      this.cancel();
      this._enqueue({ text: trimmed, priority, weight, lang, rate, pitch });
      this._processQueue();
      return;
    }

    // Deduplication: skip if same text already in queue or currently speaking
    if (this.queue.some((item) => item.text === trimmed)) return;

    // Drop low-priority items when queue is full (keep up to 3 items max)
    if (this.queue.length >= 3) {
      // Remove lowest-priority non-danger item
      const lowestIdx = this._findLowestIndex();
      if (lowestIdx !== -1 && this.queue[lowestIdx].weight < weight) {
        this.queue.splice(lowestIdx, 1);
      } else {
        return; // Queue full with higher priority items — skip this one
      }
    }

    this._enqueue({ text: trimmed, priority, weight, lang, rate, pitch });

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

    // Resume if paused
    try {
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    } catch {}

    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.lang = item.lang || 'ro-RO';
    utterance.rate = item.rate || 1.0;
    utterance.pitch = item.pitch || 1.0;

    if (!this.voices.length) this._loadVoices();
    const roVoice = this.getRomanianVoice();
    if (roVoice) utterance.voice = roVoice;

    // Chain: when this utterance ends, process the next one directly (no setTimeout)
    utterance.onend = () => {
      this.isSpeaking = false;
      this._processQueue();
    };
    utterance.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        console.warn('[SpeechQueue] error:', e.error, '—', item.text.slice(0, 40));
      }
      this.isSpeaking = false;
      this._processQueue();
    };

    try {
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('[SpeechQueue] speak() threw:', err);
      this.isSpeaking = false;
      this._processQueue();
    }
  }

  cancel() {
    this.queue = [];
    this.isSpeaking = false;
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
