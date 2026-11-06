/**
 * iCloud 登录 Worker —— 独立进程运行，由服务端通过 CreateProcess(lpDesktop=WinSta0\default)
 * 启动到用户的交互桌面，负责弹出真实的苹果登录浏览器窗口并抓取会话 Cookie。
 *
 * 结果写回 resultPath (JSON)：{ ok: true, appleId, dsid } 或 { ok: false, error }。
 *
 * 用法: node icloud-login-worker.mjs <notesDir> <mode:reauth|bind> <resultPath>
 */
import fs from "node:fs";
import { reauthenticateFolder, bindNewFolderAccount } from "icloud-md/dist/auth/folderAuth.js";

const [notesDir, mode, resultPath] = process.argv.slice(2);

function writeResult(obj) {
  try {
    fs.writeFileSync(resultPath, JSON.stringify(obj, null, 2), "utf-8");
  } catch (e) {
    console.error("[icloud-login-worker] 无法写结果文件:", e.message);
  }
}

function status(text) {
  console.log("[icloud-login-worker]", text);
}

async function main() {
  try {
    status(`开始登录 (mode=${mode}, notesDir=${notesDir})`);
    let auth;
    if (mode === "bind") {
      auth = await bindNewFolderAccount({ onStatus: status });
    } else {
      auth = await reauthenticateFolder(notesDir, { onStatus: status });
    }
    writeResult({ ok: true, appleId: auth.appleId, dsid: auth.dsid, at: Date.now() });
    status(`登录成功 ${auth.appleId} (dsid=${auth.dsid})`);
    process.exit(0);
  } catch (e) {
    const message = e?.message || String(e);
    writeResult({ ok: false, error: message, at: Date.now() });
    status(`登录失败: ${message}`);
    process.exit(1);
  }
}

main();
