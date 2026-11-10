-- 일반 핫딜(kind = product) 지원 (D-18, D-19). 한 번만 적용된다(wrangler d1 migrations).
ALTER TABLE deals ADD COLUMN kind TEXT NOT NULL DEFAULT 'gift';   -- gift | product
ALTER TABLE deals ADD COLUMN product_name TEXT;                   -- 일반 딜의 상품명
ALTER TABLE deals ADD COLUMN merchant_raw TEXT;                   -- 판매처 사전에 없을 때의 원문 표기
ALTER TABLE deals ADD COLUMN price_kind TEXT;                     -- exact | descriptive
ALTER TABLE deals ADD COLUMN price_text TEXT;                     -- descriptive일 때의 원문 표기
ALTER TABLE deals ADD COLUMN shipping TEXT;                       -- 정규화한 배송비 표기
ALTER TABLE deals ADD COLUMN product_category TEXT;               -- 이후 단계용(지금은 항상 NULL)
ALTER TABLE deals ADD COLUMN title_tokens TEXT;                   -- 묶기용 정규화 토큰(공백 구분, 정렬됨)
ALTER TABLE deal_posts ADD COLUMN closed INTEGER NOT NULL DEFAULT 0; -- 글 제목에 품절·종료 표시가 붙음
CREATE INDEX IF NOT EXISTS idx_deals_kind_status_score ON deals(kind, status, score DESC);
CREATE INDEX IF NOT EXISTS idx_deals_kind_week_merchant_price ON deals(kind, iso_week, merchant, sale_price);
-- 최근 7일 추천·댓글 중앙값 계산(loadMedians)이 deal_posts 전체를 읽지 않게
CREATE INDEX IF NOT EXISTS idx_posts_first_seen ON deal_posts(first_seen);
