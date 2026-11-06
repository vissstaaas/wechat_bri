import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { listAccounts, accountSessionPath } from "icloud-md/dist/auth/accountStore.js";
import { loadSession } from "icloud-md/dist/session.js";
import { getAllIndexedPhotos } from "../../core/photo-index-engine.js";
import { normalizeImageFileName } from "../../core/wechat-image-embedder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const NOTES_DIR = path.join(PROJECT_ROOT, "notes");
const NOTES_SUBDIR = path.join(NOTES_DIR, "Notes");
const ATTACHMENTS_DIR = path.join(NOTES_SUBDIR, "attachments");
const MEDIA_SAVE_DIR = path.join(PROJECT_ROOT, "wechat_media");
const DRIVE_PHOTO_FOLDER_ID = "C71D98D3-A6C1-41BC-B530-8250CB864A2C"; // 学习照片

if (!fs.existsSync(MEDIA_SAVE_DIR)) fs.mkdirSync(MEDIA_SAVE_DIR, { recursive: true });
if (!fs.existsSync(ATTACHMENTS_DIR)) fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });

let cachedIcloudWs = null;
let cachedIcloudWsAt = 0;
let cachedDriveListing = null;
let cachedDriveListingAt = 0;

export class DriveService {
  static async getWebservices(forceRefresh = false) {
    if (!forceRefresh && cachedIcloudWs && Date.now() - cachedIcloudWsAt < 10 * 60 * 1000) {
      return cachedIcloudWs;
    }
    const accs = await listAccounts();
    if (!accs || accs.length === 0) throw new Error("未找到已登录的 iCloud 账号会话");
    const session = await loadSession(accountSessionPath(accs[0].dsid));
    const res = await fetch(
      "https://setup.icloud.com.cn/setup/ws/1/validate?clientBuildNumber=2610Build20&clientMasteringNumber=2610Build20&clientId=dc038370-55d2-4090-9f16-a0a96fb3129a",
      {
        method: "POST",
        headers: {
          Origin: "https://www.icloud.com.cn",
          Referer: "https://www.icloud.com.cn/",
          Cookie: session.cookie
        }
      }
    );
    if (!res.ok) throw new Error(`iCloud validate HTTP ${res.status}`);
    const data = await res.json();
    cachedIcloudWs = {
      session,
      dsid: String(data.dsInfo?.dsid || accs[0].dsid),
      fullName: data.dsInfo?.fullName || "iCloud User",
      appleId: data.dsInfo?.appleId || accs[0].appleId,
      driveUrl: data.webservices?.drivews?.url,
      docUrl: data.webservices?.docws?.url,
      ckUrl: data.webservices?.ckdatabasews?.url,
      photosUrl: data.webservices?.photosws?.url,
      allServices: Object.keys(data.webservices || {})
    };
    cachedIcloudWsAt = Date.now();
    return cachedIcloudWs;
  }

  static async listDriveItems(forceRefresh = false) {
    if (!forceRefresh && cachedDriveListing && Date.now() - cachedDriveListingAt < 30 * 1000) {
      return cachedDriveListing;
    }
    const ws = await this.getWebservices(forceRefresh);
    const queryParams = `clientBuildNumber=2610Build20&clientMasteringNumber=2610Build20&clientId=dc038370-55d2-4090-9f16-a0a96fb3129a&dsid=${ws.dsid}`;

    // 1. 查询根目录
    const rRoot = await fetch(`${ws.driveUrl}/retrieveItemDetailsInFolders?${queryParams}`, {
      method: "POST",
      headers: {
        Origin: "https://www.icloud.com.cn",
        Referer: "https://www.icloud.com.cn/",
        Cookie: ws.session.cookie,
        "Content-Type": "text/plain"
      },
      body: JSON.stringify([{ drivewsid: "FOLDER::com.apple.CloudDocs::root", partialData: false }])
    });
    const rootArr = await rRoot.json();
    const rootFolder = rootArr?.[0] || {};
    const rootItems = rootFolder.items || [];

    const allFiles = [];
    const subFoldersToQuery = [];

    for (const item of rootItems) {
      if (item.type === "FILE") {
        allFiles.push({
          docwsid: item.docwsid,
          drivewsid: item.drivewsid,
          name: item.extension ? `${item.name}.${item.extension}` : item.name,
          rawName: item.name,
          extension: item.extension || "",
          size: item.size || 0,
          folderName: "iCloud 云盘根目录",
          zone: item.zone || "com.apple.CloudDocs"
        });
      } else if (item.type === "FOLDER" && item.drivewsid) {
        subFoldersToQuery.push({ name: item.name, drivewsid: item.drivewsid, docwsid: item.docwsid });
      }
    }

    // 2. 批量展开子文件夹
    if (subFoldersToQuery.length > 0) {
      const batch = subFoldersToQuery.slice(0, 15);
      const rSub = await fetch(`${ws.driveUrl}/retrieveItemDetailsInFolders?${queryParams}`, {
        method: "POST",
        headers: {
          Origin: "https://www.icloud.com.cn",
          Referer: "https://www.icloud.com.cn/",
          Cookie: ws.session.cookie,
          "Content-Type": "text/plain"
        },
        body: JSON.stringify(batch.map(f => ({ drivewsid: f.drivewsid, partialData: false })))
      });
      const subArr = await rSub.json();
      if (Array.isArray(subArr)) {
        for (const sf of subArr) {
          const folderLabel = sf.name || "子文件夹";
          for (const item of sf.items || []) {
            if (item.type === "FILE") {
              allFiles.push({
                docwsid: item.docwsid,
                drivewsid: item.drivewsid,
                name: item.extension ? `${item.name}.${item.extension}` : item.name,
                rawName: item.name,
                extension: item.extension || "",
                size: item.size || 0,
                folderName: folderLabel,
                zone: item.zone || "com.apple.CloudDocs"
              });
            }
          }
        }
      }
    }

    // 3. 读取本地已索引的图片相册
    const noteImages = getAllIndexedPhotos().slice(0, 20);

    cachedDriveListing = {
      account: { fullName: ws.fullName, appleId: ws.appleId, dsid: ws.dsid, services: ws.allServices },
      folders: subFoldersToQuery,
      files: allFiles,
      noteImages
    };
    cachedDriveListingAt = Date.now();
    return cachedDriveListing;
  }

