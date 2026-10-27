/** Worker 환경 바인딩 (wrangler.toml의 vars/secrets/d1과 일치) */
export interface Env {
  DB: D1Database;
  SITE_NAME: string;
  SITE_URL: string;
  RATES_ENABLED: string;
  RATES_JSON_URL: string;
  RATES_SOURCE_NAME: string;
  GUARD_MIN_ACTIVE_RATIO: string;
  GUARD_STALE_HOURS: string;
  CB_FAIL_THRESHOLD: string;
  CB_COOLDOWN_MIN: string;
  FEED_CACHE_SECONDS: string;
  FETCH_TIMEOUT_MS: string;
  USER_AGENT: string;
  DISABLED_SOURCES?: string;
  DEV_INGEST?: string;
  ADMIN_TOKEN?: string; // secret: 관리용 엔드포인트(/__admin/*)
  // secrets (wrangler secret put ...)
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

/** 커뮤니티에서 수집한 원본 글 (최소 필드만, 본문 비저장) */
export interface RawPost {
  source: string;
  postId: string;
  url: string;
  title: string;
  postedAt?: string; // ISO8601
  votes?: number;
  comments?: number;
  category?: string; // 소스가 제공하는 카테고리 라벨(있으면)
}

/** 제목 파싱 결과 */
export interface ParsedDeal {
  brand: string;            // brands.json slug
  brandName: string;
  category: string;
  merchant: string | null;  // merchants slug
  faceValue: number | null;
  salePrice: number | null;
  discountRate: number | null;
  cardIssuers: string[];
  cardBenefit: string | null;
  limitPerPerson: string | null;
  paymentNote: string | null;
  confidence: number;       // 0~1
}

export interface SourceDef {
  slug: string;
  name: string;
  tier: number;
  type: "rss" | "html";
  url: string;
  board_url: string;
  enabled?: boolean;
  notes?: string;
  ua?: "bot" | "feed";
  headers?: Record<string, string>;
}

export interface RatesMap {
  [brandKey: string]: { buy_rate: number; updated_at?: string };
}
