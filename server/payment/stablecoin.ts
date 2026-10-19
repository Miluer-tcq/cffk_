/**
 * 稳定币收款(自有钱包)的链 / 资产 / 合约地址统一定义。
 * 前后台共用:后台配置勾选、前台下单选择、二维码生成、链上查询都从这里取。
 */

export type StablecoinChainId = "trc20" | "bep20" | "erc20" | "polygon" | "arbitrum" | "optimism" | "base" | "sol";
export type StablecoinAssetId = "usdt" | "usdc";
export type AddressKind = "evm" | "trc20" | "solana";

export interface StablecoinChain {
  id: StablecoinChainId;
  /** 前端展示的短标签,如 BSC */
  label: string;
  /** 网络全名,如 BNB Smart Chain */
  network: string;
  addressKind: AddressKind;
  /** EVM 链 ID,用于 EIP-681 二维码;非 EVM 为 null */
  evmChainId: number | null;
}

export const STABLECOIN_CHAINS: StablecoinChain[] = [
  { id: "bep20", label: "BSC", network: "BNB Smart Chain", addressKind: "evm", evmChainId: 56 },
  { id: "erc20", label: "Ethereum", network: "以太坊 Ethereum", addressKind: "evm", evmChainId: 1 },
  { id: "polygon", label: "Polygon", network: "Polygon", addressKind: "evm", evmChainId: 137 },
  { id: "arbitrum", label: "Arbitrum", network: "Arbitrum One", addressKind: "evm", evmChainId: 42161 },
  { id: "optimism", label: "Optimism", network: "OP Mainnet", addressKind: "evm", evmChainId: 10 },
  { id: "base", label: "Base", network: "Base", addressKind: "evm", evmChainId: 8453 },
  { id: "sol", label: "Solana", network: "Solana", addressKind: "solana", evmChainId: null },
  { id: "trc20", label: "Tron", network: "波场 TRON", addressKind: "trc20", evmChainId: null },
];

/** 每条链支持的资产 */
export const STABLECOIN_CHAIN_ASSETS: Record<StablecoinChainId, StablecoinAssetId[]> = {
  bep20: ["usdt", "usdc"],
  erc20: ["usdt", "usdc"],
  polygon: ["usdt", "usdc"],
  arbitrum: ["usdt", "usdc"],
  optimism: ["usdt", "usdc"],
  base: ["usdt", "usdc"],
  sol: ["usdt", "usdc"],
  trc20: ["usdt", "usdc"],
};

export const STABLECOIN_ASSETS: Array<{ id: StablecoinAssetId; label: string }> = [
  { id: "usdt", label: "USDT" },
  { id: "usdc", label: "USDC" },
];

export function getStablecoinChain(id: string): StablecoinChain | undefined {
  return STABLECOIN_CHAINS.find((c) => c.id === id);
}

export function isStablecoinChain(id: string): id is StablecoinChainId {
  return STABLECOIN_CHAINS.some((c) => c.id === id);
}

export function isStablecoinAsset(id: string): id is StablecoinAssetId {
  return STABLECOIN_ASSETS.some((a) => a.id === id);
}

/** 官方代币合约 / Mint 地址 — 查询时只认这些,假币直接过滤。 */
export const STABLECOIN_CONTRACTS: Record<StablecoinAssetId, Record<StablecoinChainId, string>> = {
  usdt: {
    trc20: "TR7NHqjeKQxGTCi8q8ZY4pL8otSzgjLj6t",
    bep20: "0x55d398326f99059fF775485246999027B3197955",
    erc20: "0xdAC17F958D2ee523a2206206994597C13D831ec7",
    polygon: "0xc2132D05D31c914a87C6611C10748AEb04B58e8F",
    arbitrum: "0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9",
    // Optimism USDT 已置换为 USDT0(新版为 canonical,二维码用它);旧版桥接 USDT 仍被监控接受,见下。
    optimism: "0x01bff41798a0bcf287b996046ca68b395dbc1071",
    base: "0xfde4C96c8593536E31F229EA8f37b2ADa2699bb2",
    sol: "Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB",
  },
  usdc: {
    trc20: "TEkxiTehnzSmSe2XqrBj4w32RUN966rdz8",
    bep20: "0x8AC76a51cc950d9822D68b83fE1Ad97B32Cd580d",
    erc20: "0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48",
    polygon: "0x3c499c542cEF5E3811e1192ce70d8cC03d5c3359",
    arbitrum: "0xaf88d065e77c8cC2239327C5EDb3A432268e5831",
    optimism: "0x0b2C639c533813f4Aa9D7837CAf62653d097Ff85",
    base: "0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913",
    sol: "EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v",
  },
};

