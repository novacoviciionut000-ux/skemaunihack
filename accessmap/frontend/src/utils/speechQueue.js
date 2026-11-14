/**
 * Centralized Speech Queue & Audio Alarm System for AccessMap
 *
 * Rules:
 * - NO custom FIFO with async isSpeaking locks (breaks on mobile browsers)
 * - Priority: 'danger' and 'urgent' instantly cancel any lower-priority speech and speak immediately
 * - Direct speak() execution — browser manages native speech buffer without gesture drops
 * - Retains active utterance reference on window to prevent mobile Garbage Collection mute bug
 * - Concurrent Web Audio beeps (alarm & tilt) that run independently of TTS
 */

// ---------------------------------------------------------------------------
// Concurrent Web Audio Tones (Alarm beep for blocked road & Tilt tone)
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
 * Play urgent alarm beep (3 fast descending tones).
 * Triggers when road is completely blocked — runs concurrently with TTS.
 */
export function playAlarmBeep() {
  const ctx = _getAudioCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    [880, 660, 440].forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sawtooth';
      osc.frequency.setValueAtTime(freq, now + i * 0.16);
      gain.gain.setValueAtTime(0.001, now + i * 0.16);
      gain.gain.exponentialRampToValueAtTime(0.25, now + i * 0.16 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.16 + 0.13);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.16);
      osc.stop(now + i * 0.16 + 0.14);
    });
  } catch {}
}

/**
 * Play subtle tilt feedback tone (2 soft pulses).
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
      osc.frequency.setValueAtTime(freq, now + i * 0.12);
      gain.gain.setValueAtTime(0.001, now + i * 0.12);
      gain.gain.exponentialRampToValueAtTime(0.18, now + i * 0.12 + 0.015);
      gain.gain.exponentialRampToValueAtTime(0.001, now + i * 0.12 + 0.09);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(now + i * 0.12);
      osc.stop(now + i * 0.12 + 0.095);
    });
  } catch {}
}

export function unlockAudioContext() {
  const ctx = _getAudioCtx();
  if (ctx && ctx.state === 'suspended') {
    ctx.resume().catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Speech Synthesis Manager
// ---------------------------------------------------------------------------

class SpeechQueueManager {
  constructor() {
    this.voiceEnabled = true;
    this.voices = [];
    this._lastText = '';
    this._lastTime = 0;
    this._currentPriority = 'normal';

    if (typeof window !== 'undefined') {
      this._init();
    }
  }

  _init() {
    this._loadVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => this._loadVoices();
    }

    const unlockHandler = () => {
      this.unlock();
      unlockAudioContext();
    };
    ['touchstart', 'touchend', 'click'].forEach((evt) => {
      window.addEventListener(evt, unlockHandler, { capture: true, passive: true });
    });
  }

  _loadVoices() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      this.voices = window.speechSynthesis.getVoices() || [];
    } catch {
      this.voices = [];
    }
  }

  getRomanianVoice() {
    if (!this.voices || this.voices.length === 0) {
      this._loadVoices();
    }
    const voices = this.voices;
    if (!voices || voices.length === 0) return null;

    return (
      voices.find(
        (v) =>
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
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch {}
  }

  setVoiceEnabled(enabled) {
    this.voiceEnabled = Boolean(enabled);
    if (!this.voiceEnabled) {
      this.cancel();
    }
  }

  getVoiceEnabled() {
    return this.voiceEnabled;
  }

  /**
   * Speak text with priority handling.
   * - 'danger' / 'urgent': cuts through immediately (cancels active speech and talks right now)
   * - 'high' / 'normal': queued cleanly by browser without stalling
   */
  speak(text, options = {}) {
    if (!this.voiceEnabled || !text || typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    const trimmed = String(text).trim();
    if (!trimmed) return;

    const {
      rate = 1.2,
      pitch = 1.0,
      lang = 'ro-RO',
      interrupt = false,
      priority = 'normal', // 'danger' | 'urgent' | 'high' | 'normal'
    } = options;

    const isHighPriority = priority === 'danger' || priority === 'urgent' || interrupt;
    const now = Date.now();

    // Deduplication: don't repeat the exact same sentence within 2.5 seconds unless it's danger
    if (!isHighPriority && trimmed === this._lastText && now - this._lastTime < 2500) {
      return;
    }

    // High priority cuts off whatever was speaking before
    if (isHighPriority) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }

    this._lastText = trimmed;
    this._lastTime = now;
    this._currentPriority = priority;

    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      const utterance = new SpeechSynthesisUtterance(trimmed);
      utterance.lang = lang;
      utterance.rate = rate;
      utterance.pitch = pitch;

      if (!this.voices.length) this._loadVoices();
      const roVoice = this.getRomanianVoice();
      if (roVoice) {
        utterance.voice = roVoice;
      }

      // CRITICAL FOR MOBILE SAFARI & CHROME: Keep global reference so GC doesn't kill utterance
      window.__accessmap_active_utterance = utterance;

      utterance.onend = () => {
        window.__accessmap_active_utterance = null;
      };
      utterance.onerror = (e) => {
        window.__accessmap_active_utterance = null;
        if (e.error !== 'interrupted' && e.error !== 'canceled') {
          console.warn('[SpeechQueue] utterance error:', e.error);
        }
      };

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('[SpeechQueue] speak() failed:', err);
    }
  }

  cancel() {
    this._lastText = '';
    if (typeof window !== 'undefined') {
      window.__accessmap_active_utterance = null;
      if ('speechSynthesis' in window) {
        try {
          window.speechSynthesis.cancel();
        } catch {}
      }
    }
  }

  playBeep() {}
}

export const speechQueue = new SpeechQueueManager();
