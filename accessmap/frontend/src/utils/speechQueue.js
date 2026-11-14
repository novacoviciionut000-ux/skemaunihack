/**
 * Centralized priority speech queue for AccessMap.
 *
 * - Priority order: danger > urgent > high > normal. Higher priority is spoken first.
 * - A danger/urgent message interrupts a lower-priority utterance that is mid-speech.
 * - Queue items expire after TTL_MS so stale warnings are never read out late.
 * - The same text is not repeated within REPEAT_COOLDOWN_MS.
 * - Utterances are chained with onend (no timers per speak), with a watchdog for
 *   engines that drop onend (mobile Safari, Chrome after long utterances).
 * - Alarm beeps use Web Audio and play concurrently; they bypass the queue.
 */

const PRIORITY_WEIGHT = { danger: 4, urgent: 3, high: 2, normal: 1 };

const TTL_MS = 4_000;
const MAX_QUEUE = 3;
const REPEAT_COOLDOWN_MS = 2_500;
const CANCEL_SETTLE_MS = 60; // speak() right after cancel() is dropped by iOS Safari and Chrome
const DEFAULT_LANG = 'ro-RO';

const hasSpeech = () => typeof window !== 'undefined' && 'speechSynthesis' in window;

// ---------------------------------------------------------------------------
// Beeps (Web Audio)
// ---------------------------------------------------------------------------
let audioCtx = null;

function getAudioCtx() {
  if (audioCtx && audioCtx.state !== 'closed') return audioCtx;
  try {
    const Ctx = window.AudioContext || window.webkitAudioContext;
    if (Ctx) audioCtx = new Ctx();
  } catch {
    audioCtx = null;
  }
  return audioCtx;
}

function playTones({ freqs, type, step, length, peak }) {
  const ctx = getAudioCtx();
  if (!ctx) return;
  try {
    if (ctx.state === 'suspended') ctx.resume();
    const now = ctx.currentTime;
    freqs.forEach((freq, i) => {
      const start = now + i * step;
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = type;
      osc.frequency.setValueAtTime(freq, start);
      gain.gain.setValueAtTime(0.001, start);
      gain.gain.exponentialRampToValueAtTime(peak, start + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.001, start + length);
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.start(start);
      osc.stop(start + length + 0.01);
      osc.onended = () => {
        osc.disconnect();
        gain.disconnect();
      };
    });
  } catch {
    /* audio is best-effort */
  }
}

/** Urgent alarm: three fast descending sawtooth pulses (path blocked / danger). */
export function playAlarmBeep() {
  playTones({ freqs: [880, 660, 440], type: 'sawtooth', step: 0.18, length: 0.14, peak: 0.28 });
}

/** Gentle two-pulse sine tone for phone tilt feedback. */
export function playTiltBeep() {
  playTones({ freqs: [300, 240], type: 'sine', step: 0.14, length: 0.095, peak: 0.18 });
}

/** Resume the AudioContext; call from a user gesture. */
export function unlockAudioContext() {
  const ctx = getAudioCtx();
  if (ctx && ctx.state === 'suspended') ctx.resume().catch(() => {});
}

// ---------------------------------------------------------------------------
// Speech queue
// ---------------------------------------------------------------------------
class SpeechQueueManager {
  constructor() {
    /** @type {Array<{text:string, weight:number, lang:string, rate:number, pitch:number, addedAt:number, onEnd:?Function}>} */
    this.queue = [];
    this.current = null; // { item, token } for the utterance being spoken
    this.voiceEnabled = true;
    this.voices = [];
    this._voiceCache = new Map(); // lang prefix -> SpeechSynthesisVoice | null
    this._unlocked = false;
    this._token = 0;
    this._watchdog = null;
    this._settleTimer = null;
    this._lastSpoken = new Map(); // text -> timestamp

    if (typeof window !== 'undefined') this._init();
  }

  get isSpeaking() {
    return this.current !== null;
  }