/**
 * 额外接受的官方合约(旧版/置换前)。链上查询时 canonical + 额外合约都认,
 * 避免用户用旧版代币付款时漏单;二维码只用 canonical 合约。
 */
export const STABLECOIN_EXTRA_CONTRACTS: Partial<Record<StablecoinAssetId, Partial<Record<StablecoinChainId, string[]>>>> = {
  // Optimism USDT: 旧版桥接 USDT,Binance 已完成置换,新版 USDT0 为 canonical。
  usdt: { optimism: ["0x94b008aA00579c1307B0EF2c499aD98a8ce58e58"] },
};

export function getStablecoinContract(asset: string, chain: string): string | null {
  if (!isStablecoinAsset(asset) || !isStablecoinChain(chain)) return null;
  // 检查该链是否支持该资产 (如 TRON 不支持 USDC)
  const supported = STABLECOIN_CHAIN_ASSETS[chain as StablecoinChainId];
  if (!supported || !supported.includes(asset as StablecoinAssetId)) return null;
  return STABLECOIN_CONTRACTS[asset as StablecoinAssetId][chain as StablecoinChainId] ?? null;
}

/** 链上查询时接受的全部官方合约:canonical 在前,额外合约在后。 */
export function getStablecoinContracts(asset: string, chain: string): string[] {
  const canonical = getStablecoinContract(asset, chain);
  if (!canonical) return [];
  const extras = STABLECOIN_EXTRA_CONTRACTS[asset as StablecoinAssetId]?.[chain as StablecoinChainId] ?? [];
  const seen = new Set([canonical.toLowerCase()]);
  const all = [canonical];
  for (const extra of extras) {
    if (!seen.has(extra.toLowerCase())) { seen.add(extra.toLowerCase()); all.push(extra); }
  }
  return all;
}

/** 各链区块浏览器交易页前缀,拼上 hash 即为 scan 链接。 */
export const STABLECOIN_EXPLORERS: Record<StablecoinChainId, string> = {
  trc20: "https://tronscan.org/#/transaction/",
  bep20: "https://bscscan.com/tx/",
  erc20: "https://etherscan.io/tx/",
  polygon: "https://polygonscan.com/tx/",
  arbitrum: "https://arbiscan.io/tx/",
  optimism: "https://optimistic.etherscan.io/tx/",
  base: "https://basescan.org/tx/",
  sol: "https://solscan.io/tx/",
};

/** 转账 hash 的区块浏览器链接;链或 hash 无效时返回 null。 */
export function getStablecoinTxScanUrl(chain: string, hash: string): string | null {
  if (!isStablecoinChain(chain)) return null;
  if (!hash || !/^(0x[0-9a-fA-F]{64}|[1-9A-HJ-NP-Za-km-z]{32,128})$/.test(hash.trim())) return null;
  return STABLECOIN_EXPLORERS[chain as StablecoinChainId] + hash.trim();
}

/** 获取某条链支持的资产列表 */
export function getChainAssets(chain: string): StablecoinAssetId[] {
  if (!isStablecoinChain(chain)) return [];
  return STABLECOIN_CHAIN_ASSETS[chain as StablecoinChainId] ?? [];
}

/**
 * 各链各资产小数位。
 * 注意:BSC 上的 USDT/USDC 是币安锚定版,为 18 位小数;其余链均为 6 位。
 * (之前误将 BSC 按 6 位计算,导致 EIP-681 金额差 10^12 倍。)
 */
