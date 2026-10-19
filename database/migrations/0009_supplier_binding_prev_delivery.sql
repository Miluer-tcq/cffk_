-- 供应商绑定记录关联前的本地发货方式，取消关联时恢复
ALTER TABLE "supplierBinding" ADD COLUMN "previousFulfillmentSource" TEXT;
ALTER TABLE "supplierBinding" ADD COLUMN "previousDeliveryType" TEXT;
