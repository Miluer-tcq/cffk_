import { ICON_CHATGPT } from "./icons/chatgpt";
import { ICON_GEMINI } from "./icons/gemini";
import { ICON_MUSE } from "./icons/muse";
import { ICON_DUOLINGO } from "./icons/duolingo";
import { ICON_CLAUDE } from "./icons/claude";
import { ICON_TOOL } from "./icons/tool";
import { ICON_ADOBE } from "./icons/adobe";

export { ICON_CHATGPT, ICON_GEMINI, ICON_MUSE, ICON_DUOLINGO, ICON_CLAUDE, ICON_TOOL, ICON_ADOBE };

type IconKey = "chatgpt" | "gemini" | "muse" | "duolingo" | "claude" | "tool" | "adobe";

const KEYWORDS: Array<[RegExp, IconKey]> = [
  [/chatgpt|\bgpt\b/i, "chatgpt"],
  [/gemini/i, "gemini"],
  [/\bmuse\b/i, "muse"],
  [/claude/i, "claude"],
  [/duolingo|多邻国/i, "duolingo"],
  [/adobe/i, "adobe"],
  [/\btool\b|工具|效率/i, "tool"],
];

const ICONS: Record<IconKey, string> = {
  chatgpt: ICON_CHATGPT,
  gemini: ICON_GEMINI,
  muse: ICON_MUSE,
  duolingo: ICON_DUOLINGO,
  claude: ICON_CLAUDE,
  tool: ICON_TOOL,
  adobe: ICON_ADOBE,
};

/** Pick a brand icon for a category/product by name/slug keywords. Null when nothing matches. */
export function pickBrandIcon(name: string | null | undefined): string | null {
  if (!name) return null;
  for (const [re, key] of KEYWORDS) {
    if (re.test(name)) return ICONS[key];
  }
  return null;
}
