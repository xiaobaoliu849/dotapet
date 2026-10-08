/**
 * Realtime transcript stream semantics — pure functions, no I/O.
 *
 * Realtime providers stream two different text shapes, and they must never be
 * funnelled through the same merger (lesson from VoiceSpirit commit 821a7a8
 * "stop splitting words in assistant transcripts"):
 *
 *   - Clean BPE token deltas (" world" opens a word, "ful" continues one)
 *     carry authoritative whitespace → append verbatim, never trim mid-turn,
 *     never invent word-boundary spaces, never deduplicate ("ha"+"ha" is real
 *     speech; an ordered WebSocket never re-delivers a delta).
 *   - Cumulative snapshots (ASR hypotheses / "as of now" transcripts) carry
 *     non-authoritative whitespace and revise backwards near the end →
 *     replace wholesale or reconcile by prefix.
 *
 * Applying overlap/whitespace heuristics to a clean delta stream splits words
 * ("wonder" + "ful" -> "wonder ful"), eats characters on a coincidental edge
 * ("Hel" + "lo" -> "Helo") and drops genuine repeats ("ha" x3 -> "ha").
 */

/**
 * Append one clean streaming text delta to the accumulated assistant reply.
 *
 * Only the very first fragment of a turn may carry a stray leading pad (a
 * tokenizer artifact with nothing before it to bound) — strip it there. Later
 * fragments keep their leading whitespace: it is the word boundary against the
 * previously flushed chunk.
 *
 * Mirrors appendAssistantDelta in VoiceSpirit frontend/src/hooks/useVoiceChatHelpers.ts
 * and the backend ground truth `ai_acc + content` / `"".join(assistant_parts)`.
 *
 * @param {string} previous accumulated text so far ('' at turn start)
 * @param {string} delta verbatim provider delta
 * @returns {string}
 */
export function appendAssistantDelta(previous, delta) {
  const text = String(delta ?? '');
  if (!text) {
    return String(previous ?? '');
  }
  if (!previous) {
    return text.replace(/^\s+/, '');
  }
  return `${previous}${text}`;
}

/**
 * Overlap-based novelty predicate for cross-family duplicate arbitration.
 *
 * Ported from VoiceSpirit realtime_constants.py::_merge_streaming_text — but
 * only in its *predicate* role: callers forward the returned `novel` suffix
 * (never `merged`, which trims and re-spaces its inputs — exactly what must
 * not reach a clean delta stream) and never the raw candidate frame.
 *
 * Whitespace discipline: trimming is used for MATCHING only. `novel` is
 * always an index-aligned slice of the ORIGINAL candidate, so a word-boundary
 * space inside a cumulative frame ("Hello" -> "Hello world") survives into
 * the published delta.
 *
 * @param {string} previous canonical text accumulated so far
 * @param {string} incoming cumulative-shaped candidate
 * @returns {{merged: string, novel: string}} novel === '' means "nothing new"
 */
export function streamingNovelty(previous, incoming) {
  const before = String(previous ?? '').trim();
  const rawNext = String(incoming ?? '');
  // Matching runs on the candidate with its LEADING pad stripped (`cand`),
  // but every novel slice is cut from the ORIGINAL `rawNext` at
  // leadLen + matched-length — so a word-boundary space between shown
  // content and new content ("Hello" -> " there") survives into the
  // published delta instead of merging words.
  const leadLen = rawNext.length - rawNext.replace(/^\s+/, '').length;
  const cand = rawNext.slice(leadLen);
  const nextTrim = cand.trim();
  if (!nextTrim) {
    return { merged: before, novel: '' };
  }
  if (!before) {
    return { merged: nextTrim, novel: rawNext };
  }

  // Exact full-text duplicates are re-sent snapshots — nothing novel.
  // Deliberately NO substring containment check: natural language routinely
  // repeats words/phrases, and a containment check silently drops genuine
  // new content (VoiceSpirit 821a7a8 removed it for the same reason).
  if (before === nextTrim) {
    return { merged: before, novel: '' };
  }

  // A cumulative snapshot rewound to a strict prefix of what is already
  // shown is the losing family re-streaming the sentence from scratch — it
  // carries nothing beyond what was already forwarded. Strict head-prefix
  // only: mid-string containment stays banned so genuine repeats survive.
  if (before.startsWith(nextTrim)) {
    return { merged: before, novel: '' };
  }

  const beforeClean = before.replace(/[.!?。！？,，:：;\s]+$/u, '');
  if (beforeClean && cand.startsWith(beforeClean)) {
    // Cumulative prefix extension: whatever trails beforeClean is new.
    const novel = rawNext.slice(leadLen + beforeClean.length);
    return novel.trim() ? { merged: `${before}${novel}`, novel } : { merged: before, novel: '' };
  }

  // Longest suffix-of-before == prefix-of-next overlap (character-level
  // revision, e.g. an ASR hypothesis rebuilding the same tail).
  const max = Math.min(before.length, cand.length);
  let overlap = 0;
  for (let size = max; size > 0; size--) {
    if (before.endsWith(cand.slice(0, size))) {
      overlap = size;
      break;
    }
  }
  const novel = overlap > 0 ? rawNext.slice(leadLen + overlap) : rawNext;
  if (!novel.trim()) {
    // Whitespace-only remainder: padding around an already-complete match,
    // never content (guards against accumulating stray pads on replays).
    return { merged: before, novel: '' };
  }
  return { merged: before + novel, novel };
}

