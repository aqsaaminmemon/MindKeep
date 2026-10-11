const paths = {
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  search: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 4.5 4.5"/>',
  filter:
    '<path d="M4 7h16M4 17h16"/><circle cx="9" cy="7" r="2" fill="var(--surface)"/><circle cx="15" cy="17" r="2" fill="var(--surface)"/>',
  grid: '<rect x="4" y="4" width="6" height="6" rx="1"/><rect x="14" y="4" width="6" height="6" rx="1"/><rect x="4" y="14" width="6" height="6" rx="1"/><rect x="14" y="14" width="6" height="6" rx="1"/>',
  list: '<rect x="4" y="4" width="16" height="6" rx="1"/><rect x="4" y="14" width="16" height="6" rx="1"/>',
  compact: '<path d="M8 5h12M8 12h12M8 19h12M4 5h.1M4 12h.1M4 19h.1"/>',
  settings:
    '<path d="m9 3-1 3-3 1 1 3-2 2 2 2-1 3 3 1 1 3h6l1-3 3-1-1-3 2-2-2-2 1-3-3-1-1-3z"/><circle cx="12" cy="12" r="3"/>',
  notes:
    '<rect x="5" y="3" width="14" height="18" rx="2"/><path d="M9 8h6M9 12h6M9 16h4"/>',
  bell: '<path d="M18 8a6 6 0 0 0-12 0c0 7-2 8-2 8h16s-2-1-2-8M10 20h4"/>',
  star: '<path d="m12 3 2.8 5.7 6.2.9-4.5 4.4 1.1 6.2-5.6-3-5.6 3 1.1-6.2L3 9.6l6.2-.9z"/>',
  clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
  archive:
    '<rect x="3" y="3" width="18" height="4" rx="1"/><path d="M5 7v13h14V7M10 11h4"/>',
  trash: '<path d="M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7"/>',
  folder: '<path d="M3 7V5h7l2 3h9v12H3z"/>',
  tag: '<path d="M3 3h8l10 10-8 8L3 11z"/><circle cx="7.5" cy="7.5" r="1"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  check:
    '<rect x="3" y="4" width="7" height="7" rx="1"/><path d="m4 7 2 2 4-4M14 7h7M14 17h7"/><rect x="3" y="14" width="7" height="7" rx="1"/>',
  image:
    '<rect x="3" y="3" width="18" height="18" rx="3"/><circle cx="8" cy="8" r="1.5"/><path d="m3 17 5-5 4 4 4-6 5 7"/>',
  mic: '<rect x="9" y="3" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/>',
  pin: '<path d="M8 3h8l-1 7 4 4H5l4-4zM12 14v7"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  close: '<path d="m6 6 12 12M6 18 18 6"/>',
  focus: '<path d="M8 3H3v5M16 3h5v5M3 16v5h5M21 16v5h-5"/>',
  lock: '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0v4M12 14v3"/>',
  unlock:
    '<rect x="5" y="10" width="14" height="11" rx="2"/><path d="M8 10V6a4 4 0 0 1 8 0M12 14v3"/>',
  copy: '<rect x="8" y="8" width="13" height="13" rx="2"/><path d="M16 8V3H3v13h5"/>',
  share:
    '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="m9 11 6-4M9 13l6 4"/>',
  download: '<path d="M12 3v12m-5-5 5 5 5-5M4 16v5h16v-5"/>',
  restore: '<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7M12 7v5l3 2"/>',
  logout: '<path d="M10 3H4v18h6M10 12h11m-4-4 4 4-4 4"/>',
  moon: '<path d="M20 14A9 9 0 0 1 10 4 9 9 0 1 0 20 14z"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M2 12h2M20 12h2M5 5l1 1M18 18l1 1M5 19l1-1M18 6l1-1"/>',
  heart: '<path d="M20 5c-3-3-6-1-8 1-2-2-5-4-8-1s-1 7 8 15c9-8 11-12 8-15z"/>',
};
export const icon = (name) =>
  `<svg viewBox="0 0 24 24" aria-hidden="true">${paths[name] || paths.notes}</svg>`;
