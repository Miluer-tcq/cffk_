-- 稳定币唯一付款金额与交易哈希去重
ALTER TABLE "order" ADD COLUMN "paymentTokenAmount" REAL;
ALTER TABLE "order" ADD COLUMN "paymentTxHash" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "order_payment_tx_hash_unique" ON "order" ("paymentTxHash") WHERE "paymentTxHash" IS NOT NULL;
