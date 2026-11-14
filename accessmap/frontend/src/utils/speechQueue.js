/**
 * Centralized Speech & Audio Manager for AccessMap
 * Built specifically for mobile browsers (iOS Safari & Android Chrome over Cloudflare / HTTPS).
 *
 * Solves:
 * 1. Mobile browser Autoplay / AudioContext restrictions via automatic gesture unlock
 * 2. Missing Romanian TTS voice fallback on mobile devices
 * 3. Web Audio tone synthesizer for instant auditory alerts (tilt, obstacle, navigation)
 * 4. Sequential speech queue with deduplication and watchdog timers
 */

class SpeechQueueManager {
  constructor() {
    this.queue = [];
    this.isSpeaking = false;
    this.currentText = '';
    this.watchdogTimer = null;
    this.voiceEnabled = true;
    this.audioCtx = null;
    this.isUnlocked = false;
    this.voices = [];
    this.activeUtterance = null; // Prevent iOS garbage collection of utterance

    if (typeof window !== 'undefined') {
      this._init();
    }
  }

  _init() {
    // 1. Pre-load TTS voices
    this._loadVoices();
    if (typeof window.speechSynthesis !== 'undefined' && 'onvoiceschanged' in window.speechSynthesis) {
      window.speechSynthesis.onvoiceschanged = () => this._loadVoices();
    }

    // 2. Global user gesture listener for instant mobile audio unlock (iOS Safari & Android)
    const unlockHandler = () => {
      this.unlock();
    };

    ['touchstart', 'touchend', 'pointerdown', 'click', 'keydown'].forEach((eventName) => {
      window.addEventListener(eventName, unlockHandler, { capture: true, passive: true });
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

  getBestVoice(preferredLang = 'ro-RO') {
    if (!this.voices || this.voices.length === 0) {
      this._loadVoices();
    }
    const voices = this.voices;
    if (!voices || voices.length === 0) return null;

    // 1. Direct match for Romanian (ro-RO, ro_RO, ro)
    const roVoice = voices.find(
      (v) =>
        v.lang &&
        (v.lang.toLowerCase().startsWith('ro') ||
          v.lang.replace('_', '-').toLowerCase() === 'ro-ro')
    );
    if (roVoice) return roVoice;

    // 2. Default system voice
    const defVoice = voices.find((v) => v.default);
    if (defVoice) return defVoice;

    // 3. First available voice
    return voices[0] || null;
  }

  getAudioContext() {
    if (!this.audioCtx && typeof window !== 'undefined') {
      const AudioCtx = window.AudioContext || window.webkitAudioContext;
      if (AudioCtx) {
        try {
          this.audioCtx = new AudioCtx();
        } catch (e) {
          console.warn('Could not create AudioContext:', e);
        }
      }
    }
    if (this.audioCtx && this.audioCtx.state === 'suspended') {
      this.audioCtx.resume().catch(() => {});
    }
    return this.audioCtx;
  }

  /**
   * Unlock both Web Audio API and SpeechSynthesis on first user gesture.
   * Mobile browsers (Safari/Chrome) require this to allow background/unprompted speech.
   */
  unlock() {
    if (this.isUnlocked) {
      // Just ensure audioCtx is resumed if needed
      if (this.audioCtx && this.audioCtx.state === 'suspended') {
        this.audioCtx.resume().catch(() => {});
      }
      return;
    }

    this.isUnlocked = true;

    // A. Unlock Web Audio
    try {
      const ctx = this.getAudioContext();
      if (ctx) {
        if (ctx.state === 'suspended') {
          ctx.resume().catch(() => {});
        }
        // Play an inaudible buffer to prime the hardware
        const buffer = ctx.createBuffer(1, 1, 22050);
        const source = ctx.createBufferSource();
        source.buffer = buffer;
        source.connect(ctx.destination);
        source.start(0);
      }
    } catch (e) {
      console.warn('AudioContext unlock note:', e);
    }

    // B. Unlock SpeechSynthesis with micro utterance
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      try {
        if (window.speechSynthesis.paused) {
          window.speechSynthesis.resume();
        }
        const dummy = new SpeechSynthesisUtterance(' ');
        dummy.volume = 0.01;
        dummy.rate = 10;
        window.speechSynthesis.speak(dummy);
      } catch (e) {
        console.warn('SpeechSynthesis unlock note:', e);
      }
    }
  }

  /**
   * Synthesize audio feedback tones directly using Web Audio oscillator.
   * Works on 100% of mobile browsers, even if device has no Romanian TTS voice.
   */
  playBeep(type = 'warning') {
    if (!this.voiceEnabled) return;
    const ctx = this.getAudioContext();
    if (!ctx) return;

    try {
      if (ctx.state === 'suspended') {
        ctx.resume().catch(() => {});
      }
      const now = ctx.currentTime;

      if (type === 'warning') {
        // Two distinct low-pitch alert pulses (tilt warning / danger)
        [0, 0.16].forEach((offset, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'triangle';
          osc.frequency.setValueAtTime(idx === 0 ? 380 : 280, now + offset);
          gain.gain.setValueAtTime(0.001, now + offset);
          gain.gain.exponentialRampToValueAtTime(0.25, now + offset + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.12);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + offset);
          osc.stop(now + offset + 0.13);
        });
      } else if (type === 'success') {
        // High upbeat chime (position corrected / route ready)
        [0, 0.12].forEach((offset, idx) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sine';
          osc.frequency.setValueAtTime(idx === 0 ? 440 : 660, now + offset);
          gain.gain.setValueAtTime(0.001, now + offset);
          gain.gain.exponentialRampToValueAtTime(0.2, now + offset + 0.02);
          gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.1);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + offset);
          osc.stop(now + offset + 0.11);
        });
      } else if (type === 'urgent') {
        // Three sharp beeps for obstacle / sidewalk departure
        [0, 0.14, 0.28].forEach((offset) => {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.type = 'sawtooth';
          osc.frequency.setValueAtTime(520, now + offset);
          gain.gain.setValueAtTime(0.001, now + offset);
          gain.gain.exponentialRampToValueAtTime(0.28, now + offset + 0.015);
          gain.gain.exponentialRampToValueAtTime(0.001, now + offset + 0.09);
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.start(now + offset);
          osc.stop(now + offset + 0.1);
        });
      }
    } catch {
      // Audio errors non-fatal
    }
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

    // Deduplication
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
    this.activeUtterance = null;
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
      this.activeUtterance = null;
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
      // Resume if browser suspended speech synthesis (fixes mobile freeze)
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }

      const utterance = new SpeechSynthesisUtterance(nextItem.text);
      this.activeUtterance = utterance; // Keep reference to prevent GC on iOS Safari

      const selectedVoice = this.getBestVoice(nextItem.lang || 'ro-RO');
      if (selectedVoice) {
        utterance.voice = selectedVoice;
        utterance.lang = selectedVoice.lang || 'ro-RO';
      } else {
        utterance.lang = nextItem.lang || 'ro-RO';
      }

      utterance.rate = nextItem.rate || 1.05;
      utterance.pitch = nextItem.pitch || 1.0;

      const finishAndNext = () => {
        if (this.watchdogTimer) {
          clearTimeout(this.watchdogTimer);
          this.watchdogTimer = null;
        }
        this.currentText = '';
        this.isSpeaking = false;
        this.activeUtterance = null;
        setTimeout(() => {
          this._processQueue();
        }, 220);
      };

      utterance.onend = finishAndNext;
      utterance.onerror = (e) => {
        console.warn('SpeechSynthesis error:', e);
        finishAndNext();
      };

      // Watchdog timer: safety timeout in case Chrome/WebKit fails to fire onend
      const estDuration = Math.max(2800, nextItem.text.split(' ').length * 500 + 2000);
      this.watchdogTimer = setTimeout(() => {
        if (this.isSpeaking && this.currentText === nextItem.text) {
          finishAndNext();
        }
      }, estDuration);

      window.speechSynthesis.speak(utterance);

      // Chrome mobile bug: resume periodically
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
    } catch (err) {
      console.warn('SpeechSynthesis speak failed:', err);
      this.isSpeaking = false;
      this.currentText = '';
      this.activeUtterance = null;
      setTimeout(() => this._processQueue(), 200);
    }
  }
}

export const speechQueue = new SpeechQueueManager();