/**
 * Reconcile an authoritative full transcript (`done.text`) against what has
 * already been streamed forward. Returns ONLY the missing suffix so the
 * consumer can self-heal any gap without double-publishing.
 *
 * Ported from VoiceSpirit realtime_doubao_provider.py::_duplex_missing_text_suffix:
 * on divergence (final is not an extension of the streamed deltas) refuse to
 * splice and report via onDivergent instead of guessing.
 *
 * @param {string} accumulated text already forwarded for this turn
 * @param {string} finalText authoritative whole-transcript snapshot
 * @param {(acc: string, fin: string) => void} [onDivergent] divergence logger
 * @returns {string} suffix to publish ('' when complete or divergent)
 */
export function missingTextSuffix(accumulated, finalText, onDivergent) {
  const fin = String(finalText ?? '');
  const acc = String(accumulated ?? '');
  if (!fin || fin === acc) {
    return '';
  }
  if (fin.startsWith(acc)) {
    return fin.slice(acc.length);
  }
  if (acc && typeof onDivergent === 'function') {
    onDivergent(acc, fin);
  }
  return '';
}

/**
 * Targeted barge-in suppression predicate (Doubao duplex).
 *
 * Ported from VoiceSpirit realtime_doubao_provider.py::_duplex_output_suppressed:
 *   suppressedId === null  → no suppression window, nothing is dropped
 *   suppressedId === ''    → barge-in without a playable response id: drop all
 *                            residual output until the next reply starts
 *   suppressedId === 'x'   → drop only that interrupted reply's residue; events
 *                            missing their id inside the window drop too
 *                            (conservative), events of OTHER replies pass
 *
 * @param {string|null} suppressedId current window id (null = inactive)
 * @param {string} responseId id carried by the downlink event (may be '')
 * @returns {boolean}
 */
export function isOutputSuppressed(suppressedId, responseId) {
  if (suppressedId === null || suppressedId === undefined) {
    return false;
  }
  const suppressed = String(suppressedId);
  const id = String(responseId ?? '');
  return !suppressed || !id || id === suppressed;
}

/**
 * Decide whether a starting reply lifts the active suppression window
 * (Doubao output_audio.started). Any reply other than the suppressed one
 * itself (or an unknown-id reply while a blank window was set) ends it.
 *
 * @param {string|null} suppressedId current window id
 * @param {string} responseId id of the reply that just started
 * @returns {boolean} true when the window should be cleared
 */
export function shouldLiftSuppression(suppressedId, responseId) {
  if (suppressedId === null || suppressedId === undefined) {
    return false;
  }
  const suppressed = String(suppressedId);
  const id = String(responseId ?? '');
  return !suppressed || !id || id !== suppressed;
}

const QWEN_ARTIFACT_FIXES = [
  // Spaced-out digits: "2 0 6 1" -> "2061"
  [/(\b\d)\s+(?=\d\b)/gu, '$1'],
  // Spaced-out hyphens: " - " -> "-"
  [/\s*-\s*/gu, '-'],
  // Common Qwen English ASR mangled words
  [/\bQ\s*wen\b/giu, 'Qwen'],
  [/\bA\s*udio\b/giu, 'Audio'],
  [/\bT\s*S\b/giu, 'TTS'],
  [/\bugging\s*Face\b/giu, 'Hugging Face'],
  [/\bccelerating\b/giu, 'accelerating'],
];

/**
 * Clean phonetic ASR artifacts from Qwen audio_transcript deltas.
 * Applies ONLY to the audio_transcript family — response.text deltas are
 * clean LLM tokens and must stay byte-exact.
 *
 * Ported from VoiceSpirit realtime_constants.py::_clean_transcript_text.
 *
 * @param {string} text raw audio_transcript delta
 * @returns {string}
 */
export function cleanQwenTranscriptArtifacts(text) {
  let out = String(text ?? '');
  if (!out) {
    return out;
  }
  for (const [pattern, replacement] of QWEN_ARTIFACT_FIXES) {
    out = out.replace(pattern, replacement);
  }
  return out;
}

/**
 * Strip Markdown symbols so TTS does not read them aloud.
 *
 * '*' and '`' have no legitimate spoken form and are always dropped. A '#'
 * is dropped ONLY in true ATX-heading position (line start, 1-6 hashes,
 * followed by whitespace) — stricter than VoiceSpirit's lookahead variant,
 * which still ate the hash in "说 C# 好" because a space happened to follow.
 *
 * @param {string} text
 * @returns {string}
 */
export function stripMarkdownForTts(text) {
  let out = String(text ?? '');
  if (!out) {
    return out;
  }
  out = out.replace(/[*`]/g, '');
  out = out.replace(/^[ \t]*#{1,6}[ \t]+/gm, '');
  return out;
}
