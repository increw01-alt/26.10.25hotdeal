import type { Env, RawPost, SourceDef } from "../types";
import { fetchRss } from "./rss";
import { fetchQuasarzone } from "./quasarzone";

export async function fetchSource(env: Env, src: SourceDef): Promise<RawPost[]> {
  if (src.type === "rss") return fetchRss(env, src);
  if (src.slug === "quasarzone") return fetchQuasarzone(env, src);
  // fmkorea 등 HTML 소스는 차단 여부 확인 후 파서 추가 (D-15)
  throw new Error(`no fetcher for ${src.slug}`);
}
