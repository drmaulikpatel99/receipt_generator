import { amountInWords } from "./utils";

export interface ReceiptStatusRecord {
  amount: number | null;
  bill_printed?: boolean;
}

export interface SavedReceiptItem {
  payment_id: string;
  patient_name: string;
  scan: string;
  payment_mode: string;
  total_charges: number;
  bill_printed: boolean;
  receipt_amount: number;
  referring_doctor: string;
  patient_phone: string;
  date: string;
  is_advance_group?: boolean;
}

export interface DaySummary {
  period: string;
  saved_at: string;
  totals: {
    total_patients: number;
    upi_patients: number;
    cash_patients: number;
    upi_amount: number;
    cash_amount: number;
    grand_total: number;
  };
  records: SavedReceiptItem[];
}

export interface MonthlySummaryData {
  year: number;
  month: string;
  last_updated: string;
  days: Record<string, { totals: DaySummary["totals"] }>;
  monthly_totals: {
    total_days_saved: number;
    total_patients: number;
    upi_patients: number;
    cash_patients: number;
    upi_amount: number;
    cash_amount: number;
    grand_total: number;
  };
}

const STATUS_KEY = "babyscan_receipt_status_v1";
const SAVED_BILLS_KEY = "babyscan_saved_bills_v1";

export function loadLocalStatus(): Record<string, ReceiptStatusRecord> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(STATUS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

export function saveLocalStatus(pid: string, amount: number | null, bill_printed?: boolean) {
  if (typeof window === "undefined") return;
  try {
    const current = loadLocalStatus();
    current[pid] = { amount, bill_printed };
    localStorage.setItem(STATUS_KEY, JSON.stringify(current));
  } catch (e) {
    console.error("Error saving status:", e);
  }
}

export function loadSavedBillsStore(): Record<string, SavedReceiptItem[]> {
  if (typeof window === "undefined") return {};
  try {
    const raw = localStorage.getItem(SAVED_BILLS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch (e) {
    return {};
  }
}

export function saveBillsToStore(dateLabel: string, items: SavedReceiptItem[]) {
  if (typeof window === "undefined") return;
  try {
    const store = loadSavedBillsStore();
    store[dateLabel] = items;
    localStorage.setItem(SAVED_BILLS_KEY, JSON.stringify(store));
  } catch (e) {
    console.error("Error saving bills to store:", e);
  }
}

// ── Text Report Formatters ──────────────────────────────────────────────────
export function generateDailyTextReport(s: DaySummary): string {
  const lines = [
    "=".repeat(76),
    "            BABYSCAN CLINIC — RECEIPT SUMMARY",
    "=".repeat(76),
    `  Period     : ${s.period}`,
    `  Generated  : ${s.saved_at}`,
    "=".repeat(76),
    `  ${"#".padEnd(4)}  ${"Date".padEnd(12)}  ${"Patient Name".padEnd(28)}  ${"Receipt No.".padEnd(12)}  ${"Amount".padStart(10)}`,
    "-".repeat(76),
  ];

  s.records.forEach((r, idx) => {
    const amt = r.receipt_amount ? `Rs.${Math.round(r.receipt_amount).toLocaleString()}` : "—";
    let name = r.patient_name || "";
    if (r.is_advance_group) {
      name = `[ADVANCE for APPOINTMENT] ${r.scan}`;
    }
    const rcNo = String(r.payment_id || "—");
    lines.push(
      `  ${String(idx + 1).padEnd(4)}  ${r.date.padEnd(12)}  ${name.slice(0, 26).padEnd(28)}  ${rcNo.slice(0, 12).padEnd(12)}  ${amt.padStart(10)}`
    );
  });

  const t = s.totals;
  lines.push(
    "=".repeat(76),
    `  Total Patients : ${t.total_patients}`,
    `  UPI Total      : Rs.${Math.round(t.upi_amount).toLocaleString()}  (${t.upi_patients} patients)`,
    `  Cash Total     : Rs.${Math.round(t.cash_amount).toLocaleString()}  (${t.cash_patients} patients)`,
    `  Grand Total    : Rs.${Math.round(t.grand_total).toLocaleString()}`,
    "=".repeat(76)
  );
  return lines.join("\n");
}

export function generateMonthlyTextReport(mdata: MonthlySummaryData): string {
  const monthStr = `${mdata.month} ${mdata.year}`;
  const lines = [
    "=".repeat(72),
    `          BABYSCAN CLINIC — MONTHLY SUMMARY REPORT (${monthStr.toUpperCase()})`,
    "=".repeat(72),
    `  Month        : ${monthStr}`,
    `  Last Updated : ${mdata.last_updated}`,
    "=".repeat(72),
    `  ${"Date".padEnd(14)}  ${"UPI Collection".padStart(16)}  ${"Cash Collection".padStart(16)}  ${"Day Total".padStart(16)}`,
    "-".repeat(72),
  ];

  const daysDict = mdata.days || {};
  Object.keys(daysDict).sort().forEach((dKey) => {
    const dt = daysDict[dKey]?.totals || { upi_amount: 0, cash_amount: 0, grand_total: 0 };
    const uAmt = dt.upi_amount || 0;
    const cAmt = dt.cash_amount || 0;
    const tot = dt.grand_total || 0;
    lines.push(
      `  ${dKey.padEnd(14)}  Rs.${Math.round(uAmt).toLocaleString().padStart(13)}  Rs.${Math.round(cAmt).toLocaleString().padStart(13)}  Rs.${Math.round(tot).toLocaleString().padStart(13)}`
    );
  });

  const mt = mdata.monthly_totals;
  lines.push(
    "=".repeat(72),
    `  DAYS SAVED           : ${mt.total_days_saved} day(s)`,
    `  TOTAL UPI PAYMENT    : Rs. ${Math.round(mt.upi_amount).toLocaleString()}`,
    `  TOTAL CASH PAYMENT   : Rs. ${Math.round(mt.cash_amount).toLocaleString()}`,
    `  MONTHLY GRAND TOTAL  : Rs. ${Math.round(mt.grand_total).toLocaleString()}`,
    "=".repeat(72)
  );
  return lines.join("\n");
}

export function generatePatientTextReceipt(r: SavedReceiptItem): string {
  const recNo = String(r.payment_id || "—");
  const name = String(r.patient_name || "—").toUpperCase();
  const scan = String(r.scan || "—");
  const mode = String(r.payment_mode || "—");
  const dateStr = String(r.date || "—");
  const amt = Number(r.receipt_amount || 0);
  const amtStr = amt ? `Rs. ${Math.round(amt).toLocaleString()}.00` : "Rs. 0.00";
  const words = amountInWords(amt);

  const lines = [
    "=".repeat(56),
    "         BABYSCAN FETAL MEDICINE & GYNEC IMAGING",
    " Rameshwar Complex, Dairy Road, Radhanpur Circle, Mehsana",
    "                 Phone: +91 9537222217",
    "=".repeat(56),
    `  RECEIPT NO.  : ${recNo}`,
    `  DATE         : ${dateStr}`,
    "-".repeat(56),
    `  PATIENT NAME : ${name}`,
    "-".repeat(56),
    `  ${"SCAN DESCRIPTION".padEnd(38)}  ${"AMOUNT".padStart(12)}`,
    "  " + "-".repeat(52),
    `  ${scan.slice(0, 38).padEnd(38)}  ${amtStr.padStart(12)}`,
    "-".repeat(56),
    `  TOTAL AMOUNT PAID          : ${amtStr}`,
    `  PAYMENT MODE               : ${mode}`,
    `  AMOUNT IN WORDS            : ${words}`,
    "=".repeat(56),
    "       Thank you for visiting Babyscan Clinic!",
    "=".repeat(56),
  ];
  return lines.join("\n");
}
