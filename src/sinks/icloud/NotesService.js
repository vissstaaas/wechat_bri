import fs from "fs";
import path from "path";
import crypto from "crypto";
import { fileURLToPath } from "url";
import { create, clone } from "@bufbuild/protobuf";
import { lookupRecords } from "icloud-md/dist/cloudkit/databaseClient.js";
import { parseNoteDocument, buildInitialNoteDocument, applyTextEdit, encodeNoteDocument } from "icloud-md/dist/notes/noteDocument.js";
import { decompressNoteDocument, compressNoteDocument } from "icloud-md/dist/notes/noteText.js";
import { buildNoteCreateFields, buildNoteUpdateFields } from "icloud-md/dist/notes/encodeNoteRecord.js";
import { AttributeRunSchema, AttachmentInfoSchema } from "icloud-md/dist/notes/gen/topotext_pb.js";
import { DriveService } from "./DriveService.js";
import { normalizeImageFileName } from "../../core/wechat-image-embedder.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(__dirname, "../../..");
const NOTES_DIR = path.join(PROJECT_ROOT, "notes");
const NOTES_SUBDIR = path.join(NOTES_DIR, "Notes");
const ATTACHMENTS_DIR = path.join(NOTES_SUBDIR, "attachments");
const GALLERY_NOTE_RECORD_NAME = "5439C17F-DBB2-4571-BCA1-B52D139F19C0";

function setAttachmentRunAtOffset(doc, charOffset, attId, typeUTI) {
  const out = [];
  let pos = 0;
  for (const run of doc.attributeRuns) {
    const start = pos;
    const end = pos + run.length;
    pos = end;
    if (charOffset >= start && charOffset < end) {
      const beforeLen = charOffset - start;
      const afterLen = end - (charOffset + 1);
      if (beforeLen > 0) {
        const b = clone(AttributeRunSchema, run);
        b.length = beforeLen;
        out.push(b);
      }
      out.push(
        create(AttributeRunSchema, {
          length: 1,
          attachmentInfo: create(AttachmentInfoSchema, {
            attachmentIdentifier: attId,
            typeUTI
          })
        })
      );
      if (afterLen > 0) {
        const a = clone(AttributeRunSchema, run);
        a.length = afterLen;
        out.push(a);
      }
    } else {
      out.push(run);
    }
  }
  doc.attributeRuns = out;
}

