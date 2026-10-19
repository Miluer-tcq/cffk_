-- no-op 迁移:仅用于补齐 drizzle 快照链。
-- 背景:0008(supplierAccount.exchangeRateToCny)与 0009(supplierBinding.previousFulfillmentSource/previousDeliveryType)
-- 的列已在生产库存在(此前手动执行 SQL 应用),但 meta/ 下缺少 0008/0009 的快照,
-- 导致每次 db:generate 都误判 schema 漂移并重复生成本文件。本文件无实际 DDL,
-- 快照(0010_snapshot.json)才是有效产出;应用到生产库时不产生任何变更。
SELECT 1;
