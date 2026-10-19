import { and, eq, isNotNull } from "drizzle-orm";
import { createDrizzleDb } from "@/database/drizzle";
import { order, paymentProvider } from "@/database/drizzle/schema";
import { parseManualUsdtConfig, manualUsdtWalletForChain } from "@/lib/config-schemas";
import { reportUnexpectedServerError } from "../error-handling";
import { confirmOrderPayment } from "../order/service";
import { PaymentLogService } from "./log-service";
import {
  getStablecoinContracts,
  getStablecoinDecimals,
  getStablecoinChain,
  isStablecoinAsset,
  isStablecoinChain,
} from "./stablecoin";

const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

const EVM_RPC: Record<string, string[]> = {
  // 官方/第一方 RPC 放前面:publicnode 会把 eth_getLogs 当归档请求 403,dRPC 免费版会因 range 报 400,
  // 之前 Arbitrum 只配了这两家,导致链上查询永远失败。官方 RPC 对 getLogs 友好。
  // 注意:以下列表只是 Alchemy 失败时的回退;配了 ALCHEMY_API_KEY 后优先走 Alchemy。
  bep20: ["https://bsc.publicnode.com", "https://bsc-dataseed1.binance.org/", "https://bsc-dataseed2.binance.org/", "https://bsc-dataseed.binance.org/"],
  erc20: ["https://ethereum.publicnode.com", "https://rpc.flashbots.net"],
  polygon: ["https://polygon.publicnode.com", "https://polygon.drpc.org"],
  arbitrum: ["https://arb1.arbitrum.io/rpc", "https://arbitrum.publicnode.com", "https://arbitrum.drpc.org"],
  optimism: ["https://mainnet.optimism.io", "https://optimism.publicnode.com", "https://optimism.drpc.org"],
  base: ["https://base.publicnode.com", "https://mainnet.base.org", "https://base.drpc.org"],
};

/** Alchemy 各链端点:一个 key 可用于全部 EVM 链(需在 Alchemy 后台启用对应网络)。 */
const ALCHEMY_ENDPOINTS: Record<string, string> = {
  bep20: "https://bnb-mainnet.g.alchemy.com/v2/",
  erc20: "https://eth-mainnet.g.alchemy.com/v2/",
  polygon: "https://polygon-mainnet.g.alchemy.com/v2/",
  arbitrum: "https://arb-mainnet.g.alchemy.com/v2/",
  optimism: "https://opt-mainnet.g.alchemy.com/v2/",
  base: "https://base-mainnet.g.alchemy.com/v2/",
};

/** 各链平均出块时间(秒),用于按订单创建时间锚定查询起点。 */
const EVM_BLOCK_TIME_S: Record<string, number> = {
  bep20: 3,
  erc20: 12,
  polygon: 2,
  arbitrum: 0.25,
  optimism: 2,
  base: 2,
};

/**
 * 按订单创建时间锚定查询起点,而不是固定 latest-2000。
 * Arbitrum 出块约 0.25s,2000 块只覆盖约 8 分钟,用户稍晚付款或稍晚点检查就会漏单。
 * 窗口 = 下单至今的块数 × 1.25 裕量 + 1000 块缓冲,下限 2000,上限 300000。
 */
function evmFromBlock(latest: number, chain: string, orderTime: number): number {
  const blockTime = EVM_BLOCK_TIME_S[chain] ?? 3;
  const ageMs = Math.max(0, Date.now() - orderTime + 60000); // +60s 时钟偏差容忍
  const span = Math.ceil((ageMs / 1000 / blockTime) * 1.25) + 1000;
  const window = Math.min(Math.max(span, 2000), 300000);
  return Math.max(0, latest - window);
}

const SOL_RPCS = ["https://api.mainnet-beta.solana.com/", "https://solana.publicnode.com"];

const TRON_APIS = ["https://api.trongrid.io", "https://tron.publicnode.com"];

type ChainTx = { hash: string; to: string; value: number; timestamp: number; contractVerified: boolean; logIndex?: number };

