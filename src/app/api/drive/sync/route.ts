import { NextRequest, NextResponse } from "next/server";
import { google } from "googleapis";

/**
 * Serverless API Route to upload/sync receipt .txt files into Google Drive
 */
export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const filename = body.filename;
    const content = body.content;
    const mimeType = body.mimeType;
    const folderPath = body.folderPath || body.subfolderPath;

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
      scopes: ["https://www.googleapis.com/auth/drive.file"],
    });

    const drive = google.drive({ version: "v3", auth });

    // Helper: Find or create subfolder inside Google Drive
    async function getOrCreateFolder(name: string, parentId?: string): Promise<string> {
      let q = `mimeType = 'application/vnd.google-apps.folder' and name = '${name}' and trashed = false`;
      if (parentId) {
        q += ` and '${parentId}' in parents`;
      }

      const res = await drive.files.list({ q, fields: "files(id, name)" });
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
      });
      return folder.data.id!;
    }

    // Traverse and create target folder path
    let currentParent = parentFolderId;
    if (folderPath && Array.isArray(folderPath)) {
      for (const folderName of folderPath) {
        currentParent = await getOrCreateFolder(folderName, currentParent);
      }
    }

    // Check if file already exists in target folder
    let q = `name = '${filename}' and trashed = false`;
    if (currentParent) {
      q += ` and '${currentParent}' in parents`;
    }
    const existingFiles = await drive.files.list({ q, fields: "files(id, name)" });

    if (existingFiles.data.files && existingFiles.data.files.length > 0) {
      const fileId = existingFiles.data.files[0].id!;
      await drive.files.update({
        fileId,
        media: {
          mimeType: mimeType || "text/plain",
          body: content,
        },
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
        media: {
          mimeType: mimeType || "text/plain",
          body: content,
        },
        fields: "id, webViewLink",
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
