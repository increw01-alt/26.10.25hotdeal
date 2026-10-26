/** ISO 8601 주차 (KST 기준). 예: 2026-W44 (D-02) */
export function isoWeekKST(date: Date = new Date()): string {
  const kst = new Date(date.getTime() + 9 * 60 * 60 * 1000);
  const d = new Date(Date.UTC(kst.getUTCFullYear(), kst.getUTCMonth(), kst.getUTCDate()));
  const day = d.getUTCDay() || 7; // 월=1 … 일=7
  d.setUTCDate(d.getUTCDate() + 4 - day); // 목요일로 이동
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** KST 날짜 문자열 YYYY-MM-DD */
export function dateKST(date: Date = new Date()): string {
  return new Date(date.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

export function dedupeKey(p: {
  brand: string; merchant: string | null; faceValue: number | null; salePrice: number | null;
}, isoWeek: string): string {
  return [p.brand, p.merchant ?? "-", p.faceValue ?? "-", p.salePrice ?? "-", isoWeek].join("|");
}

/** dedupe_key → 안정적인 짧은 ID (SHA-1 앞 16 hex) */
export async function dealId(key: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(key));
  return [...new Uint8Array(buf)].slice(0, 8).map((b) => b.toString(16).padStart(2, "0")).join("");
}

export async function sha1(text: string): Promise<string> {
  const buf = await crypto.subtle.digest("SHA-1", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
