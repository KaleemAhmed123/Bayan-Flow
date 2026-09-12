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
let stopReason = "manual";

/** Used only if the main process sends nothing; the real value is a setting. */
const DEFAULT_SILENCE_AUTO_STOP_MS = 5_000;
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
    stopReason = "manual";
    stream = await openMicrophone(options?.microphoneId || "");
    mediaRecorder = new MediaRecorder(stream, { mimeType: "audio/webm" });
    const silenceMs = Number(options?.silenceStopMs) > 0 ? Number(options.silenceStopMs) : DEFAULT_SILENCE_AUTO_STOP_MS;
    startSilenceMonitor(stream, silenceMs);

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
      const reason = stopReason;
      const blob = new Blob(chunks, { type: "audio/webm" });
      const buffer = await blob.arrayBuffer();
      stopStream();

      if (failure) {
        await window.recorderBridge.failed({ sessionId, message: failure });
        return;
      }

      await window.recorderBridge.stopped({ sessionId, audio: buffer, stopReason: reason });
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

  stopReason = normalizeStopReason(options?.reason);

  if (!mediaRecorder || mediaRecorder.state === "inactive") {
    const sessionId = activeSessionId;
    stopStream();
    await window.recorderBridge.stopped({ sessionId, audio: new ArrayBuffer(0), stopReason });
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
        stopReason = "silence";
        mediaRecorder.stop();
      }
    }, 500);
  } catch {
    stopSilenceMonitor();
  }
}

function normalizeStopReason(reason) {
  if (reason === "manual" || reason === "silence" || reason === "max_duration") {
    return reason;
  }

  return "manual";
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

/**
 * Opens the chosen microphone, falling back to the system default when it is gone.
 *
 * `deviceId: { exact }` fails hard when the device was unplugged. That is the
 * right constraint — we want the device the user picked — but losing a whole
 * dictation because a headset was removed is not acceptable, so a missing device
 * degrades to the default rather than failing.
 *
 * The user is told about it in Settings, where the saved device is compared
 * against the live list. That is the place they would go to fix it, and it needs
 * no extra channel out of this window. Only a genuinely missing device is
 * retried: a permission denial must surface as itself, not be masked.
 */
async function openMicrophone(microphoneId) {
  if (!microphoneId) {
    return navigator.mediaDevices.getUserMedia({ audio: true });
  }

  try {
    return await navigator.mediaDevices.getUserMedia({ audio: { deviceId: { exact: microphoneId } } });
  } catch (error) {
    const isMissingDevice = error?.name === "NotFoundError" || error?.name === "OverconstrainedError";
    if (!isMissingDevice) {
      throw error;
    }

    return navigator.mediaDevices.getUserMedia({ audio: true });
  }
}

window.recorderBridge.onListDevices(async () => {
  try {
    const devices = await navigator.mediaDevices.enumerateDevices();
    await window.recorderBridge.devicesListed({
      devices: devices
        .filter((device) => device.kind === "audioinput" && device.deviceId)
        .map((device) => ({ deviceId: device.deviceId, label: device.label || "Microphone" })),
    });
  } catch {
    // An empty list degrades Settings to "system default", which is the
    // behaviour that existed before a picker was offered.
    await window.recorderBridge.devicesListed({ devices: [] });
  }
});

/**
 * Opening a microphone for the first time after launch was measured at 1,646ms
 * on a real machine, against 18-23ms once warm. A press shorter than that
 * captured no audio at all, so the first dictation of every run came back
 * empty. Opening a stream here and dropping it immediately leaves the device
 * initialised, and the first real recording starts as fast as every later one.
 *
 * The tracks are stopped straight away, so no in-use indicator stays lit.
 * Failure is swallowed on purpose: this is an optimisation, and the real open
 * is what should report a real microphone problem.
 */
window.recorderBridge.onPrewarm(async (_event, payload) => {
  try {
    const stream = await openMicrophone(payload?.microphoneId || "");
    for (const track of stream.getTracks()) {
      track.stop();
    }
  } catch {
    // Deliberately silent. The next recording surfaces anything that matters.
  }
});
