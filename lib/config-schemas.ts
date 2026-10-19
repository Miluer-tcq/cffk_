
export type AlipayMode = "web" | "face_to_face";

export type AlipayConfig = {
  schemaVersion: 1;
  modes: AlipayMode[];
  baseUrl: string;
  appId: string;
  sellerId: string;
  privateKey: string;
  alipayPublicKey: string;
  notifyUrl: string;
  returnUrl: string;
};

export type EpayConfig = {
  schemaVersion: 1;
  baseUrl: string;
  pid: string;
  key: string;
  epayChannels: Array<"alipay" | "wxpay">;
  notifyUrl: string;
  returnUrl: string;
};

export type BepusdtConfig = {
  schemaVersion: 1;
  baseUrl: string;
  appSecret: string;
  notifyUrl: string;
  returnUrl: string;
};

export type NowpaymentsConfig = {
  schemaVersion: 1;
  apiKey: string;
  ipnSecret: string;
  payCurrency: string;
  notifyUrl: string;
  returnUrl: string;
};

export type ManualUsdtConfig = {
  schemaVersion: 2;
  /** EVM 各链共用地址(0x...) */
  evmAddress: string;
  /** TRC20 地址 */
  trc20Address: string;
  /** Solana 地址 */
  solanaAddress: string;
  /** 启用的链,如 ["trc20","bep20","sol"] */
  chains: string[];
  /** 启用的资产,如 ["usdt","usdc"] */
  assets: string[];
  exchangeRate: string;
  notifyUrl: string;
  returnUrl: string;
  /** 旧版字段(向后兼容读取) */
  walletAddress?: string;
  token?: string;
  chain?: string;
  bscApiKey?: string;
};

export type StripeConfig = {
  schemaVersion: 1;
  secretKey: string;
  webhookSecret: string;
  currency: string;
  notifyUrl: string;
  returnUrl: string;
};

export type HashpayConfig = {
  schemaVersion: 1;
  baseUrl: string;
  merchantId: string;
  privateKey: string;
  currency: string;
  notifyUrl: string;
  returnUrl: string;
};

export type PerpayConfig = {
  schemaVersion: 1;
  baseUrl: string;
  apiSecret: string;
  webhookSecret: string;
  notifyUrl: string;
  returnUrl: string;
};

export type PaymentProviderConfig = AlipayConfig | EpayConfig | BepusdtConfig | StripeConfig | HashpayConfig | PerpayConfig | NowpaymentsConfig | ManualUsdtConfig;

export type EmailProviderConfig =
  | { kind: "smtp"; host: string; port: number; secure: boolean; username: string; password: string; authType?: "plain" | "login" | "cram-md5"; from: string; fromName?: string; replyTo?: string }
  | { kind: "api"; endpoint: string; apiKey: string; apiProvider?: "BREVO" | "RESEND"; from: string; fromName?: string; replyTo?: string; timeoutMs?: number }
  | { kind: "cloudflare"; from: string; fromName?: string; replyTo?: string };

export type S3Config = {
  schemaVersion: 2;
  endpoint: string;
  region: string;
  bucket: string;
  pathPrefix: string;
  cacheControl: string;
  forcePathStyle: boolean;
};

export type EmailTemplateConfig = {
  subject: string;
  body: string;
  format: "text";
  variables?: string[];
};

type JsonObject = Record<string, unknown>;

function isRecord(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function requireString(value: unknown, field: string): string {
  if (typeof value !== "string" || !value.trim()) throw new Error(`Invalid configuration: ${field} must be a non-empty string`);
  return value.trim();
}

function normalizeTemplateText(value: string) {
  return value.replace(/\\n/g, "\n");
}


function requireSchemaVersion(value: JsonObject, field: string) {
  if (value.schemaVersion !== 1) throw new Error(`Invalid configuration: ${field} must be 1`);
}

function isForbiddenS3EndpointHost(hostname: string) {
  const host = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (host === "localhost" || host === "::1" || host.endsWith(".localhost")) return true;
  const parts = host.split(".").map(Number);
  if (parts.length !== 4 || parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)) return false;
  const [first, second] = parts;
  return first === 0 || first === 10 || first === 127 || (first === 169 && second === 254) || (first === 172 && second >= 16 && second <= 31) || (first === 192 && second === 168) || (first === 100 && second >= 64 && second <= 127);
}