/** 链上查询时接受的全部官方合约(canonical + 旧版),如 Optimism USDT 新旧双合约。 */
function getContracts(token: string, chain: string): string[] {
  return getStablecoinContracts(token, chain);
}

function isAcceptedContract(contracts: string[], address: string | undefined): boolean {
  if (!address) return false;
  const lower = address.toLowerCase();
  return contracts.some((c) => c.toLowerCase() === lower);
}

async function rpcPost(url: string, method: string, params: unknown[], timeoutMs = 3000): Promise<unknown> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`RPC_ERROR_${response.status}`);
    const body = (await response.json()) as { result?: unknown; error?: { message?: string } };
    if (body.error) throw new Error(`RPC_${body.error.message ?? "FAILED"}`);
    return body.result;
  } finally {
    clearTimeout(timer);
  }
}

/** 带一次重试的 fetch,应对公共接口偶发限流 */
async function fetchWithRetry(url: string, init?: RequestInit, retries = 1): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      const response = await fetch(url, init);
      if (response.ok) return response;
      // 429/5xx 才重试,其他 4xx 直接抛
      if (response.status !== 429 && response.status < 500) throw new Error(`HTTP_${response.status}`);
      lastError = new Error(`HTTP_${response.status}`);
    } catch (cause) {
      lastError = cause;
    }
    if (attempt < retries) await new Promise((resolve) => setTimeout(resolve, 1500));
  }
  throw lastError instanceof Error ? lastError : new Error("FETCH_FAILED");
}