export class NotesService {
  /**
   * 将图片以原生 Attachment & Media 记录直接注入 Apple Notes
   */
  static async embedImageIntoAppleNote(imageBuffer, rawFileName = "wechat_photo.jpeg", captionText = "微信图片直传") {
    const ws = await DriveService.getWebservices();
    const { fileName, info } = normalizeImageFileName(rawFileName, imageBuffer);
    const typeUTI = info.uti;
    const attId = crypto.randomUUID().toUpperCase();
    const mediaId = crypto.randomUUID().toUpperCase();
    const dimensions = { width: info.width, height: info.height };
    const ckParams = `ckjsBuildVersion=2310ProjectDev27&ckjsVersion=2.6.4&clientId=8ef78dc1-e132-4e1f-9b12-8db48092e904&clientBuildNumber=2640Build24&clientMasteringNumber=2640Build24&dsid=${ws.dsid}`;

    // 1. 申请 CloudKit Media.Asset 上传令牌
    const rUp = await fetch(`${ws.ckUrl}/database/1/com.apple.notes/production/private/assets/upload?${ckParams}`, {
      method: "POST",
      headers: {
        Origin: "https://www.icloud.com.cn",
        Referer: "https://www.icloud.com.cn/",
        Cookie: ws.session.cookie,
        "Content-Type": "text/plain"
      },
      body: JSON.stringify({
        zoneID: { zoneName: "Notes" },
        tokens: [{ recordName: mediaId, recordType: "Media", fieldName: "Asset" }]
      })
    });
    if (!rUp.ok) throw new Error(`CloudKit assets/upload HTTP ${rUp.status}`);
    const tok = (await rUp.json()).tokens?.[0];
    if (!tok?.url) throw new Error("未获取到 CloudKit Media 上传地址");

    // 2. 上传二进制数据流
    const rSf = await fetch(tok.url, {
      method: "POST",
      headers: {
        Origin: "https://www.icloud.com.cn",
        Referer: "https://www.icloud.com.cn/",
        Cookie: ws.session.cookie
      },
      body: imageBuffer
    });
    if (!rSf.ok) throw new Error(`CloudKit singleFileUpload HTTP ${rSf.status}`);
    const sf = (await rSf.json()).singleFile;

    // 3. 查询当前备忘录记录并追加 U+FFFC Attachment
    const lookedUp = await lookupRecords(ws.session, ws.ckUrl, ws.dsid, "private", { zoneName: "Notes" }, [GALLERY_NOTE_RECORD_NAME]);
    const current = lookedUp?.[0];
    const timeStr = new Date().toLocaleString("zh-CN", { hour12: false });
    const nowMs = Date.now();
    let noteOp;
    const base64UTI = Buffer.from(typeUTI, "utf-8").toString("base64");
    const base64FileName = Buffer.from(fileName, "utf-8").toString("base64");

    if (current && current.fields?.TextDataEncrypted?.value) {
      const raw = decompressNoteDocument(Buffer.from(current.fields.TextDataEncrypted.value, "base64"));
      const doc = parseNoteDocument(raw);
      const addition = `\n[${timeStr}] ${captionText}\n\uFFFC\n`;
      const newText = doc.text + addition;
      const fffcOffset = newText.lastIndexOf("\uFFFC");
      applyTextEdit(doc, newText, { replicaId: crypto.randomBytes(16) });
      setAttachmentRunAtOffset(doc, fffcOffset, attId, typeUTI);
      const compressed = compressNoteDocument(encodeNoteDocument(doc));
      const updateFields = buildNoteUpdateFields(current, compressed.toString("base64"), newText, nowMs);

      updateFields.FirstAttachmentUTIEncrypted = { value: base64UTI };
      updateFields.FirstAttachmentThumbnail = { value: sf };
      updateFields.FirstAttachmentThumbnailOrientation = { value: 0 };

      noteOp = {
        operationType: "update",
        record: {
          recordName: GALLERY_NOTE_RECORD_NAME,
          recordType: "Note",
          recordChangeTag: current.recordChangeTag,
          fields: updateFields
        }
      };
    } else {
      const titleText = "🖼️ 微信图片速记测试";
      const fullText = `${titleText}\n[${timeStr}] ${captionText}\n\uFFFC\n`;
      const fffcOffset = fullText.lastIndexOf("\uFFFC");
      const doc = buildInitialNoteDocument(fullText, crypto.randomBytes(16));
      setAttachmentRunAtOffset(doc, fffcOffset, attId, typeUTI);
      const compressed = compressNoteDocument(encodeNoteDocument(doc));
      const createFields = buildNoteCreateFields(compressed.toString("base64"), fullText, nowMs);

      createFields.FirstAttachmentUTIEncrypted = { value: base64UTI };
      createFields.FirstAttachmentThumbnail = { value: sf };
      createFields.FirstAttachmentThumbnailOrientation = { value: 0 };

      noteOp = {
        operationType: "create",
        record: {
          recordName: GALLERY_NOTE_RECORD_NAME,
          recordType: "Note",
          fields: createFields
        }
      };
    }

    // 4. 原子提交 Note 更新 + 1:1 原生 Attachment + Media 资产
    const rMod = await fetch(`${ws.ckUrl}/database/1/com.apple.notes/production/private/records/modify?${ckParams}`, {
      method: "POST",
      headers: {
        Origin: "https://www.icloud.com.cn",
        Referer: "https://www.icloud.com.cn/",
        Cookie: ws.session.cookie,
        "Content-Type": "text/plain"
      },
      body: JSON.stringify({
        zoneID: { zoneName: "Notes" },
        operations: [
          noteOp,
          {
            operationType: "create",
            record: {
              recordName: attId,
              recordType: "Attachment",
              parent: { recordName: GALLERY_NOTE_RECORD_NAME },
              fields: {
                UTI: { value: typeUTI, type: "STRING" },
                Width: { value: dimensions.width, type: "DOUBLE" },
                Height: { value: dimensions.height, type: "DOUBLE" },
                FileSize: { value: imageBuffer.length, type: "INT64" },
                Orientation: { value: 0, type: "INT64" },
                ImageFilterType: { value: 0, type: "INT64" },
                HandwritingSummaryVersion: { value: 0, type: "INT64" },
                ImageClassificationSummaryVersion: { value: 0, type: "INT64" },
                OcrSummaryVersion: { value: 0, type: "INT64" },
                CroppingQuadTopRightX: { value: 1, type: "DOUBLE" },
                CroppingQuadTopRightY: { value: 1, type: "DOUBLE" },
                CroppingQuadTopLeftX: { value: 0, type: "DOUBLE" },
                CroppingQuadTopLeftY: { value: 1, type: "DOUBLE" },
                CroppingQuadBottomRightX: { value: 1, type: "DOUBLE" },
                CroppingQuadBottomRightY: { value: 0, type: "DOUBLE" },
                CroppingQuadBottomLeftX: { value: 0, type: "DOUBLE" },
                CroppingQuadBottomLeftY: { value: 0, type: "DOUBLE" },
                MinimumSupportedNotesVersion: { value: 1, type: "INT64" },
                Media: { value: { recordName: mediaId, action: "NONE", zoneID: { zoneName: "Notes" } }, type: "REFERENCE" },
                Note: { value: { recordName: GALLERY_NOTE_RECORD_NAME, action: "DELETE_SELF", zoneID: { zoneName: "Notes" } }, type: "REFERENCE" }
              }
            }
          },
          {
            operationType: "create",
            record: {
              recordName: mediaId,
              recordType: "Media",
              parent: { recordName: GALLERY_NOTE_RECORD_NAME },
              fields: {
                Asset: { value: sf },
                FilenameEncrypted: { value: base64FileName, type: "ENCRYPTED_BYTES" }
              }
            }
          }
        ]
      })
    });
    if (!rMod.ok) throw new Error(`CloudKit records/modify HTTP ${rMod.status}`);

    if (!fs.existsSync(ATTACHMENTS_DIR)) fs.mkdirSync(ATTACHMENTS_DIR, { recursive: true });
    fs.writeFileSync(path.join(ATTACHMENTS_DIR, fileName), imageBuffer);
    return { noteRecordName: GALLERY_NOTE_RECORD_NAME, attachmentRecordName: attId, mediaRecordName: mediaId, fileName, size: sf.size, dimensions };
  }

  static async bridgeImageToDriveAndNotes(imageBuffer, rawFileName, captionText = "微信图片直传") {
    const { fileName, info } = normalizeImageFileName(rawFileName, imageBuffer);
    const driveRes = await DriveService.uploadFile(imageBuffer, fileName, info.mime);
    const noteRes = await this.embedImageIntoAppleNote(imageBuffer, fileName, captionText);
    return { driveRes, noteRes, fileName };
  }
}
