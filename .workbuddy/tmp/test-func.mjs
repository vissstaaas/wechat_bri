import { chromium } from "playwright";

const BASE = "http://localhost:3080";
const errors = [];
const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on("console", m => { if (m.type() === "error") errors.push(m.text()); });
page.on("pageerror", e => errors.push("PAGEERROR: " + e.message));

async function shot(n) { await page.screenshot({ path: `D:/dev/ideas/omnibridge-core/.workbuddy/tmp/${n}.png` }); }

try {
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(2000);

  // 检查顶部状态栏（BOT 是否还是 null）
  const summary = await page.locator("#console-top-summary").innerText().catch(() => "无元素");
  console.log("顶部状态栏:", summary);

  // 点击进入 Playground
  const pgTab = page.locator("text=Playground & Console").first();
  if (await pgTab.count()) { await pgTab.click(); await page.waitForTimeout(1500); }

  // 测试 1：模拟打标（quickFillAndRun）
  await page.evaluate(() => { window.quickFillAndRun("帮我查一下备忘录里的宽带密码是多少"); });
  await page.waitForTimeout(2500);
  await shot("t1-simulate");

  // 检查 RLCD.OUTPUT 是否有变化
  const rlcd = await page.locator("#rlcd-output, [id*=rlcd], [class*=rlcd]").innerText().catch(() => "无");
  console.log("模拟打标后 RLCD 输出:", (rlcd || "").slice(0, 300));

  // 测试 2：SIRI 搜索
  await page.evaluate(() => {
    const inp = document.getElementById('siri-search-input');
    if (inp) inp.value = "宽带";
    window.executeRealSiriSearch();
  });
  await page.waitForTimeout(2000);
  const siri = await page.locator("#siri-search-results").innerText().catch(() => "无");
  console.log("SIRI 搜索结果:", (siri || "").slice(0, 300));
  await shot("t2-siri");

  // 测试 3：图库检索
  await page.evaluate(() => {
    const inp = document.getElementById('photo-semantic-search-input');
    if (inp) inp.value = "";
    window.executePhotoSemanticSearch();
  });
  await page.waitForTimeout(2500);
  const gal = await page.locator("#notes-gallery-grid").innerText().catch(() => "无");
  console.log("图库检索结果(前300):", (gal || "").slice(0, 300));
  await shot("t3-gallery");

} catch (e) {
  console.log("脚本异常:", e.message);
} finally {
  console.log("=== console 错误 (" + errors.length + ") ===");
  for (const e of errors.slice(0, 15)) console.log("  " + e.slice(0, 200));
  await browser.close();
}
