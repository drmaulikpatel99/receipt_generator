import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { Readable } from "stream";

/**
 * Serverless API Route to upload/sync receipt .txt files into Google Drive
 * Fixed for Google Service Accounts (Readable stream & folder duplicate prevention)
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const filename = body.filename;
    const content = body.content || "";
    const mimeType = body.mimeType || "text/plain";
    let folderPath: string[] = body.folderPath || body.subfolderPath || [];

    const clientEmail = process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
    const privateKey = process.env.GOOGLE_DRIVE_PRIVATE_KEY?.replace(/\\n/g, "\n");
    const parentFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!clientEmail || !privateKey) {
      return NextResponse.json(
        {
          success: false,
          simulated: true,
          error: "Google Drive sync not configured. Please set GOOGLE_DRIVE_CLIENT_EMAIL and GOOGLE_DRIVE_PRIVATE_KEY in Vercel environment variables.",
        },
        { status: 400 }
      );
    }

    const auth = new google.auth.JWT({
      email: clientEmail,
      key: privateKey,
      scopes: ["https://www.googleapis.com/auth/drive"],
    });

    const drive = google.drive({ version: "v3", auth });

    // Helper: Find or create subfolder inside Google Drive
    async function getOrCreateFolder(name: string, parentId?: string): Promise<string> {
      let q = `mimeType = 'application/vnd.google-apps.folder' and name = '${name}' and trashed = false`;
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
        return res.data.files[0].id!;
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

    // Determine starting parent folder
    let currentParent = parentFolderId;

    // If GOOGLE_DRIVE_FOLDER_ID is set and folderPath starts with "Saved_Receipts",
    // strip "Saved_Receipts" so we don't create a duplicate Saved_Receipts inside Saved_Receipts
    if (currentParent && folderPath.length > 0 && folderPath[0].toLowerCase() === "saved_receipts") {
      folderPath = folderPath.slice(1);
    }

    // Traverse and create target folder path
    if (folderPath && Array.isArray(folderPath)) {
      for (const folderName of folderPath) {
        if (!folderName) continue;
        currentParent = await getOrCreateFolder(folderName, currentParent);
      }
    }

    // Check if file already exists in target folder
    let q = `name = '${filename}' and trashed = false`;
    if (currentParent) {
      q += ` and '${currentParent}' in parents`;
    }

    const existingFiles = await drive.files.list({
      q,
      fields: "files(id, name)",
      supportsAllDrives: true,
      includeItemsFromAllDrives: true,
    });

    const media = {
      mimeType: mimeType,
      body: Readable.from([content]),
    };

    if (existingFiles.data.files && existingFiles.data.files.length > 0) {
      const fileId = existingFiles.data.files[0].id!;
      await drive.files.update({
        fileId,
        media,
        supportsAllDrives: true,
      });
      return NextResponse.json({ success: true, fileId, action: "updated" });
    } else {
      const fileMetadata: any = {
        name: filename,
      };
      if (currentParent) {
        fileMetadata.parents = [currentParent];
      }

      const newFile = await drive.files.create({
        requestBody: fileMetadata,
        media,
        fields: "id, webViewLink",
        supportsAllDrives: true,
      });

      return NextResponse.json({
        success: true,
        fileId: newFile.data.id,
        link: newFile.data.webViewLink,
        action: "created",
      });
    }
  } catch (err: any) {
    console.error("Google Drive Sync API Error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Drive sync error" },
      { status: 500 }
    );
  }
}