function requireUrl(value: unknown, field: string, allowEmpty = false) {
  const text = allowEmpty && value === "" ? "" : requireString(value, field);
  if (text) {
    try {
      const url = new URL(text);
      if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error();
    } catch {
      throw new Error(`Invalid configuration: ${field} must be an HTTP or HTTPS URL`);
    }
  }
  return text;
}

function requireStringArray(value: unknown, field: string, allowed: readonly string[], min = 0) {
  if (!Array.isArray(value) || value.length < min || value.some((item) => typeof item !== "string" || !allowed.includes(item))) {
    throw new Error(`Invalid configuration: ${field} contains an unsupported value`);
  }
  return [...new Set(value)] as string[];
}

function parseJsonObject(json: string, name: string) {
  let value: unknown;
  try { value = JSON.parse(json); } catch { throw new Error(`Invalid ${name} configuration`); }
  if (!isRecord(value)) throw new Error(`Invalid ${name} configuration`);
  return value;
}

function requirePaymentUrl(value: unknown, field: string, allowEmpty = false) {
  const text = allowEmpty && value === "" ? "" : requireString(value, field);
  if (text) {
    try {
      if (text.startsWith("/")) new URL(text, "https://payment.invalid");
      else requireUrl(text, field);
    } catch {
      throw new Error(`Invalid configuration: ${field} must be a URL or absolute path`);
    }
  }
  return text;
}

export function parseAlipayConfig(json: string): AlipayConfig {
  const value = parseJsonObject(json, "Alipay");
  requireSchemaVersion(value, "schemaVersion");
  const modes = requireStringArray(value.modes, "modes", ["web", "face_to_face"], 1) as AlipayMode[];
  return {
    schemaVersion: 1,
    modes,
    baseUrl: requireUrl(value.baseUrl, "baseUrl"),
    appId: requireString(value.appId, "appId"),
    sellerId: requireString(value.sellerId, "sellerId"),
    privateKey: requireString(value.privateKey, "privateKey"),
    alipayPublicKey: requireString(value.alipayPublicKey, "alipayPublicKey"),
    notifyUrl: requirePaymentUrl(value.notifyUrl, "notifyUrl", true),
    returnUrl: requirePaymentUrl(value.returnUrl, "returnUrl", true),
  };
}

export function parseEpayConfig(json: string): EpayConfig {
  const value = parseJsonObject(json, "Epay");
  requireSchemaVersion(value, "schemaVersion");
  return {
    schemaVersion: 1,
    baseUrl: requireUrl(value.baseUrl, "baseUrl"),
    pid: requireString(value.pid, "pid"),
    key: requireString(value.key, "key"),
    epayChannels: requireStringArray(value.epayChannels, "epayChannels", ["alipay", "wxpay"], 1) as EpayConfig["epayChannels"],
    notifyUrl: requirePaymentUrl(value.notifyUrl, "notifyUrl", true),
    returnUrl: requirePaymentUrl(value.returnUrl, "returnUrl", true),
  };
}

export function parseBepusdtConfig(json: string): BepusdtConfig {
  const value = parseJsonObject(json, "BEpusdt");
  requireSchemaVersion(value, "schemaVersion");
  return {
    schemaVersion: 1,
    baseUrl: requireUrl(value.baseUrl, "baseUrl"),
    appSecret: requireString(value.appSecret, "appSecret"),
    notifyUrl: requirePaymentUrl(value.notifyUrl, "notifyUrl", true),
    returnUrl: requirePaymentUrl(value.returnUrl, "returnUrl", true),
  };
}

