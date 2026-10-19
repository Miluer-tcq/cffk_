export default function title(pageContext: { site?: { name?: string; subtitle?: string | null }; urlPathname?: string }) {
  const siteName = pageContext.site?.name || "星云Shop";
  // 首页标题带上站点副标题(含关键词),利于搜索;其余页保持品牌名(商品页有自己的 +title.ts)
  const subtitle = pageContext.site?.subtitle?.trim();
  if (pageContext.urlPathname === "/" && subtitle) return `${siteName} - ${subtitle}`;
  return siteName;
}