  static async downloadFile(docwsid, fileNameHint = "icloud_file.pdf") {
    const ws = await this.getWebservices();
    const queryParams = `document_id=${encodeURIComponent(docwsid)}&clientBuildNumber=2610Build20&clientMasteringNumber=2610Build20&clientId=dc038370-55d2-4090-9f16-a0a96fb3129a&dsid=${ws.dsid}`;
    const rInfo = await fetch(`${ws.docUrl}/ws/com.apple.CloudDocs/download/by_id?${queryParams}`, {
      method: "GET",
      headers: {
        Origin: "https://www.icloud.com.cn",
        Referer: "https://www.icloud.com.cn/",
        Cookie: ws.session.cookie
      }
    });
    if (!rInfo.ok) throw new Error(`docws download/by_id HTTP ${rInfo.status}`);
    const dlInfo = await rInfo.json();
    const downloadUrl = dlInfo?.data_token?.url;
    if (!downloadUrl) throw new Error("未获取到 iCloud 云盘文件下载链接");

    const rBytes = await fetch(downloadUrl);
    if (!rBytes.ok) throw new Error(`下载云盘文件实体失败 HTTP ${rBytes.status}`);
    const buf = Buffer.from(await rBytes.arrayBuffer());

    const safeName = fileNameHint.replace(/[\\/:*?"<>|]/g, "_");
    const localPath = path.join(MEDIA_SAVE_DIR, safeName);
    fs.writeFileSync(localPath, buf);
    return { localPath, fileName: safeName, size: buf.length };
  }

  static async uploadFile(fileBuffer, fileName, contentType = "image/png", parentFolderDocwsid = DRIVE_PHOTO_FOLDER_ID) {
    const ws = await this.getWebservices();
    const queryParams = `clientBuildNumber=2610Build20&clientMasteringNumber=2610Build20&clientId=dc038370-55d2-4090-9f16-a0a96fb3129a&dsid=${ws.dsid}`;

    // Step 1: 申请上传 URL
    const r1 = await fetch(`${ws.docUrl}/ws/com.apple.CloudDocs/upload/web?${queryParams}`, {
      method: "POST",
      headers: {
        Origin: "https://www.icloud.com.cn",
        Referer: "https://www.icloud.com.cn/",
        Cookie: ws.session.cookie,
        "Content-Type": "text/plain"
      },
      body: JSON.stringify({
        filename: fileName,
        type: "FILE",
        content_type: contentType,
        size: fileBuffer.length
      })
    });
    if (!r1.ok) throw new Error(`Drive upload/web HTTP ${r1.status}`);
    const up1 = (await r1.json())[0];

    // Step 2: 上传二进制流至 cws.icloud-content.com.cn
    const form = new FormData();
    form.append("files", new Blob([fileBuffer], { type: contentType }), fileName);
    const r2 = await fetch(up1.url, {
      method: "POST",
      headers: {
        Origin: "https://www.icloud.com.cn",
        Referer: "https://www.icloud.com.cn/",
        Cookie: ws.session.cookie
      },
      body: form
    });
    if (!r2.ok) throw new Error(`Drive singleFileUpload HTTP ${r2.status}`);
    const up2 = await r2.json();
    const sf = up2.singleFile;

    // Step 3: 挂载到指定 iCloud 云盘目录
    const r3 = await fetch(`${ws.docUrl}/ws/com.apple.CloudDocs/update/documents?${queryParams}`, {
      method: "POST",
      headers: {
        Origin: "https://www.icloud.com.cn",
        Referer: "https://www.icloud.com.cn/",
        Cookie: ws.session.cookie,
        "Content-Type": "text/plain"
      },
      body: JSON.stringify({
        data: {
          signature: sf.fileChecksum,
          wrapping_key: sf.wrappingKey,
          reference_signature: sf.referenceChecksum,
          receipt: sf.receipt,
          size: sf.size
        },
        command: "add_file",
        document_id: up1.document_id,
        path: {
          starting_document_id: parentFolderDocwsid,
          path: fileName
        },
        allow_conflict: true,
        file_flags: {
          is_writable: true,
          is_executable: false,
          is_hidden: false
        }
      })
    });
    if (!r3.ok) throw new Error(`Drive update/documents HTTP ${r3.status}`);
    const res3 = await r3.json();
    cachedDriveListingAt = 0;
    return { documentId: up1.document_id, fileName, size: sf.size, raw: res3 };
  }
}
