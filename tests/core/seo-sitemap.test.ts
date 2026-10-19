import { describe, expect, test } from "bun:test";
import { Hono } from "hono";
import { serveSitemap } from "../../server/seo";
import { createTestDatabase } from "../helpers/sqlite-d1";

function buildSeoApp(db: D1Database) {
  const app = new Hono<{ Bindings: { DB: D1Database } }>();
  app.get("/sitemap.xml", serveSitemap);
  return {
    get: (path: string) => app.request(path, {}, { DB: db }),
  };
}

describe("SEO: sitemap.xml", () => {
  test("只收录上架商品,下架/草稿商品不出现", async () => {
    const { database, close } = createTestDatabase();
    try {
      const now = Date.now();
      await database.prepare("INSERT INTO product_v2 (name, slug, status, sort, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
        .bind("在售商品", "active-product", "ACTIVE", 0, now, now).run();
      await database.prepare("INSERT INTO product_v2 (name, slug, status, sort, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
        .bind("下架商品", "inactive-product", "INACTIVE", 0, now, now).run();
      await database.prepare("INSERT INTO product_v2 (name, slug, status, sort, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
        .bind("草稿商品", "draft-product", "DRAFT", 0, now, now).run();

      const res = await buildSeoApp(database).get("https://xyshop.eu.cc/sitemap.xml");
      expect(res.status).toBe(200);
      expect(res.headers.get("content-type")).toContain("application/xml");
      const xml = await res.text();
      expect(xml).toContain("<loc>https://xyshop.eu.cc/</loc>");
      expect(xml).toContain("<loc>https://xyshop.eu.cc/product/active-product</loc>");
      expect(xml).not.toContain("inactive-product");
      expect(xml).not.toContain("draft-product");
      expect(xml).toContain("<lastmod>");
    } finally {
      close();
    }
  });

  test("特殊字符 slug 正确转义,空库仍返回首页", async () => {
    const { database, close } = createTestDatabase();
    try {
      const now = Date.now();
      await database.prepare("INSERT INTO product_v2 (name, slug, status, sort, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, ?)")
        .bind("特殊商品", "a&b<c>", "ACTIVE", 0, now, now).run();

      const res = await buildSeoApp(database).get("https://xyshop.eu.cc/sitemap.xml");
      const xml = await res.text();
      expect(xml).toContain("a%26b%3Cc%3E");
      expect(xml).not.toContain("<loc>https://xyshop.eu.cc/product/a&b<c></loc>");

      // 清空商品后仍应返回合法 sitemap
      await database.prepare("DELETE FROM product_v2").run();
      const empty = await buildSeoApp(database).get("https://xyshop.eu.cc/sitemap.xml");
      expect(empty.status).toBe(200);
      const emptyXml = await empty.text();
      expect(emptyXml).toContain("<loc>https://xyshop.eu.cc/</loc>");
    } finally {
      close();
    }
  });
});
