-- 供应商账号汇率：1 上游币种 = X 人民币，用于导入定价时把上游成本换算成人民币
ALTER TABLE "supplierAccount" ADD COLUMN "exchangeRateToCny" TEXT NOT NULL DEFAULT '1';
