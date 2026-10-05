import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import ExcelJS from "exceljs";
import { Readable } from "stream";

/**
 * API Route to Read/Write Financial Year Master Excel file in Google Drive.
 * File Name Pattern: Master_Receipts_FY2026-27.xlsx in folder FY2026-27
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

async function getOrCreateFolder(drive: any, name: string, parentId?: string): Promise<string> {
  let q = `mimeType = 'application/vnd.google-apps.folder' and trashed = false`;
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

// GET: Read cash status & bill printed map from Financial Year Master Excel in Drive
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
    let targetFolderId = parentFolderId;
    if (fy) {
      targetFolderId = await getOrCreateFolder(drive, fy, parentFolderId);
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
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    const sheet = workbook.getWorksheet("Patient_Receipts_Master") || workbook.worksheets[0];
    const statusMap: Record<string, { amount: number | null; bill_printed: boolean }> = {};

    if (sheet) {
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return; // Skip header
        const pid = String(row.getCell(1).value || "").trim();
        if (!pid) return;

        const printedVal = String(row.getCell(7).value || "").trim().toUpperCase();
        const isPrinted = printedVal === "YES" || printedVal === "TRUE" || printedVal === "1";

        const amtRaw = row.getCell(8).value;
        const amtNum = amtRaw !== null && amtRaw !== undefined && amtRaw !== "" ? Number(amtRaw) : null;

        statusMap[pid] = {
          amount: isNaN(amtNum as number) ? null : amtNum,
          bill_printed: isPrinted,
        };
      });
    }

    return NextResponse.json({ success: true, statusMap, fy });
  } catch (err: any) {
    console.error("GET Master Excel Sync Error:", err);
    return NextResponse.json({ success: false, error: err.message, statusMap: {} });
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

    const workbook = new ExcelJS.Workbook();
    let existingFileId: string | null = null;

    if (fileList.data.files && fileList.data.files.length > 0) {
      existingFileId = fileList.data.files[0].id!;
      const fileRes = await drive.files.get(
        { fileId: existingFileId, alt: "media" },
        { responseType: "arraybuffer" }
      );
      const buffer = Buffer.from(fileRes.data as ArrayBuffer);
      await workbook.xlsx.load(buffer as any);
    }

    // Get or Create Master Sheet
    let sheet = workbook.getWorksheet("Patient_Receipts_Master");
    if (!sheet) {
      sheet = workbook.addWorksheet("Patient_Receipts_Master");
      sheet.columns = [
        { header: "Payment ID", key: "payment_id", width: 15 },
        { header: "Date", key: "date", width: 14 },
        { header: "Patient Name", key: "patient_name", width: 30 },
        { header: "Scan Description", key: "scan", width: 32 },
        { header: "Payment Mode", key: "payment_mode", width: 14 },
        { header: "Total Charges", key: "total_charges", width: 16 },
        { header: "Bill Printed", key: "bill_printed", width: 14 },
        { header: "Receipt Amount (₹)", key: "receipt_amount", width: 20 },
        { header: "Last Updated", key: "last_updated", width: 22 },
      ];
      // Format Header row
      sheet.getRow(1).font = { bold: true };
      sheet.getRow(1).fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FF0E6655" },
      };
      sheet.getRow(1).font = { color: { argb: "FFFFFFFF" }, bold: true };
    }

    // Update or append item rows
    const nowStr = new Date().toLocaleString("en-IN", { timeZone: "Asia/Kolkata" });

    items.forEach((item) => {
      const pid = String(item.payment_id || "").trim();
      if (!pid) return;

      let foundRow: ExcelJS.Row | null = null;
      sheet.eachRow((row, rowNumber) => {
        if (rowNumber === 1) return;
        if (String(row.getCell(1).value || "").trim() === pid) {
          foundRow = row;
        }
      });

      const printedText = item.bill_printed ? "YES" : "NO";
      const receiptAmt = item.receipt_amount !== undefined && item.receipt_amount !== null ? item.receipt_amount : 0;

      if (foundRow) {
        (foundRow as ExcelJS.Row).getCell(2).value = item.date || "";
        (foundRow as ExcelJS.Row).getCell(3).value = item.patient_name || "";
        (foundRow as ExcelJS.Row).getCell(4).value = item.scan || "";
        (foundRow as ExcelJS.Row).getCell(5).value = item.payment_mode || "";
        (foundRow as ExcelJS.Row).getCell(6).value = item.total_charges || 0;
        (foundRow as ExcelJS.Row).getCell(7).value = printedText;
        (foundRow as ExcelJS.Row).getCell(8).value = receiptAmt;
        (foundRow as ExcelJS.Row).getCell(9).value = nowStr;
      } else {
        sheet.addRow({
          payment_id: pid,
          date: item.date || "",
          patient_name: item.patient_name || "",
          scan: item.scan || "",
          payment_mode: item.payment_mode || "",
          total_charges: item.total_charges || 0,
          bill_printed: printedText,
          receipt_amount: receiptAmt,
          last_updated: nowStr,
        });
      }
    });

    const outBuffer = await workbook.xlsx.writeBuffer();
    const media = {
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      body: Readable.from([Buffer.from(outBuffer)]),
    };

    if (existingFileId) {
      await drive.files.update({
        fileId: existingFileId,
        media,
        supportsAllDrives: true,
      });
      return NextResponse.json({ success: true, fileId: existingFileId, action: "updated", fy });
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

      return NextResponse.json({ success: true, fileId: newFile.data.id, action: "created", fy });
    }
  } catch (err: any) {
    console.error("POST Master Excel Sync Error:", err);
    return NextResponse.json({ success: false, error: err.message || "Excel sync error" }, { status: 500 });
  }
}
