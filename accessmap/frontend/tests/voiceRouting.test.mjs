// Every command the parser produces must reach the right handler in useVoiceAssistant.js.
// Regression: the microphone cases were inserted in the middle of the help cases, so
// "Am nevoie de ajutor" turned on the permanent microphone instead of calling a volunteer.
import { readFileSync } from 'fs';

const src = readFileSync(new URL('../src/hooks/useVoiceAssistant.js', import.meta.url), 'utf8');
const expect = {
  'call-volunteer': 'emitHelpCommand', 'cancel-help': 'emitHelpCommand', 'help-status': 'emitHelpCommand',
  'deed-finished': 'emitHelpCommand', 'accept-help': 'emitHelpCommand', 'release-help': 'emitHelpCommand',
  'duty-on': 'emitHelpCommand', 'duty-off': 'emitHelpCommand', 'my-points': 'emitHelpCommand',
  'mic-always-on': 'onMicAlwaysOn', 'mic-off': 'onMicOff',
  'emergency': 'onEmergency', 'camera-open': 'onCameraOpen', 'camera-close': 'onCameraClose',
  'cancel-route': 'onCancelRoute', 'status': 'onStatusQuery', 'start-navigation': 'onStartNavigation',
  'destination': 'onDestinationRecognized',
};
const handlers = [...new Set(Object.values(expect))];

let fail = 0;
for (const [type, handler] of Object.entries(expect)) {
  const at = src.indexOf(`case '${type}':`);
  // The branch a case runs: from its label to the first `return;` after it
  const branch = at < 0 ? '' : src.slice(at, src.indexOf('return;', at));
  const calls = handlers.filter((h) => branch.includes(`${h}(`));
  const ok = calls.length === 1 && calls[0] === handler;
  if (!ok) fail++;
  console.log(ok ? 'ok  ' : 'FAIL', `${type.padEnd(17)} -> ${calls.join(', ') || '(not handled)'}${ok ? '' : `   expected ${handler}`}`);
}
console.log(fail ? `\n${fail} routing FAILED` : `\nvoice routing: all ${Object.keys(expect).length} commands reach their handler`);
process.exit(fail ? 1 : 0);
