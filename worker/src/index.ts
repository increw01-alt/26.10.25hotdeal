import type { Env } from "./types";
import { handleApi } from "./api";
import { runCollection } from "./collect";
import { maybeDispatchRelay } from "./dispatch";

export default {
  /** 공개 피드 API */
  async fetch(req: Request, env: Env): Promise<Response> {
    return handleApi(req, env);
  },

  /** 1분 Cron 수집 (wrangler.toml [triggers]) */
  async scheduled(_controller: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    ctx.waitUntil((async () => {
      const started = Date.now();
      try {
        const s = await runCollection(env);
        console.log(`[collect] fetched=${s.fetched} parsed=${s.parsed} new=${s.newDeals} active=${s.activeDeals} guard=${s.guardTripped} errors=${s.errors.length} ${Date.now() - started}ms`);
        const d = await maybeDispatchRelay(env);
        if (d.dispatched || !/no token|relay fresh|cooldown/.test(d.reason)) console.log(`[dispatch] ${d.reason}`);
      } catch (e) {
        console.error("[collect] fatal", (e as Error).stack ?? (e as Error).message);
      }
    })());
  },
} satisfies ExportedHandler<Env>;
