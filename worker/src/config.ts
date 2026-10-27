import sourcesJson from "../../shared/sources.json";
import brandsJson from "../../shared/brands.json";
import type { Env, SourceDef } from "./types";

export const SOURCES: SourceDef[] = (sourcesJson.sources as SourceDef[]).map((s) => ({
  ...s,
  enabled: s.enabled ?? sourcesJson.defaults.enabled,
}));

/** User-Agent 프리셋. 모두 봇임을 밝히고 연락처 URL을 포함한다(브라우저 위장 금지, 출처 정책). */
export const UA_PRESETS: Record<string, string> = {
  feed: "Mozilla/5.0 (compatible; HotdealHubFeedFetcher/0.1; +https://hotdeal-hub.pages.dev/about/)",
};
export function userAgent(env: Env, preset?: string): string {
  return (preset && UA_PRESETS[preset]) || env.USER_AGENT;
}

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

/** Worker Cron이 직접 가져올 소스 = 활성 소스 중 relay_only 가 아닌 것 */
export function cronSources(env: Env): SourceDef[] {
  return enabledSources(env).filter((s) => !s.relay_only);
}

/** 중계 수집기가 담당하는 소스 */
export function relaySources(): SourceDef[] {
  return SOURCES.filter((s) => s.enabled !== false && s.relay_only);
}
