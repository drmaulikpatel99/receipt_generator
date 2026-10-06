"use client";

import React, { useState, useEffect } from "react";
import {
  Calendar,
  Save,
  BarChart3,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  Sparkles,
  Settings,
  Lock,
} from "lucide-react";
import {
  fetchPaymentsByDateRange,
  SupabasePaymentRecord,
  getCurrentUser,
} from "@/lib/supabase";
import {
  loadLocalStatus,
  saveLocalStatus,
  saveBillsToStore,
  generateDailyTextReport,
  generateMonthlyTextReport,
  generateMonthlyExcelBase64,
  generatePatientTextReceipt,
  SavedReceiptItem,
  DaySummary,
  MonthlySummaryData,
  loadSavedBillsStore,
} from "@/lib/appStorage";
import {
  formatDateDMY,
  formatDateYMD,
  parseYMD,
  cleanScanDescription,
  isUpiMode,
  getFinancialYear,
} from "@/lib/utils";
import { YearlySummaryModal } from "./YearlySummaryModal";
import { SettingsAuthModal } from "./SettingsAuthModal";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

// Helper to calculate effective receipt amount & split totals (Cash + UPI)
export function calculateRecordSplit(
  r: SupabasePaymentRecord,
  printed: boolean,
  manualAmtStr?: string
) {
  const c1 = Number(r.collected_today || 0);
  const c2 = Number(r.collected_today2 || 0);

  const isUpi1 = isUpiMode(r.collected_mode);
  const isUpi2 = isUpiMode(r.collected_mode2);

  const upiPortion = (isUpi1 ? c1 : 0) + (isUpi2 ? c2 : 0);
  const cashPortion = (!isUpi1 ? c1 : 0) + (!isUpi2 ? c2 : 0);
  const totalCharges = c1 + c2;

  const isPureUpi = upiPortion > 0 && cashPortion === 0;
  const isPureCash = cashPortion > 0 && upiPortion === 0;
  const isSplit = upiPortion > 0 && cashPortion > 0;

  let effectiveReceiptAmount = 0;
  let effectiveUpi = upiPortion;
  let effectiveCash = 0;

  if (isPureUpi) {
    effectiveReceiptAmount = totalCharges;
    effectiveUpi = totalCharges;
    effectiveCash = 0;
  } else if (printed) {
    // If Bill IS Printed -> Include WHOLE amount (Cash + UPI)
    effectiveReceiptAmount = totalCharges;
    effectiveUpi = upiPortion;
    effectiveCash = cashPortion;
  } else {
    // If Bill is NOT Printed -> Include ONLY UPI Portion unless manual cash is entered
    if (manualAmtStr && Number(manualAmtStr) > 0) {
      effectiveCash = Number(manualAmtStr);
      effectiveReceiptAmount = upiPortion + effectiveCash;
    } else {
      effectiveReceiptAmount = upiPortion;
      effectiveUpi = upiPortion;
      effectiveCash = 0; // Exclude cash portion
    }
  }

  return {
    upiPortion,
    cashPortion,
    totalCharges,
    isPureUpi,
    isPureCash,
    isSplit,
    effectiveReceiptAmount,
    effectiveUpi,
    effectiveCash,
  };
}

