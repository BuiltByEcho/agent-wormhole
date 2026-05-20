const DURATION_RE = /^(\d+)(ms|s|m|h|d)$/i;

export function parseDuration(value, fallbackMs = 10 * 60 * 1000) {
  if (value == null || value === "") return fallbackMs;
  if (typeof value === "number" && Number.isFinite(value) && value > 0) return value;

  const text = String(value).trim();
  const match = DURATION_RE.exec(text);
  if (!match) {
    throw new Error(`Invalid duration "${value}". Use formats like 30s, 10m, 2h, or 1d.`);
  }

  const amount = Number(match[1]);
  const unit = match[2].toLowerCase();
  const multipliers = {
    ms: 1,
    s: 1000,
    m: 60 * 1000,
    h: 60 * 60 * 1000,
    d: 24 * 60 * 60 * 1000,
  };

  return amount * multipliers[unit];
}

export function nowIso() {
  return new Date().toISOString();
}

export function addMsIso(ms, now = Date.now()) {
  return new Date(now + ms).toISOString();
}
