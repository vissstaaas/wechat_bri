import { chromium } from "playwright";

const BASE = "http://localhost:3080";
const errors = [];
const logs = [];

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });

page.on("console", (msg) => {
  const t = msg.type();
  if (t === "error") errors.push(msg.text());
  else if (t === "warning") logs.push(msg.text());
});
page.on("pageerror", (err) => errors.push("PAGEERROR: " + err.message));
page.on("requestfailed", (req) => errors.push("REQFAIL: " + req.url() + " " + (req.failure()?.errorText || "")));

async function shot(name) {
  await page.screenshot({ path: `D:/dev/ideas/omnibridge-core/.workbuddy/tmp/${name}.png`, fullPage: false });
  console.log("截图:", name);
}

try {
  await page.goto(BASE, { waitUntil: "networkidle", timeout: 20000 });
  await page.waitForTimeout(2000);
  await shot("01-home");

  // 页面标题
  console.log("标题:", await page.title());

  // 检查 STEP 标签和当前步骤
  const stepTabs = await page.locator("[id^='wiz-tab-']").allTextContents();
  console.log("步骤标签:", stepTabs.join(" | "));

  // 检查是否有明显的"已识别连接/进入 Playground"提示
  const bodyText = (await page.locator("body").innerText()).slice(0, 500);
  console.log("页面文本片段:", bodyText.replace(/\n+/g, " | ").slice(0, 400));

  // 尝试点击进入 Playground（如果有按钮）
  const enterBtns = page.locator("text=/进入 Playground|进入控制台|Playground/");
  const n = await enterBtns.count();
  console.log("进入Playground按钮数:", n);
  if (n > 0) {
    await enterBtns.first().click();
    await page.waitForTimeout(2000);
    await shot("02-playground");
  }

  // 检查 STEP 03 控制台是否可见，尝试点几个功能按钮
  // 尝试切换到 STEP 03
  const tab3 = page.locator("#wiz-tab-3");
  if (await tab3.count()) {
    await tab3.click();
    await page.waitForTimeout(1500);
    await shot("03-step3");
  }

  // 模拟打标按钮测试
  const simBtn = page.locator("text=/快速打标|测试打标|模拟/").first();
  if (await simBtn.count()) {
    console.log("找到模拟按钮");
  }

} catch (e) {
  console.log("脚本异常:", e.message);
} finally {
  console.log("=== console 错误 (" + errors.length + ") ===");
  for (const e of errors.slice(0, 20)) console.log("  " + e.slice(0, 200));
  console.log("=== console 警告 (" + logs.length + ") ===");
  for (const l of logs.slice(0, 10)) console.log("  " + l.slice(0, 150));
  await browser.close();
}
