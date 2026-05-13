import path from "node:path";
import { FileLogSink, Logger, type LogLevel } from "./logger.js";

export const logger = new Logger();

export function configureLogger(userDataPath: string, level: LogLevel = "info"): string {
  const logDir = path.join(userDataPath, "logs");
  logger.configure([new FileLogSink(logDir)], level);
  return logDir;
}
