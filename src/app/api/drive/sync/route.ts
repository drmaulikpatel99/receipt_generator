import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";
import { Readable } from "stream";

/**
 * Serverless API Route to upload/sync receipt .txt files into Google Drive
 * Uses Google OAuth2 User Account Refresh Token (Direct User Storage Quota).
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const filename = body.filename;
    const content = body.content || "";
    const mimeType = body.mimeType || "text/plain";
    let folderPath: string[] = body.folderPath || body.subfolderPath || [];

    // OAuth2 User Credentials
    const clientId = process.env.GOOGLE_DRIVE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_DRIVE_CLIENT_SECRET;
    const refreshToken = process.env.GOOGLE_DRIVE_REFRESH_TOKEN;
    const parentFolderId = process.env.GOOGLE_DRIVE_FOLDER_ID;

    if (!clientId || !clientSecret || !refreshToken) {
      return NextResponse.json(
        {
          success: false,
          simulated: true,
          error: "Google Drive OAuth2 user credentials (GOOGLE_DRIVE_CLIENT_ID, GOOGLE_DRIVE_CLIENT_SECRET, GOOGLE_DRIVE_REFRESH_TOKEN) not configured in Vercel environment variables.",
        },
        { status: 400 }
      );
    }

    const oauth2Client = new google.auth.OAuth2(clientId, clientSecret);
    oauth2Client.setCredentials({ refresh_token: refreshToken });

    const drive = google.drive({ version: "v3", auth: oauth2Client });

    // Helper: Find or create subfolder inside Google Drive (Case-Insensitive)
    async function getOrCreateFolder(name: string, parentId?: string): Promise<string> {
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
          (f) => f.name && f.name.trim().toLowerCase() === name.trim().toLowerCase()
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

    const isBase64 = body.isBase64 || false;
    const fileBuffer = isBase64 ? Buffer.from(content, "base64") : Buffer.from(content);

    const media = {
      mimeType: mimeType,
      body: Readable.from([fileBuffer]),
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
