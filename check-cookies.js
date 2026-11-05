import { chromium } from "playwright";
import path from "path";

const profileDir = "C:\\Users\\sxbdg\\.config\\icloud-md\\tmp\\login-b784dcef7d2d16e3";
console.log("Checking saved cookies in profile:", profileDir);

const context = await chromium.launchPersistentContext(profileDir, {
  headless: true
});

const cookies = await context.cookies();
console.log(`Found ${cookies.length} cookies!`);
for (const c of cookies) {
  if (c.domain.includes("icloud")) {
    console.log(`Cookie: ${c.name} on ${c.domain}`);
  }
}

await context.close();
