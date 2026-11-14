/**
 * Lets the main voice assistant (double tap anywhere) answer the help system's question
 * "was the deed really done?". While a question is pending, "da" / "nu" go to it.
 */
let pending = null;

export const helpConfirmBridge = {
  /** @param {(yes: boolean) => void} handler */
  ask(handler) {
    pending = handler;
  },
  clear() {
    pending = null;
  },
  isAwaiting() {
    return pending !== null;
  },
  answer(yes) {
    const handler = pending;
    pending = null;
    if (handler) handler(yes);
  },
};

/** Voice commands for the help system, delivered to HelpCenter. */
export const HELP_COMMAND_EVENT = 'accessmap:help-command';

export function emitHelpCommand(type) {
  window.dispatchEvent(new CustomEvent(HELP_COMMAND_EVENT, { detail: { type } }));
}
