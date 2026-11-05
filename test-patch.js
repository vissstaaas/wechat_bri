import qrcodeterminal from "qrcode-terminal";
import QRCode from "qrcode";
import { exec } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const qrImagePath = path.join(__dirname, "qrcode.png");

const orig = qrcodeterminal.generate;
qrcodeterminal.generate = function (url, opts, cb) {
  console.log("Captured QR URL:", url);
  QRCode.toFile(qrImagePath, url, { width: 350 }, (err) => {
    if (!err) {
      console.log("QR Code saved to:", qrImagePath);
    }
  });
  return orig.call(this, url, opts, cb);
};

qrcodeterminal.generate("https://example.com/test", { small: true }, (qr) => {
  console.log("Mock QR generated successfully");
});
