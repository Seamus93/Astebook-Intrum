// lib/text.js
export const norm = (text) =>
  (text || "")
    .replace(/\r\n?/g, "\n")
    .replace(/[\t\f\v]+/g, " ")
    .replace(/\u00A0/g, " ")
    .replace(/[ ]{2,}/g, " ")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

export const splitLines = (text) => norm(text).split("\n").map(s => s.trim()).filter(Boolean);

export const moneyNum = (s) => {
  if (!s) return null;
  const n = parseFloat(String(s).replace(/\./g,"").replace(",",".").replace(/[^\d.-]/g,""));
  return Number.isNaN(n) ? null : Number(n.toFixed(2));
};

export function toISODate(s) {
  if (!s) return null;
  let m = s.match(/(\d{1,2})[\/\.-](\d{1,2})[\/\.-](\d{4})/);
  if (m) return `${m[3]}-${m[2].padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  const mon = {gen:1,feb:2,mar:3,apr:4,mag:5,giu:6,lug:7,ago:8,set:9,ott:10,nov:11,dic:12};
  m = s.toLowerCase().match(/(\d{1,2})\s+([a-zà-ù]+)\s+(\d{4})/i);
  if (m) {
    const mm = mon[m[2].slice(0,3).normalize("NFD").replace(/\p{Diacritic}/gu,"")];
    if (mm) return `${m[3]}-${String(mm).padStart(2,"0")}-${m[1].padStart(2,"0")}`;
  }
  return null;
}

export const slug = (s) =>
  (s || "")
    .normalize("NFD").replace(/\p{Diacritic}/gu,"")
    .replace(/[^a-z0-9]+/gi,"-").replace(/^-+|-+$/g,"")
    .toLowerCase()
    .slice(0,140);

export function pickNear(text, labelRe, valueRe, window = 200) {
  const m = text.match(new RegExp(`${labelRe.source}[\\s\\S]{0,${window}}?(${valueRe.source})`, "i"));
  return m?.[1] || null;
}
export function pickLabelLine(lines, labelRe) {
  const i = lines.findIndex(l => labelRe.test(l));
  return i >= 0 ? (lines[i+1] || null) : null;
}
export function yesNoNormalize(s) {
  if (!s) return null;
  const t = s.toLowerCase();
  if (/(s[iì]|yes)/i.test(t)) return "SI";
  if (/no/i.test(t)) return "NO";
  return null;
}
