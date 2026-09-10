/**
 * Live network reachability.
 *
 * WHY THIS EXISTS. A dropped wifi connection and a slow provider produce the
 * identical symptom: a socket that hangs until our timeout fires. Without a
 * separate signal we told a user with their wifi off that "Groq is temporarily
 * unavailable", sending them to check a status page instead of their own
 * network. Wrong diagnosis, wasted minutes, and it makes the app look like it is
 * blaming someone else for a local problem.
 *
 * Deliberately cheap: Electron already tracks this, so there is no polling, no
 * timer, and no probe request of our own.
 */

import { net } from "../electron.js";
import { logger } from "./app-logger.js";

/**
 * Defaults to online.
 *
 * The very first request can land before anything has been checked, and
 * "offline" is the more damaging thing to be wrong about: it tells the user to
 * go fix a network that was never broken.
 */
let online = true;
let started = false;

/**
 * Electron exposes reachability as `net.online`, with `net.isOnline()` on older
 * versions. Neither exists outside Electron, which is where the unit tests run.
 * Any of those cases means "we cannot tell", and we answer optimistically rather
 * than blaming the network on missing API surface.
 */
function readPlatformOnline(): boolean {
  try {
    const netModule = net as unknown as { online?: boolean; isOnline?: () => boolean } | undefined;
    if (typeof netModule?.online === "boolean") {
      return netModule.online;
    }

    if (typeof netModule?.isOnline === "function") {
      return netModule.isOnline();
    }
  } catch {
    // Falls through to the optimistic default below.
  }

  return true;
}

/** Reads reachability once at startup. Idempotent. */
export function startNetworkMonitor(): void {
  if (started) {
    return;
  }

  started = true;
  online = readPlatformOnline();
  void logger.info("network.monitor.started", { online });
}

/**
 * Current reachability.
 *
 * Re-read on every call rather than cached from an event, because this is
 * consulted once per failed request — a handful of times a day — and a stale
 * cached value is the specific bug this module exists to prevent.
 */
export function isOnline(): boolean {
  if (!started) {
    return true;
  }

  online = readPlatformOnline();
  return online;
}