  _init() {
    if (hasSpeech()) {
      this._loadVoices();
      window.speechSynthesis.onvoiceschanged = () => this._loadVoices();
      // Stop talking when the page goes away so the engine is not left in a stuck state
      window.addEventListener('pagehide', () => this.cancel());
    }

    const unlockOnce = () => {
      this.unlock();
      unlockAudioContext();
      ['touchstart', 'click', 'keydown'].forEach((evt) =>
        window.removeEventListener(evt, unlockOnce, { capture: true })
      );
    };
    ['touchstart', 'click', 'keydown'].forEach((evt) =>
      window.addEventListener(evt, unlockOnce, { capture: true, passive: true })
    );
  }

  _loadVoices() {
    if (!hasSpeech()) return;
    try {
      this.voices = window.speechSynthesis.getVoices() || [];
    } catch {
      this.voices = [];
    }
    this._voiceCache.clear();
  }

  /** Best voice for a language: exact match first, then same language, preferring on-device voices. */
  getVoice(lang = DEFAULT_LANG) {
    const key = lang.toLowerCase();
    if (this._voiceCache.has(key)) return this._voiceCache.get(key);
    if (!this.voices.length) this._loadVoices();

    const norm = (v) => (v.lang || '').toLowerCase().replace('_', '-');
    const base = key.split('-')[0];
    const pick = (list) => list.find((v) => v.localService) || list[0] || null;
    const exact = this.voices.filter((v) => norm(v) === key);
    const sameLang = this.voices.filter((v) => norm(v).split('-')[0] === base);
    const voice = pick(exact) || pick(sameLang);

    // Only cache hits, since voices may still be loading
    if (voice) this._voiceCache.set(key, voice);
    return voice;
  }

  getRomanianVoice() {
    return this.getVoice(DEFAULT_LANG);
  }

  /** Open the audio channel on iOS/Android with a silent utterance. Safe to call repeatedly. */
  unlock() {
    if (this._unlocked || !hasSpeech()) return;
    this._unlocked = true;
    try {
      if (window.speechSynthesis.paused) window.speechSynthesis.resume();
      const silent = new SpeechSynthesisUtterance('\u200B');
      silent.volume = 0;
      silent.rate = 10;
      silent.lang = DEFAULT_LANG;
      window.speechSynthesis.speak(silent);
    } catch {
      /* ignore */
    }
  }

  setVoiceEnabled(enabled) {
    this.voiceEnabled = Boolean(enabled);
    if (!this.voiceEnabled) this.cancel();
  }

  getVoiceEnabled() {
    return this.voiceEnabled;
  }

  /**
   * @param {string} text
   * @param {object} [options]
   * @param {'danger'|'urgent'|'high'|'normal'} [options.priority='normal']
   * @param {boolean} [options.interrupt=false] cancel everything and speak now
   * @param {number} [options.rate=1.1]
   * @param {number} [options.pitch=1]
   * @param {string} [options.lang='ro-RO']
   * @param {Function} [options.onEnd] called once when spoken, dropped or cancelled
   */
  speak(text, options = {}) {
    const {
      rate = 1.1,
      pitch = 1.0,
      lang = DEFAULT_LANG,
      interrupt = false,
      priority = 'normal',
      onEnd = null,
    } = options;

    const trimmed = text ? String(text).trim() : '';
    if (!this.voiceEnabled || !trimmed || !hasSpeech()) {
      onEnd?.();
      return;
    }

    const weight = PRIORITY_WEIGHT[priority] ?? PRIORITY_WEIGHT.normal;
    const item = { text: trimmed, weight, lang, rate, pitch, onEnd, addedAt: Date.now() };

    if (interrupt) {
      this._cancelAll();
      this._enqueue(item);
      this._scheduleProcess();
      return;
    }

    // Skip repeats: same text queued, being spoken, or spoken very recently
    const now = item.addedAt;
    const recent = this._lastSpoken.get(trimmed);
    if (
      this.queue.some((q) => q.text === trimmed) ||
      this.current?.item.text === trimmed ||
      (recent !== undefined && now - recent < REPEAT_COOLDOWN_MS)
    ) {
      onEnd?.();
      return;
    }

    // Full queue: replace the lowest-priority item only if the new one outranks it
    if (this.queue.length >= MAX_QUEUE) {
      const lowest = this.queue[this.queue.length - 1];
      if (lowest.weight >= weight) {
        onEnd?.();
        return;
      }
      this.queue.pop();
      lowest.onEnd?.();
    }

    this._enqueue(item);

    if (!this.current) {
      this._processQueue();
    } else if (weight >= PRIORITY_WEIGHT.urgent && weight > this.current.item.weight) {
      // Urgent warning beats a lower-priority utterance that is mid-speech
      this._stopCurrent();
      this._scheduleProcess();
    }
  }

