/**
 * In-Memory Zero-Disk Stream Sanitizer & Type Sniffer
 * Completely bypasses physical disk writes for maximum privacy and multi-tenant security.
 */
export class StreamSanitizer {
  /**
   * Sniff image format, dimension and Apple UTI directly from Buffer header without disk writes
   */
  static inspectImageBuffer(buf) {
    if (!buf || buf.length < 16) {
      return { ext: ".png", uti: "public.png", mime: "image/png", width: 1080, height: 1080 };
    }

    // JPEG (FF D8 FF)
    if (buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) {
      const dim = this.getJpegDimensions(buf);
      return {
        ext: ".jpg",
        uti: "public.jpeg",
        mime: "image/jpeg",
        width: dim.width || 1280,
        height: dim.height || 1707
      };
    }

    // PNG (89 50 4E 47 0D 0A 1A 0A)
    if (buf[0] === 0x89 && buf[1] === 0x50 && buf[2] === 0x4e && buf[3] === 0x47) {
      const width = buf.readUInt32BE(16);
      const height = buf.readUInt32BE(20);
      return {
        ext: ".png",
        uti: "public.png",
        mime: "image/png",
        width: width || 1080,
        height: height || 1080
      };
    }

    // GIF (47 49 46 38)
    if (buf[0] === 0x47 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x38) {
      const width = buf.readUInt16LE(6);
      const height = buf.readUInt16LE(8);
      return {
        ext: ".gif",
        uti: "com.compuserve.gif",
        mime: "image/gif",
        width: width || 800,
        height: height || 600
      };
    }

    return { ext: ".jpg", uti: "public.jpeg", mime: "image/jpeg", width: 1280, height: 1707 };
  }

  static getJpegDimensions(buf) {
    try {
      let offset = 2;
      while (offset < buf.length - 8) {
        if (buf[offset] !== 0xff) {
          offset++;
          continue;
        }
        const marker = buf[offset + 1];
        // SOF0, SOF1, SOF2 markers
        if ([0xc0, 0xc1, 0xc2].includes(marker)) {
          const height = buf.readUInt16BE(offset + 5);
          const width = buf.readUInt16BE(offset + 7);
          return { width, height };
        }
        const length = buf.readUInt16BE(offset + 2);
        offset += 2 + length;
      }
    } catch {}
    return { width: 1280, height: 1707 };
  }

  /**
   * Safely wipe sensitive memory buffer after transmission
   */
  static wipeBuffer(buf) {
    if (Buffer.isBuffer(buf)) {
      buf.fill(0);
    }
  }
}
