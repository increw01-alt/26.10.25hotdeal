import type { Env, RatesMap } from "./types";
import { fetchText } from "./fetchers/http";
import { BRANDS } from "./config";

/**
 * 외부 시세(모두의시세 rates.json) 로드. 비활성화 또는 실패 시 빈 맵.
 * 응답 형식은 엔드포인트 확정 후 normalizeRates()만 고치면 된다.
 */
export async function loadRates(env: Env): Promise<RatesMap> {
  if (env.RATES_ENABLED !== "true" || !env.RATES_JSON_URL || env.RATES_JSON_URL.includes("REPLACE_")) return {};
  try {
    const raw = JSON.parse(await fetchText(env, env.RATES_JSON_URL, "application/json"));
    return normalizeRates(raw);
  } catch (e) {
    console.error("[rates] load failed", (e as Error).message);
    return {};
  }
}

export function normalizeRates(raw: unknown): RatesMap {
  const out: RatesMap = {};
  if (!raw || typeof raw !== "object") return out;
  const obj = raw as Record<string, unknown>;
  const entries: Array<Record<string, unknown>> = Array.isArray(obj.rates)
    ? (obj.rates as Array<Record<string, unknown>>)
    : Object.entries(obj).map(([k, v]) => ({ key: k, ...(typeof v === "object" && v ? (v as Record<string, unknown>) : { rate: v }) }));
  for (const e of entries) {
    const key = String(e.key ?? e.slug ?? e.brand ?? "");
    const rate = Number(e.buy_rate ?? e.buyRate ?? e.rate);
    if (key && Number.isFinite(rate)) out[key] = { buy_rate: rate, updated_at: e.updated_at as string | undefined };
  }
  return out;
}

export function rateForBrand(rates: RatesMap, brandSlug: string): number | null {
  const b = BRANDS.find((x) => x.slug === brandSlug);
  if (!b?.rates_key) return null;
  return rates[b.rates_key]?.buy_rate ?? null;
}
