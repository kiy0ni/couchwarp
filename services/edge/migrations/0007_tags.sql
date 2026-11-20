-- A number after the name, as in Kiyo#482913. Name and number together let people add
-- each other as friends, without a search that would list everyone.
ALTER TABLE users ADD COLUMN tag INTEGER;
-- Existing accounts: 7919 is prime and does not divide 900000, so no two rows collide.
UPDATE users SET tag = 100000 + (rowid * 7919) % 900000;
CREATE UNIQUE INDEX users_by_tag ON users(tag);
