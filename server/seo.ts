import type { Context } from "hono";

type SeoBindings = { Bindings: Record<string, unknown> & { DB: D1Database } };

export function escapeXml(value: string) {
  return value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

/** sitemap.xml:首页 + 所有上架商品,供搜索引擎发现收录 */
export async function serveSitemap(context: Context<SeoBindings>) {
  const origin = new URL(context.req.url).origin;
  const urls: Array<{ loc: string; lastmod?: string }> = [{ loc: `${origin}/` }];
  try {
    const result = await (context.env.DB as D1Database)
      .prepare("SELECT slug, updatedAt FROM product_v2 WHERE status = 'ACTIVE' ORDER BY sort ASC, id ASC LIMIT 5000")
      .all<{ slug: string; updatedAt: number }>();
    for (const row of result.results ?? []) {
      if (!row.slug) continue;
      urls.push({
        loc: `${origin}/product/${encodeURIComponent(row.slug)}`,
        lastmod: row.updatedAt ? new Date(row.updatedAt).toISOString().slice(0, 10) : undefined,
      });
    }
  } catch {
    // 商品查询失败时降级为仅首页,不影响 sitemap 可用性
  }
  const body = `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls
    .map((item) => `  <url>\n    <loc>${escapeXml(item.loc)}</loc>${item.lastmod ? `\n    <lastmod>${item.lastmod}</lastmod>` : ""}\n  </url>`)
    .join("\n")}\n</urlset>`;
  return context.body(body, 200, { "content-type": "application/xml; charset=utf-8", "cache-control": "public, max-age=3600" });
}
