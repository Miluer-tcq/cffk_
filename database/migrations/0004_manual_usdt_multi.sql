DROP INDEX IF EXISTS `paymentProvider_provider_unique`;--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS `paymentProvider_name_unique` ON `paymentProvider` (`name`);