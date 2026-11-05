import { chromium } from "playwright";

console.log("Testing visible browser popup...");
const context = await chromium.launchPersistentContext("C:\\Users\\sxbdg\\.config\\icloud-md\\tmp\\test-login", {
  headless: false,
  viewport: null
});
const page = context.pages()[0] || await context.newPage();
await page.goto("https://www.icloud.com/");
console.log("Successfully navigated to icloud.com!");
console.log("Waiting 6 seconds to let you see the window...");
await new Promise(r => setTimeout(r, 6000));
await context.close();
console.log("Test window closed.");
