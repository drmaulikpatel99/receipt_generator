import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import * as XLSX from "xlsx";
import { Readable } from "stream";

/**
 * API Route to Read/Write Financial Year Master Excel file in Google Drive.
 * File Name Pattern: Master_Receipts_FY2026-27.xlsx in folder FY2026-27
 * Uses `xlsx` (SheetJS) for 100% Vercel & Webpack bundling compatibility.
 */

function getDriveClient() {
  const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
  const parentFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

  if (!clientId || !clientSecret || !refreshToken) {
    return null;
  }

  const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
  oauth2Client.setCredentials({ refresh_token: refreshToken });

  return {
    drive: google.drive({ version: "v3", auth: oauth2Client }),
    parentFolderId,
  };
}

async function findFolder(drive: any, name: string, parentId?: string): Promise<string | null> {
  const safeName = name.replace(/'/g, "\\'");
  let q = `name = '${safeName}' and mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
  if (parentId) {
    q += ` and '${parentId}' in parents`;
  }

  const res = await drive.files.list({
    q,
    fields: "files(id, name)",
    supportsAllDrives: true,
    includeItemsFromAllDrives: true,
  });

  if (res.data.files && res.data.files.length > 0) {
    const match = res.data.files.find(
      (f: any) => f.name && f.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    if (match && match.id) {
      return match.id;
    }
  }

  return null;
}

async function getOrCreateFolder(drive: any, name: string, parentId?: string): Promise<string> {
  const existingId = await findFolder(drive, name, parentId);
  if (existingId) {
    return existingId;
  }

  const folderMetadata: any = {
    name,
    mimeType: "application/vnd.google-apps.folder",
  };
  if (parentId) {
    folderMetadata.parents = [parentId];
  }

  const folder = await drive.files.create({
    requestBody: folderMetadata,
    fields: "id",
    supportsAllDrives: true,
  });
  return folder.data.id!;
}

// GET: Read cash status & bill printed map from Financial Year Master Excel in Drive (READ ONLY)
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const fy = searchParams.get("fy") || "FY2026-27";
    const filename = `Master_Receipts_${fy}.xlsx`;

    const clientObj = getDriveClient();
    if (!clientObj) {
      return NextResponse.json({ success: false, error: "OAuth2 not configured", statusMap: {} });
    }

    const { drive, parentFolderId } = clientObj;
    let targetFolderId: string | undefined = parentFolderId;
    if (fy) {
      const foundId = await findFolder(drive, fy, parentFolderId);
      if (!foundId) {
        // Read-only: Folder does not exist yet -> return empty status map without creating empty folders!
        return NextResponse.json({ success: true, statusMap: {}, fy, note: "Folder not created yet" });
      }
      targetFolderId = foundId;
    }

    let q = `name = '${filename}' and trashed = false`;
    if (targetFolderId) {
      q += ` and '${targetFolderId}' in parents`;
    }

    const fileList = await drive.files.list({
      q,
      fields: "files(id, name)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    if (!fileList.data.files || fileList.data.files.length === 0) {
      return NextResponse.json({ success: true, statusMap: {}, fy, note: "File not created yet" });
    }

    const fileId = fileList.data.files[0].id!;
    const fileRes = await drive.files.get(
      { fileId, alt: "media" },
      { responseType: "arraybuffer" }
    );

    const buffer = Buffer.from(fileRes.data as ArrayBuffer);
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const worksheet = workbook.Sheets[sheetName];

    const jsonRows: any[] = XLSX.utils.sheet_to_json(worksheet, { defval: "" });
    const statusMap: Record<string, { amount: number | null; bill_printed: boolean }> = {};

    jsonRows.forEach((row) => {
      const pid = String(row["Payment ID"] || row["payment_id"] || "").trim();
      if (!pid) return;

      const printedVal = String(row["Bill Printed"] || row["bill_printed"] || "").trim().toUpperCase();
      const isPrinted = printedVal === "YES" || printedVal === "TRUE" || printedVal === "1";

      const cashRaw = row["Cash (₹)"] ?? row["cash_amount"];
      const amtRaw = cashRaw ?? row["Receipt Amount (₹)"] ?? row["receipt_amount"];
      const amtNum = amtRaw !== null && amtRaw !== undefined && amtRaw !== "" ? Number(amtRaw) : null;
      const finalAmt = (amtNum !== null && !isNaN(amtNum) && amtNum > 0) ? amtNum : null;

      statusMap[pid] = {
        amount: finalAmt,
        bill_printed: isPrinted,
      };
    });

    return NextResponse.json({ success: true, statusMap, rows: jsonRows, fy });
  } catch (err: any) {
    console.error("GET Master Excel Sync Error:", err);
    return NextResponse.json({ success: false, error: err.message, statusMap: {}, rows: [] });
  }
}

// POST: Save/Update Financial Year Master Excel in Google Drive
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const fy = body.fy || "FY2026-27";
    const items: any[] = body.items || [];
    const filename = `Master_Receipts_${fy}.xlsx`;

    const clientObj = getDriveClient();
    if (!clientObj) {
      return NextResponse.json({ success: false, error: "OAuth2 credentials missing" }, { status: 400 });
    }

    const { drive, parentFolderId } = clientObj;
    let targetFolderId = parentFolderId;
    if (fy) {
      targetFolderId = await getOrCreateFolder(drive, fy, parentFolderId);
    }

    // Check if Excel file exists in Drive
    let q = `name = '${filename}' and trashed = false`;
    if (targetFolderId) {
      q += ` and '${targetFolderId}' in parents`;
    }

    const fileList = await drive.files.list({
      q,
      fields: "files(id, name)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    let existingRowsMap: Map<string, any> = new Map();
    let existingFileId: string | null = null;

    if (fileList.data.files && fileList.data.files.length > 0) {
      existingFileId = fileList.data.files[0].id!;
      const fileRes = await drive.files.get(
        { fileId: existingFileId, alt: "media" },
        { responseType: "arraybuffer" }
      );
      const buffer = Buffer.from(fileRes.data as ArrayBuffer);
      const workbook = XLSX.read(buffer, { type: "buffer" });
      const sheetName = workbook.SheetNames[0];
      if (sheetName && workbook.Sheets[sheetName]) {
        const rows: any[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: "" });
        rows.forEach((r) => {
          const pid = String(r["Payment ID"] || r["payment_id"] || "").trim();
          if (pid) existingRowsMap.set(pid, r);
        });
      }
    }

    const nowStr = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    // Update existing map or add new items
    items.forEach((item) => {
      const pid = String(item.payment_id || "").trim();
      if (!pid) return;

      let cashAmt = item.cash_amount !== undefined && item.cash_amount !== null ? Number(item.cash_amount) : 0;
      let upiAmt = item.upi_amount !== undefined && item.upi_amount !== null ? Number(item.upi_amount) : 0;

      if (item.cash_amount === undefined && item.upi_amount === undefined) {
        const amt = Number(item.receipt_amount || 0);
        if (item.payment_mode && String(item.payment_mode).toUpperCase().includes("UPI")) {
          upiAmt = amt;
          cashAmt = 0;
        } else {
          cashAmt = amt;
          upiAmt = 0;
        }
      }

      const totalAmt = cashAmt + upiAmt;

      existingRowsMap.set(pid, {
        "Payment ID": pid,
        "Date": item.date || "",
        "Patient Name": item.patient_name || "",
        "Scan Description": item.scan || "",
        "Cash (₹)": cashAmt,
        "UPI (₹)": upiAmt,
        "Total (₹)": totalAmt,
      });
    });

    const finalRowsList = Array.from(existingRowsMap.values());
    const worksheet = XLSX.utils.json_to_sheet(finalRowsList);
    
    // Set column widths
    worksheet["!cols"] = [
      { wch: 15 }, // Payment ID
      { wch: 14 }, // Date
      { wch: 30 }, // Patient Name
      { wch: 32 }, // Scan Description
      { wch: 14 }, // Cash (₹)
      { wch: 14 }, // UPI (₹)
      { wch: 16 }, // Total (₹)
    ];

    const newWorkbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(newWorkbook, worksheet, "Patient_Receipts_Master");

    const outBuffer = XLSX.write(newWorkbook, { type: "buffer", bookType: "xlsx" });
    const media = {
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: Readable.from([outBuffer]),
    };

    if (existingFileId) {
      await drive.files.update({
        fileId: existingFileId,
        media,
        supportsAllDrives: true,
      });
      return NextResponse.json({ success: true, fileId: existingFileId, action: "updated", fy, allRows: finalRowsList });
    } else {
      const fileMetadata: any = {
        name: filename,
      };
      if (targetFolderId) {
        fileMetadata.parents = [targetFolderId];
      }

      const newFile = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: "id",
        supportsAllDrives: true,
      });

      return NextResponse.json({ success: true, fileId: newFile.data.id, action: "created", fy, allRows: finalRowsList });
    }
  } catch (err: any) {
    console.error("POST Master Excel Sync Error:", err);
    return NextResponse.json({ success: false, error: err.message || "Excel sync error" }, { status: 500 });
  }
}
