import { login, isLoggedIn } from "weixin-agent-sdk";

console.log("======================================================");
console.log(" NoteBridge AI - 微信 ClawBot 官方终端扫码认证向导");
console.log("======================================================");

if (isLoggedIn()) {
  console.log("✅ 检测到本地已存在有效的微信登录态，无需重复扫码！");
  process.exit(0);
}

try {
  console.log("\n[NoteBridge] 正在建立与腾讯官方 iLink AI Bot 通道...\n");
  const accountId = await login({
    log: (msg) => console.log(msg)
  });
  console.log(`\n======================================================`);
  console.log(`🎉 恭喜！微信 ClawBot 授权连接成功！`);
  console.log(`🆔 微信账号 ID: ${accountId}`);
  console.log(`======================================================\n`);
  process.exit(0);
} catch (err) {
  console.error(`\n❌ 微信授权连接中断: ${err.message}`);
  process.exit(1);
}