export function parseNowpaymentsConfig(json: string): NowpaymentsConfig {
  const value = parseJsonObject(json, "NOWPayments");
  requireSchemaVersion(value, "schemaVersion");
  return {
    schemaVersion: 1,
    apiKey: requireString(value.apiKey, "apiKey"),
    ipnSecret: requireString(value.ipnSecret, "ipnSecret"),
    payCurrency: requireString(value.payCurrency, "payCurrency"),
    notifyUrl: requirePaymentUrl(value.notifyUrl, "notifyUrl", true),
    returnUrl: requirePaymentUrl(value.returnUrl, "returnUrl", true),
  };
}

export function parseManualUsdtConfig(json: string): ManualUsdtConfig {
  const value = parseJsonObject(json, "手动USDT");
  const version = typeof value.schemaVersion === "number" ? value.schemaVersion : 1;
  const exchangeRate = requireString(value.exchangeRate, "exchangeRate");
  const notifyUrl = requirePaymentUrl(value.notifyUrl, "notifyUrl", true);
  const returnUrl = requirePaymentUrl(value.returnUrl, "returnUrl", true);
  if (version >= 2) {
    const chains = Array.isArray(value.chains) ? (value.chains as unknown[]).filter((c): c is string => typeof c === "string" && c.length > 0) : [];
    const assets = Array.isArray(value.assets) ? (value.assets as unknown[]).filter((a): a is string => typeof a === "string" && a.length > 0) : [];
    if (chains.length === 0) throw new Error("MANUAL_USDT_NO_CHAIN");
    if (assets.length === 0) throw new Error("MANUAL_USDT_NO_ASSET");
    const evmAddress = typeof value.evmAddress === "string" ? value.evmAddress.trim() : "";
    const trc20Address = typeof value.trc20Address === "string" ? value.trc20Address.trim() : "";
    const solanaAddress = typeof value.solanaAddress === "string" ? value.solanaAddress.trim() : "";
    // 启用的链必须有对应地址(EVM 各链共用一个)
    if (chains.includes("trc20") && !trc20Address) throw new Error("MANUAL_USDT_TRC20_ADDRESS_REQUIRED");
    if (chains.includes("sol") && !solanaAddress) throw new Error("MANUAL_USDT_SOLANA_ADDRESS_REQUIRED");
    if (chains.some((c) => c !== "trc20" && c !== "sol") && !evmAddress) throw new Error("MANUAL_USDT_EVM_ADDRESS_REQUIRED");
    return {
      schemaVersion: 2,
      evmAddress,
      trc20Address,
      solanaAddress,
      chains,
      assets,
      exchangeRate,
      notifyUrl,
      returnUrl,
    };
  }
  // v1 向后兼容:单地址/单链/单资产,按链类型归位
  requireSchemaVersion(value, "schemaVersion");
  const walletAddress = requireString(value.walletAddress, "walletAddress");
  const token = typeof value.token === "string" && value.token ? value.token : "usdt";
  const chain = typeof value.chain === "string" && value.chain ? value.chain : "trc20";
  return {
    schemaVersion: 2,
    evmAddress: chain !== "trc20" && chain !== "sol" ? walletAddress : "",
    trc20Address: chain === "trc20" ? walletAddress : "",
    solanaAddress: chain === "sol" ? walletAddress : "",
    chains: [chain],
    assets: [token],
    exchangeRate,
    notifyUrl,
    returnUrl,
    walletAddress,
    token,
    chain,
  };
}

/** 按链取收款地址(EVM 共用一个,TRC20/Solana 各一个)。 */
export function manualUsdtWalletForChain(config: ManualUsdtConfig, chain: string): string {
  if (chain === "trc20") return (config.trc20Address || config.walletAddress || "").trim();
  if (chain === "sol") return (config.solanaAddress || config.walletAddress || "").trim();
  return (config.evmAddress || config.walletAddress || "").trim();
}

