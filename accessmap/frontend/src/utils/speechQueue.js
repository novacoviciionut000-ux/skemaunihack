/**
 * Centralized Speech Queue for AccessMap
 *
 * Strategy (simplest approach that works on mobile):
 * - Use window.speechSynthesis directly — browsers natively queue multiple speak() calls
 * - NEVER use setTimeout to trigger speak() — breaks mobile autoplay policy
 * - For interrupt: cancel() then speak() immediately
 * - Unlock: call a silent speak() directly from touchstart (synchronous, gesture stack)
 * - No custom FIFO queue — the browser's own queue is reliable enough
 */

class SpeechQueueManager {
  constructor() {
    this.voiceEnabled = true;
    this.voices = [];
    this._unlocked = false;
    this._lastText = '';
    this._lastTime = 0;

    if (typeof window !== 'undefined') {
      this._init();
    }
  }

  _init() {
    this._loadVoices();
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.onvoiceschanged = () => this._loadVoices();
    }

    // Unlock on first user gesture — MUST be synchronous in the event handler
    const unlockOnce = () => {
      if (this._unlocked) return;
      this._unlocked = true;
      this.unlock();
    };
    ['touchstart', 'click', 'keydown'].forEach((evt) => {
      window.addEventListener(evt, unlockOnce, { capture: true, passive: true, once: false });
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
    if (!this.voices.length) this._loadVoices();
    return (
      this.voices.find(
        (v) =>
          v.lang &&
          (v.lang.toLowerCase() === 'ro-ro' ||
            v.lang.toLowerCase() === 'ro_ro' ||
            v.lang.toLowerCase().startsWith('ro'))
      ) || null
    );
  }

  /**
   * Unlock the speech synthesis engine.
   * Must be called synchronously from a user-gesture event handler.
   * Sends a silent utterance to "open" the audio channel on iOS/Android.
   */
  unlock() {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
    try {
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      // Send a truly silent utterance to open the channel
      const silent = new SpeechSynthesisUtterance('\u200B'); // zero-width space
      silent.volume = 0;
      silent.rate = 10;
      silent.lang = 'ro-RO';
      window.speechSynthesis.speak(silent);
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
   * Speak text.
   * @param {string} text
   * @param {object} options
   *   - interrupt {boolean}: cancel current speech and speak immediately
   *   - priority {string}: 'urgent'|'high'|'normal' (affects dedup window)
   *   - rate {number}: speech rate (default 1.0)
   *   - pitch {number}: pitch (default 1.0)
   *   - lang {string}: BCP-47 language tag (default 'ro-RO')
   */
  speak(text, options = {}) {
    if (!this.voiceEnabled) return;
    if (!text || typeof window === 'undefined' || !('speechSynthesis' in window)) return;

    const trimmed = String(text).trim();
    if (!trimmed) return;

    const {
      rate = 1.0,
      pitch = 1.0,
      lang = 'ro-RO',
      interrupt = false,
    } = options;

    // Simple deduplication: skip if same text was spoken within 2 seconds
    const now = Date.now();
    if (!interrupt && trimmed === this._lastText && now - this._lastTime < 2000) return;

    if (interrupt) {
      // Cancel all pending speech immediately, then speak
      try { window.speechSynthesis.cancel(); } catch {}
    }

    // Update dedup state
    this._lastText = trimmed;
    this._lastTime = now;

    // Resume if paused
    try {
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
    } catch {}

    const utterance = new SpeechSynthesisUtterance(trimmed);
    utterance.lang = lang;
    utterance.rate = rate;
    utterance.pitch = pitch;

    // Assign Romanian voice if available
    if (!this.voices.length) this._loadVoices();
    const roVoice = this.getRomanianVoice();
    if (roVoice) utterance.voice = roVoice;

    // Error handler — log but don't stall
    utterance.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        console.warn('[SpeechQueue] utterance error:', e.error);
      }
    };

    try {
      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('[SpeechQueue] speak() threw:', err);
    }
  }

  cancel() {
    if (typeof window === 'undefined') return;
    try {
      if ('speechSynthesis' in window) window.speechSynthesis.cancel();
    } catch {}
  }

  // Stub — kept for backward compatibility with callers
  playBeep() {}
}

export const speechQueue = new SpeechQueueManager();
