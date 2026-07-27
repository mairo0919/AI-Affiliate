import type { LogLevel } from "./types.js";

export interface Logger {
  debug: (message: string) => void;
  info: (message: string) => void;
  warn: (message: string) => void;
  error: (message: string) => void;
}

const levelPriority: Record<LogLevel, number> = {
  debug: 10,
  info: 20,
  warn: 30,
  error: 40,
};

export function createLogger(level: LogLevel = "info"): Logger {
  const min = levelPriority[level];

  const write = (current: LogLevel, message: string): void => {
    if (levelPriority[current] < min) {
      return;
    }

    const line = `[${current}] ${message}`;
    if (current === "error") {
      console.error(line);
      return;
    }
    if (current === "warn") {
      console.warn(line);
      return;
    }
    console.log(line);
  };

  return {
    debug: (message) => write("debug", message),
    info: (message) => write("info", message),
    warn: (message) => write("warn", message),
    error: (message) => write("error", message),
  };
}
