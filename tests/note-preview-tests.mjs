import assert from "node:assert/strict";
import { formattedPreview } from "../frontend/note-preview.js";
const text = value => ({ nodeType: 3, textContent: value });
const el = (tagName, ...childNodes) => ({ nodeType: 1, tagName, childNodes });
const rich = el("BODY", el("P", text("Normal "), el("B", text("bold "),
  el("I", text("bold italic"))), text(" and "), el("EM", text("italic"))),
  el("P", el("U", text("underlined")), text(" "), el("S", text("struck"))));
assert.equal(formattedPreview(rich),
  "Normal <b>bold <i>bold italic</i></b> and <em>italic</em>\n<u>underlined</u> <s>struck</s>");
assert.equal(formattedPreview(el("BODY", el("B", text("abcdef")), text("extra")), 4),
  "<b>abcd</b>");
assert.equal(formattedPreview(el("BODY", el("SCRIPT", text("alert(1)")),
  el("IMG"), el("A", text("<safe>&")))), "&lt;safe&gt;&amp;");
assert.equal(formattedPreview(el("BODY")), "");
console.log("PASS: preview emphasis, nested bold/italic, line breaks, safe truncation and escaped content");