export function ReceiptGeneratorApp() {
  const todayYMD = formatDateYMD(new Date());

  const [fromYMD, setFromYMD] = useState<string>(todayYMD);
  const [toYMD, setToYMD] = useState<string>(todayYMD);

  const [rawRecords, setRawRecords] = useState<SupabasePaymentRecord[]>([]);
  const [rowStates, setRowStates] = useState<Record<string, { amountStr: string; printed: boolean }>>({});

  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [statusMsg, setStatusMsg] = useState<string>("Ready");

  const [isFYModalOpen, setIsFYModalOpen] = useState<boolean>(false);
  const [isSettingsOpen, setIsSettingsOpen] = useState<boolean>(false);
  const [currentUserEmail, setCurrentUserEmail] = useState<string | null>(null);

  const [driveSyncStatus, setDriveSyncStatus] = useState<string>("");
  const [failedSyncPids, setFailedSyncPids] = useState<Record<string, string>>({});

  // Check auth user on mount
  useEffect(() => {
    getCurrentUser().then((user) => {
      if (user?.email) {
        setCurrentUserEmail(user.email);
      } else {
        const localEmail = typeof window !== "undefined" ? localStorage.getItem("sb_email") : null;
        setCurrentUserEmail(localEmail || null);
      }
    });
  }, []);

  // Load patient data from Supabase + Financial Year Excel status from Drive
  const handleLoadData = async (from: string, to: string) => {
    setIsLoading(true);
    setStatusMsg("⏳ Fetching records from database & Google Drive Excel...");
    try {
      const rawData = await fetchPaymentsByDateRange(from, to);

      // Financial Filter: Exclude ₹0 payment entries and Cash Advance Appointments
      const data = rawData.filter((r) => {
        const c1 = Number(r.collected_today || 0);
        const c2 = Number(r.collected_today2 || 0);
        const adv = Number((r as any).advance_amount || 0);

        // 1. Exclude ₹0 payment entries
        if (c1 + c2 + adv === 0) return false;

        // 2. Detect Advance Appointment
        const isAdvance =
          Boolean(r.is_advance_booking) ||
          String(r.scan_description || "").toLowerCase().includes("advance");

        const modeStr = (r.collected_mode || "") + " " + (r.collected_mode2 || "");
        const isUpi = isUpiMode(modeStr);

        // 3. Exclude Advance for Appointment paid in Cash
        if (isAdvance && !isUpi) {
          return false;
        }

        return true;
      });

      setRawRecords(data);

      const localStatus = loadLocalStatus();
      const initialStates: Record<string, { amountStr: string; printed: boolean }> = {};

      data.forEach((r) => {
        const pid = String(r.id);
        const stored = localStatus[pid];
        const printed = stored?.bill_printed !== undefined ? stored.bill_printed : Boolean(r.bill_printed);
        const amtVal = stored?.amount !== undefined && stored?.amount !== null ? String(Math.round(stored.amount)) : "";
        initialStates[pid] = { amountStr: amtVal, printed };
      });

      // Fetch Master Excel status map from Google Drive for the Financial Year
      const fy = getFinancialYear(from);
      try {
        const driveRes = await fetch(`/api/drive/excel-sync?fy=${fy}`);
        if (driveRes.ok) {
          const driveData = await driveRes.json();
          if (driveData.success && driveData.statusMap) {
            const driveMap = driveData.statusMap;
            data.forEach((r) => {
              const pid = String(r.id);
              if (driveMap[pid]) {
                const dAmt = driveMap[pid].amount;
                const dPrinted = driveMap[pid].bill_printed;
                const amtStr = dAmt !== null && dAmt !== undefined && dAmt > 0
                  ? String(Math.round(dAmt))
                  : initialStates[pid]?.amountStr || "";
                const printed = dPrinted || initialStates[pid]?.printed || false;
                initialStates[pid] = { amountStr: amtStr, printed };
                saveLocalStatus(pid, dAmt, printed);
              }
            });
            setDriveSyncStatus(`☁️ Synced with Master Excel (${fy})`);
          }
        }
      } catch (excelErr) {
        console.warn("Could not fetch Master Excel from Drive, using local cache:", excelErr);
      }

      setRowStates(initialStates);
      setStatusMsg(`Loaded ${data.length} records • (${from} → ${to})`);
    } catch (err: any) {
      console.error(err);
      const errText = err.message || String(err);
      if (errText.includes("row-level security") || errText.includes("JWT") || errText.includes("401") || errText.includes("403")) {
        setStatusMsg("❌ Auth Required. Please log in in Settings ⚙️");
        setIsSettingsOpen(true);
      } else {
        setStatusMsg(`❌ Error: ${errText}`);
      }
    } finally {
      setIsLoading(false);
    }
  };

  // Initial load on mount only (for Today)
  useEffect(() => {
    handleLoadData(todayYMD, todayYMD);
  }, []);

  const refreshAuthUser = () => {
    getCurrentUser().then((user) => {
      if (user?.email) {
        setCurrentUserEmail(user.email);
      } else {
        const localEmail = typeof window !== "undefined" ? localStorage.getItem("sb_email") : null;
        setCurrentUserEmail(localEmail || null);
      }
    });
    handleLoadData(fromYMD, toYMD);
  };

  // Quick Date Range Selectors
  const setQuickToday = () => {
    const d = formatDateYMD(new Date());
    setFromYMD(d); setToYMD(d);
    handleLoadData(d, d);
  };

  const setQuickYesterday = () => {
    const prev = new Date();
    prev.setDate(prev.getDate() - 1);
    const d = formatDateYMD(prev);
    setFromYMD(d); setToYMD(d);
    handleLoadData(d, d);
  };

  const setQuickLast7 = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);
    const s = formatDateYMD(start);
    const e = formatDateYMD(end);
    setFromYMD(s); setToYMD(e);
    handleLoadData(s, e);
  };

  const setQuickThisMonth = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    const s = formatDateYMD(start);
    const e = formatDateYMD(now);
    setFromYMD(s); setToYMD(e);
    handleLoadData(s, e);
  };

  // Toggle Bill Printed status
  const handleTogglePrinted = (pid: string, isUpi: boolean, totalCharges: number) => {
    setRowStates((prev) => {
      const current = prev[pid] || { amountStr: "", printed: false };
      const nextPrinted = !current.printed;
      const nextAmtStr = nextPrinted ? String(Math.round(totalCharges)) : current.amountStr;

      const updated = { ...prev, [pid]: { amountStr: nextAmtStr, printed: nextPrinted } };

      const amtNum = nextAmtStr ? Number(nextAmtStr) : null;
      saveLocalStatus(pid, amtNum, nextPrinted);

      return updated;
    });
  };

  // Update Manual Amount
  const handleAmountChange = (pid: string, val: string) => {
    setRowStates((prev) => {
      const current = prev[pid] || { amountStr: "", printed: false };
      const updated = { ...prev, [pid]: { ...current, amountStr: val } };

      const amtNum = val ? Number(val) : null;
      saveLocalStatus(pid, amtNum, current.printed);

      return updated;
    });
  };

  // Process all patient records (including advance bookings with patient names)
  const normalRecords: SupabasePaymentRecord[] = rawRecords;

  // Compute Statistics
  let patientCount = normalRecords.length;

  let upiTotal = 0;
  let cashTotal = 0;

  // Process Records stats
  normalRecords.forEach((r) => {
    const pid = String(r.id);
    const state = rowStates[pid] || { amountStr: "", printed: Boolean(r.bill_printed) };
    const split = calculateRecordSplit(r, state.printed, state.amountStr);

    upiTotal += split.effectiveUpi;
    cashTotal += split.effectiveCash;
  });

  const grandTotal = upiTotal + cashTotal;

  // Helper: Auto-sync generated reports to Google Drive API
  const syncToDrive = async (
    filename: string,
    content: string,
    subfolderPath: string[] = [],
    mimeType: string = "text/plain",
    isBase64: boolean = false
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      setDriveSyncStatus(`☁️ Syncing ${filename}...`);
      const resp = await fetch("/api/drive/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, content, folderPath: subfolderPath, mimeType, isBase64 }),
      });
      const resData = await resp.json();
      if (resp.ok && resData.success && !resData.simulated) {
        setDriveSyncStatus(`☁️ Google Drive: Synced ${filename}`);
        return { success: true };
      } else {
        const errMsg = resData.error || resData.message || "Google Drive credentials not set on Vercel";
        setDriveSyncStatus(`⚠️ Drive sync: ${errMsg}`);
        return { success: false, error: errMsg };
      }
    } catch (e: any) {
      const errMsg = e.message || "Offline / Network Error";
      setDriveSyncStatus(`⚠️ Drive sync error: ${errMsg}`);
      return { success: false, error: errMsg };
    }
  };

  // Retry single patient receipt sync to Google Drive
  const handleRetryPatientSync = async (r: SupabasePaymentRecord) => {
    const pid = String(r.id);
    const state = rowStates[pid] || { amountStr: "", printed: Boolean(r.bill_printed) };
    const split = calculateRecordSplit(r, state.printed, state.amountStr);

    const isAdvance = Boolean(r.is_advance_booking) || String(r.scan_description || "").toLowerCase().includes("advance");
    const origScan = isAdvance ? "Advance for Appointment" : cleanScanDescription(r.scan_description);

    let activeScan = origScan;
    if (!isUpiMode(r.collected_mode) && !state.printed && state.amountStr && Number(state.amountStr) > 0) {
      activeScan = "Fetal Well Being";
    }

    const item: SavedReceiptItem = {
      payment_id: pid,
      patient_name: r.patient_name || "—",
      scan: activeScan,
      payment_mode: r.collected_mode || "—",
      total_charges: split.totalCharges,
      bill_printed: state.printed,
      receipt_amount: split.effectiveReceiptAmount,
      cash_amount: split.effectiveCash,
      upi_amount: split.effectiveUpi,
      referring_doctor: r.referring_doctor || "",
      patient_phone: r.patient_phone || "",
      date: r.collected_date || "",
    };

    let dObj = parseYMD(fromYMD);
    if (item.date) {
      const str = String(item.date).trim();
      if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(str)) {
        dObj = parseYMD(str.substring(0, 10));
      } else if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(str)) {
        const p = str.split(/[-/]/);
        const d = parseInt(p[0], 10);
        const m = parseInt(p[1], 10) - 1;
        const y = parseInt(p[2], 10);
        dObj = new Date(y, m, d);
      }
    }
    const dateLabel = formatDateDMY(dObj);
    const yearStr = String(dObj.getFullYear());
    const monthName = MONTH_NAMES[dObj.getMonth() + 1];

    const receiptTxt = generatePatientTextReceipt(item);
    const sanName = item.patient_name.replace(/[^a-z0-9]/gi, "_").substring(0, 20);
    const filename = `Receipt_${item.payment_id}_${sanName}.txt`;

    const res = await syncToDrive(filename, receiptTxt, [
      "Saved_Receipts",
      yearStr,
      monthName,
      dateLabel,
      "Individual_Receipts",
    ]);

    if (res.success) {
      setFailedSyncPids((prev) => {
        const copy = { ...prev };
        delete copy[pid];
        return copy;
      });
      alert(`✅ Google Drive sync succeeded for ${item.patient_name}!`);
    } else {
      alert(`❌ Retry failed for ${item.patient_name}: ${res.error || "Drive sync error"}`);
    }
  };

  // Save Bills Action
  const handleSaveBills = async () => {
    if (rawRecords.length === 0) {
      alert("No patients loaded to save.");
      return;
    }

    const savedItems: SavedReceiptItem[] = [];
    let upiT = 0, cashT = 0, upiN = 0, cashN = 0;
    const newFailedPids: Record<string, string> = {};

    // Normal and advance patient records
    normalRecords.forEach((r) => {
      const pid = String(r.id);
      const state = rowStates[pid] || { amountStr: "", printed: Boolean(r.bill_printed) };
      const split = calculateRecordSplit(r, state.printed, state.amountStr);

      const isAdvance = Boolean(r.is_advance_booking) || String(r.scan_description || "").toLowerCase().includes("advance");
      const origScan = isAdvance ? "Advance for Appointment" : cleanScanDescription(r.scan_description);

      let activeScan = origScan;
      if (!isUpiMode(r.collected_mode) && !state.printed && state.amountStr && Number(state.amountStr) > 0) {
        activeScan = "Fetal Well Being";
      }

      savedItems.push({
        payment_id: pid,
        patient_name: r.patient_name || "—",
        scan: activeScan,
        payment_mode: r.collected_mode || "—",
        total_charges: split.totalCharges,
        bill_printed: state.printed,
        receipt_amount: split.effectiveReceiptAmount,
        cash_amount: split.effectiveCash,
        upi_amount: split.effectiveUpi,
        referring_doctor: r.referring_doctor || "",
        patient_phone: r.patient_phone || "",
        date: r.collected_date || "",
      });

      if (split.effectiveUpi > 0) {
        upiT += split.effectiveUpi;
        upiN += 1;
      }
      if (split.effectiveCash > 0) {
        cashT += split.effectiveCash;
        if (split.effectiveUpi === 0) {
          cashN += 1;
        }
      }
    });

    const firstDateObj = parseYMD(fromYMD);
    const failedSyncs: { filename: string; error?: string }[] = [];

    // Helper to group saved items by their actual date
    const itemsByDate: Record<
      string,
      { items: SavedReceiptItem[]; dateObj: Date; yearStr: string; monthName: string }
    > = {};

    savedItems.forEach((item) => {
      let dObj = firstDateObj;
      if (item.date) {
        const str = String(item.date).trim();
        if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(str)) {
          dObj = parseYMD(str.substring(0, 10));
        } else if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(str)) {
          const p = str.split(/[-/]/);
          const d = parseInt(p[0], 10);
          const m = parseInt(p[1], 10) - 1;
          const y = parseInt(p[2], 10);
          dObj = new Date(y, m, d);
        }
      }
      const dLabel = formatDateDMY(dObj);
      const yStr = String(dObj.getFullYear());
      const mName = MONTH_NAMES[dObj.getMonth() + 1];

      if (!itemsByDate[dLabel]) {
        itemsByDate[dLabel] = { items: [], dateObj: dObj, yearStr: yStr, monthName: mName };
      }
      itemsByDate[dLabel].items.push(item);
    });

    // Save items day-by-day to local store & sync individual receipts & daily summary per day
    for (const [dLabel, dayGroup] of Object.entries(itemsByDate)) {
      saveBillsToStore(dLabel, dayGroup.items);

      // 1. Generate individual receipts for this day
      for (const item of dayGroup.items) {
        if (item.is_advance_group) continue;
        const receiptTxt = generatePatientTextReceipt(item);
        const sanName = item.patient_name.replace(/[^a-z0-9]/gi, "_").substring(0, 20);
        const filename = `Receipt_${item.payment_id}_${sanName}.txt`;

        const res = await syncToDrive(filename, receiptTxt, [
          "Saved_Receipts",
          dayGroup.yearStr,
          dayGroup.monthName,
          dLabel,
          "Individual_Receipts",
        ]);
        if (!res.success) {
          failedSyncs.push({ filename, error: res.error });
          newFailedPids[item.payment_id] = res.error || "Drive sync failed";
        }
      }

      // 2. Generate Daily Summary Report for this day
      let dUpiT = 0, dCashT = 0, dUpiN = 0, dCashN = 0;
      dayGroup.items.forEach((it) => {
        if (it.upi_amount && it.upi_amount > 0) {
          dUpiT += it.upi_amount;
          dUpiN += 1;
        }
        if (it.cash_amount && it.cash_amount > 0) {
          dCashT += it.cash_amount;
          if (!it.upi_amount || it.upi_amount === 0) dCashN += 1;
        }
      });

      const daySummaryObj: DaySummary = {
        period: dLabel,
        saved_at: new Date().toLocaleString(),
        totals: {
          total_patients: dayGroup.items.length,
          upi_patients: dUpiN,
          cash_patients: dCashN,
          upi_amount: dUpiT,
          cash_amount: dCashT,
          grand_total: dUpiT + dCashT,
        },
        records: dayGroup.items,
      };
      const daySummaryTxt = generateDailyTextReport(daySummaryObj);
      const summaryFilename = `summary_${dLabel}.txt`;
      const dayRes = await syncToDrive(summaryFilename, daySummaryTxt, [
        "Saved_Receipts",
        dayGroup.yearStr,
        dayGroup.monthName,
        dLabel,
      ]);
      if (!dayRes.success) {
        failedSyncs.push({ filename: summaryFilename, error: dayRes.error });
      }
    }

    // Sync Financial Year Master Excel to Google Drive
    const primaryDateLabel = formatDateDMY(firstDateObj);
    const fy = getFinancialYear(firstDateObj);
    let masterExcelRows: any[] = [];
    try {
      const excelRes = await fetch("/api/drive/excel-sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fy,
          dateLabel: primaryDateLabel,
          items: savedItems,
        }),
      });
      const excelJson = await excelRes.json();
      if (!excelJson.success) {
        failedSyncs.push({ filename: `Master_Receipts_${fy}.xlsx`, error: excelJson.error || "Excel sync failed" });
      } else {
        setDriveSyncStatus(`☁️ Master Excel (${fy}) synced to Google Drive!`);
        if (Array.isArray(excelJson.allRows)) {
          masterExcelRows = excelJson.allRows;
        }
      }
    } catch (eErr: any) {
      failedSyncs.push({ filename: `Master_Receipts_${fy}.xlsx`, error: eErr.message || String(eErr) });
    }

    // Build Monthly Summary Report (using Master Excel rows as authoritative multi-device source)
    const targetMonth = firstDateObj.getMonth() + 1;
    const targetYear = firstDateObj.getFullYear();
    const daysSummaryMap: Record<string, { totals: DaySummary["totals"] }> = {};
    const dayDataAccumulator: Record<string, { upiT: number; cashT: number; upiN: number; cashN: number; totalPts: number }> = {};

    if (masterExcelRows.length > 0) {
      masterExcelRows.forEach((row) => {
        const rawDate = String(row["Date"] || "").trim();
        if (!rawDate) return;

        let dNum = 0, mNum = 0, yNum = 0;
        if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(rawDate)) {
          const p = rawDate.split(/[-/]/);
          yNum = parseInt(p[0], 10);
          mNum = parseInt(p[1], 10);
          dNum = parseInt(p[2], 10);
        } else if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(rawDate)) {
          const p = rawDate.split(/[-/]/);
          dNum = parseInt(p[0], 10);
          mNum = parseInt(p[1], 10);
          yNum = parseInt(p[2], 10);
        }

        if (mNum === targetMonth && yNum === targetYear) {
          const dStr = String(dNum).padStart(2, "0");
          const mStr = String(mNum).padStart(2, "0");
          const formattedDateKey = `${dStr}-${mStr}-${yNum}`;

          if (!dayDataAccumulator[formattedDateKey]) {
            dayDataAccumulator[formattedDateKey] = { upiT: 0, cashT: 0, upiN: 0, cashN: 0, totalPts: 0 };
          }
          const acc = dayDataAccumulator[formattedDateKey];
          const cashVal = Number(row["Cash (₹)"] || 0);
          const upiVal = Number(row["UPI (₹)"] || 0);

          acc.totalPts += 1;
          acc.upiT += upiVal;
          acc.cashT += cashVal;
          if (upiVal > 0) acc.upiN += 1;
          if (cashVal > 0 && upiVal === 0) acc.cashN += 1;
        }
      });
    }

    // Merge with local store if day is missing from Master Excel
    const allStore = loadSavedBillsStore();
    Object.keys(allStore).forEach((dateKey) => {
      let dNum = 0, mNum = 0, yNum = 0;
      const parts = dateKey.split("-");
      if (parts.length === 3) {
        dNum = parseInt(parts[0], 10);
        mNum = parseInt(parts[1], 10);
        yNum = parseInt(parts[2], 10);
      }
      if (mNum === targetMonth && yNum === targetYear) {
        const dStr = String(dNum).padStart(2, "0");
        const mStr = String(mNum).padStart(2, "0");
        const formattedDateKey = `${dStr}-${mStr}-${yNum}`;

        if (!dayDataAccumulator[formattedDateKey]) {
          const itemsForDay = allStore[dateKey] || [];
          let dUpiT = 0, dCashT = 0, dUpiN = 0, dCashN = 0;
          itemsForDay.forEach((it) => {
            const uAmt = it.upi_amount !== undefined ? it.upi_amount : (isUpiMode(it.payment_mode) ? it.receipt_amount : 0);
            const cAmt = it.cash_amount !== undefined ? it.cash_amount : (!isUpiMode(it.payment_mode) && it.bill_printed ? it.receipt_amount : 0);
            dUpiT += uAmt;
            dCashT += cAmt;
            if (uAmt > 0) dUpiN += 1;
            if (cAmt > 0 && uAmt === 0) dCashN += 1;
          });
          dayDataAccumulator[formattedDateKey] = {
            totalPts: itemsForDay.length,
            upiT: dUpiT,
            cashT: dCashT,
            upiN: dUpiN,
            cashN: dCashN,
          };
        }
      }
    });

    let monthlyUpiT = 0, monthlyCashT = 0, monthlyPatientsN = 0, monthlyUpiN = 0, monthlyCashN = 0;
    Object.keys(dayDataAccumulator).forEach((dKey) => {
      const acc = dayDataAccumulator[dKey];
      daysSummaryMap[dKey] = {
        totals: {
          total_patients: acc.totalPts,
          upi_patients: acc.upiN,
          cash_patients: acc.cashN,
          upi_amount: acc.upiT,
          cash_amount: acc.cashT,
          grand_total: acc.upiT + acc.cashT,
        },
      };
      monthlyUpiT += acc.upiT;
      monthlyCashT += acc.cashT;
      monthlyPatientsN += acc.totalPts;
      monthlyUpiN += acc.upiN;
      monthlyCashN += acc.cashN;
    });

    const totalDaysSaved = Object.keys(daysSummaryMap).length;
    const yearStr = String(firstDateObj.getFullYear());
    const monthName = MONTH_NAMES[firstDateObj.getMonth() + 1];

    if (totalDaysSaved > 0) {
      const monthlySummaryObj: MonthlySummaryData = {
        year: firstDateObj.getFullYear(),
        month: monthName,
        last_updated: new Date().toLocaleString(),
        days: daysSummaryMap,
        monthly_totals: {
          total_days_saved: totalDaysSaved,
          total_patients: monthlyPatientsN,
          upi_patients: monthlyUpiN,
          cash_patients: monthlyCashN,
          upi_amount: monthlyUpiT,
          cash_amount: monthlyCashT,
          grand_total: monthlyUpiT + monthlyCashT,
        },
      };
      // 1. Text Summary File (.txt)
      const mSummaryTxt = generateMonthlyTextReport(monthlySummaryObj);
      const monthlyFilenameTxt = `Monthly_Summary_${monthName}_${yearStr}.txt`;
      const monthTxtRes = await syncToDrive(monthlyFilenameTxt, mSummaryTxt, ["Saved_Receipts", yearStr, monthName]);
      if (!monthTxtRes.success) {
        failedSyncs.push({ filename: monthlyFilenameTxt, error: monthTxtRes.error });
      }

      // 2. Excel Summary File (.xlsx)
      const mSummaryBase64 = generateMonthlyExcelBase64(monthlySummaryObj);
      const monthlyFilenameXlsx = `Monthly_Summary_${monthName}_${yearStr}.xlsx`;
      const monthXlsxRes = await syncToDrive(
        monthlyFilenameXlsx,
        mSummaryBase64,
        ["Saved_Receipts", yearStr, monthName],
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        true
      );
      if (!monthXlsxRes.success) {
        failedSyncs.push({ filename: monthlyFilenameXlsx, error: monthXlsxRes.error });
      }
    }

    setFailedSyncPids(newFailedPids);

    if (failedSyncs.length > 0) {
      const firstErr = failedSyncs[0].error || "Unknown error";
      alert(
        `✅ Saved ${savedItems.length} receipt(s) to local storage.\n\n⚠️ WARNING: Google Drive sync failed for ${failedSyncs.length} file(s)!\nReason: ${firstErr}`
      );
      setStatusMsg(`⚠️ Saved locally, but Google Drive sync failed: ${firstErr}`);
    } else {
      alert(`✅ Saved ${savedItems.length} receipt(s) locally and successfully synced all files & Master Excel (${fy}) to Google Drive!`);
      setStatusMsg(`✅ Saved bills and synced to Google Drive for ${primaryDateLabel} (${fy})`);
    }
  };

  return (
    <div className="min-h-screen flex flex-col bg-slate-50 text-slate-800 antialiased">
      {/* ── Top Header ────────────────────────────────────────────────── */}
      <header className="bg-[#0E6655] text-white shadow-md py-3 px-4 sm:px-6 flex flex-wrap items-center justify-between gap-3 sticky top-0 z-30">
        <div className="flex items-center gap-2.5">
          <div className="bg-white/10 p-1.5 sm:p-2 rounded-xl backdrop-blur-md">
            <Sparkles className="w-5 h-5 sm:w-6 sm:h-6 text-teal-200" />
          </div>
          <div>
            <h1 className="text-base sm:text-xl font-bold tracking-tight leading-tight">Babyscan Clinic</h1>
            <p className="text-[10px] sm:text-xs text-teal-200 font-medium">Cloud Receipts Portal</p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {/* Settings & Admin Login Button */}
          <button
            onClick={() => setIsSettingsOpen(true)}
            className="flex items-center gap-1.5 bg-teal-800 hover:bg-teal-900 text-white text-xs font-bold px-2.5 py-1.5 sm:px-3 sm:py-2 rounded-xl shadow-xs transition border border-teal-600/50"
            title="Admin Login & Settings"
          >
            <Settings className="w-4 h-4 text-teal-200" />
            {currentUserEmail ? (
              <span className="flex items-center gap-1">
                <span className="w-2 h-2 rounded-full bg-emerald-400"></span>
                <span className="hidden md:inline max-w-[120px] truncate">{currentUserEmail}</span>
              </span>
            ) : (
              <span className="flex items-center gap-1 text-amber-300">
                <Lock className="w-3.5 h-3.5" /> Login ⚙️
              </span>
            )}
          </button>

          <button
            onClick={handleSaveBills}
            className="flex items-center gap-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl shadow-xs transition active:scale-95"
          >
            <Save className="w-4 h-4" /> <span className="hidden sm:inline">Save Bills</span><span className="sm:hidden">Save</span>
          </button>
          
          <button
            onClick={() => setIsFYModalOpen(true)}
            className="flex items-center gap-1.5 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-3 py-1.5 sm:px-3.5 sm:py-2 rounded-xl shadow-xs transition active:scale-95"
          >
            <BarChart3 className="w-4 h-4" /> <span className="hidden sm:inline">Yearly Summary</span><span className="sm:hidden">Summary</span>
          </button>
        </div>
      </header>

      {/* ── Top Live Status & Sync Banner ─────────────────────────────── */}
      <div className="bg-teal-950 text-teal-100 border-t border-b border-teal-800/60 py-2 px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between text-xs font-medium gap-1 text-center sm:text-left shadow-2xs z-20">
        <div className="flex items-center gap-2 justify-center sm:justify-start">
          <span className="relative flex h-2.5 w-2.5">
            <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
            <span className="relative inline-flex rounded-full h-2.5 w-2.5 bg-emerald-400"></span>
          </span>
          <span className="font-semibold text-white tracking-wide">{statusMsg}</span>
        </div>
        {driveSyncStatus && (
          <div className="font-bold text-emerald-300 bg-teal-900/80 px-2.5 py-0.5 rounded-full border border-teal-700/50">
            {driveSyncStatus}
          </div>
        )}
      </div>

      {/* ── Date Picker Strip (Auto-loading on Date Change) ─────────────── */}
      <section className="bg-white border-b border-slate-200 p-3 sm:p-4 shadow-xs">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row md:items-center justify-between gap-3">
          
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-[#0E6655] font-bold text-xs sm:text-sm">
              <Calendar className="w-4 h-4" /> Date Filter:
            </div>

            <div className="flex items-center gap-1.5 bg-slate-50 px-2.5 py-1.5 rounded-xl border border-slate-200 text-xs font-semibold w-full sm:w-auto">
              <span className="text-slate-400">From</span>
              <input
                type="date"
                value={fromYMD}
                onChange={(e) => setFromYMD(e.target.value)}
                className="bg-transparent outline-none font-bold text-slate-800 text-[16px] sm:text-xs"
              />
              <span className="text-slate-400">To</span>
              <input
                type="date"
                value={toYMD}
                onChange={(e) => setToYMD(e.target.value)}
                className="bg-transparent outline-none font-bold text-slate-800 text-[16px] sm:text-xs"
              />
            </div>

            <button
              onClick={() => handleLoadData(fromYMD, toYMD)}
              disabled={isLoading}
              className="flex items-center justify-center gap-1.5 bg-[#0E6655] hover:bg-teal-800 text-white text-xs font-bold px-3.5 py-1.5 rounded-xl shadow-2xs transition active:scale-95 disabled:opacity-50"
              title="Fetch records for selected dates"
            >
              <Search className="w-3.5 h-3.5" /> Search
            </button>
          </div>

          {/* Quick Filter Buttons */}
          <div className="grid grid-cols-4 sm:flex items-center gap-1.5">
            {[
              { label: "Today", fn: setQuickToday },
              { label: "Yesterday", fn: setQuickYesterday },
              { label: "Last 7 Days", fn: setQuickLast7 },
              { label: "This Month", fn: setQuickThisMonth },
            ].map((b) => (
              <button
                key={b.label}
                onClick={b.fn}
                className="bg-teal-50 hover:bg-teal-100 text-[#0E6655] border border-teal-200 text-[11px] sm:text-xs font-bold py-1.5 px-2 sm:px-3 rounded-lg text-center transition active:scale-95"
              >
                {b.label}
              </button>
            ))}
          </div>

        </div>
      </section>

      {/* ── Stats Bar ─────────────────────────────────────────────────── */}
      <section className="bg-slate-100/80 border-b border-slate-200 py-3 px-3 sm:px-6">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3">
          
          <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 sm:gap-4 flex-1">
            <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs text-center">
              <p className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase">Patients</p>
              <p className="text-base sm:text-lg font-black text-[#0E6655]">{patientCount}</p>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs text-center">
              <p className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase">UPI Total</p>
              <p className="text-base sm:text-lg font-black text-emerald-600">₹{upiTotal.toLocaleString()}</p>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs text-center">
              <p className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase">Cash Total</p>
              <p className="text-base sm:text-lg font-black text-amber-600">₹{cashTotal.toLocaleString()}</p>
            </div>
            <div className="bg-white p-2.5 rounded-xl border border-slate-200 shadow-2xs text-center">
              <p className="text-[10px] sm:text-[11px] font-bold text-slate-400 uppercase">Grand Total</p>
              <p className="text-base sm:text-lg font-black text-purple-700">₹{grandTotal.toLocaleString()}</p>
            </div>
          </div>

          <div className="text-[10px] sm:text-xs font-semibold text-slate-500 bg-white px-3 py-1.5 rounded-lg border border-slate-200 text-center">
            🟩 UPI / Printed Cash &nbsp;&nbsp; 🟨 Cash without Bill
          </div>

        </div>
      </section>

      {/* ── Main Content Container ────────────────────────────────────── */}
      <main className="flex-1 p-3 sm:p-6 max-w-7xl w-full mx-auto">
        
        {/* Loading Spinner */}
        {isLoading ? (
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200 py-12 text-center text-slate-500 font-semibold space-y-2">
            <Clock className="w-7 h-7 animate-spin mx-auto text-[#0E6655]" />
            <p className="text-sm">Fetching patient records...</p>
          </div>
        ) : rawRecords.length === 0 ? (
          <div className="bg-white rounded-2xl shadow-xs border border-slate-200 py-12 text-center text-slate-400 font-medium text-sm">
            No payment records found for selected date range.
          </div>
        ) : (
          <>
            {/* 1. Mobile Cards View (Visible on screens smaller than md) */}
            <div className="block md:hidden space-y-3">
              {/* Normal Records Cards */}
              {normalRecords.map((r) => {
                const pid = String(r.id);
                const state = rowStates[pid] || { amountStr: "", printed: Boolean(r.bill_printed) };
                const split = calculateRecordSplit(r, state.printed, state.amountStr);

                const isAdvance = Boolean(r.is_advance_booking);
                const origScan = isAdvance
                  ? "Advance for Appointment"
                  : cleanScanDescription(r.scan_description);

                const cardBg = split.isPureUpi || state.printed ? "bg-emerald-50/70 border-emerald-200" : "bg-amber-50/70 border-amber-200";

                const modeTag = split.isSplit
                  ? `UPI ₹${Math.round(split.upiPortion)} + Cash ₹${Math.round(split.cashPortion)}`
                  : (r.collected_mode || "Cash");

                return (
                  <div key={`mob_${pid}`} className={`p-3.5 rounded-2xl border shadow-2xs space-y-2.5 ${cardBg}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-bold text-slate-400">📅 {r.collected_date || "—"}</span>
                        <h4 className="font-bold text-base text-slate-900 leading-tight">{r.patient_name || "—"}</h4>
                        <p className="text-xs text-slate-600 mt-0.5">🔬 {origScan}</p>
                      </div>

                      <div className="text-right">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-extrabold ${split.isPureUpi ? "bg-emerald-200 text-emerald-900" : split.isSplit ? "bg-blue-200 text-blue-900" : "bg-amber-200 text-amber-900"}`}>
                          {modeTag}
                        </span>
                        <p className="text-sm font-black text-slate-900 mt-1">₹{Math.round(split.totalCharges).toLocaleString()}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-600">Bill Printed:</span>
                        {!split.isPureUpi ? (
                          <button
                            onClick={() => handleTogglePrinted(pid, split.isPureUpi, split.totalCharges)}
                            className="focus:outline-none p-1"
                          >
                            {state.printed ? (
                              <CheckCircle2 className="w-6 h-6 text-emerald-600 inline" />
                            ) : (
                              <XCircle className="w-6 h-6 text-slate-300 inline" />
                            )}
                          </button>
                        ) : (
                          <span className="text-slate-400 font-semibold">N/A (UPI)</span>
                        )}
                      </div>

                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-600">Receipt ₹:</span>
                        <input
                          type="text"
                          value={state.amountStr}
                          onChange={(e) => handleAmountChange(pid, e.target.value)}
                          disabled={split.isPureUpi || state.printed}
                          placeholder={String(Math.round(split.effectiveReceiptAmount))}
                          className={`w-24 text-center py-1 rounded-xl font-bold text-[16px] md:text-xs border outline-none ${
                            split.isPureUpi || state.printed
                              ? "bg-emerald-100/80 border-emerald-300 text-emerald-900 cursor-not-allowed"
                              : "bg-white border-amber-300 text-slate-900 shadow-2xs"
                          }`}
                        />
                      </div>
                    </div>

                    {failedSyncPids[pid] && (
                      <div className="flex items-center justify-between bg-red-100/90 border border-red-300 rounded-xl px-2.5 py-1 text-xs text-red-900 font-bold mt-1">
                        <span className="truncate pr-2" title={failedSyncPids[pid]}>⚠️ Drive Sync Failed</span>
                        <button
                          onClick={() => handleRetryPatientSync(r)}
                          className="bg-red-600 hover:bg-red-700 text-white font-extrabold px-2.5 py-0.5 rounded-lg text-xs transition shadow-2xs shrink-0"
                        >
                          🔄 Retry
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>

            {/* 2. Desktop Table View (Visible on screens md and larger) */}
            <div className="hidden md:block bg-white rounded-2xl shadow-xs border border-slate-200 overflow-hidden">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="bg-slate-100 border-b border-slate-200 text-xs font-bold text-slate-600 uppercase">
                    <th className="py-3.5 px-4">Date</th>
                    <th className="py-3.5 px-4">Patient Name</th>
                    <th className="py-3.5 px-4">Scan Description</th>
                    <th className="py-3.5 px-4 text-center">Mode</th>
                    <th className="py-3.5 px-4 text-right">Total Charges</th>
                    <th className="py-3.5 px-4 text-center">Bill Printed?</th>
                    <th className="py-3.5 px-4 text-center">Receipt Amount (₹)</th>
                  </tr>
                </thead>

                <tbody className="divide-y divide-slate-100 text-sm">
                  {/* Normal Payment Rows */}
                  {normalRecords.map((r) => {
                    const pid = String(r.id);
                    const state = rowStates[pid] || { amountStr: "", printed: Boolean(r.bill_printed) };
                    const split = calculateRecordSplit(r, state.printed, state.amountStr);

                    const isAdvance = Boolean(r.is_advance_booking);
                    const origScan = isAdvance
                      ? "Advance for Appointment"
                      : cleanScanDescription(r.scan_description);

                    const rowBgClass =
                      split.isPureUpi || state.printed
                        ? "bg-emerald-50/60 hover:bg-emerald-100/50"
                        : "bg-amber-50/50 hover:bg-amber-100/40";

                    const modeTag = split.isSplit
                      ? `UPI ₹${Math.round(split.upiPortion)} + Cash ₹${Math.round(split.cashPortion)}`
                      : (r.collected_mode || "Cash");

                    return (
                      <tr key={pid} className={`${rowBgClass} transition`}>
                        <td className="py-3.5 px-4 text-xs font-semibold text-slate-500">
                          {r.collected_date || "—"}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-900">
                          <div className="flex items-center gap-2">
                            <span>{r.patient_name || "—"}</span>
                            {failedSyncPids[pid] && (
                              <span
                                className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-extrabold bg-red-100 text-red-900 border border-red-300 shadow-2xs"
                                title={failedSyncPids[pid]}
                              >
                                ⚠️ Drive Sync Failed
                                <button
                                  onClick={() => handleRetryPatientSync(r)}
                                  className="bg-red-600 hover:bg-red-700 text-white font-black px-2 py-0.5 rounded-md text-[10px] ml-0.5 transition active:scale-95"
                                  title="Retry Google Drive sync for this receipt"
                                >
                                  🔄 Retry
                                </button>
                              </span>
                            )}
                          </div>
                        </td>
                        <td className="py-3.5 px-4 text-slate-700 font-medium">{origScan}</td>
                        <td className="py-3.5 px-4 text-center">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-extrabold ${
                              split.isPureUpi ? "bg-emerald-100 text-emerald-800" : split.isSplit ? "bg-blue-100 text-blue-800" : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {modeTag}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right font-bold text-slate-800">
                          ₹{Math.round(split.totalCharges).toLocaleString()}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {!split.isPureUpi ? (
                            <button
                              onClick={() => handleTogglePrinted(pid, split.isPureUpi, split.totalCharges)}
                              className="focus:outline-none hover:scale-110 transition active:scale-95"
                              title="Toggle Bill Printed Status"
                            >
                              {state.printed ? (
                                <CheckCircle2 className="w-6 h-6 text-emerald-600 inline-block" />
                              ) : (
                                <XCircle className="w-6 h-6 text-slate-300 inline-block" />
                              )}
                            </button>
                          ) : (
                            <span className="text-slate-400 text-xs font-medium">N/A (UPI)</span>
                          )}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          <input
                            type="text"
                            value={state.amountStr}
                            onChange={(e) => handleAmountChange(pid, e.target.value)}
                            disabled={split.isPureUpi || state.printed}
                            placeholder={String(Math.round(split.effectiveReceiptAmount))}
                            className={`w-28 text-center py-1 rounded-lg font-bold text-[16px] md:text-sm border outline-none transition ${
                              split.isPureUpi || state.printed
                                ? "bg-emerald-100/60 border-emerald-300 text-emerald-900 cursor-not-allowed"
                                : "bg-white border-amber-300 focus:ring-2 focus:ring-amber-500 text-slate-900 shadow-2xs"
                            }`}
                          />
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      {/* ── Footer ─────────────────────────────────────────────────────── */}
      <footer className="bg-slate-200 border-t border-slate-300 py-2.5 px-4 sm:px-6 flex items-center justify-center text-xs text-slate-500 text-center font-medium">
        <div>Babyscan Fetal Medicine & Gynec Imaging © {new Date().getFullYear()}</div>
      </footer>

      {/* ── Financial Year Modal ──────────────────────────────────────── */}
      <YearlySummaryModal
        isOpen={isFYModalOpen}
        onClose={() => setIsFYModalOpen(false)}
        onSyncDrive={(filename, content, path) => syncToDrive(filename, content, path)}
      />

      {/* ── Settings & Admin Login Modal ─────────────────────────────── */}
      <SettingsAuthModal
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        onAuthSuccess={refreshAuthUser}
        currentUserEmail={currentUserEmail}
        onLogout={() => {
          setCurrentUserEmail(null);
          handleLoadData(fromYMD, toYMD);
        }}
      />
    </div>
  );
}
