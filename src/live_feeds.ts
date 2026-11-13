import { sanitizePlainText } from "./security";
import type { LiveFeedKind, LiveFeedReading, LiveFeedSpec } from "./types";

const FEED_KINDS: Record<LiveFeedKind, true> = {
  weather: true,
  surf: true,
  wind: true,
  time: true,
  moon: true,
  iss: true,
};

const DEFAULT_PLACE = "Sydney";
const DEFAULT_LAT = -33.8688;
const DEFAULT_LON = 151.2093;
const DEFAULT_SURF_PLACE = "Bondi";
const DEFAULT_SURF_LAT = -33.8915;
const DEFAULT_SURF_LON = 151.2767;
const DEFAULT_TZ = "Australia/Sydney";

const CACHE_TTL_MS = 5 * 60 * 1000;
const feedCache = new Map<string, { exp: number; data: LiveFeedReading }>();

const clamp = (v: number, lo: number, hi: number): number =>
  !Number.isFinite(v) ? lo : v < lo ? lo : v > hi ? hi : v;

export function sanitizeLiveFeed(raw: unknown): LiveFeedSpec | null {
  if (!raw || typeof raw !== "object") return null;
  const rec = raw as Record<string, unknown>;
  const kindStr = typeof rec.kind === "string" ? rec.kind.trim().toLowerCase() : "";
  if (!FEED_KINDS[kindStr as LiveFeedKind]) return null;
  const kind = kindStr as LiveFeedKind;

  const place =
    sanitizePlainText(rec.place, 24, true) ||
    (kind === "surf" ? DEFAULT_SURF_PLACE : DEFAULT_PLACE);

  const defLat = kind === "surf" ? DEFAULT_SURF_LAT : DEFAULT_LAT;
  const defLon = kind === "surf" ? DEFAULT_SURF_LON : DEFAULT_LON;
  const latNum = Number(rec.lat);
  const lonNum = Number(rec.lon);
  const lat = Number.isFinite(latNum) ? Number(clamp(latNum, -85, 85).toFixed(3)) : defLat;
  const lon = Number.isFinite(lonNum) ? Number(clamp(lonNum, -180, 180).toFixed(3)) : defLon;

  let timezone = DEFAULT_TZ;
  if (typeof rec.timezone === "string" && rec.timezone.trim()) {
    const cand = rec.timezone.trim().slice(0, 40);
    try {
      Intl.DateTimeFormat("en-GB", { timeZone: cand });
      timezone = cand;
    } catch {
      timezone = DEFAULT_TZ;
    }
  }

  return {
    kind,
    place,
    lat,
    lon,
    ...(kind === "time" ? { timezone } : {}),
  };
}

function wmoToWord(code: number): string {
  if (code === 0) return "Clear";
  if (code === 1 || code === 2) return "Fair";
  if (code === 3) return "Cloudy";
  if (code >= 45 && code <= 48) return "Misty";
  if (code >= 51 && code <= 67) return "Rain";
  if (code >= 71 && code <= 77) return "Snow";
  if (code >= 80 && code <= 82) return "Showers";
  if (code >= 95) return "Storm";
  return "Mild";
}

function degToCardinal(deg: number): string {
  const dirs = ["N", "NE", "E", "SE", "S", "SW", "W", "NW"];
  const idx = Math.round((((deg % 360) + 360) % 360) / 45) % 8;
  return dirs[idx];
}

function computeMoonReading(now: number): LiveFeedReading {
  const synodicDays = 29.53058867;
  const knownNewMoonMs = Date.UTC(2000, 0, 6, 18, 14, 0);
  const daysSince = (now - knownNewMoonMs) / 86_400_000;
  const phase = ((daysSince % synodicDays) + synodicDays) % synodicDays / synodicDays;
  const illum = Math.round(0.5 * (1 - Math.cos(phase * Math.PI * 2)) * 100);
  let label = "New Moon";
  if (phase < 0.04 || phase > 0.96) label = "New Moon";
  else if (phase < 0.22) label = "Waxing Crescent";
  else if (phase < 0.28) label = "First Quarter";
  else if (phase < 0.46) label = "Waxing Gibbous";
  else if (phase < 0.54) label = "Full Moon";
  else if (phase < 0.72) label = "Waning Gibbous";
  else if (phase < 0.78) label = "Last Quarter";
  else label = "Waning Crescent";

  const shortWord = label.split(" ")[0];
  return {
    kind: "moon",
    badge: `${shortWord} · ${illum}%`,
    summary: `Moon · ${label} (${illum}% lit)`,
    value: illum,
    updatedAt: now,
  };
}

function computeTimeReading(spec: LiveFeedSpec, now: number): LiveFeedReading {
  const tz = spec.timezone || DEFAULT_TZ;
  const place = spec.place || "Meadow";
  let hhmm = "12:00";
  try {
    hhmm = new Intl.DateTimeFormat("en-GB", {
      hour: "2-digit",
      minute: "2-digit",
      hour12: false,
      timeZone: tz,
    }).format(new Date(now));
  } catch {
    const d = new Date(now);
    hhmm = `${String(d.getUTCHours()).padStart(2, "0")}:${String(d.getUTCMinutes()).padStart(2, "0")}`;
  }
  return {
    kind: "time",
    badge: `${hhmm} · ${place}`,
    summary: `${place} Time · ${hhmm}`,
    updatedAt: now,
  };
}

