-- 쇼핑몰 바로가기·상품 이미지 (D-22). 한 번만 적용된다(wrangler d1 migrations).
ALTER TABLE deal_posts ADD COLUMN shop_url TEXT;                          -- 글 페이지에서 뽑은 쇼핑몰 주소
ALTER TABLE deal_posts ADD COLUMN detail_tries INTEGER NOT NULL DEFAULT 0; -- 상세 수집 시도 횟수(2회까지)
ALTER TABLE deals ADD COLUMN shop_url TEXT;                               -- 딜의 쇼핑몰 주소(처음 얻은 값 유지)
ALTER TABLE deals ADD COLUMN image_url TEXT;                              -- 쇼핑몰 상품 페이지의 대표 이미지 주소
CREATE INDEX IF NOT EXISTS idx_posts_detail_pending ON deal_posts(detail_tries, first_seen);
