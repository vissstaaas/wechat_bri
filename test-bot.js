import { login, start, isLoggedIn } from "weixin-agent-sdk";
import qrcodeterminal from "qrcode-terminal";
import QRCode from "qrcode";
import { exec } from "child_process";
import path from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const qrImagePath = path.join(__dirname, "qrcode.png");
const verifyCodePath = path.join(__dirname, "verify_code.txt");

// 拦截二维码生成，生成高精度图片并自动在 Windows 弹窗打开
const origGenerate = qrcodeterminal.generate;
qrcodeterminal.generate = function (url, opts, cb) {
  QRCode.toFile(qrImagePath, url, { width: 420, margin: 2 }, (err) => {
    if (!err) {
      console.log("\n=======================================================");
      console.log("【提示】二维码图片已保存: " + qrImagePath);
      console.log("【提示】正在为您在屏幕上自动弹窗打开二维码图片，请用微信扫码！");
      console.log("=======================================================\n");
      try {
        exec(`start "" "${qrImagePath}"`);
      } catch (e) {}
    }
  });
  return origGenerate.call(this, url, opts, cb);
};

console.log("=========================================");
console.log("       微信 ClawBot 测试连接启动中        ");
console.log("=========================================");

try {
  const accountId = await login({
    log: (msg) => console.log(msg),
    onVerifyCode: async ({ retry, signal }) => {
      console.log("\n[⚠️ 注意] 微信要求输入手机屏幕上显示的数字验证码！");
      console.log(`[⚠️ 注意] 请在文件 ${verifyCodePath} 中写入 6 位数字并保存，程序将自动读取。`);
      fs.writeFileSync(verifyCodePath, "", "utf-8");
      while (!signal.aborted) {
        await new Promise((r) => setTimeout(r, 1000));
        if (fs.existsSync(verifyCodePath)) {
          const code = fs.readFileSync(verifyCodePath, "utf-8").trim();
          if (code.length >= 4) {
            console.log(`[提示] 读取到验证码: ${code}`);
            return code;
          }
        }
      }
      return "";
    }
  });

  console.log(`\n🎉 登录成功！账号标识: ${accountId}`);

  console.log("\n正在启动测试消息监听器 (Echo 回复)...");
  const bot = start({
    async chat(req) {
      const timeStr = new Date().toLocaleTimeString();
      console.log(`\n-----------------------------------------`);
      console.log(`[${timeStr}] 收到来自微信的消息:`);
      console.log(`发送人/会话ID: ${req.conversationId}`);
      console.log(`文本内容: ${req.text || "(无文本)"}`);
      if (req.media) {
        console.log(`附件: 类型=${req.media.type}, 本地路径=${req.media.filePath}`);
      }
      console.log(`-----------------------------------------`);

      const replyText = `✅ [测试Bot回复 ${timeStr}]\n收到你的内容: "${req.text || `[${req.media?.type}文件]`}"\n微信通道连接成功！`;
      return { text: replyText };
    }
  });

  console.log("=========================================");
  console.log("  Bot 已成功启动！");
  console.log("  请在手机微信里给新连接的助手发一条消息测试。");
  console.log("=========================================");

  await bot.wait();
} catch (err) {
  console.error("\n❌ 运行失败:", err);
}
