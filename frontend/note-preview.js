import { escape } from "./icons.js";

// Keep text emphasis without copying editor layouts or HTML attributes into cards.
export function formattedPreview(root, limit = 270) {
  const inline = new Set(["B", "STRONG", "I", "EM", "U", "S", "STRIKE"]);
  const blocks = new Set(["P", "DIV", "H1", "H2", "H3", "LI", "BLOCKQUOTE"]);
  const hidden = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "SVG", "TEMPLATE"]);
  let length = 0, last = "";
  const text = (value) => {
    const part = value.slice(0, Math.max(0, limit - length));
    length += part.length;
    if (part) last = part.at(-1);
    return escape(part);
  };
  const lineBreak = () => length && last !== "\n" ? text("\n") : "";
  const visit = (node) => {
    if (length >= limit) return "";
    if (node.nodeType === 3) return text(node.textContent || "");
    const tag = node.tagName;
    if (hidden.has(tag)) return "";
    if (tag === "BR") return text("\n");
    const prefix = blocks.has(tag) ? lineBreak() : "";
    const content = Array.from(node.childNodes || [], visit).join("");
    const suffix = blocks.has(tag) ? lineBreak() : "";
    if (inline.has(tag) && content)
      return `${prefix}<${tag.toLowerCase()}>${content}</${tag.toLowerCase()}>${suffix}`;
    return prefix + content + suffix;
  };
  return visit(root).trim();
}