export const escape = (s) =>
  String(s ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
export function cleanHTML(input) {
  const doc = new DOMParser().parseFromString(input, "text/html");
  const allowed = new Set([
    "P",
    "DIV",
    "BR",
    "B",
    "STRONG",
    "I",
    "EM",
    "U",
    "S",
    "STRIKE",
    "H1",
    "H2",
    "H3",
    "UL",
    "OL",
    "LI",
    "SPAN",
    "FONT",
    "BLOCKQUOTE",
  ]);
  for (const el of [...doc.body.querySelectorAll("*")]) {
    if (!allowed.has(el.tagName)) {
      if (["SCRIPT", "STYLE", "IFRAME", "OBJECT"].includes(el.tagName))
        el.remove();
      else el.replaceWith(...el.childNodes);
      continue;
    }
    for (const attr of [...el.attributes]) {
      const k = attr.name,
        v = attr.value;
      let valid = false;
      if (k === "data-checked") valid = ["true", "false"].includes(v);
      if (k === "color") valid = /^#[a-f0-9]{6}$/i.test(v);
      if (k === "face")
        valid = ["Poppins", "Garamond", "Arial", "Georgia", "Verdana", "monospace"].includes(v);
      if (k === "size") valid = /^[1-7]$/.test(v);
      if (k === "style") {
        let safe = "";
        for (const part of v.split(";")) {
          if (
            /^\s*(color|background-color)\s*:\s*(#[a-f0-9]{6}|rgb\([0-9 ,]{1,20}\))\s*$/i.test(
              part,
            ) ||
            /^\s*font-family\s*:\s*(Poppins|Garamond|Arial|Georgia|Verdana|monospace)\s*$/.test(
              part,
            ) ||
            /^\s*font-size\s*:\s*(12|14|16|18|20|24|32)px\s*$/.test(part)
          )
            safe += part + ";";
        }
        el.setAttribute(k, safe);
        valid = true;
      }
      if (!valid) el.removeAttribute(k);
    }
  }
  return doc.body.innerHTML;
}

// Map normalized Unicode matches back to original UTF-16 ranges without changing stored text.
export function matchRanges(text, terms) {
  const segmenter = new Intl.Segmenter(undefined, { granularity: "grapheme" });
  const casefold = (s) =>
    s
      .normalize("NFC")
      .toLowerCase()
      .replace(/ß/g, "ss")
      .replace(/ς/g, "σ")
      .replace(/ſ/g, "s")
      .replace(/ﬀ/g, "ff")
      .replace(/ﬁ/g, "fi")
      .replace(/ﬂ/g, "fl")
      .replace(/ﬃ/g, "ffi")
      .replace(/ﬄ/g, "ffl")
      .replace(/[ﬅﬆ]/g, "st");
  let normalized = "",
    map = [];
  for (const { segment, index } of segmenter.segment(text)) {
    const folded = casefold(segment);
    normalized += folded;
    for (let i = 0; i < folded.length; i++)
      map.push([index, index + segment.length]);
  }
  const ranges = [];
  for (const raw of terms) {
    const term = casefold(raw);
    if (!term) continue;
    let i = 0;
    while ((i = normalized.indexOf(term, i)) >= 0) {
      ranges.push([map[i][0], map[i + term.length - 1][1]]);
      i += term.length;
    }
  }
  ranges.sort((a, b) => a[0] - b[0]);
  const merged = [];
  for (const range of ranges) {
    const last = merged.at(-1);
    if (last && range[0] <= last[1]) last[1] = Math.max(last[1], range[1]);
    else merged.push(range);
  }
  return merged;
}
export function highlightedText(text, terms) {
  const ranges = matchRanges(text, terms);
  let output = "",
    offset = 0;
  for (const [start, end] of ranges) {
    output +=
      escape(text.slice(offset, start)) +
      "<mark>" +
      escape(text.slice(start, end)) +
      "</mark>";
    offset = end;
  }
  return output + escape(text.slice(offset));
}