export function parseStripeConfig(json: string): StripeConfig {
  const value = parseJsonObject(json, "Stripe");
  requireSchemaVersion(value, "schemaVersion");
  return {
    schemaVersion: 1,
    secretKey: requireString(value.secretKey, "secretKey"),
    webhookSecret: requireString(value.webhookSecret, "webhookSecret"),
    currency: requireString(value.currency, "currency").toLowerCase(),
    notifyUrl: requirePaymentUrl(value.notifyUrl, "notifyUrl", true),
    returnUrl: requirePaymentUrl(value.returnUrl, "returnUrl", true),
  };
}

export function parseHashpayConfig(json: string): HashpayConfig {
  const value = parseJsonObject(json, "HashPay");
  requireSchemaVersion(value, "schemaVersion");
  return {
    schemaVersion: 1,
    baseUrl: requireUrl(value.baseUrl, "baseUrl"),
    merchantId: requireString(value.merchantId, "merchantId"),
    privateKey: requireString(value.privateKey, "privateKey"),
    currency: requireString(value.currency, "currency").toUpperCase(),
    notifyUrl: requirePaymentUrl(value.notifyUrl, "notifyUrl", true),
    returnUrl: requirePaymentUrl(value.returnUrl, "returnUrl", true),
  };
}

function requirePerpaySecret(value: unknown, field: string) {
  const secret = requireString(value, field);
  if (!/^[A-Za-z0-9_-]{43}$/.test(secret)) throw new Error(`Invalid configuration: ${field} must be a 32-byte base64url secret`);
  try {
    const bytes = Uint8Array.from(atob(secret.replace(/-/g, "+").replace(/_/g, "/") + "=".repeat((4 - secret.length % 4) % 4)), (character) => character.charCodeAt(0));
    if (bytes.length !== 32) throw new Error();
  } catch { throw new Error(`Invalid configuration: ${field} must be a 32-byte base64url secret`); }
  return secret;
}

export function parsePerpayConfig(json: string): PerpayConfig {
  const value = parseJsonObject(json, "PerPay");
  requireSchemaVersion(value, "schemaVersion");
  const baseUrl = requireUrl(value.baseUrl, "baseUrl");
  const parsed = new URL(baseUrl);
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.search || parsed.hash || parsed.pathname !== "/") {
    throw new Error("Invalid configuration: baseUrl must be an HTTPS origin");
  }
  return {
    schemaVersion: 1,
    baseUrl: parsed.origin,
    apiSecret: requirePerpaySecret(value.apiSecret, "apiSecret"),
    webhookSecret: requirePerpaySecret(value.webhookSecret, "webhookSecret"),
    notifyUrl: requirePaymentUrl(value.notifyUrl, "notifyUrl", true),
    returnUrl: requirePaymentUrl(value.returnUrl, "returnUrl", true),
  };
}