  /** Insert keeping the queue sorted by weight (desc), then arrival order. */
  _enqueue(item) {
    let i = this.queue.length;
    while (i > 0 && this.queue[i - 1].weight < item.weight) i--;
    this.queue.splice(i, 0, item);
  }

  _scheduleProcess() {
    clearTimeout(this._settleTimer);
    this._settleTimer = setTimeout(() => {
      this._settleTimer = null;
      this._processQueue();
    }, CANCEL_SETTLE_MS);
  }

  _processQueue() {
    if (this.current || this._settleTimer) return;

    // Drop expired items
    const cutoff = Date.now() - TTL_MS;
    const expired = this.queue.filter((q) => q.addedAt < cutoff);
    if (expired.length) {
      this.queue = this.queue.filter((q) => q.addedAt >= cutoff);
      expired.forEach((q) => q.onEnd?.());
    }

    const item = this.queue.shift();
    if (!item) return;

    const synth = window.speechSynthesis;
    const token = ++this._token;
    this.current = { item, token };
    this._lastSpoken.set(item.text, Date.now());
    if (this._lastSpoken.size > 40) this._lastSpoken.delete(this._lastSpoken.keys().next().value);

    const utterance = new SpeechSynthesisUtterance(item.text);
    utterance.lang = item.lang;
    utterance.rate = item.rate;
    utterance.pitch = item.pitch;
    const voice = this.getVoice(item.lang);
    if (voice) utterance.voice = voice;

    // Ignore callbacks from utterances that were cancelled or replaced
    const finish = () => {
      if (!this.current || this.current.token !== token) return;
      clearTimeout(this._watchdog);
      this._watchdog = null;
      this.current = null;
      try {
        item.onEnd?.();
      } catch {
        /* caller errors must not stall the queue */
      }
      this._processQueue();
    };

    utterance.onend = finish;
    utterance.onerror = (e) => {
      if (e.error !== 'interrupted' && e.error !== 'canceled') {
        console.warn('[SpeechQueue] error:', e.error, item.text.slice(0, 40));
      }
      finish();
    };

    // If onend never fires, stop the engine so it cannot talk over the next item
    clearTimeout(this._watchdog);
    this._watchdog = setTimeout(() => {
      try {
        synth.cancel();
      } catch {
        /* ignore */
      }
      finish();
    }, Math.max(4500, item.text.length * 130));

    try {
      if (synth.paused) synth.resume();
      synth.speak(utterance);
    } catch (err) {
      console.warn('[SpeechQueue] speak() threw:', err);
      finish();
    }
  }

  /** Stop the utterance in progress without clearing the queue. */
  _stopCurrent() {
    const cur = this.current;
    if (!cur) return;
    clearTimeout(this._watchdog);
    this._watchdog = null;
    this.current = null; // invalidates the token, so its onend/onerror are ignored
    try {
      window.speechSynthesis.cancel();
    } catch {
      /* ignore */
    }
    cur.item.onEnd?.();
  }

  _cancelAll() {
    clearTimeout(this._settleTimer);
    this._settleTimer = null;
    const dropped = this.queue;
    this.queue = [];
    this._stopCurrent();
    if (hasSpeech()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        /* ignore */
      }
    }
    dropped.forEach((q) => q.onEnd?.());
  }

  cancel() {
    this._cancelAll();
  }
}

export const speechQueue = new SpeechQueueManager();
