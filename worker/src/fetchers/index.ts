import type { Env, RawPost, SourceDef } from "../types";
import { fetchRss } from "./rss";
import { fetchQuasarzone } from "./quasarzone";
import { fetchClien } from "./clien";
import { fetchFmkorea } from "./fmkorea";

const HTML_FETCHERS: Record<string, (env: Env, src: SourceDef) => Promise<RawPost[]>> = {
  clien: fetchClien,
  quasarzone: fetchQuasarzone,
  fmkorea: fetchFmkorea,
};

export async function fetchSource(env: Env, src: SourceDef): Promise<RawPost[]> {
  if (src.type === "rss") return fetchRss(env, src);
  const f = HTML_FETCHERS[src.slug];
  if (!f) throw new Error(`no fetcher for ${src.slug}`);
  return f(env, src);
}
