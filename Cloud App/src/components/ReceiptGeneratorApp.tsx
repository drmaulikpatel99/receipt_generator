"use client";

import React, { useState, useEffect, useTransition } from "react";
import {
  Calendar,
  Save,
  BarChart3,
  FolderOpen,
  CloudUpload,
  Search,
  CheckCircle2,
  XCircle,
  Clock,
  Printer,
  Share2,
  Sparkles,
} from "lucide-react";
import {
  fetchPaymentsByDateRange,
  SupabasePaymentRecord,
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
  toSortableDate,
} from "@/lib/utils";
import { YearlySummaryModal } from "./YearlySummaryModal";

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

interface UIProcessedRow {
  pid: string;
  originalRecord: SupabasePaymentRecord;
  dateStr: string;
  patientName: string;
  origScan: string;
  activeScan: string;
  mode: string;
  isUpi: boolean;
  totalCharges: number;
  billPrinted: boolean;
  manualAmountStr: string;
  isAdvanceGroup?: boolean;
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
  const [driveSyncStatus, setDriveSyncStatus] = useState<string>("");

  // Load patient data from Supabase (Strictly Read-Only)
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
      setStatusMsg("❌ Error fetching data");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    handleLoadData(todayYMD, todayYMD);
  }, []);

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
      let nextAmtStr = current.amountStr;

      if (!isUpi) {
        if (nextPrinted) {
          nextAmtStr = String(Math.round(totalCharges));
        } else {
          nextAmtStr = "";
        }
      }

      saveLocalStatus(pid, nextAmtStr ? Number(nextAmtStr) : null, nextPrinted);
      return { ...prev, [pid]: { amountStr: nextAmtStr, printed: nextPrinted } };
    });
  };

  // Handle Manual Cash Entry input
  const handleAmountChange = (pid: string, val: string) => {
    setRowStates((prev) => {
      const current = prev[pid] || { amountStr: "", printed: false };
      saveLocalStatus(pid, val ? Number(val) : null, current.printed);
      return { ...prev, [pid]: { ...current, amountStr: val } };
    });
  };

  // Process Rows & Grouping
  const normalRecords = rawRecords.filter((r) => !r.is_advance_booking);
  const upiAdvRecords = rawRecords.filter(
    (r) =>
      r.is_advance_booking &&
      isUpiMode((r.collected_mode || "") + " " + (r.collected_mode2 || ""))
  );

  // Group UPI Advance Bookings Date-Wise
  const advByDate: Record<string, SupabasePaymentRecord[]> = {};
  upiAdvRecords.forEach((r) => {
    const cd = String(r.collected_date || "").replace(/\//g, "-").trim() || "—";
    if (!advByDate[cd]) advByDate[cd] = [];
    advByDate[cd].push(r);
  });

  const sortedAdvDates = Object.keys(advByDate).sort((a, b) =>
    toSortableDate(a).localeCompare(toSortableDate(b))
  );

  // Compute Totals
  let upiTotal = 0;
  let cashTotal = 0;
  let patientCount = normalRecords.length;

  normalRecords.forEach((r) => {
    const pid = String(r.id);
    const modeStr = (r.collected_mode || "") + " " + (r.collected_mode2 || "");
    const isUpi = isUpiMode(modeStr);
    const state = rowStates[pid] || { amountStr: "", printed: Boolean(r.bill_printed) };
    const totalCharges = (r.collected_today || 0) + (r.collected_today2 || 0);

    let amt = 0;
    if (isUpi || state.printed) {
      amt = totalCharges;
    } else if (state.amountStr) {
      amt = Number(state.amountStr) || 0;
    }

    if (isUpi) upiTotal += amt;
    else cashTotal += amt;
  });

  sortedAdvDates.forEach((dStr) => {
    const group = advByDate[dStr];
    const groupTotal = group.reduce(
      (acc, curr) => acc + (curr.collected_today || 0) + (curr.collected_today2 || 0),
      0
    );
    upiTotal += groupTotal;
    patientCount += 1;
  });

  const grandTotal = upiTotal + cashTotal;

  // Google Drive Sync API Call Helper
  const syncToDrive = async (filename: string, content: string, path: string[]) => {
    try {
      setDriveSyncStatus("⏳ Syncing to Google Drive...");
      const res = await fetch("/api/drive/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filename, content, folderPath: path }),
      });
      const data = await res.json();
      if (data.success) {
        setDriveSyncStatus(`✅ Google Drive: ${data.message || "Synced"}`);
      } else {
        setDriveSyncStatus(`⚠️ Drive Sync: ${data.error || "Failed"}`);
      }
    } catch (e) {
      setDriveSyncStatus("⚠️ Drive Sync Error");
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

    const dateLabel = fromYMD === toYMD ? formatDateDMY(parseYMD(fromYMD)) : `${formatDateDMY(parseYMD(fromYMD))}_to_${formatDateDMY(parseYMD(toYMD))}`;
    const fromD = parseYMD(fromYMD);
    const monthName = MONTH_NAMES[fromD.getMonth() + 1];
    const yearStr = String(fromD.getFullYear());

    saveBillsToStore(dateLabel, savedItems);

    const daySummary: DaySummary = {
      period: fromYMD === toYMD ? formatDateDMY(fromD) : `${formatDateDMY(fromD)} to ${formatDateDMY(parseYMD(toYMD))}`,
      saved_at: new Date().toLocaleString(),
      totals: {
        total_patients: savedItems.length,
        upi_patients: upiN,
        cash_patients: cashN,
        upi_amount: upiT,
        cash_amount: cashT,
        grand_total: upiT + cashT,
      },
      records: savedItems,
    };

    // Generate .txt contents
    const dailyTxt = generateDailyTextReport(daySummary);

    // Sync to Google Drive
    await syncToDrive(`summary_${dateLabel}.txt`, dailyTxt, [
      "Saved_Receipts",
      yearStr,
      monthName,
      dateLabel,
    ]);

    // Sync individual receipts to Google Drive
    for (const item of savedItems) {
      const pTxt = generatePatientTextReceipt(item);
      const cleanName = (item.patient_name || "").replace(/[^a-zA-Z0-9_]/g, "_").slice(0, 20);
      const fName = `Receipt_${item.payment_id}_${cleanName}.txt`;
      await syncToDrive(fName, pTxt, [
        "Saved_Receipts",
        yearStr,
        monthName,
        dateLabel,
        "Individual_Receipts",
      ]);
    }

    alert(`✅ Saved ${savedItems.length} receipt(s) to storage!\nAuto-synced reports to Google Drive.`);
    setStatusMsg(`✅ Saved bills for ${dateLabel}`);
  };

  return (
    <div className="min-h-screen flex flex-col">
      {/* ── Top Header ────────────────────────────────────────────────── */}
      <header className="bg-blue-700 text-white shadow-lg py-3.5 px-6 flex flex-wrap items-center justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="bg-white/10 p-2 rounded-xl backdrop-blur-md">
            <Sparkles className="w-7 h-7 text-blue-200" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight">Babyscan Clinic</h1>
            <p className="text-xs text-blue-200 font-medium">Cloud Receipt Generator & Analytics</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={handleSaveBills}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow transition"
          >
            <Save className="w-4 h-4" /> Save Bills
          </button>
          <button
            onClick={() => setIsFYModalOpen(true)}
            className="flex items-center gap-2 bg-purple-600 hover:bg-purple-700 text-white text-xs font-bold px-3.5 py-2 rounded-xl shadow transition"
          >
            <BarChart3 className="w-4 h-4" /> Yearly Summary
          </button>
        </div>
      </header>

      {/* ── Date Picker Strip ─────────────────────────────────────────── */}
      <section className="bg-indigo-50/80 border-b border-indigo-100 p-4 flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-3">
          <div className="flex items-center gap-2 text-indigo-900 font-bold text-sm">
            <Calendar className="w-4 h-4 text-indigo-600" /> Date Filter:
          </div>

          <div className="flex items-center gap-2 bg-white px-3 py-1.5 rounded-xl border border-indigo-200 shadow-sm text-xs font-medium">
            <span className="text-slate-500 font-bold">From</span>
            <input
              type="date"
              value={fromYMD}
              onChange={(e) => setFromYMD(e.target.value)}
              className="outline-none font-semibold text-slate-800"
            />
            <span className="text-slate-500 font-bold">To</span>
            <input
              type="date"
              value={toYMD}
              onChange={(e) => setToYMD(e.target.value)}
              className="outline-none font-semibold text-slate-800"
            />
          </div>

          {/* Quick Filter Buttons */}
          <div className="flex flex-wrap items-center gap-1.5">
            {[
              { label: "Today", fn: setQuickToday },
              { label: "Yesterday", fn: setQuickYesterday },
              { label: "Last 7 Days", fn: setQuickLast7 },
              { label: "This Month", fn: setQuickThisMonth },
            ].map((b) => (
              <button
                key={b.label}
                onClick={b.fn}
                className="bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold px-3 py-1.5 rounded-lg shadow-sm transition"
              >
                {b.label}
              </button>
            ))}
          </div>
        </div>

        <button
          onClick={() => handleLoadData(fromYMD, toYMD)}
          disabled={isLoading}
          className="flex items-center gap-2 bg-blue-700 hover:bg-blue-800 text-white text-xs font-bold px-4 py-2 rounded-xl shadow transition disabled:opacity-50"
        >
          <Search className="w-4 h-4" /> Load Patients
        </button>
      </section>

      {/* ── Stats Bar ─────────────────────────────────────────────────── */}
      <section className="bg-sky-50 border-b border-sky-100 py-3 px-6 flex flex-wrap items-center justify-between gap-4">
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-6 text-center flex-1 max-w-3xl">
          <div className="bg-white p-2.5 rounded-xl border border-sky-100 shadow-sm">
            <p className="text-[11px] font-semibold text-slate-400 uppercase">Patients</p>
            <p className="text-lg font-black text-blue-700">{patientCount}</p>
          </div>
          <div className="bg-white p-2.5 rounded-xl border border-sky-100 shadow-sm">
            <p className="text-[11px] font-semibold text-slate-400 uppercase">UPI Total</p>
            <p className="text-lg font-black text-emerald-600">₹{upiTotal.toLocaleString()}</p>
          </div>
          <div className="bg-white p-2.5 rounded-xl border border-sky-100 shadow-sm">
            <p className="text-[11px] font-semibold text-slate-400 uppercase">Cash Total</p>
            <p className="text-lg font-black text-amber-600">₹{cashTotal.toLocaleString()}</p>
          </div>
          <div className="bg-white p-2.5 rounded-xl border border-sky-100 shadow-sm">
            <p className="text-[11px] font-semibold text-slate-400 uppercase">Grand Total</p>
            <p className="text-lg font-black text-purple-700">₹{grandTotal.toLocaleString()}</p>
          </div>
        </div>

        <div className="text-xs font-medium text-slate-500 bg-white/80 px-3 py-1.5 rounded-lg border border-sky-100">
          🟩 UPI / Printed Cash &nbsp;&nbsp; 🟨 Cash without Bill
        </div>
      </section>

      {/* ── Main Patient Table ────────────────────────────────────────── */}
      <main className="flex-1 p-4 md:p-6 overflow-auto">
        <div className="bg-white rounded-2xl shadow-sm border border-slate-200 overflow-hidden">
          <table className="w-full text-left border-collapse text-sm">
            <thead className="bg-blue-700 text-white text-xs uppercase font-bold sticky top-0">
              <tr>
                <th className="py-3 px-4 w-12 text-center">#</th>
                <th className="py-3 px-4">Date</th>
                <th className="py-3 px-4">Patient Name</th>
                <th className="py-3 px-4">Scan Type</th>
                <th className="py-3 px-4 text-center">Mode</th>
                <th className="py-3 px-4 text-right">Total Charges ₹</th>
                <th className="py-3 px-4 text-center">Bill Printed</th>
                <th className="py-3 px-4 text-center">Receipt Amount ₹</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 font-medium">
              {isLoading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-blue-600 font-bold">
                    ⏳ Fetching records from database...
                  </td>
                </tr>
              ) : normalRecords.length === 0 && sortedAdvDates.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400 font-medium">
                    No payments found for the selected date period
                  </td>
                </tr>
              ) : (
                <>
                  {/* Normal Patient Rows */}
                  {normalRecords.map((r, idx) => {
                    const pid = String(r.id);
                    const modeStr = (r.collected_mode || "") + " " + (r.collected_mode2 || "");
                    const isUpi = isUpiMode(modeStr);
                    const state = rowStates[pid] || { amountStr: "", printed: Boolean(r.bill_printed) };
                    const totalCharges = (r.collected_today || 0) + (r.collected_today2 || 0);

                    const isAdvance = Boolean(r.is_advance_booking);
                    const origScan = isAdvance ? "Advance for Appointment" : cleanScanDescription(r.scan_description);

                    const editable = !isUpi && !state.printed;
                    const hasManualAmt = Boolean(state.amountStr && Number(state.amountStr) > 0);
                    const activeScan = !isUpi && !state.printed && hasManualAmt ? "Fetal Well Being" : origScan;

                    const rowBg = isUpi || state.printed ? "bg-emerald-50/70" : "bg-amber-50/70";

                    let displayAmt = "";
                    if (isUpi || state.printed) {
                      displayAmt = String(Math.round(totalCharges));
                    } else {
                      displayAmt = state.amountStr;
                    }

                    return (
                      <tr key={pid} className={`${rowBg} hover:bg-slate-100/80 transition`}>
                        <td className="py-3 px-4 text-center text-slate-400 text-xs font-mono">{idx + 1}</td>
                        <td className="py-3 px-4 text-slate-600 text-xs font-semibold">{r.collected_date || "—"}</td>
                        <td className="py-3 px-4 font-bold text-indigo-950">{r.patient_name || "—"}</td>
                        <td className="py-3 px-4 text-slate-700 font-semibold">{activeScan}</td>
                        <td className="py-3 px-4 text-center">
                          <span
                            className={`px-2 py-0.5 rounded-full text-xs font-black ${
                              isUpi ? "bg-emerald-200 text-emerald-900" : "bg-amber-200 text-amber-900"
                            }`}
                          >
                            {r.collected_mode || "—"}
                          </span>
                        </td>
                        <td className="py-3 px-4 text-right font-bold text-slate-700">
                          ₹{Math.round(totalCharges).toLocaleString()}
                        </td>
                        <td className="py-3 px-4 text-center">
                          <button
                            onClick={() => handleTogglePrinted(pid, isUpi, totalCharges)}
                            className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-lg text-xs font-bold text-white transition shadow-sm ${
                              state.printed ? "bg-emerald-600 hover:bg-emerald-700" : "bg-rose-500 hover:bg-rose-600"
                            }`}
                          >
                            {state.printed ? <CheckCircle2 className="w-3.5 h-3.5" /> : <XCircle className="w-3.5 h-3.5" />}
                            {state.printed ? "Printed" : "Not Printed"}
                          </button>
                        </td>
                        <td className="py-3 px-4 text-center">
                          <input
                            type="text"
                            value={displayAmt}
                            readOnly={!editable}
                            placeholder={editable ? "Enter amount" : ""}
                            onChange={(e) => handleAmountChange(pid, e.target.value)}
                            className={`w-28 text-center py-1 rounded-lg font-bold text-sm border ${
                              !editable
                                ? "bg-emerald-100/60 border-emerald-300 text-emerald-900 cursor-not-allowed"
                                : "bg-white border-amber-300 text-slate-900 focus:ring-2 focus:ring-amber-500 outline-none"
                            }`}
                          />
                        </td>
                      </tr>
                    );
                  })}

                  {/* Advance Bookings Section (Grouped Date-Wise) */}
                  {sortedAdvDates.length > 0 && (
                    <>
                      <tr className="bg-blue-700 text-white font-bold text-xs">
                        <td colSpan={8} className="py-2 px-4 uppercase tracking-wider">
                          💳 Advance for Appointment ({upiAdvRecords.length} booking(s) • UPI)
                        </td>
                      </tr>
                      {sortedAdvDates.map((dStr, idx) => {
                        const group = advByDate[dStr];
                        const groupTotal = group.reduce(
                          (acc, curr) => acc + (curr.collected_today || 0) + (curr.collected_today2 || 0),
                          0
                        );
                        return (
                          <tr key={`adv_${dStr}`} className="bg-emerald-50/90 font-medium border-t border-emerald-200">
                            <td className="py-3 px-4 text-center text-slate-400 text-xs font-mono">{idx + 1}</td>
                            <td className="py-3 px-4 text-slate-600 text-xs font-bold">{dStr}</td>
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
                </>
              )}
            </tbody>
          </table>
        </div>
      </main>

      {/* ── Footer Status Bar ─────────────────────────────────────────── */}
      <footer className="bg-slate-200 border-t border-slate-300 py-2 px-6 flex flex-wrap items-center justify-between text-xs text-slate-600">
        <div>{statusMsg}</div>
        {driveSyncStatus && <div className="font-semibold text-slate-700">{driveSyncStatus}</div>}
      </footer>

      {/* ── Financial Year Modal ──────────────────────────────────────── */}
      <YearlySummaryModal
        isOpen={isFYModalOpen}
        onClose={() => setIsFYModalOpen(false)}
        onSyncDrive={(filename, content, path) => syncToDrive(filename, content, path)}
      />
    </div>
  );
}
