import Groq from "groq-sdk";
import { createPrefixedId } from "../ids.js";
import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { logger } from "../observability/logger.js";
import { normalizeError, retryTransient } from "../observability/errors.js";
import type { OperationContext } from "../types.js";
import { buildTranscriptionPrompt } from "./transcription-prompt.js";
import { buildClientOptions, type EndpointSettings } from "../llm/client-options.js";

const WEAK_AVG_LOGPROB_THRESHOLD = -0.5;
const HIGH_NO_SPEECH_THRESHOLD = 0.75;

/**
 * Stock phrases speech-to-text models emit when handed silence or room noise.
 * They are artefacts of the captioned video in the training data, not words the
 * user said, and pasting one into somebody's chat window is the most
 * embarrassing failure this app has.
 *
 * Matching a phrase is NEVER enough on its own to drop a transcript. Someone
 * genuinely saying "thank you" into a chat box is a real dictation and must
 * survive. Suppression additionally requires the model's own `no_speech_prob`
 * to agree there was probably no speech there — see `suppressHallucination`.
 *
 * Deliberately excluded: bare "you" and "bye". Both are plausible one-word
 * dictations, and the phrase list is the only thing standing between a real
 * utterance and silent deletion.
 */
const HALLUCINATION_PHRASES = new Set([
  "thank you",
  "thank you very much",
  "thank you so much",
  "thank you for watching",
  "thank you for watching this video",
  "thanks for watching",
  "thanks for watching this video",
  "please subscribe",
  "like and subscribe",
  "subscribe to my channel",
  "subtitles by",
  "subtitles by the amara org community",
]);

/**
 * How sure the model must be that a segment holds no speech before a matching
 * phrase is dropped.
 *
 * Lower  -> more artefacts caught, higher risk of eating a real short reply.
 * Higher -> fewer false positives, more artefacts reach the user's text box.
 *
 * 0.5 is a middling starting point, not a tuned figure. Move it using captured
 * samples, not by feel.
 */
export const HALLUCINATION_NO_SPEECH_THRESHOLD = 0.5;

export type GroqTranscriptionSegment = {
  avg_logprob?: number;
  no_speech_prob?: number;
  text?: string;
};

export type GroqTranscriptionResult = {
  text: string;
  language: string;
  duration?: number;
  segments: GroqTranscriptionSegment[];
  confidence: {
    weakSegmentCount: number;
    averageLogprob: number | null;
    highNoSpeechSegmentCount: number;
    bucket: "strong" | "mixed" | "weak" | "empty";
    retried: boolean;
    /** True when a known silence artefact was dropped. Blocks the empty-text retry. */
    hallucinationSuppressed: boolean;
  };
};

export type GroqTranscriptionOptions = {
  /** Empty or absent means auto-detect: the `language` parameter is omitted entirely. */
  language?: string;
  prompt?: string;
  retry?: boolean;
  /** User vocabulary, biased into the recognition prompt. */
  vocabulary?: string[];
};

type GroqVerboseJsonResponse = {
  text?: string;
  language?: string;
  duration?: number;
  segments?: GroqTranscriptionSegment[];
};

export class GroqTranscriptionService {
  private readonly client: Groq;
  private readonly model: string;

  constructor(apiKey: string, model: string, endpoint: EndpointSettings = {}) {
    this.client = new Groq(buildClientOptions(apiKey, endpoint));
    this.model = model;
  }

  async transcribe(
    audioPath: string,
    context: OperationContext = {},
    options: GroqTranscriptionOptions = {},
  ): Promise<GroqTranscriptionResult> {
    const language = options.language?.trim() ?? "";
    const vocabulary = options.vocabulary ?? [];
    return this.transcribeAttempt(audioPath, context, {
      language,
      vocabulary,
      prompt: options.prompt || buildTranscriptionPrompt({ language, vocabulary }),
      retry: false,
    });
  }

  private async transcribeAttempt(
    audioPath: string,
    context: OperationContext,
    options: { language: string; prompt: string; retry: boolean; vocabulary: string[] },
  ): Promise<GroqTranscriptionResult> {
    const startedAt = Date.now();
    const requestId = context.requestId || createPrefixedId("transcription");
    const audioBytes = (await stat(audioPath)).size;

    void logger.info("groq.transcription.start", {
      ...context,
      requestId,
      model: this.model,
      audioBytes,
      language: options.language,
      retry: options.retry,
    });

    try {
      const transcription = (await retryTransient(
        () =>
          this.client.audio.transcriptions.create({
            file: createReadStream(audioPath),
            model: this.model,
            // Omitted entirely when empty. Sending a language forces the model to
            // decode as that language, which mangles anything else the user says.
            ...(options.language ? { language: options.language } : {}),
            prompt: options.prompt,
            response_format: "verbose_json",
            temperature: 0,
          }),
        {
          category: "transcription",
          onRetry: (attempt, error) =>
            logger.warn("groq.transcription.retry", {
              ...context,
              requestId,
              attempt,
              error,
            }),
        },
      )) as GroqVerboseJsonResponse;

      const result = normalizeTranscriptionResult(transcription, options.retry);
      void logger.info("groq.transcription.success", {
        ...context,
        requestId,
        model: this.model,
        durationMs: Date.now() - startedAt,
        audioBytes,
        outputChars: result.text.length,
        confidence: result.confidence,
      });

      if (!options.retry && shouldRetryTranscription(result)) {
        void logger.warn("groq.transcription.low_confidence_retry", {
          ...context,
          requestId,
          model: this.model,
          confidence: result.confidence,
        });
        return this.transcribeAttempt(audioPath, context, {
          language: options.language,
          vocabulary: options.vocabulary,
          prompt: buildTranscriptionPrompt({
            retry: true,
            language: options.language,
            vocabulary: options.vocabulary,
          }),
          retry: true,
        });
      }

      return result;
    } catch (error) {
      const normalized = normalizeError("transcription", error);
      void logger.error("groq.transcription.failed", {
        ...context,
        requestId,
        model: this.model,
        durationMs: Date.now() - startedAt,
        audioBytes,
        error: normalized,
      });
      throw error;
    }
  }
}