async function fetchTrc20Transfers(walletAddress: string, contract: string, decimals: number, alchemyApiKey?: string): Promise<ChainTx[]> {
  // Alchemy 也提供 TronGrid 兼容接口,配了 key 时优先走 Alchemy,失败回退公共 TronGrid。
  const apis = alchemyApiKey ? [`https://tron-mainnet.g.alchemy.com/v2/${alchemyApiKey}`, ...TRON_APIS] : TRON_APIS;
  // 并行查全部接口,合并去重:Promise.any 只取最快成功的那份,
  // 若最快的那家节点落后返回空,另一家已到账的转账会被漏掉。
  const settled = await Promise.allSettled(apis.map(async (base) => {
    const url = `${base}/v1/accounts/${walletAddress}/transactions/trc20?contract_address=${contract}&limit=20&order_by=block_timestamp,desc`;
    const response = await fetchWithRetry(url, { headers: { accept: "application/json" } });
    const body = (await response.json()) as { data?: Array<{ transaction_id: string; to: string; value: string; block_timestamp: number; token_info?: { address?: string } }> };
    // 严格验证:只接受官方合约地址的交易
    return (body.data ?? [])
      .filter((tx) => !tx.token_info?.address || tx.token_info.address === contract)
      .map((tx) => ({ hash: tx.transaction_id, to: tx.to, value: Number(tx.value) / 10 ** decimals, timestamp: tx.block_timestamp, contractVerified: true }));
  }));
  const fulfilled = settled.filter((r): r is PromiseFulfilledResult<ChainTx[]> => r.status === "fulfilled");
  if (fulfilled.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
  const seen = new Set<string>();
  return fulfilled.flatMap((r) => r.value).filter((tx) => {
    if (seen.has(tx.hash)) return false;
    seen.add(tx.hash);
    return true;
  });
}

/**
 * 经 Alchemy 查询某钱包收到的指定代币转账。
 * 用 alchemy_getAssetTransfers(按收款地址 + 官方合约过滤),比 eth_getLogs 更可靠:
 * 免费公共 RPC 对 getLogs 有各种限制(publicnode 403 归档、dRPC 400 range、Blast/1rpc 只允许 10/50 块窗口),
 * Alchemy 无这些限制,且按订单时间锚定 fromBlock,不会漏掉稍早的转账。
 */
async function fetchEvmTransfersViaAlchemy(walletAddress: string, chain: string, contracts: string[], decimals: number, orderTime: number, apiKey: string): Promise<ChainTx[]> {
  const base = ALCHEMY_ENDPOINTS[chain];
  if (!base) throw new Error(`ALCHEMY_UNSUPPORTED_${chain}`);
  const url = base + apiKey;
  const latestHex = (await rpcPost(url, "eth_blockNumber", [], 8000)) as string;
  const latest = parseInt(latestHex, 16);
  const fromBlock = "0x" + evmFromBlock(latest, chain, orderTime).toString(16);
  const toBlock = "0x" + latest.toString(16);
  const results: ChainTx[] = [];
  let pageKey: string | undefined;
  // 分页取,最多 3 页(按收款地址 + 合约过滤后,单笔订单窗口内的转账数量很少)
  for (let page = 0; page < 3; page += 1) {
    const body = (await rpcPost(url, "alchemy_getAssetTransfers", [{
      fromBlock,
      toBlock,
      toAddress: walletAddress,
      contractAddresses: contracts,
      category: ["erc20"],
      order: "asc",
      withMetadata: true,
      maxCount: "0x3e8",
      ...(pageKey ? { pageKey } : {}),
    }], 8000)) as {
      transfers?: Array<{
        hash: string;
        metadata?: { blockTimestamp?: string };
        rawContract?: { address?: string; value?: string };
      }>;
      pageKey?: string;
    };
    for (const t of body.transfers ?? []) {
      // 再校验一次合约地址,防止 Alchemy 返回非官方合约的转账(新旧双合约都在接受列表内)
      if (!isAcceptedContract(contracts, t.rawContract?.address)) continue;
      const value = Number(BigInt(t.rawContract?.value ?? "0x0")) / 10 ** decimals;
      const timestamp = t.metadata?.blockTimestamp ? new Date(t.metadata.blockTimestamp).getTime() : Date.now();
      results.push({ hash: t.hash, to: walletAddress, value, timestamp, contractVerified: true });
    }
    pageKey = body.pageKey;
    if (!pageKey) break;
  }
  return results;
}

async function fetchEvmTransfers(walletAddress: string, chain: string, contracts: string[], decimals: number, orderTime: number): Promise<ChainTx[]> {
  const rpcs = EVM_RPC[chain];
  if (!rpcs || rpcs.length === 0) throw new Error(`UNSUPPORTED_CHAIN_${chain}`);
  // 并行查全部 RPC,合并去重:Promise.any 只取最快成功的那份,
  // 若最快的那家节点落后返回空,另一家已到账的转账会被漏掉。
  const settled = await Promise.allSettled(rpcs.map((rpc) => fetchEvmTransfersFromRpc(walletAddress, chain, contracts, decimals, rpc, orderTime)));
  const fulfilled = settled.filter((r): r is PromiseFulfilledResult<ChainTx[]> => r.status === "fulfilled");
  if (fulfilled.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
  const seen = new Set<string>();
  return fulfilled.flatMap((r) => r.value).filter((tx) => {
    const key = `${tx.hash}:${tx.logIndex ?? 0}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

async function fetchEvmTransfersFromRpc(walletAddress: string, chain: string, contracts: string[], decimals: number, rpc: string, orderTime: number): Promise<ChainTx[]> {
  const paddedWallet = "0x000000000000000000000000" + walletAddress.slice(2).toLowerCase();
  const latestHex = (await rpcPost(rpc, "eth_blockNumber", [])) as string;
  const latest = parseInt(latestHex, 16);
  const fromBlock = "0x" + evmFromBlock(latest, chain, orderTime).toString(16);
  // toBlock 必须用显式区块号,不能用 "latest":drpc 会报 ranges over 10000,publicnode 会当归档请求要 token
  const toBlock = "0x" + latest.toString(16);
  // address 参数限定只查官方合约 — 假币的 Transfer 事件不会被返回(新旧双合约都列入)
  const logs = (await rpcPost(rpc, "eth_getLogs", [{
    fromBlock,
    toBlock,
    address: contracts,
    topics: [TRANSFER_TOPIC, null, paddedWallet],
  }])) as Array<{ transactionHash: string; data: string; blockNumber: string; address: string; logIndex?: string }>;
  const results: ChainTx[] = [];
  for (const log of logs.slice(-100)) {
    // 双重验证:返回的 log 地址必须等于官方合约之一
    if (!isAcceptedContract(contracts, log.address)) continue;
    const value = Number(BigInt(log.data)) / 10 ** decimals;
    let timestamp = Date.now();
    try {
      const block = (await rpcPost(rpc, "eth_getBlockByNumber", [log.blockNumber, false])) as { timestamp?: string };
      if (block?.timestamp) timestamp = parseInt(block.timestamp, 16) * 1000;
    } catch { /* use now */ }
    results.push({ hash: log.transactionHash, to: walletAddress, value, timestamp, contractVerified: true, logIndex: log.logIndex !== undefined ? parseInt(log.logIndex, 16) : undefined });
  }
  return results;
}

async function fetchSolTransfers(walletAddress: string, mint: string, decimals: number, alchemyApiKey?: string): Promise<ChainTx[]> {
  // Alchemy 也有 Solana JSON-RPC 端点,配了 key 时优先走 Alchemy,失败回退公共 RPC。
  const rpcs = alchemyApiKey ? [`https://solana-mainnet.g.alchemy.com/v2/${alchemyApiKey}`, ...SOL_RPCS] : SOL_RPCS;
  // 并行查全部 RPC,合并去重:Promise.any 只取最快成功的那份,
  // 若最快的那家节点落后返回空,另一家已到账的转账会被漏掉。
  const settled = await Promise.allSettled(rpcs.map((rpc) => fetchSolTransfersFromRpc(walletAddress, mint, decimals, rpc)));
  const fulfilled = settled.filter((r): r is PromiseFulfilledResult<ChainTx[]> => r.status === "fulfilled");
  if (fulfilled.length === 0) throw (settled[0] as PromiseRejectedResult).reason;
  const seen = new Set<string>();
  return fulfilled.flatMap((r) => r.value).filter((tx) => {
    if (seen.has(tx.hash)) return false;
    seen.add(tx.hash);
    return true;
  });
}

async function fetchSolTransfersFromRpc(walletAddress: string, mint: string, decimals: number, rpc: string): Promise<ChainTx[]> {
  const sigs = (await rpcPost(rpc, "getSignaturesForAddress", [walletAddress, { limit: 15 }])) as Array<{ signature: string; blockTime?: number }>;
  const results: ChainTx[] = [];
  for (const sig of sigs.slice(0, 8)) {
    try {
      const tx = (await rpcPost(rpc, "getTransaction", [sig.signature, { encoding: "jsonParsed", maxSupportedTransactionVersion: 0 }])) as {
        meta?: { preTokenBalances?: Array<{ mint: string; owner?: string; uiTokenAmount?: { uiAmount?: number } }>; postTokenBalances?: Array<{ mint: string; owner?: string; uiTokenAmount?: { uiAmount?: number } }> };
      } | null;
      if (!tx?.meta) continue;
      // 严格验证:只认官方 mint 地址
      const pre = (tx.meta.preTokenBalances ?? []).filter((b) => b.mint === mint);
      const post = (tx.meta.postTokenBalances ?? []).filter((b) => b.mint === mint);
      for (const p of post) {
        if (p.owner?.toLowerCase() !== walletAddress.toLowerCase()) continue;
        const before = pre.find((b) => b.owner?.toLowerCase() === walletAddress.toLowerCase())?.uiTokenAmount?.uiAmount ?? 0;
        const after = p.uiTokenAmount?.uiAmount ?? 0;
        const diff = after - before;
        if (diff > 0.000001) {
          results.push({ hash: sig.signature, to: walletAddress, value: diff, timestamp: (sig.blockTime ?? Date.now() / 1000) * 1000, contractVerified: true });
        }
      }
    } catch { /* skip */ }
  }
  return results;
}

export async function fetchChainTransfers(walletAddress: string, token: string, chain: string, orderTime = Date.now(), alchemyApiKey?: string): Promise<ChainTx[]> {
  const contracts = getContracts(token, chain);
  if (contracts.length === 0) throw new Error(`UNSUPPORTED_${token}_${chain}`);
  const decimals = getStablecoinDecimals(token, chain);
  // 全部数据源都失败时抛错(调用方显示“链上查询失败”),而不是返回空数组冒充“没到账”。
  // 至少一家成功时返回合并结果(即使为空,说明确实没到账)。
  // TRON / Solana 只有单一合约,用第一个即可;Alchemy key 配了就优先走 Alchemy,失败回退公共接口。
  if (chain === "trc20") return await fetchTrc20Transfers(walletAddress, contracts[0], decimals, alchemyApiKey);
  if (chain === "sol") return await fetchSolTransfers(walletAddress, contracts[0], decimals, alchemyApiKey);
  // EVM:配了 ALCHEMY_API_KEY 时优先走 Alchemy;Alchemy 失败时静默回退公共 RPC,
  // 避免 key 配错/某网络未启用时整条链直接不可用(回退路径自己的失败仍会正常抛错)。
  if (alchemyApiKey) {
    try {
      return await fetchEvmTransfersViaAlchemy(walletAddress, chain, contracts, decimals, orderTime, alchemyApiKey);
    } catch { /* fall through to public RPCs */ }
  }
  return await fetchEvmTransfers(walletAddress, chain, contracts, decimals, orderTime);
}

async function markOrderPaid(database: D1Database, orderId: number, txHash?: string): Promise<boolean> {
  const now = Date.now();
  const result = await database
    .prepare("UPDATE `order` SET status = 'PAID', paymentStatus = 'PAID', paidAt = ?, updatedAt = ?, paymentTxHash = COALESCE(?, paymentTxHash) WHERE id = ? AND status = 'PENDING' AND paymentStatus = 'UNPAID'")
    .bind(now, now, txHash ?? null, orderId)
    .run();
  if (result.meta.changes === 0) return false;
  await database
    .prepare("INSERT INTO automaticDeliveryJob (orderId, status, attemptCount, createdAt, updatedAt) VALUES (?, 'PENDING', 0, ?, ?) ON CONFLICT(orderId) DO NOTHING")
    .bind(orderId, now, now)
    .run();
  await database
    .prepare("INSERT INTO orderEvent (eventKey, orderId, scene, status, attemptCount, availableAt, createdAt, updatedAt) VALUES (?, ?, 'ORDER_PAID', 'PENDING', 0, ?, ?, ?) ON CONFLICT(eventKey) DO NOTHING")
    .bind(`order-paid:${orderId}`, orderId, now, now, now)
    .run();
  return true;
}

/** Check a single order against the chain. Returns true if paid. */
export async function checkSingleOrderPayment(database: D1Database, orderId: number, alchemyApiKey?: string): Promise<{ paid: boolean; message: string }> {
  const db = createDrizzleDb(database);
  const [record] = await db
    .select({ id: order.id, orderNo: order.orderNo, amount: order.amount, status: order.status, paymentStatus: order.paymentStatus, paymentChannel: order.paymentChannel, paymentChain: order.paymentChain, paymentAsset: order.paymentAsset, paymentTokenAmount: order.paymentTokenAmount, createdAt: order.createdAt })
    .from(order)
    .where(eq(order.id, orderId))
    .limit(1);
  if (!record) return { paid: false, message: "订单不存在" };
  if (record.paymentStatus === "PAID") return { paid: true, message: "订单已支付" };
  if (record.status !== "PENDING") return { paid: false, message: "订单状态不允许检查" };

  const providerId = Number(record.paymentChannel);
  if (!Number.isInteger(providerId) || providerId < 1) return { paid: false, message: "支付通道信息缺失" };
  const [provider] = await db.select().from(paymentProvider).where(eq(paymentProvider.id, providerId)).limit(1);
  if (!provider || provider.provider !== "MANUAL_USDT") return { paid: false, message: "未找到对应的USDT通道" };

  let walletAddress = "";
  let token = "usdt";
  let chain = "trc20";
  let exchangeRate = 7.2;
  try {
    const config = parseManualUsdtConfig(provider.configJson);
    // 优先用订单下单时选择的链/资产,老订单回退到渠道配置
    chain = record.paymentChain && config.chains.includes(record.paymentChain) ? record.paymentChain : config.chains[0] ?? "trc20";
    token = record.paymentAsset && config.assets.includes(record.paymentAsset) ? record.paymentAsset : config.assets[0] ?? "usdt";
    walletAddress = manualUsdtWalletForChain(config, chain);
    exchangeRate = Number(config.exchangeRate) || 7.2;
  } catch {
    return { paid: false, message: "支付配置解析失败" };
  }
  if (!walletAddress) return { paid: false, message: "该链未配置收款地址" };

  const orderTime = new Date(record.createdAt).getTime();
  let transfers: ChainTx[];
  try {
    transfers = await fetchChainTransfers(walletAddress, token, chain, orderTime, alchemyApiKey);
  } catch (cause) {
    reportUnexpectedServerError("manual-usdt-single-check", cause, { walletAddress, token, chain });
    return { paid: false, message: "链上查询失败，请稍后重试" };
  }

  // 优先用订单创建时存的唯一付款金额;老订单回退到按汇率计算
  const expected = typeof record.paymentTokenAmount === "number" && record.paymentTokenAmount > 0
    ? record.paymentTokenAmount
    : Number(((record.amount / 100) / exchangeRate).toFixed(2));
  // 唯一金额用极小容差精确匹配;老订单(无唯一金额)用宽容差兼容
  const tolerance = typeof record.paymentTokenAmount === "number" && record.paymentTokenAmount > 0 ? 0.00001 : 0.011;
  // orderTime 已在上面计算(用于锚定链上查询起点)
  // 已被其他订单用过的交易哈希不能重复使用
  const usedTxHashes = new Set(
    (await db.select({ paymentTxHash: order.paymentTxHash }).from(order).where(and(eq(order.paymentStatus, "PAID"), isNotNull(order.paymentTxHash))).limit(500))
      .map((r) => r.paymentTxHash as string)
  );
  const match = transfers.find((tx) => {
    if (!tx.contractVerified) return false;
    if (tx.to.toLowerCase() !== walletAddress.toLowerCase()) return false;
    if (Math.abs(tx.value - expected) > tolerance) return false;
    if (tx.timestamp < orderTime - 60000) return false;
    if (tx.hash && usedTxHashes.has(tx.hash.toLowerCase())) return false;
    return true;
  });

  if (!match) return { paid: false, message: "未检测到匹配的转账，请确认已按精确金额付款" };
  const ok = await markOrderPaid(database, record.id, match.hash);
  if (!ok) return { paid: false, message: "订单状态已变更" };
  // 支付日志:稳定币确认只写成功事件(自动检测每 10 秒查一次,不写失败日志避免刷屏)
  await new PaymentLogService(database).writeBestEffort({ orderId: record.id, provider: "MANUAL_USDT", orderNo: record.orderNo, eventType: "CONFIRM", verifyStatus: "VERIFIED", message: `STABLECOIN_CONFIRMED:${chain}:${token}:${expected}`, payload: { txHash: match.hash, chain, token, expectedAmount: expected, actualAmount: match.value } });
  // 马上发货:支付宝回调走 confirmOrderPayment 同步发货,稳定币之前只插任务等 5 分钟 cron,
  // 现在确认后立即触发(本地卡密直接发货,供应商订单立即创建采购任务;失败由任务重试)。
  // confirmOrderPayment 在已支付分支(PAID)里处理发货/供应商,不会重复标记支付。
  await confirmOrderPayment(database, record.id).catch((cause) => reportUnexpectedServerError("manual-usdt-confirm-delivery", cause, { orderId: record.id, orderNo: record.orderNo }));
  return { paid: true, message: "检测到付款，已确认并发货" };
}
