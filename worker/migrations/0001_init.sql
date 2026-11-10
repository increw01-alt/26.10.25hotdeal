-- 핫딜 허브 D1 스키마 (D-01, D-02, D-12)
-- 적용: npm run db:migrate:local  /  npm run db:migrate:remote

CREATE TABLE IF NOT EXISTS deals (
  id            TEXT PRIMARY KEY,            -- dedupe_key의 sha1 앞 16자
  dedupe_key    TEXT NOT NULL UNIQUE,        -- brand|merchant|face_value|sale_price|YYYY-Www
  iso_week      TEXT NOT NULL,               -- 2026-W44
  brand         TEXT NOT NULL,               -- brands.json slug
  merchant      TEXT,                        -- merchants slug (없으면 NULL)
  category      TEXT NOT NULL DEFAULT 'gift',
  title         TEXT NOT NULL,               -- 대표 제목(최초 수집 글)
  face_value    INTEGER,                     -- 액면가(원)
  sale_price    INTEGER,                     -- 판매가(원)
  discount_rate REAL,                        -- (1 - sale/face) * 100
  -- 상테크 1급 필드 (D-01)
  card_issuers  TEXT NOT NULL DEFAULT '[]',  -- JSON 배열 ["shinhan"]
  card_benefit  TEXT,                        -- 원문 조건 요약 "신한카드 10% 즉시할인"
  limit_per_person TEXT,                     -- "1인 3매", "월 10만원"
  payment_note  TEXT,                        -- 결제 조건(간편결제, 무이자 등)
  valid_until   TEXT,                        -- 딜 종료 예정(있으면)
  -- 시세 비교 (D-01)
  buy_rate      REAL,                        -- 수집 시점 매입 시세(%)
  rate_gap      REAL,                        -- buy_rate - sale/face*100 (%p)
  rate_source   TEXT,                        -- 시세 출처명
  -- 제휴 (D-05, 기본 미사용)
  deal_url      TEXT NOT NULL,               -- 판매처 원본 URL(커뮤니티 글 본문 링크 또는 글 URL)
  affiliate_url TEXT,
  is_affiliate  INTEGER NOT NULL DEFAULT 0,
  -- 상태
  status        TEXT NOT NULL DEFAULT 'live', -- live | ending | ended
  score         REAL NOT NULL DEFAULT 0,
  votes_total   INTEGER NOT NULL DEFAULT 0,
  comments_total INTEGER NOT NULL DEFAULT 0,
  first_seen    TEXT NOT NULL,               -- ISO8601 UTC
  last_seen     TEXT NOT NULL,
  ended_at      TEXT,
  parse_method  TEXT NOT NULL DEFAULT 'regex', -- regex | llm | manual
  created_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  updated_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);
CREATE INDEX IF NOT EXISTS idx_deals_status_score ON deals(status, score DESC);
CREATE INDEX IF NOT EXISTS idx_deals_brand_week ON deals(brand, iso_week);
CREATE INDEX IF NOT EXISTS idx_deals_week ON deals(iso_week);
CREATE INDEX IF NOT EXISTS idx_deals_last_seen ON deals(last_seen);

-- 딜 ↔ 커뮤니티 글 (여러 커뮤니티 글이 한 딜로 병합)
CREATE TABLE IF NOT EXISTS deal_posts (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  deal_id     TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  source      TEXT NOT NULL,                 -- sources.json slug
  post_id     TEXT NOT NULL,                 -- 커뮤니티 글 ID
  post_url    TEXT NOT NULL,
  title       TEXT NOT NULL,
  author_hash TEXT,                          -- 작성자 식별 해시(원문 저장 안 함, 출처 정책)
  posted_at   TEXT,
  votes       INTEGER NOT NULL DEFAULT 0,
  comments    INTEGER NOT NULL DEFAULT 0,
  first_seen  TEXT NOT NULL,
  last_seen   TEXT NOT NULL,
  UNIQUE(source, post_id)
);
CREATE INDEX IF NOT EXISTS idx_posts_deal ON deal_posts(deal_id);
CREATE INDEX IF NOT EXISTS idx_posts_source_seen ON deal_posts(source, first_seen);

-- 일별 가격·시세 이력 (일 단위 비교, D-02)
CREATE TABLE IF NOT EXISTS deal_prices (
  deal_id    TEXT NOT NULL REFERENCES deals(id) ON DELETE CASCADE,
  date       TEXT NOT NULL,                  -- YYYY-MM-DD (KST)
  sale_price INTEGER,
  buy_rate   REAL,
  votes      INTEGER NOT NULL DEFAULT 0,
  comments   INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (deal_id, date)
);

-- 소스 상태 (서킷 브레이커, D-03)
CREATE TABLE IF NOT EXISTS source_state (
  source          TEXT PRIMARY KEY,
  consecutive_fail INTEGER NOT NULL DEFAULT 0,
  paused_until    TEXT,
  last_ok_at      TEXT,
  last_error      TEXT,
  last_item_count INTEGER NOT NULL DEFAULT 0,
  median_votes_7d REAL NOT NULL DEFAULT 1,   -- 점수 정규화(D-10)
  median_comments_7d REAL NOT NULL DEFAULT 1,
  updated_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
);

-- 실행 스냅샷 (수집 급감 가드, D-03)
CREATE TABLE IF NOT EXISTS run_log (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  ran_at       TEXT NOT NULL,
  active_deals INTEGER NOT NULL,
  new_deals    INTEGER NOT NULL DEFAULT 0,
  fetched      INTEGER NOT NULL DEFAULT 0,
  parsed       INTEGER NOT NULL DEFAULT 0,
  guard_tripped INTEGER NOT NULL DEFAULT 0,
  note         TEXT
);
CREATE INDEX IF NOT EXISTS idx_run_log_ran ON run_log(ran_at DESC);

-- 제외 목록 (D-12: 게시글 ID·소스·반영일만 저장, 요청자 정보 없음)
CREATE TABLE IF NOT EXISTS blocklist (
  source     TEXT NOT NULL,
  post_id    TEXT NOT NULL,
  applied_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  PRIMARY KEY (source, post_id)
);

-- 파싱 실패 큐 (정규식 실패 건, LLM 보조 파싱 대상 D-15)
CREATE TABLE IF NOT EXISTS parse_queue (
  id        INTEGER PRIMARY KEY AUTOINCREMENT,
  source    TEXT NOT NULL,
  post_id   TEXT NOT NULL,
  post_url  TEXT NOT NULL,
  title     TEXT NOT NULL,
  reason    TEXT,
  queued_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
  resolved  INTEGER NOT NULL DEFAULT 0,
  UNIQUE(source, post_id)
);

-- 중계 수집기 상태: 최근 10분 내 중계가 들어온 소스는 Cron이 직접 가져오지 않는다 (Worker IP 차단 소스용)
CREATE TABLE IF NOT EXISTS relay_state (
  source   TEXT PRIMARY KEY,
  last_at  TEXT NOT NULL,
  host     TEXT
);
