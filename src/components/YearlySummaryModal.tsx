"use client";

import React, { useState, useEffect } from "react";
import { X, Save, Share2, Calendar, FileText } from "lucide-react";
import { loadSavedBillsStore, SavedReceiptItem } from "@/lib/appStorage";
import { isUpiMode } from "@/lib/utils";

interface YearlySummaryModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSyncDrive?: (filename: string, content: string, path: string[]) => void;
}

const MONTH_NAMES = [
  "", "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December"
];

export function YearlySummaryModal({ isOpen, onClose, onSyncDrive }: YearlySummaryModalProps) {
  const currentYear = new Date().getFullYear();
  const currentMonth = new Date().getMonth() + 1;
  const initialStartYear = currentMonth >= 4 ? currentYear : currentYear - 1;

  const [selectedStartYear, setSelectedStartYear] = useState<number>(initialStartYear);
  const [fyData, setFyData] = useState<any>(null);

  const fyOptions = [];
  for (let y = initialStartYear + 1; y >= initialStartYear - 4; y--) {
    fyOptions.push({
      startYear: y,
      label: `FY_${y}-${String(y + 1).slice(2)}`,
      display: `FY ${y}-${String(y + 1).slice(2)} (1st Apr ${y} to 31st Mar ${y + 1})`,
    });
  }

  useEffect(() => {
    if (!isOpen) return;

    let isMounted = true;
    const endYear = selectedStartYear + 1;
    const fyLabel = `FY${selectedStartYear}-${String(endYear).slice(2)}`;

    const loadFyData = async () => {
      let masterRows: any[] = [];
      try {
        const res = await fetch(`/api/drive/excel-sync?fy=${fyLabel}`);
        if (res.ok) {
          const data = await res.json();
          if (data.success && Array.isArray(data.rows)) {
            masterRows = data.rows;
          }
        }
      } catch (e) {
        console.warn("Could not fetch Master Excel for FY summary:", e);
      }

      const store = loadSavedBillsStore();
      const months: Array<{
        year: number;
        monthIdx: number;
        monthName: string;
        label: string;
        patients: number;
        upiAmount: number;
        cashAmount: number;
        totalAmount: number;
      }> = [];

      const fyMonthsList: Array<[number, number]> = [];
      for (let m = 4; m <= 12; m++) fyMonthsList.push([selectedStartYear, m]);
      for (let m = 1; m <= 3; m++) fyMonthsList.push([selectedStartYear + 1, m]);

      let totPts = 0;
      let totUpi = 0;
      let totCash = 0;

      fyMonthsList.forEach(([yr, mIdx]) => {
        const mName = MONTH_NAMES[mIdx];
        let pCnt = 0;
        let uAmt = 0;
        let cAmt = 0;

        if (masterRows.length > 0) {
          masterRows.forEach((r) => {
            const rawDate = String(r["Date"] || "").trim();
            if (!rawDate) return;
            let mNum = 0, yNum = 0;
            if (/^\d{4}[-/]\d{1,2}[-/]\d{1,2}/.test(rawDate)) {
              const p = rawDate.split(/[-/]/);
              yNum = parseInt(p[0], 10);
              mNum = parseInt(p[1], 10);
            } else if (/^\d{1,2}[-/]\d{1,2}[-/]\d{4}/.test(rawDate)) {
              const p = rawDate.split(/[-/]/);
              mNum = parseInt(p[1], 10);
              yNum = parseInt(p[2], 10);
            }

            if (yNum === yr && mNum === mIdx) {
              pCnt += 1;
              uAmt += Number(r["UPI (₹)"] || 0);
              cAmt += Number(r["Cash (₹)"] || 0);
            }
          });
        } else {
          // Fallback to local store
          Object.entries(store).forEach(([dateLabel, items]) => {
            const parts = dateLabel.split("-");
            if (parts.length === 3) {
              const itemYear = Number(parts[2]);
              const itemMonth = Number(parts[1]);
              if (itemYear === yr && itemMonth === mIdx) {
                items.forEach((r: SavedReceiptItem) => {
                  const amt = Number(r.receipt_amount || 0);
                  pCnt += 1;
                  if (isUpiMode(r.payment_mode)) {
                    uAmt += amt;
                  } else {
                    cAmt += amt;
                  }
                });
              }
            }
          });
        }

        months.push({
          year: yr,
          monthIdx: mIdx,
          monthName: mName,
          label: `${mName} ${yr}`,
          patients: pCnt,
          upiAmount: uAmt,
          cashAmount: cAmt,
          totalAmount: uAmt + cAmt,
        });

        totPts += pCnt;
        totUpi += uAmt;
        totCash += cAmt;
      });

      if (isMounted) {
        setFyData({
          startYear: selectedStartYear,
          endYear,
          fyLabel: `FY_${selectedStartYear}-${String(endYear).slice(2)}`,
          displayLabel: `FY ${selectedStartYear}-${String(endYear).slice(2)} (1st Apr ${selectedStartYear} to 31st Mar ${endYear})`,
          months,
          totals: {
            totalPatients: totPts,
            upiAmount: totUpi,
            cashAmount: totCash,
            grandTotal: totUpi + totCash,
          },
        });
      }
    };

    loadFyData();

    return () => {
      isMounted = false;
    };
  }, [isOpen, selectedStartYear]);

  if (!isOpen || !fyData) return null;

  const generateReportText = () => {
    const lines = [
      "=".repeat(72),
      `          BABYSCAN CLINIC — FINANCIAL YEAR SUMMARY (${fyData.fyLabel})`,
      `                  ${fyData.displayLabel}`,
      "=".repeat(72),
      `  Generated At : ${new Date().toLocaleString()}`,
      "=".repeat(72),
      `  ${"Month".padEnd(16)}  ${"UPI Collection".padStart(16)}  ${"Cash Collection".padStart(16)}  ${"Month Total".padStart(16)}`,
      "-".repeat(72),
    ];
    fyData.months.forEach((m: any) => {
      lines.push(
        `  ${m.label.padEnd(16)}  Rs.${Math.round(m.upiAmount).toLocaleString().padStart(13)}  Rs.${Math.round(m.cashAmount).toLocaleString().padStart(13)}  Rs.${Math.round(m.totalAmount).toLocaleString().padStart(13)}`
      );
    });
    const t = fyData.totals;
    lines.push(
      "=".repeat(72),
      `  TOTAL UPI PAYMENT    : Rs. ${Math.round(t.upiAmount).toLocaleString()}`,
      `  TOTAL CASH PAYMENT   : Rs. ${Math.round(t.cashAmount).toLocaleString()}`,
      `  FY GRAND TOTAL       : Rs. ${Math.round(t.grandTotal).toLocaleString()}`,
      "=".repeat(72)
    );
    return lines.join("\n");
  };

  const handleSaveReport = () => {
    const text = generateReportText();
    const blob = new Blob([text], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `Financial_Year_Summary_${fyData.fyLabel}.txt`;
    a.click();
    URL.revokeObjectURL(url);

    if (onSyncDrive) {
      onSyncDrive(
        `Financial_Year_Summary_${fyData.fyLabel}.txt`,
        text,
        ["Saved_Receipts", fyData.fyLabel]
      );
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/60 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="bg-white w-full max-w-4xl rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="bg-purple-700 text-white px-6 py-4 flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Calendar className="w-6 h-6" />
            <h2 className="text-xl font-bold">Financial Year Summary</h2>
          </div>
          <button
            onClick={onClose}
            className="text-purple-200 hover:text-white p-1 rounded-lg hover:bg-purple-600 transition"
          >
            <X className="w-6 h-6" />
          </button>
        </div>

        {/* Year Selector */}
        <div className="p-4 bg-purple-50 border-b border-purple-100 flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <label className="text-sm font-semibold text-purple-900">Select Financial Year:</label>
            <select
              value={selectedStartYear}
              onChange={(e) => setSelectedStartYear(Number(e.target.value))}
              className="bg-white border border-purple-300 rounded-lg px-3 py-1.5 font-bold text-purple-900 text-sm focus:ring-2 focus:ring-purple-500 outline-none"
            >
              {fyOptions.map((opt) => (
                <option key={opt.startYear} value={opt.startYear}>
                  {opt.label}
                </option>
              ))}
            </select>
          </div>
          <span className="text-xs italic text-purple-700 font-medium">
            {fyData.displayLabel}
          </span>
        </div>

        {/* Table Body */}
        <div className="overflow-y-auto flex-1 p-6">
          <table className="w-full text-left text-sm">
            <thead className="bg-purple-900 text-white text-xs uppercase font-bold sticky top-0">
              <tr>
                <th className="py-3 px-4 rounded-l-lg">#</th>
                <th className="py-3 px-4">Month</th>
                <th className="py-3 px-4 text-right">UPI Collection (₹)</th>
                <th className="py-3 px-4 text-right">Cash Collection (₹)</th>
                <th className="py-3 px-4 text-right rounded-r-lg">Month Total (₹)</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {fyData.months.map((m: any, idx: number) => (
                <tr key={m.label} className="hover:bg-purple-50/50 transition">
                  <td className="py-3 px-4 text-slate-400 font-mono text-xs">{idx + 1}</td>
                  <td className="py-3 px-4 font-semibold text-slate-800">{m.label}</td>
                  <td className="py-3 px-4 text-right font-medium text-emerald-700">
                    ₹{Math.round(m.upiAmount).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-right font-medium text-amber-700">
                    ₹{Math.round(m.cashAmount).toLocaleString()}
                  </td>
                  <td className="py-3 px-4 text-right font-bold text-purple-900">
                    ₹{Math.round(m.totalAmount).toLocaleString()}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {/* Footer Totals & Actions */}
        <div className="p-4 bg-purple-100 border-t border-purple-200 flex flex-wrap items-center justify-between gap-4">
          <div className="text-sm font-bold text-purple-950 flex flex-wrap gap-4">
            <span>UPI: <span className="text-emerald-700">₹{Math.round(fyData.totals.upiAmount).toLocaleString()}</span></span>
            <span>•</span>
            <span>Cash: <span className="text-amber-700">₹{Math.round(fyData.totals.cashAmount).toLocaleString()}</span></span>
            <span>•</span>
            <span>FY Grand Total: <span className="text-purple-900">₹{Math.round(fyData.totals.grandTotal).toLocaleString()}</span></span>
          </div>

          <button
            onClick={handleSaveReport}
            className="flex items-center gap-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-sm px-4 py-2 rounded-xl shadow transition"
          >
            <Save className="w-4 h-4" />
            Save FY Report (.txt)
          </button>
        </div>
      </div>
    </div>
  );
}
