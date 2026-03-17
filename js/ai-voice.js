/**
 * ai-voice.js — Web Speech STT/TTS
 * Zero dependencies, browser-native speech recognition and synthesis.
 */

const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;

/**
 * Check if STT is supported in this browser.
 */
export function isSTTSupported() {
  return !!SpeechRecognition;
}

/**
 * Check if TTS is supported.
 */
export function isTTSSupported() {
  return 'speechSynthesis' in window;
}

/**
 * Create a speech recognition session.
 * Returns a controller object with start/stop/abort.
 *
 * @param {object} opts
 * @param {function} opts.onInterim - Called with interim text as user speaks
 * @param {function} opts.onResult - Called with final recognised text
 * @param {function} opts.onError - Called on error
 * @param {function} opts.onEnd - Called when recognition ends
 * @returns {object} { start, stop, abort, isListening }
 */
export function createRecogniser(opts = {}) {
  if (!SpeechRecognition) {
    return {
      start() { opts.onError?.('Speech recognition is not supported in this browser.'); },
      stop() {},
      abort() {},
      get isListening() { return false; },
    };
  }

  const recogniser = new SpeechRecognition();
  recogniser.continuous = false;
  recogniser.interimResults = true;
  recogniser.lang = 'en-AU';
  recogniser.maxAlternatives = 1;

  let listening = false;

  recogniser.onresult = (event) => {
    let interim = '';
    let final = '';
    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        final += transcript;
      } else {
        interim += transcript;
      }
    }
    if (interim) opts.onInterim?.(interim);
    if (final) opts.onResult?.(final);
  };

  recogniser.onerror = (event) => {
    listening = false;
    if (event.error === 'no-speech' || event.error === 'aborted') {
      opts.onEnd?.();
      return;
    }
    opts.onError?.(event.error);
  };

  recogniser.onend = () => {
    listening = false;
    opts.onEnd?.();
  };

  return {
    start() {
      if (listening) return;
      listening = true;
      recogniser.start();
    },
    stop() {
      if (!listening) return;
      recogniser.stop();
    },
    abort() {
      if (!listening) return;
      recogniser.abort();
      listening = false;
    },
    get isListening() { return listening; },
  };
}

/**
 * Speak text aloud using Web Speech Synthesis.
 * @param {string} text
 * @param {object} opts
 * @param {function} opts.onEnd - Called when speech finishes
 * @returns {{ cancel: function }} Controller to cancel speech
 */
/**
 * Pick the best available voice — prefer natural/premium voices over robotic defaults.
 * macOS ships "Karen" (AU English, premium) and Chrome has Google voices.
 */
let _preferredVoice = null;
let _voicesLoaded = false;

function loadPreferredVoice() {
  if (_voicesLoaded) return;
  const voices = window.speechSynthesis.getVoices();
  if (!voices.length) return; // voices not loaded yet

  _voicesLoaded = true;

  // Priority order: premium/enhanced AU English → any AU English → premium UK → fallback
  const ranked = [
    v => v.lang === 'en-AU' && /premium|enhanced|natural|neural/i.test(v.name),
    v => v.lang === 'en-AU' && !/compact|alex/i.test(v.name),
    v => v.lang === 'en-AU',
    v => v.lang.startsWith('en-') && /premium|enhanced|natural|neural|google/i.test(v.name),
    v => v.lang === 'en-GB',
  ];

  for (const test of ranked) {
    const match = voices.find(test);
    if (match) { _preferredVoice = match; return; }
  }
}

// Voices load asynchronously in most browsers
if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
  window.speechSynthesis.onvoiceschanged = loadPreferredVoice;
  loadPreferredVoice(); // try immediately in case already loaded
}

export function speak(text, opts = {}) {
  if (!isTTSSupported()) {
    opts.onEnd?.();
    return { cancel() {} };
  }

  // Cancel any current speech
  window.speechSynthesis.cancel();

  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-AU';
  utterance.rate = 1.0;
  utterance.pitch = 1.0;

  // Use the best available natural voice instead of OS default
  loadPreferredVoice();
  if (_preferredVoice) utterance.voice = _preferredVoice;

  utterance.onend = () => opts.onEnd?.();
  utterance.onerror = () => opts.onEnd?.();

  window.speechSynthesis.speak(utterance);

  return {
    cancel() {
      window.speechSynthesis.cancel();
    },
  };
}

/**
 * Stop any current TTS playback.
 */
export function stopSpeaking() {
  if (isTTSSupported()) {
    window.speechSynthesis.cancel();
  }
}
