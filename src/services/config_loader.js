'use strict';

const fs = require('fs');
const path = require('path');

const CONFIG_PATH = path.join(__dirname, '../../data/config_full.json');
const WARN_INTERVAL_MS = 5_000;

let cachedConfig = null;
let cachedMtimeMs = -1;
let lastWarnAt = 0;

function getConfigData() {
  try {
    const stat = fs.statSync(CONFIG_PATH);
    const mtimeMs = stat.mtimeMs;

    if (cachedConfig && cachedMtimeMs === mtimeMs) {
      return cachedConfig;
    }

    const raw = fs.readFileSync(CONFIG_PATH, 'utf8');
    const parsed = JSON.parse(raw);

    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      throw new Error('config_full.json must contain a JSON object at root');
    }

    cachedConfig = parsed;
    cachedMtimeMs = mtimeMs;
    return cachedConfig;
  } catch (err) {
    if (cachedConfig) {
      const now = Date.now();
      if (now - lastWarnAt > WARN_INTERVAL_MS) {
        lastWarnAt = now;
        console.warn(`[config-loader] using cached config after read error: ${err.message}`);
      }
      return cachedConfig;
    }

    throw err;
  }
}

module.exports = { getConfigData };