async function fetchSingleFeed(spec: LiveFeedSpec): Promise<LiveFeedReading> {
  const now = Date.now();
  if (spec.kind === "time") return computeTimeReading(spec, now);
  if (spec.kind === "moon") return computeMoonReading(now);

  const lat = spec.lat ?? (spec.kind === "surf" ? DEFAULT_SURF_LAT : DEFAULT_LAT);
  const lon = spec.lon ?? (spec.kind === "surf" ? DEFAULT_SURF_LON : DEFAULT_LON);
  const place = spec.place || (spec.kind === "surf" ? DEFAULT_SURF_PLACE : DEFAULT_PLACE);
  const cacheKey = `${spec.kind}:${lat.toFixed(2)},${lon.toFixed(2)}:${place}`;

  const hit = feedCache.get(cacheKey);
  if (hit && hit.exp > now) {
    return hit.data;
  }

  let reading: LiveFeedReading;
  try {
    if (spec.kind === "surf") {
      const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height,wave_period,wave_direction`;
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) throw new Error(`Marine HTTP ${res.status}`);
      const data = (await res.json()) as {
        current?: { wave_height?: number; wave_period?: number; wave_direction?: number };
      };
      const h = Number(data.current?.wave_height ?? 1.1);
      const p = Math.round(Number(data.current?.wave_period ?? 8));
      const dir = degToCardinal(Number(data.current?.wave_direction ?? 135));
      reading = {
        kind: "surf",
        badge: `${h.toFixed(1)}m @ ${p}s`,
        summary: `${place} Surf · ${h.toFixed(1)}m swell @ ${p}s (${dir})`,
        value: h,
        updatedAt: now,
      };
    } else if (spec.kind === "wind") {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=wind_speed_10m,wind_direction_10m`;
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) throw new Error(`Wind HTTP ${res.status}`);
      const data = (await res.json()) as {
        current?: { wind_speed_10m?: number; wind_direction_10m?: number };
      };
      const spd = Math.round(Number(data.current?.wind_speed_10m ?? 14));
      const dir = degToCardinal(Number(data.current?.wind_direction_10m ?? 45));
      reading = {
        kind: "wind",
        badge: `${spd} km/h ${dir}`,
        summary: `${place} Wind · ${spd} km/h ${dir}`,
        value: spd,
        updatedAt: now,
      };
    } else if (spec.kind === "iss") {
      const res = await fetch("https://api.wheretheiss.at/v1/satellites/25544", {
        signal: AbortSignal.timeout(2500),
      });
      if (!res.ok) throw new Error(`ISS HTTP ${res.status}`);
      const data = (await res.json()) as { latitude?: number; longitude?: number };
      const ilat = Number(data.latitude ?? 0);
      const ilon = Number(data.longitude ?? 0);
      const ns = ilat >= 0 ? "N" : "S";
      const ew = ilon >= 0 ? "E" : "W";
      reading = {
        kind: "iss",
        badge: `ISS ${Math.abs(ilat).toFixed(0)}°${ns} ${Math.abs(ilon).toFixed(0)}°${ew}`,
        summary: `ISS Overhead · ${Math.abs(ilat).toFixed(1)}°${ns}, ${Math.abs(ilon).toFixed(1)}°${ew}`,
        updatedAt: now,
      };
    } else {
      const url = `https://api.open-meteo.com/v1/forecast?latitude=${lat}&longitude=${lon}&current=temperature_2m,weather_code,wind_speed_10m`;
      const res = await fetch(url, { signal: AbortSignal.timeout(2500) });
      if (!res.ok) throw new Error(`Weather HTTP ${res.status}`);
      const data = (await res.json()) as {
        current?: { temperature_2m?: number; weather_code?: number; wind_speed_10m?: number };
      };
      const temp = Math.round(Number(data.current?.temperature_2m ?? 21));
      const cond = wmoToWord(Number(data.current?.weather_code ?? 1));
      const wind = Math.round(Number(data.current?.wind_speed_10m ?? 12));
      reading = {
        kind: "weather",
        badge: `${temp}°C · ${cond}`,
        summary: `${place} Weather · ${temp}°C, ${cond} (${wind} km/h wind)`,
        value: temp,
        updatedAt: now,
      };
    }
    if (feedCache.size >= 128) {
      const oldestKey = feedCache.keys().next().value;
      if (oldestKey) feedCache.delete(oldestKey);
    }
    feedCache.set(cacheKey, { exp: now + CACHE_TTL_MS, data: reading });
    return reading;
  } catch {
    if (spec.kind === "surf") {
      return { kind: "surf", badge: "1.1m @ 8s", summary: `${place} Surf · 1.1m @ 8s`, value: 1.1, updatedAt: now };
    }
    if (spec.kind === "wind") {
      return { kind: "wind", badge: "14 km/h NE", summary: `${place} Wind · 14 km/h NE`, value: 14, updatedAt: now };
    }
    if (spec.kind === "iss") {
      return { kind: "iss", badge: "ISS · In Orbit", summary: "ISS · 408 km orbit", updatedAt: now };
    }
    return { kind: "weather", badge: "21°C · Fair", summary: `${place} Weather · 21°C, Fair`, value: 21, updatedAt: now };
  }
}

export async function resolveWorldLiveFeeds(
  creations: readonly {
    id: string;
    liveFeed?: LiveFeedSpec | null;
    blueprint?: { liveFeed?: LiveFeedSpec | null };
  }[],
): Promise<Record<string, LiveFeedReading>> {
  const out: Record<string, LiveFeedReading> = {};
  const tasks: Promise<void>[] = [];

  for (const c of creations) {
    const spec = c.liveFeed || c.blueprint?.liveFeed;
    if (!spec) continue;
    tasks.push(
      fetchSingleFeed(spec).then((r) => {
        out[c.id] = r;
      }),
    );
  }

  await Promise.all(tasks);
  return out;
}
