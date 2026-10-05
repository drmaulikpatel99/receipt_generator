import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

// ── Indian number-to-words ──────────────────────────────────────────────────
const ONES = [
  "", "One", "Two", "Three", "Four", "Five", "Six", "Seven", "Eight", "Nine",
  "Ten", "Eleven", "Twelve", "Thirteen", "Fourteen", "Fifteen", "Sixteen",
  "Seventeen", "Eighteen", "Nineteen",
];
const TENS = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

function wordsUpto999(n: number): string {
  if (n === 0) return "";
  if (n < 20) return ONES[n];
  if (n < 100) {
    const rest = n % 10 ? " " + ONES[n % 10] : "";
    return TENS[Math.floor(n / 10)] + rest;
  }
  const rest = n % 100 ? " " + wordsUpto999(n % 100) : "";
  return ONES[Math.floor(n / 100)] + " Hundred" + rest;
}

export function amountInWords(amount: number): string {
  let n = Math.round(amount);
  if (n === 0) return "Zero Rupees only";

  const parts: string[] = [];
  const crore = Math.floor(n / 10000000); n %= 10000000;
  const lakh  = Math.floor(n / 100000);   n %= 100000;
  const thou  = Math.floor(n / 1000);     n %= 1000;
  const rest  = n;

  if (crore) parts.push(wordsUpto999(crore) + " Crore");
  if (lakh)  parts.push(wordsUpto999(lakh)  + " Lakh");
  if (thou)  parts.push(wordsUpto999(thou)  + " Thousand");
  if (rest)  parts.push(wordsUpto999(rest));

  return parts.join(" ") + " Rupees only";
}

// ── Clean Scan Description ──────────────────────────────────────────────────
export function cleanScanDescription(scanDesc?: string | null): string {
  if (!scanDesc) return "";
  let s = String(scanDesc).trim();
  if (s.toUpperCase().startsWith("SONO:")) {
    s = s.slice(5).trim();
  } else if (s.toUpperCase().startsWith("SONO :")) {
    s = s.slice(6).trim();
  }
  return s.replace(/\s*\(\d+\)\s*$/, "").trim();
}

// ── UPI Payment Mode Checker ────────────────────────────────────────────────
export function isUpiMode(modeStr?: string | null): boolean {
  if (!modeStr) return false;
  const m = String(modeStr).toUpperCase();
  return ["UPI", "GPAY", "GOOGLE PAY", "GOOGLEPAY", "PHONEPE", "PAYTM", "BHIM", "QR"].some((k) =>
    m.includes(k)
  );
}

// ── Date Formatting Helpers ─────────────────────────────────────────────────
export function formatDateDMY(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${dd}-${mm}-${yyyy}`;
}

export function formatDateYMD(d: Date): string {
  const dd = String(d.getDate()).padStart(2, "0");
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const yyyy = d.getFullYear();
  return `${yyyy}-${mm}-${dd}`;
}

export function parseYMD(ymdStr: string): Date {
  const [y, m, d] = ymdStr.split("-").map(Number);
  return new Date(y, m - 1, d);
}

export function toSortableDate(dStr: string): string {
  try {
    const parts = dStr.replace(/\//g, "-").split("-");
    if (parts.length === 3) {
      return `${parts[2]}-${parts[1].padStart(2, "0")}-${parts[0].padStart(2, "0")}`;
    }
  } catch (e) {
    // fallback
  }
  return dStr;
}

// ── Financial Year Helper (April 1 to March 31) ─────────────────────────────
export function getFinancialYear(dateStr?: string | Date | null): string {
  let dateObj: Date;
  if (!dateStr) {
    dateObj = new Date();
  } else if (dateStr instanceof Date) {
    dateObj = dateStr;
  } else {
    const s = String(dateStr).trim();
    if (s.includes("-") || s.includes("/")) {
      const parts = s.replace(/\//g, "-").split("-").map(Number);
      if (parts[0] > 1000) {
        // YYYY-MM-DD
        dateObj = new Date(parts[0], parts[1] - 1, parts[2]);
      } else {
        // DD-MM-YYYY
        dateObj = new Date(parts[2], parts[1] - 1, parts[0]);
      }
    } else {
      dateObj = new Date(s);
    }
  }

  if (isNaN(dateObj.getTime())) {
    dateObj = new Date();
  }

  const year = dateObj.getFullYear();
  const month = dateObj.getMonth() + 1; // 1..12

  if (month >= 4) {
    // April to December
    const nextYearShort = String(year + 1).slice(-2);
    return `FY${year}-${nextYearShort}`;
  } else {
    // January to March
    const currentYearShort = String(year).slice(-2);
    return `FY${year - 1}-${currentYearShort}`;
  }
}
