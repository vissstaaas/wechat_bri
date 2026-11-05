import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const distRoot = path.join(projectRoot, "node_modules", "icloud-md", "dist");

const HOST_REWRITES = [
  [/https:\/\/setup\.icloud\.com(?!\.cn)/g, "https://setup.icloud.com.cn"],
  [/https:\/\/www\.icloud\.com(?!\.cn)/g, "https://www.icloud.com.cn"],
  [/setup\\\.icloud\\\.com(?!\\\.cn)/g, "setup\\.icloud\\.com\\.cn"]
];

const DOMAIN_CHECK_BEFORE = 'return host === "icloud.com" || host.endsWith(".icloud.com");';
const DOMAIN_CHECK_AFTER =
  'return host === "icloud.com" || host.endsWith(".icloud.com") || host === "icloud.com.cn" || host.endsWith(".icloud.com.cn");';

function collectJsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) return collectJsFiles(fullPath);
    return entry.name.endsWith(".js") ? [fullPath] : [];
  });
}

function patchFile(filePath) {
  const original = fs.readFileSync(filePath, "utf-8");
  let patched = HOST_REWRITES.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), original);
  patched = patched.replace(DOMAIN_CHECK_BEFORE, DOMAIN_CHECK_AFTER);
  if (patched === original) return false;
  fs.writeFileSync(filePath, patched, "utf-8");
  return true;
}

if (!fs.existsSync(distRoot)) {
  console.log("[patch-icloud-cn] icloud-md not installed, skipped.");
  process.exit(0);
}

const patchedFiles = collectJsFiles(distRoot).filter(patchFile);
console.log(`[patch-icloud-cn] patched ${patchedFiles.length} file(s) for icloud.com.cn`);
