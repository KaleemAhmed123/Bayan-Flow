let mediaRecorder = null;
let stream = null;
let chunks = [];
let activeSessionId = null;
let maxAudioBytes = 0;
let recordedBytes = 0;
let durationTimer = null;
let limitFailure = null;
let audioContext = null;
let silenceInterval = null;

const SILENCE_AUTO_STOP_MS = 10_000;
const VOICE_RMS_THRESHOLD = 0.025;

window.recorderBridge.onStart(async (_event, options) => {
  activeSessionId = options?.sessionId || null;
  maxAudioBytes = Number(options?.maxAudioBytes || 0);
  const maxDurationMs = Number(options?.maxDurationMs || 0);

  try {
    if (!activeSessionId) {
      throw new Error("Recording session is missing.");
    }

    stopStream();
    activeSessionId = options.sessionId;
    chunks = [];
    recordedBytes = 0;
    limitFailure = null;
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    startSilenceMonitor(stream, SILENCE_AUTO_STOP_MS);

    mediaRecorder.addEventListener("dataavailable", (event) => {
      if (event.data.size > 0) {
        recordedBytes += event.data.size;
        chunks.push(event.data);

        if (maxAudioBytes > 0 && recordedBytes > maxAudioBytes) {
          failActiveRecording("Recording is too large. Try a shorter dictation.");
        }
      }
    });

    mediaRecorder.addEventListener("stop", async () => {
      const sessionId = activeSessionId;
      const failure = limitFailure;
      const blob = new Blob(chunks, { type: "audio/webm" });
      const buffer = await blob.arrayBuffer();
      stopStream();

      if (failure) {
        await window.recorderBridge.failed({ sessionId, message: failure });
        return;
      }

      await window.recorderBridge.stopped({ sessionId, audio: buffer });
    });

    mediaRecorder.start(1000);

    if (maxDurationMs > 0) {
      durationTimer = window.setTimeout(() => {
        failActiveRecording("Recording limit reached. Try a shorter dictation.");
      }, maxDurationMs);
    }

    await window.recorderBridge.started({ sessionId: activeSessionId, ok: true });
  } catch (error) {
    const sessionId = activeSessionId;
    stopStream();
    await window.recorderBridge.failed({
      sessionId,
      message: error.message || "Could not start microphone recording.",
    });
  }
});

window.recorderBridge.onStop(async (_event, options) => {
  if (options?.sessionId !== activeSessionId) {
    return;
  }

  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    const sessionId = activeSessionId;
    stopStream();
    await window.recorderBridge.stopped({ sessionId, audio: new ArrayBuffer(0) });
    return;
  }

  mediaRecorder.stop();
});

window.recorderBridge.onTestMic(async (_event, options) => {
  const requestId = options?.requestId || null;
  let testStream = null;

  try {
    testStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    testStream.getTracks().forEach((track) => track.stop());
    await window.recorderBridge.micTested({ requestId, ok: true });
  } catch (error) {
    testStream?.getTracks().forEach((track) => track.stop());
    await window.recorderBridge.micTested({
      requestId,
      ok: false,
      message: error.message || "Could not access microphone.",
    });
  }
});

function failActiveRecording(message) {
  if (limitFailure || !mediaRecorder || mediaRecorder.state === "inactive") {
    return;
  }

  limitFailure = message;
  mediaRecorder.stop();
}

function stopStream() {
  if (durationTimer) {
    window.clearTimeout(durationTimer);
    durationTimer = null;
  }

  stopSilenceMonitor();

  stream?.getTracks().forEach((track) => track.stop());
  stream = null;
  mediaRecorder = null;
  activeSessionId = null;
}

function startSilenceMonitor(inputStream, silenceMs) {
  stopSilenceMonitor();

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) {
      return;
    }

    audioContext = new AudioContextClass();
    const source = audioContext.createMediaStreamSource(inputStream);
    const analyser = audioContext.createAnalyser();
    analyser.fftSize = 1024;
    source.connect(analyser);

    const samples = new Uint8Array(analyser.fftSize);
    let lastVoiceAt = Date.now();

    silenceInterval = window.setInterval(() => {
      if (!mediaRecorder || mediaRecorder.state !== "recording") {
        return;
      }

      analyser.getByteTimeDomainData(samples);
      let total = 0;
      for (const sample of samples) {
        const centered = (sample - 128) / 128;
        total += centered * centered;
      }

      const rms = Math.sqrt(total / samples.length);
      if (rms > VOICE_RMS_THRESHOLD) {
        lastVoiceAt = Date.now();
        return;
      }

      if (Date.now() - lastVoiceAt >= silenceMs) {
        mediaRecorder.stop();
      }
    }, 500);
  } catch {
    stopSilenceMonitor();
  }
}

function stopSilenceMonitor() {
  if (silenceInterval) {
    window.clearInterval(silenceInterval);
    silenceInterval = null;
  }

  if (audioContext) {
    audioContext.close().catch(() => undefined);
    audioContext = null;
  }
}
