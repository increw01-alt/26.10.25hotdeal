import sourcesJson from "../../shared/sources.json";
import brandsJson from "../../shared/brands.json";
import type { Env, SourceDef } from "./types";

export const SOURCES: SourceDef[] = (sourcesJson.sources as SourceDef[]).map((s) => ({
  ...s,
  enabled: s.enabled ?? sourcesJson.defaults.enabled,
}));

export const BRANDS = brandsJson.brands as Array<{
  slug: string; name: string; aliases: string[]; face_values: number[]; rates_key: string | null; category: string;
}>;
export const MERCHANTS = brandsJson.merchants as Array<{ slug: string; name: string; aliases: string[] }>;
export const CARD_ISSUERS = brandsJson.card_issuers as Array<{ slug: string; name: string; aliases: string[] }>;

export function num(env: Env, key: keyof Env, fallback: number): number {
  const v = Number(env[key]);
  return Number.isFinite(v) ? v : fallback;
}

export function enabledSources(env: Env): SourceDef[] {
  return SOURCES.filter((s) => {
    if (s.slug === "fmkorea") return env.ENABLE_FMKOREA === "true";
    return s.enabled !== false;
  });
}