export const STABLECOIN_DECIMALS: Record<StablecoinAssetId, Record<StablecoinChainId, number>> = {
  usdt: { trc20: 6, bep20: 18, erc20: 6, polygon: 6, arbitrum: 6, optimism: 6, base: 6, sol: 6 },
  usdc: { trc20: 6, bep20: 18, erc20: 6, polygon: 6, arbitrum: 6, optimism: 6, base: 6, sol: 6 },
};

export function getStablecoinDecimals(asset: string, chain: string): number {
  if (!isStablecoinAsset(asset) || !isStablecoinChain(chain)) return 6;
  return STABLECOIN_DECIMALS[asset as StablecoinAssetId][chain as StablecoinChainId] ?? 6;
}

/**
 * 为每笔订单生成唯一付款金额:基础金额 + 订单号派生的微小偏移 (0.000001 ~ 0.009999)。
 * 同一商品短时间内多人下单、金额相同时,靠尾数区分订单,避免一笔转账匹配到多单。
 * 偏移由订单号哈希确定,同一订单每次生成结果一致。
 */
/** 订单号哈希派生的偏移（微单位 1 ~ 9999，即 0.000001 ~ 0.009999）。 */
export function stablecoinOffsetUnits(orderNo: string): number {
  let hash = 0;
  for (let i = 0; i < orderNo.length; i++) {
    hash = (hash * 31 + orderNo.charCodeAt(i)) >>> 0;
  }
  return (hash % 9999) + 1; // 1 ~ 9999
}

export function uniqueStablecoinAmount(baseAmount: number, orderNo: string): number {
  const baseUnits = Math.round(baseAmount * 1e6);
  return (baseUnits + stablecoinOffsetUnits(orderNo)) / 1e6;
}

/**
 * 在已占用的金额集合中为订单找一个不碰撞的偏移（线性探测）。
 * usedMicroUnits 为同链同资产下待支付订单的金额（微单位整数）。
 * 池子共 9999 个偏移，真用完时返回原偏移（需 9999 个同价待支付订单同时存在，实际不可能）。
 */
export function probeFreeOffsetUnits(orderNo: string, baseUnits: number, usedMicroUnits: Set<number>): number {
  let offset = stablecoinOffsetUnits(orderNo);
  for (let i = 0; i < 9999; i++) {
    if (!usedMicroUnits.has(baseUnits + offset)) return offset;
    offset = offset % 9999 + 1;
  }
  return offset;
}

/**
 * 生成钱包可扫码的二维码内容。
 * - EVM: EIP-681 通用协议 ethereum:{合约}@{链ID}/transfer?address={地址}&uint256={最小单位金额}
 *   (注意 BSC 的 USDT/USDC 为 18 位小数,其余链 6 位,小数位按链+资产查表,避免精度错误)
 * - TRON/Solana: 纯钱包地址,用户在钱包内手动选择币种并输入金额
 */
export function buildStablecoinQrUri(opts: {
  chain: string;
  asset: string;
  walletAddress: string;
  tokenAmount: number;
}): string {
  const { chain, asset, walletAddress, tokenAmount } = opts;
  const info = getStablecoinChain(chain);
  const contract = getStablecoinContract(asset, chain);
  if (info?.addressKind === "evm" && contract && info.evmChainId) {
    const decimals = getStablecoinDecimals(asset, chain);
    // 金额最多 6 位小数:先定死 6 位,再按目标小数位补零,全程字符串运算无浮点误差
    const base6 = tokenAmount.toFixed(6).replace(".", "");
    const wei = base6 + "0".repeat(Math.max(0, decimals - 6));
    return `ethereum:${contract}@${info.evmChainId}/transfer?address=${walletAddress}&uint256=${wei}`;
  }
  // TRON / Solana:纯地址
  return walletAddress;
}

/** 展示用标签,如 "USDT · TRC20"。 */
export function stablecoinDisplayLabel(asset: string, chain: string): string {
  const assetLabel = STABLECOIN_ASSETS.find((a) => a.id === asset)?.label ?? asset.toUpperCase();
  const chainLabel = getStablecoinChain(chain)?.label ?? chain.toUpperCase();
  return `${assetLabel} · ${chainLabel}`;
}
