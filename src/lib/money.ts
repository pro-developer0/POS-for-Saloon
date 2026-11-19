// Money is handled as integer minor units (cents) to avoid floating point errors.
export const toCents = (v: string | number | null | undefined): number => {
  if (v === null || v === undefined || v === "") return 0;
  const s = typeof v === "number" ? v.toFixed(2) : v;
  const neg = s.startsWith("-");
  const [i, f = ""] = s.replace("-", "").split(".");
  const c = parseInt(i || "0", 10) * 100 + parseInt((f + "00").slice(0, 2), 10);
  return neg ? -c : c;
};
export const fromCents = (c: number): string => {
  const neg = c < 0;
  const a = Math.abs(Math.round(c));
  return `${neg ? "-" : ""}${Math.floor(a / 100)}.${String(a % 100).padStart(2, "0")}`;
};
/** percent may have 2 decimals (e.g. "8.25"); result rounded half-up to cents */
export const pctOf = (cents: number, pct: string | number): number =>
  Math.round((cents * Math.round(Number(pct) * 100)) / 10000);

export function formatMoney(v: string | number | null | undefined, currency: string, locale = "en"): string {
  const n = typeof v === "number" ? v : toCents(v) / 100;
  try {
    return new Intl.NumberFormat(locale, { style: "currency", currency, maximumFractionDigits: currency === "PKR" ? 0 : 2 }).format(n);
  } catch {
    return `${currency} ${n.toFixed(2)}`;
  }
}
