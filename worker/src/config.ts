import sourcesJson from "../../shared/sources.json";
import brandsJson from "../../shared/brands.json";
import type { Env, SourceDef } from "./types";

export const SOURCES: SourceDef[] = (sourcesJson.sources as SourceDef[]).map((s) => ({
  ...s,
  enabled: s.enabled ?? sourcesJson.defaults.enabled,
}));

export const DEFAULT_TIMEOUT_MS: number = Number(sourcesJson.defaults.fetch_timeout_ms) || 20000;

export const BRANDS = brandsJson.brands as Array<{
  slug: string; name: string; aliases: string[]; face_values: number[]; rates_key: string | null; category: string;
}>;
export const MERCHANTS = brandsJson.merchants as Array<{ slug: string; name: string; aliases: string[] }>;
export const CARD_ISSUERS = brandsJson.card_issuers as Array<{ slug: string; name: string; aliases: string[] }>;

export function num(env: Env, key: keyof Env, fallback: number): number {
  const v = Number(env[key]);
  return Number.isFinite(v) ? v : fallback;
}

/** 활성 소스: sources.json의 enabled 기준. 환경변수 DISABLED_SOURCES="a,b"로 배포 없이 끌 수 있다. */
export function enabledSources(env: Env): SourceDef[] {
  const disabled = new Set((env.DISABLED_SOURCES ?? "").split(",").map((x) => x.trim()).filter(Boolean));
  return SOURCES.filter((s) => s.enabled !== false && !disabled.has(s.slug));
}
