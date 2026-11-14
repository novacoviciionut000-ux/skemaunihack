/**
 * Connects the help system (HelpCenter) with the main voice assistant (VoiceButton +
 * useVoiceAssistant), so every help action also works by voice.
 */
let pending = null; // { onAnswer(yes), onUnclear() }

export const helpConfirmBridge = {
  /** The app asked "was the deed really done?" and waits for "da" / "nu". */
  ask(onAnswer, { onUnclear } = {}) {
    pending = { onAnswer, onUnclear };
  },
  clear() {
    pending = null;
  },
  isAwaiting() {
    return pending !== null;
  },
  answer(yes) {
    const p = pending;
    pending = null;
    if (p) p.onAnswer(yes);
  },
  /** Heard something, but not "da" or "nu". */
  unclear() {
    if (pending && pending.onUnclear) pending.onUnclear();
  },
};

/** Voice commands for the help system, delivered to HelpCenter. */
export const HELP_COMMAND_EVENT = 'accessmap:help-command';

export function emitHelpCommand(type) {
  window.dispatchEvent(new CustomEvent(HELP_COMMAND_EVENT, { detail: { type } }));
}

/**
 * Opens the microphone with the normal listening popup, as if the user had double tapped.
 * Used right after the app asks a question.
 */
export const VOICE_LISTEN_EVENT = 'accessmap:voice-listen';

export function requestVoiceListen(prompt) {
  window.dispatchEvent(new CustomEvent(VOICE_LISTEN_EVENT, { detail: { prompt } }));
}
