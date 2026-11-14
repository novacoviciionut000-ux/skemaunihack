/**
 * Centralized Speech Synthesis Queue for AccessMap
 * Ensures all Romanian voice announcements (navigation turn-by-turn prompts,
 * sidewalk departure corrections, obstacle alerts, phone tilt warnings, system messages)
 * are spoken one by one sequentially without overlapping or interrupting
 * each other prematurely.
 */

class SpeechQueueManager {
  constructor() {
    this.queue = [];
    this.isSpeaking = false;
    this.currentText = '';
    this.watchdogTimer = null;
    this.voiceEnabled = true;
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
   * Enqueue a text announcement to be spoken aloud in Romanian.
   * If interrupt is true, cancels the current queue and speaks immediately.
   * If interrupt is false, adds to queue and plays sequentially when previous finishes.
   */
  speak(text, options = {}) {
    if (!this.voiceEnabled || !text || typeof window === 'undefined') return;
    if (!('speechSynthesis' in window)) return;

    const trimmed = String(text).trim();
    if (!trimmed) return;

    const {
      rate = 1.05,
      pitch = 1.0,
      lang = 'ro-RO',
      interrupt = false,
      priority = 'normal', // 'urgent' | 'high' | 'normal'
    } = options;

    // Deduplication: if exact same text is currently speaking or in queue, skip
    if (this.currentText === trimmed && this.isSpeaking && !interrupt) {
      return;
    }
    if (this.queue.some((item) => item.text === trimmed) && !interrupt) {
      return;
    }

    if (interrupt) {
      this.cancel();
      this.queue.push({ text: trimmed, rate, pitch, lang, priority });
      this._processQueue();
      return;
    }

    // Limit queue size to avoid stale backlog
    if (this.queue.length >= 3) {
      // Keep urgent or recent items
      this.queue = this.queue.filter((item) => item.priority === 'urgent');
    }

    this.queue.push({ text: trimmed, rate, pitch, lang, priority });

    if (!this.isSpeaking) {
      this._processQueue();
    }
  }

  cancel() {
    this.queue = [];
    this.isSpeaking = false;
    this.currentText = '';
    if (this.watchdogTimer) {
      clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        window.speechSynthesis.cancel();
      } catch {}
    }
  }

  _processQueue() {
    if (this.queue.length === 0) {
      this.isSpeaking = false;
      this.currentText = '';
      return;
    }

    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      this.queue = [];
      this.isSpeaking = false;
      return;
    }

    const nextItem = this.queue.shift();
    if (!nextItem) {
      this.isSpeaking = false;
      this.currentText = '';
      return;
    }

    this.isSpeaking = true;
    this.currentText = nextItem.text;

    try {
      // Resume if browser suspended speech synthesis
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      const utterance = new SpeechSynthesisUtterance(nextItem.text);
      utterance.lang = nextItem.lang || 'ro-RO';
      utterance.rate = nextItem.rate || 1.05;
      utterance.pitch = nextItem.pitch || 1.0;

      const finishAndNext = () => {
        if (this.watchdogTimer) {
          clearTimeout(this.watchdogTimer);
          this.watchdogTimer = null;
        }
        this.currentText = '';
        this.isSpeaking = false;
        // Small 250ms breathing gap between sentences so the user absorbs the info
        setTimeout(() => {
          this._processQueue();
        }, 250);
      };

      utterance.onend = finishAndNext;
      utterance.onerror = (e) => {
        console.warn('SpeechSynthesis error:', e);
        finishAndNext();
      };

      // Watchdog timer: safety timeout in case Chrome/WebKit fails to fire onend
      const estDuration = Math.max(3000, nextItem.text.split(' ').length * 550 + 2000);
      this.watchdogTimer = setTimeout(() => {
        if (this.isSpeaking && this.currentText === nextItem.text) {
          finishAndNext();
        }
      }, estDuration);

      window.speechSynthesis.speak(utterance);
    } catch (err) {
      console.warn('SpeechSynthesis speak failed:', err);
      this.isSpeaking = false;
      this.currentText = '';
      setTimeout(() => this._processQueue(), 200);
    }
  }
}

export const speechQueue = new SpeechQueueManager();