export function parseEmailProviderConfig(json: string): EmailProviderConfig {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value)) throw new Error("Invalid email provider configuration");
  if (value.schemaVersion !== undefined && value.schemaVersion !== 1) throw new Error("Invalid email provider configuration version");
  const from = requireString(value.from, "from");

  if (value.kind === "cloudflare") {
    return {
      kind: "cloudflare",
      from,
      ...(typeof value.fromName === "string" && value.fromName.trim() ? { fromName: value.fromName.trim() } : {}),
      ...(typeof value.replyTo === "string" && value.replyTo.trim() ? { replyTo: value.replyTo.trim() } : {}),
    };
  }
  if (value.kind === "smtp") {
    const host = requireString(value.host, "host");
    if (host.length > 253 || [...host].some((character) => character <= "\u001f" || character === "\u007f" || /[\s/:@?#\\]/.test(character)) || !host.split(".").every((label) => /^(?!-)[A-Za-z0-9-]{1,63}(?<!-)$/.test(label))) {
      throw new Error("EMAIL_SMTP_HOST_INVALID");
    }
    if (typeof value.port !== "number" || !Number.isInteger(value.port) || value.port < 1 || value.port > 65535) {
      throw new Error("Invalid configuration: port must be a valid integer");
    }
    if (typeof value.secure !== "boolean") throw new Error("Invalid configuration: secure must be boolean");
    return {
      kind: "smtp",
      host,
      port: value.port,
      secure: value.secure,
      username: requireString(value.username, "username"),
      password: requireString(value.password, "password"),
      from,
      ...(value.authType === "login" || value.authType === "cram-md5" || value.authType === "plain" ? { authType: value.authType } : {}),
      ...(typeof value.fromName === "string" && value.fromName.trim() ? { fromName: value.fromName.trim() } : {}),
      ...(typeof value.replyTo === "string" && value.replyTo.trim() ? { replyTo: value.replyTo.trim() } : {}),
    };
  }
  if (value.kind === "api") {
    return {
      kind: "api",
      endpoint: requireString(value.endpoint, "endpoint"),
      apiKey: requireString(value.apiKey, "apiKey"),
      from,
      ...(value.apiProvider === "BREVO" || value.apiProvider === "RESEND" ? { apiProvider: value.apiProvider } : {}),
      ...(typeof value.fromName === "string" && value.fromName.trim() ? { fromName: value.fromName.trim() } : {}),
      ...(typeof value.replyTo === "string" && value.replyTo.trim() ? { replyTo: value.replyTo.trim() } : {}),
      ...(typeof value.timeoutMs === "number" && Number.isInteger(value.timeoutMs) && value.timeoutMs > 0 ? { timeoutMs: value.timeoutMs } : {}),
    };
  }
  throw new Error("Invalid configuration: kind must be smtp, api, or cloudflare");
}

export function parseS3Config(json: string): S3Config {
  const value = parseJsonObject(json, "S3");
  if (value.schemaVersion !== 2) throw new Error("Invalid configuration: schemaVersion must be 2");
  const endpoint = requireUrl(value.endpoint, "endpoint").replace(/\/$/, "");
  const endpointUrl = new URL(endpoint);
  if (endpointUrl.username || endpointUrl.password || endpointUrl.search || endpointUrl.hash || endpointUrl.port) throw new Error("Invalid configuration: endpoint is not allowed");
  if (isForbiddenS3EndpointHost(endpointUrl.hostname)) throw new Error("Invalid configuration: endpoint host is not allowed");
  const pathPrefix = typeof value.pathPrefix === "string" ? value.pathPrefix.trim().replace(/\\/g, "/").replace(/(^\/|\/$)/g, "") : "media";
  if (!pathPrefix || pathPrefix.includes("..") || pathPrefix.includes("//")) throw new Error("Invalid configuration: pathPrefix is invalid");
  const cacheControl = typeof value.cacheControl === "string" && value.cacheControl.trim()
    ? value.cacheControl.trim()
    : "public, max-age=31536000, s-maxage=31536000, immutable";
  if (cacheControl.length > 500 || typeof value.forcePathStyle !== "boolean") throw new Error("Invalid S3 configuration");
  return {
    schemaVersion: 2,
    endpoint,
    region: requireString(value.region, "region"),
    bucket: requireString(value.bucket, "bucket"),
    pathPrefix,
    cacheControl,
    forcePathStyle: value.forcePathStyle,
  };
}

export function parseEmailTemplateConfig(json: string): EmailTemplateConfig {
  const value: unknown = JSON.parse(json);
  if (!isRecord(value)) throw new Error("Invalid email template configuration");
  const variables = value.variables;
  if (variables !== undefined && (!Array.isArray(variables) || variables.some((item) => typeof item !== "string"))) {
    throw new Error("Invalid configuration: variables must be an array of strings");
  }

  if (value.format !== "text") throw new Error("Invalid configuration: format must be text");
  return {
    subject: normalizeTemplateText(requireString(value.subject, "subject")),
    body: normalizeTemplateText(requireString(value.body, "body")),
    format: "text",
    ...(variables ? { variables } : {}),
  };
}
