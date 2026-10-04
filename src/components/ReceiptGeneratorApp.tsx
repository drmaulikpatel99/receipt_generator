"use client";

import React, { useState, useEffect } from "react";
import {
  Calendar,
  Save,
  BarChart3,
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
} from "@/lib/utils";
import { YearlySummaryModal } from "./YearlySummaryModal";
import { SettingsAuthModal } from "./SettingsAuthModal";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

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

  // Load patient data from Supabase automatically
  const handleLoadData = async (from: string, to: string) => {
    setIsLoading(true);
    setStatusMsg("⏳ Fetching records from database...");
    try {
      const data = await fetchPaymentsByDateRange(from, to);
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

  // Auto-fetch data whenever fromYMD or toYMD changes
  useEffect(() => {
    handleLoadData(fromYMD, toYMD);
  }, [fromYMD, toYMD]);

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
  };

  const setQuickYesterday = () => {
    const prev = new Date();
    prev.setDate(prev.getDate() - 1);
    const d = formatDateYMD(prev);
    setFromYMD(d); setToYMD(d);
  };

  const setQuickLast7 = () => {
    const end = new Date();
    const start = new Date();
    start.setDate(end.getDate() - 6);
    setFromYMD(formatDateYMD(start));
    setToYMD(formatDateYMD(end));
  };

  const setQuickThisMonth = () => {
    const now = new Date();
    const start = new Date(now.getFullYear(), now.getMonth(), 1);
    setFromYMD(formatDateYMD(start));
    setToYMD(formatDateYMD(now));
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

  // Separate normal records vs advance records
  const normalRecords: SupabasePaymentRecord[] = [];
  const advByDate: Record<string, SupabasePaymentRecord[]> = {};

  rawRecords.forEach((r) => {
    const isAdv = Boolean(r.is_advance_booking);
    const modeStr = (r.collected_mode || "") + " " + (r.collected_mode2 || "");
    const isUpi = isUpiMode(modeStr);

    if (isAdv && isUpi) {
      const d = r.collected_date || "Unknown Date";
      if (!advByDate[d]) advByDate[d] = [];
      advByDate[d].push(r);
    } else {
      normalRecords.push(r);
    }
  });

  const sortedAdvDates = Object.keys(advByDate).sort((a, b) => (a > b ? -1 : 1));

  // Compute Statistics
  let patientCount = normalRecords.length;
  sortedAdvDates.forEach((d) => (patientCount += advByDate[d].length));

  let upiTotal = 0;
  let cashTotal = 0;

  // Process Normal Records stats
  normalRecords.forEach((r) => {
    const pid = String(r.id);
    const modeStr = (r.collected_mode || "") + " " + (r.collected_mode2 || "");
    const isUpi = isUpiMode(modeStr);
    const state = rowStates[pid] || { amountStr: "", printed: Boolean(r.bill_printed) };
    const totalCharges = (r.collected_today || 0) + (r.collected_today2 || 0);

    let amt = 0;
    if (isUpi || state.printed) {
      amt = totalCharges;
    } else if (state.amountStr && Number(state.amountStr) > 0) {
      amt = Number(state.amountStr);
    }

    if (isUpi) upiTotal += amt;
    else cashTotal += amt;
  });

  // Process Advance Booking groups stats
  sortedAdvDates.forEach((dStr) => {
    const group = advByDate[dStr];
    const total = group.reduce(
      (acc, curr) => acc + (curr.collected_today || 0) + (curr.collected_today2 || 0),
      0
    );
    upiTotal += total;
  });

  const grandTotal = upiTotal + cashTotal;

  // Helper: Auto-sync generated text reports to Google Drive API
  const syncToDrive = async (
    filename: string,
    content: string,
    subfolderPath: string[] = []
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      setDriveSyncStatus(`☁️ Syncing ${filename}...`);
      const resp = await fetch("/api/drive/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, content, folderPath: subfolderPath }),
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

  // Save Bills Action
  const handleSaveBills = async () => {
    if (rawRecords.length === 0) {
      alert("No patients loaded to save.");
      return;
    }

    const savedItems: SavedReceiptItem[] = [];
    let upiT = 0, cashT = 0, upiN = 0, cashN = 0;

    // Normal records
    normalRecords.forEach((r) => {
      const pid = String(r.id);
      const modeStr = (r.collected_mode || "") + " " + (r.collected_mode2 || "");
      const isUpi = isUpiMode(modeStr);
      const state = rowStates[pid] || { amountStr: "", printed: Boolean(r.bill_printed) };
      const totalCharges = (r.collected_today || 0) + (r.collected_today2 || 0);

      const isAdvance = Boolean(r.is_advance_booking);
      const origScan = isAdvance ? "Advance for Appointment" : cleanScanDescription(r.scan_description);

      let amt = 0;
      let activeScan = origScan;

      if (isUpi || state.printed) {
        amt = totalCharges;
      } else if (state.amountStr && Number(state.amountStr) > 0) {
        amt = Number(state.amountStr);
        activeScan = "Fetal Well Being";
      }

      savedItems.push({
        payment_id: pid,
        patient_name: r.patient_name || "—",
        scan: activeScan,
        payment_mode: r.collected_mode || "—",
        total_charges: r.total_charges || 0,
        bill_printed: state.printed,
        receipt_amount: amt,
        referring_doctor: r.referring_doctor || "",
        patient_phone: r.patient_phone || "",
        date: r.collected_date || "",
      });

      if (isUpi) { upiT += amt; upiN += 1; }
      else { cashT += amt; cashN += 1; }
    });

    // Advance groups date-wise
    sortedAdvDates.forEach((dStr) => {
      const group = advByDate[dStr];
      const total = group.reduce(
        (acc, curr) => acc + (curr.collected_today || 0) + (curr.collected_today2 || 0),
        0
      );
      savedItems.push({
        payment_id: `adv_${dStr.replace(/[-/]/g, "")}`,
        patient_name: "Advance for Appointment",
        scan: `${group.length} UPI booking(s)`,
        payment_mode: "UPI",
        total_charges: total,
        bill_printed: false,
        receipt_amount: total,
        referring_doctor: "",
        patient_phone: "",
        date: dStr,
        is_advance_group: true,
      });
      upiT += total;
      upiN += group.length;
    });

    const dateLabel = formatDateDMY(parseYMD(fromYMD));
    saveBillsToStore(dateLabel, savedItems);

    const firstDateObj = parseYMD(fromYMD);
    const yearStr = String(firstDateObj.getFullYear());
    const monthName = MONTH_NAMES[firstDateObj.getMonth() + 1];

    const failedSyncs: { filename: string; error?: string }[] = [];

    // Generate individual receipts sequentially
    for (const item of savedItems) {
      if (item.is_advance_group) continue;
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
      if (!res.success) {
        failedSyncs.push({ filename, error: res.error });
      }
    }

    // Generate Daily Summary Report
    const daySummaryObj: DaySummary = {
      period: dateLabel,
      saved_at: new Date().toLocaleString(),
      totals: {
        total_patients: upiN + cashN,
        upi_patients: upiN,
        cash_patients: cashN,
        upi_amount: upiT,
        cash_amount: cashT,
        grand_total: upiT + cashT,
      },
      records: savedItems,
    };
    const daySummaryTxt = generateDailyTextReport(daySummaryObj);
    const summaryFilename = `summary_${dateLabel}.txt`;
    const dayRes = await syncToDrive(summaryFilename, daySummaryTxt, ["Saved_Receipts", yearStr, monthName, dateLabel]);
    if (!dayRes.success) {
      failedSyncs.push({ filename: summaryFilename, error: dayRes.error });
    }

    // Update Monthly Summary Report
    const allStore = loadSavedBillsStore();
    const monthlyItemsMap: Record<string, SavedReceiptItem> = {};

    Object.keys(allStore).forEach((dateKey) => {
      const parts = dateKey.split("-");
      if (parts.length === 3) {
        const dNum = parseInt(parts[0], 10);
        const mNum = parseInt(parts[1], 10);
        const yNum = parseInt(parts[2], 10);

        if (mNum === firstDateObj.getMonth() + 1 && yNum === firstDateObj.getFullYear()) {
          allStore[dateKey].forEach((item) => {
            monthlyItemsMap[`${dateKey}_${item.payment_id}`] = item;
          });
        }
      }
    });

    const monthlyItemsList = Object.values(monthlyItemsMap);
    if (monthlyItemsList.length > 0) {
      let mUpiT = 0, mCashT = 0, mUpiN = 0, mCashN = 0;
      monthlyItemsList.forEach((it) => {
        if (isUpiMode(it.payment_mode)) { mUpiT += it.receipt_amount; mUpiN += 1; }
        else { mCashT += it.receipt_amount; mCashN += 1; }
      });

      const monthlySummaryObj: MonthlySummaryData = {
        year: firstDateObj.getFullYear(),
        month: monthName,
        last_updated: new Date().toLocaleString(),
        days: {},
        monthly_totals: {
          total_days_saved: 1,
          total_patients: mUpiN + mCashN,
          upi_patients: mUpiN,
          cash_patients: mCashN,
          upi_amount: mUpiT,
          cash_amount: mCashT,
          grand_total: mUpiT + mCashT,
        },
      };
      const mSummaryTxt = generateMonthlyTextReport(monthlySummaryObj);
      const monthlyFilename = `Monthly_Summary_${monthName}_${yearStr}.txt`;
      const monthRes = await syncToDrive(monthlyFilename, mSummaryTxt, ["Saved_Receipts", yearStr, monthName]);
      if (!monthRes.success) {
        failedSyncs.push({ filename: monthlyFilename, error: monthRes.error });
      }
    }

    if (failedSyncs.length > 0) {
      const firstErr = failedSyncs[0].error || "Unknown error";
      alert(
        `✅ Saved ${savedItems.length} receipt(s) to local storage.\n\n⚠️ WARNING: Google Drive sync failed for ${failedSyncs.length} file(s)!\nReason: ${firstErr}`
      );
      setStatusMsg(`⚠️ Saved locally, but Google Drive sync failed: ${firstErr}`);
    } else {
      alert(`✅ Saved ${savedItems.length} receipt(s) locally and successfully synced all files to Google Drive!`);
      setStatusMsg(`✅ Saved bills and synced to Google Drive for ${dateLabel}`);
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
                className="bg-transparent outline-none font-bold text-slate-800 text-xs"
              />
              <span className="text-slate-400">To</span>
              <input
                type="date"
                value={toYMD}
                onChange={(e) => setToYMD(e.target.value)}
                className="bg-transparent outline-none font-bold text-slate-800 text-xs"
              />
            </div>
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
                const modeStr = (r.collected_mode || "") + " " + (r.collected_mode2 || "");
                const isUpi = isUpiMode(modeStr);
                const state = rowStates[pid] || { amountStr: "", printed: Boolean(r.bill_printed) };
                const totalCharges = (r.collected_today || 0) + (r.collected_today2 || 0);

                const isAdvance = Boolean(r.is_advance_booking);
                const origScan = isAdvance
                  ? "Advance for Appointment"
                  : cleanScanDescription(r.scan_description);

                const cardBg = isUpi || state.printed ? "bg-emerald-50/70 border-emerald-200" : "bg-amber-50/70 border-amber-200";

                return (
                  <div key={`mob_${pid}`} className={`p-3.5 rounded-2xl border shadow-2xs space-y-2.5 ${cardBg}`}>
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <span className="text-[10px] font-bold text-slate-400">📅 {r.collected_date || "—"}</span>
                        <h4 className="font-bold text-base text-slate-900 leading-tight">{r.patient_name || "—"}</h4>
                        <p className="text-xs text-slate-600 mt-0.5">🔬 {origScan}</p>
                      </div>

                      <div className="text-right">
                        <span className={`inline-block px-2.5 py-0.5 rounded-full text-xs font-extrabold ${isUpi ? "bg-emerald-200 text-emerald-900" : "bg-amber-200 text-amber-900"}`}>
                          {r.collected_mode || "Cash"}
                        </span>
                        <p className="text-sm font-black text-slate-900 mt-1">₹{Math.round(totalCharges).toLocaleString()}</p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between pt-2 border-t border-slate-200/60 text-xs">
                      <div className="flex items-center gap-1.5">
                        <span className="font-bold text-slate-600">Bill Printed:</span>
                        {!isUpi ? (
                          <button
                            onClick={() => handleTogglePrinted(pid, isUpi, totalCharges)}
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
                          disabled={isUpi || state.printed}
                          placeholder={isUpi || state.printed ? String(Math.round(totalCharges)) : "Manual ₹"}
                          className={`w-24 text-center py-1 rounded-xl font-bold text-xs border outline-none ${
                            isUpi || state.printed
                              ? "bg-emerald-100/80 border-emerald-300 text-emerald-900 cursor-not-allowed"
                              : "bg-white border-amber-300 text-slate-900 shadow-2xs"
                          }`}
                        />
                      </div>
                    </div>
                  </div>
                );
              })}

              {/* Advance Booking Group Cards */}
              {sortedAdvDates.length > 0 && (
                <div className="space-y-2 pt-2">
                  <h4 className="text-xs font-bold text-indigo-900 uppercase tracking-wider px-1">
                    📅 Advance Bookings Grouped Date-wise
                  </h4>
                  {sortedAdvDates.map((dStr) => {
                    const group = advByDate[dStr];
                    const groupTotal = group.reduce(
                      (acc, curr) => acc + (curr.collected_today || 0) + (curr.collected_today2 || 0),
                      0
                    );
                    return (
                      <div key={`mob_adv_${dStr}`} className="bg-indigo-50 border border-indigo-200 p-3.5 rounded-2xl shadow-2xs flex items-center justify-between">
                        <div>
                          <span className="text-[10px] font-bold text-indigo-600">📅 {dStr}</span>
                          <h5 className="font-bold text-sm text-indigo-950">Advance for Appointment</h5>
                          <p className="text-xs text-indigo-700 font-semibold">{group.length} UPI booking(s)</p>
                        </div>
                        <div className="text-right">
                          <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-200 text-emerald-900">UPI</span>
                          <p className="text-sm font-black text-indigo-950 mt-1">₹{Math.round(groupTotal).toLocaleString()}</p>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
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
                    const modeStr = (r.collected_mode || "") + " " + (r.collected_mode2 || "");
                    const isUpi = isUpiMode(modeStr);
                    const state = rowStates[pid] || { amountStr: "", printed: Boolean(r.bill_printed) };
                    const totalCharges = (r.collected_today || 0) + (r.collected_today2 || 0);

                    const isAdvance = Boolean(r.is_advance_booking);
                    const origScan = isAdvance
                      ? "Advance for Appointment"
                      : cleanScanDescription(r.scan_description);

                    const rowBgClass =
                      isUpi || state.printed
                        ? "bg-emerald-50/60 hover:bg-emerald-100/50"
                        : "bg-amber-50/50 hover:bg-amber-100/40";

                    return (
                      <tr key={pid} className={`${rowBgClass} transition`}>
                        <td className="py-3.5 px-4 text-xs font-semibold text-slate-500">
                          {r.collected_date || "—"}
                        </td>
                        <td className="py-3.5 px-4 font-bold text-slate-900">{r.patient_name || "—"}</td>
                        <td className="py-3.5 px-4 text-slate-700 font-medium">{origScan}</td>
                        <td className="py-3.5 px-4 text-center">
                          <span
                            className={`px-2.5 py-1 rounded-full text-xs font-extrabold ${
                              isUpi ? "bg-emerald-100 text-emerald-800" : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {r.collected_mode || "Cash"}
                          </span>
                        </td>
                        <td className="py-3.5 px-4 text-right font-bold text-slate-800">
                          ₹{Math.round(totalCharges).toLocaleString()}
                        </td>
                        <td className="py-3.5 px-4 text-center">
                          {!isUpi ? (
                            <button
                              onClick={() => handleTogglePrinted(pid, isUpi, totalCharges)}
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
                            disabled={isUpi || state.printed}
                            placeholder={isUpi || state.printed ? String(Math.round(totalCharges)) : "Manual ₹"}
                            className={`w-28 text-center py-1 rounded-lg font-bold text-sm border outline-none transition ${
                              isUpi || state.printed
                                ? "bg-emerald-100/60 border-emerald-300 text-emerald-900 cursor-not-allowed"
                                : "bg-white border-amber-300 focus:ring-2 focus:ring-amber-500 text-slate-900 shadow-2xs"
                            }`}
                          />
                        </td>
                      </tr>
                    );
                  })}

                  {/* Date-wise Grouped Advance Payments */}
                  {sortedAdvDates.length > 0 && (
                    <>
                      <tr className="bg-indigo-100/70 text-indigo-900 text-xs font-bold uppercase tracking-wider">
                        <td colSpan={7} className="py-2.5 px-4">
                          📅 Advance Bookings Grouped Date-wise ({sortedAdvDates.length} date groups)
                        </td>
                      </tr>
                      {sortedAdvDates.map((dStr) => {
                        const group = advByDate[dStr];
                        const groupTotal = group.reduce(
                          (acc, curr) => acc + (curr.collected_today || 0) + (curr.collected_today2 || 0),
                          0
                        );
                        return (
                          <tr key={`adv_${dStr}`} className="bg-indigo-50/60 hover:bg-indigo-100/50 transition">
                            <td className="py-3 px-4 text-xs font-bold text-indigo-800">{dStr}</td>
                            <td className="py-3 px-4 font-bold text-indigo-950">
                              Advance for Appointment ({group.length} booking(s))
                            </td>
                            <td className="py-3 px-4 text-slate-700 font-semibold">Advance for Appointment</td>
                            <td className="py-3 px-4 text-center">
                              <span className="px-2 py-0.5 rounded-full text-xs font-black bg-emerald-200 text-emerald-900">
                                UPI
                              </span>
                            </td>
                            <td className="py-3 px-4 text-right font-bold text-slate-700">
                              ₹{Math.round(groupTotal).toLocaleString()}
                            </td>
                            <td className="py-3 px-4 text-center text-slate-400 text-xs">—</td>
                            <td className="py-3 px-4 text-center">
                              <input
                                type="text"
                                value={String(Math.round(groupTotal))}
                                readOnly
                                className="w-28 text-center py-1 rounded-lg font-bold text-sm bg-emerald-100/60 border border-emerald-300 text-emerald-900 cursor-not-allowed"
                              />
                            </td>
                          </tr>
                        );
                      })}
                    </>
                  )}
                </tbody>
              </table>
            </div>
          </>
        )}
      </main>

      {/* ── Footer Status Bar ─────────────────────────────────────────── */}
      <footer className="bg-slate-200 border-t border-slate-300 py-2.5 px-4 sm:px-6 flex flex-col sm:flex-row items-center justify-between text-xs text-slate-600 gap-1 text-center sm:text-left">
        <div>{statusMsg}</div>
        {driveSyncStatus && <div className="font-semibold text-slate-700">{driveSyncStatus}</div>}
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
