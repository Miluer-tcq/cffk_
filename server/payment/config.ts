import { and, asc, desc, eq } from "drizzle-orm";
import { createDrizzleDb } from "@/database/drizzle";
import { paymentProvider } from "@/database/drizzle/schema";
import { appError } from "@/lib/app-error";
import { getProviderDefinition, parseProviderConfig, type PaymentChannel, type PaymentProviderKind } from "./registry";

export type { PaymentProviderKind } from "./registry";

export type PublicPaymentProvider = {
  id: number;
  provider: PaymentProviderKind;
  name: string;
  channels: PaymentChannel[];
  configStatus: "valid" | "invalid";
  /** 稳定币收款:启用的链/资产,供前台选择 */
  stablecoinChains?: string[];
  stablecoinAssets?: string[];
};

export type EnabledPaymentProvider = PublicPaymentProvider & {
  configJson: string;
  isEnabled: boolean;
};

export function validatePaymentProviderConfig(provider: PaymentProviderKind, configJson: string) {
  return parseProviderConfig(provider, configJson);
}

export async function getEnabledPaymentProviders(database: D1Database): Promise<PublicPaymentProvider[]> {
  const db = createDrizzleDb(database);
  const records = await db
    .select({ id: paymentProvider.id, provider: paymentProvider.provider, name: paymentProvider.name, configJson: paymentProvider.configJson })
    .from(paymentProvider)
    .where(eq(paymentProvider.isEnabled, true))
    .orderBy(asc(paymentProvider.sort), asc(paymentProvider.id));

  return records.flatMap((record) => {
    try {
      const definition = getProviderDefinition(record.provider);
      if (!definition) return [];
      const config = parseProviderConfig(record.provider, record.configJson);
      const base = { id: record.id, provider: record.provider as PaymentProviderKind, name: record.name, channels: definition.getChannels(config), configStatus: "valid" as const };
      // 稳定币收款:把启用的链/资产暴露给前台做选择器
      if (record.provider === "MANUAL_USDT" && typeof config === "object" && config !== null && "chains" in config) {
        const c = config as { chains?: unknown; assets?: unknown };
        return [{ ...base, stablecoinChains: Array.isArray(c.chains) ? (c.chains as string[]) : [], stablecoinAssets: Array.isArray(c.assets) ? (c.assets as string[]) : [] }];
      }
      return [base];
    } catch {
      return [];
    }
  });
}

export async function getPaymentProvider(database: D1Database, provider: PaymentProviderKind): Promise<EnabledPaymentProvider | null> {
  const db = createDrizzleDb(database);
  // 同类型可能有多条,优先取已启用的
  const [record] = await db
    .select({ id: paymentProvider.id, provider: paymentProvider.provider, name: paymentProvider.name, isEnabled: paymentProvider.isEnabled, configJson: paymentProvider.configJson })
    .from(paymentProvider)
    .where(eq(paymentProvider.provider, provider))
    .orderBy(desc(paymentProvider.isEnabled), asc(paymentProvider.sort), asc(paymentProvider.id))
    .limit(1);
  if (!record) return null;
  const definition = getProviderDefinition(record.provider);
  if (!definition) return null;
  try {
    const config = parseProviderConfig(record.provider, record.configJson);
    return { id: record.id, provider: record.provider as PaymentProviderKind, name: record.name, channels: definition.getChannels(config), configStatus: "valid", configJson: record.configJson, isEnabled: record.isEnabled };
  } catch {
    return { id: record.id, provider: record.provider as PaymentProviderKind, name: record.name, channels: [], configStatus: "invalid", configJson: record.configJson, isEnabled: record.isEnabled };
  }
}

export async function getPaymentProviderById(database: D1Database, id: number): Promise<EnabledPaymentProvider | null> {
  const db = createDrizzleDb(database);
  const [record] = await db
    .select({ id: paymentProvider.id, provider: paymentProvider.provider, name: paymentProvider.name, isEnabled: paymentProvider.isEnabled, configJson: paymentProvider.configJson })
    .from(paymentProvider)
    .where(eq(paymentProvider.id, id))
    .limit(1);
  if (!record) return null;
  const definition = getProviderDefinition(record.provider);
  if (!definition) return null;
  try {
    const config = parseProviderConfig(record.provider, record.configJson);
    return { id: record.id, provider: record.provider as PaymentProviderKind, name: record.name, channels: definition.getChannels(config), configStatus: "valid", configJson: record.configJson, isEnabled: record.isEnabled };
  } catch {
    return { id: record.id, provider: record.provider as PaymentProviderKind, name: record.name, channels: [], configStatus: "invalid", configJson: record.configJson, isEnabled: record.isEnabled };
  }
}

export async function getEnabledPaymentProvider(database: D1Database, provider: PaymentProviderKind) {
  const db = createDrizzleDb(database);
  // 取已启用的记录(同类型可能有多条,只取启用的第一条)
  const [record] = await db
    .select({ id: paymentProvider.id, provider: paymentProvider.provider, name: paymentProvider.name, isEnabled: paymentProvider.isEnabled, configJson: paymentProvider.configJson })
    .from(paymentProvider)
    .where(and(eq(paymentProvider.provider, provider), eq(paymentProvider.isEnabled, true)))
    .orderBy(asc(paymentProvider.sort), asc(paymentProvider.id))
    .limit(1);
  if (!record) return null;
  const definition = getProviderDefinition(record.provider);
  if (!definition) return null;
  try {
    const config = parseProviderConfig(record.provider, record.configJson);
    return { id: record.id, provider: record.provider as PaymentProviderKind, name: record.name, channels: definition.getChannels(config), configStatus: "valid" as const, configJson: record.configJson, isEnabled: record.isEnabled };
  } catch {
    return null;
  }
}

export function requirePaymentChannel(provider: PaymentProviderKind, configJson: string, channel: string | undefined) {
  const definition = getProviderDefinition(provider);
  if (!definition) appError("PAYMENT_PROVIDER_NOT_IMPLEMENTED");
  const config = parseProviderConfig(provider, configJson);
  const selected = channel || definition.getChannels(config)[0];
  if (selected && !definition.getChannels(config).includes(selected as PaymentChannel)) appError("PAYMENT_CHANNEL_INVALID");
  return selected as PaymentChannel | undefined;
}
