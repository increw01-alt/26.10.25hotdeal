import type { Env } from "./types";

/** 운영 알림. 실패해도 예외를 던지지 않는다 (D-03). */
export async function notifyOps(env: Env, text: string): Promise<void> {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) {
    console.warn("[notify] telegram not configured:", text);
    return;
  }
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: env.TELEGRAM_CHAT_ID, text: `[${env.SITE_NAME}] ${text}`, disable_web_page_preview: true }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) console.error("[notify] telegram HTTP", res.status);
  } catch (e) {
    console.error("[notify] failed", (e as Error).message);
  }
}