/**
 * Strips a transcript down to bare lowercase words so "Thank you, for watching!"
 * and "thank you for watching" compare equal. Punctuation becomes a separator
 * rather than being deleted, so "amara.org" normalises to "amara org" and cannot
 * accidentally fuse two words together.
 */
function normalizeForPhraseMatch(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

/**
 * Returns "" when the transcript is a known silence artefact, otherwise returns
 * the text unchanged.
 *
 * Two conditions must both hold, because either one alone is unsafe:
 *
 *  1. the whole transcript normalises to a known artefact phrase, and
 *  2. some segment reports `no_speech_prob` at or above the threshold.
 *
 * When the provider omits segment metadata we FAIL OPEN and keep the text. A
 * spurious "Thank you" reaching the user is bad; silently eating words they
 * actually spoke is worse, and unlike the first case it is invisible to them.
 */
export function suppressHallucination(
  text: string,
  segments: GroqTranscriptionSegment[],
): { text: string; suppressed: boolean; reason?: string } {
  const normalized = normalizeForPhraseMatch(text);
  if (!normalized || !HALLUCINATION_PHRASES.has(normalized)) {
    return { text, suppressed: false };
  }

  const noSpeechProbs = segments
    .map((segment) => segment.no_speech_prob)
    .filter((value): value is number => typeof value === "number" && Number.isFinite(value));

  if (noSpeechProbs.length === 0) {
    return { text, suppressed: false, reason: "no_segment_metadata" };
  }

  // Max rather than average: the transcript is one short phrase, so a single
  // segment flagged as silence is the whole utterance being flagged.
  const highestNoSpeechProb = Math.max(...noSpeechProbs);
  if (highestNoSpeechProb < HALLUCINATION_NO_SPEECH_THRESHOLD) {
    return { text, suppressed: false, reason: "speech_likely" };
  }

  return { text: "", suppressed: true, reason: "silence_artifact" };
}

function normalizeTranscriptionResult(
  transcription: GroqVerboseJsonResponse,
  retried: boolean,
): GroqTranscriptionResult {
  const rawText = transcription.text?.trim() || "";
  const segments = Array.isArray(transcription.segments) ? transcription.segments : [];
  const hallucination = suppressHallucination(rawText, segments);
  const text = hallucination.text;

  if (hallucination.suppressed) {
    void logger.info("groq.transcription.hallucination_suppressed", {
      // The phrase itself is one of a dozen known constants, not user content,
      // so recording which one fired is safe and makes threshold tuning possible.
      phrase: normalizeForPhraseMatch(rawText),
      reason: hallucination.reason,
    });
  }
  const segmentsWithLogprob = segments.filter((segment) => typeof segment.avg_logprob === "number");
  const weakSegmentCount = segments.filter(
    (segment) =>
      typeof segment.avg_logprob === "number" && segment.avg_logprob <= WEAK_AVG_LOGPROB_THRESHOLD,
  ).length;
  const highNoSpeechSegmentCount = segments.filter(
    (segment) =>
      typeof segment.no_speech_prob === "number" && segment.no_speech_prob >= HIGH_NO_SPEECH_THRESHOLD,
  ).length;
  const averageLogprob =
    segmentsWithLogprob.length > 0
      ? segmentsWithLogprob.reduce((sum, segment) => sum + Number(segment.avg_logprob), 0) / segmentsWithLogprob.length
      : null;

  return {
    text,
    // Empty means the provider did not say. Claiming "en" when we auto-detected
    // and were told nothing is a guess dressed up as a fact.
    language: transcription.language || "",
    duration: typeof transcription.duration === "number" ? transcription.duration : undefined,
    segments,
    confidence: {
      weakSegmentCount,
      averageLogprob,
      highNoSpeechSegmentCount,
      bucket: confidenceBucket(text, averageLogprob, weakSegmentCount),
      retried,
      hallucinationSuppressed: hallucination.suppressed,
    },
  };
}

function confidenceBucket(
  text: string,
  averageLogprob: number | null,
  weakSegmentCount: number,
): GroqTranscriptionResult["confidence"]["bucket"] {
  if (!text) {
    return "empty";
  }

  if (averageLogprob !== null && averageLogprob <= WEAK_AVG_LOGPROB_THRESHOLD) {
    return "weak";
  }

  if (weakSegmentCount > 0) {
    return "mixed";
  }

  return "strong";
}

function shouldRetryTranscription(result: GroqTranscriptionResult): boolean {
  // Suppression already concluded there was no speech. Asking the model again
  // buys the same artefact back at the price of another round trip.
  if (result.confidence.hallucinationSuppressed) {
    return false;
  }

  if (!result.text) {
    return true;
  }

  if (result.confidence.bucket === "weak") {
    return true;
  }

  return result.confidence.weakSegmentCount > 0 && result.confidence.averageLogprob !== null
    ? result.confidence.averageLogprob <= -0.35
    : false;
}

