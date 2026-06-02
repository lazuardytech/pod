import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { warn } from "@/sse/utils/logger.js";

const APP_NAME = "pod";

function defaultDir() {
  if (process.platform === "win32") {
    return path.join(
      /*turbopackIgnore: true*/ process.env.APPDATA ||
        path.join(/*turbopackIgnore: true*/ os.homedir(), "AppData", "Roaming"),
      APP_NAME,
    );
  }
  return path.join(/*turbopackIgnore: true*/ os.homedir(), `.${APP_NAME}`);
}

export function getDataDir() {
  const configured = process.env.DATA_DIR;
  if (!configured) return defaultDir();
  try {
    fs.mkdirSync(/*turbopackIgnore: true*/ configured, { recursive: true });
    return configured;
  } catch (e) {
    if (e?.code === "EACCES" || e?.code === "EPERM") {
      warn("DATA_DIR", `'${configured}' not writable, falling back to ~/.${APP_NAME}`);
      return defaultDir();
    }
    throw e;
  }
}

export const DATA_DIR = getDataDir();
