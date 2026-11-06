import fs from "fs";
import path from "path";

const htmlPath = "d:/dev/ideas/omnibridge-core/public/index.html";
let html = fs.readFileSync(htmlPath, "utf-8");

html = html.replace('<span id="bk-wx-id" class="font-bold">4547d85e4cb2-im-bot</span>', '<span id="bk-wx-id" class="font-bold">--</span>');
html = html.replace(/<div class="text-\[11px\] text-neutral-600 bg-amber-50 p-2 border border-amber-200 mt-2">[\s\S]*?<\/div>/, '');
html = html.replace('🔑 登录 iCloud（弹出独立登录窗口）', '🔑 登录 / 授权 iCloud（云上贵州）');

fs.writeFileSync(htmlPath, html, "utf-8");
console.log("HTML successfully updated");
