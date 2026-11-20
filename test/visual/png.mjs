// Minimal PNG decode/crop/encode for 8-bit RGB/RGBA images (CDP screencast frames). Test tooling only.
import zlib from 'node:zlib';

export function decodePng(buf) {
  let at = 8;
  let width = 0;
  let height = 0;
  let colorType = 0;
  const idat = [];
  while (at < buf.length) {
    const len = buf.readUInt32BE(at);
    const type = buf.toString('latin1', at + 4, at + 8);
    const data = buf.subarray(at + 8, at + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      if (data[8] !== 8 || data[12] !== 0)
        throw new Error('unsupported PNG (bit depth / interlace)');
      colorType = data[9];
    } else if (type === 'IDAT') idat.push(data);
    at += 12 + len;
  }
  const bpp = colorType === 6 ? 4 : colorType === 2 ? 3 : 0;
  if (!bpp) throw new Error(`unsupported PNG colour type ${colorType}`);
  const raw = zlib.inflateSync(Buffer.concat(idat));
  const stride = width * bpp;
  const pixels = Buffer.alloc(stride * height);
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)];
    const line = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    const out = pixels.subarray(y * stride, (y + 1) * stride);
    const prev = y > 0 ? pixels.subarray((y - 1) * stride, y * stride) : null;
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? out[x - bpp] : 0;
      const b = prev ? prev[x] : 0;
      const c = prev && x >= bpp ? prev[x - bpp] : 0;
      let v = line[x];
      if (filter === 1) v += a;
      else if (filter === 2) v += b;
      else if (filter === 3) v += (a + b) >> 1;
      else if (filter === 4) {
        const p = a + b - c;
        const pa = Math.abs(p - a);
        const pb = Math.abs(p - b);
        const pc = Math.abs(p - c);
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c;
      }
      out[x] = v & 255;
    }
  }
  return { width, height, bpp, pixels };
}

export function cropRgb(img, x0, y0, w, h) {
  const out = Buffer.alloc(w * h * 3);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const sx = Math.min(img.width - 1, Math.max(0, x0 + x));
      const sy = Math.min(img.height - 1, Math.max(0, y0 + y));
      const s = (sy * img.width + sx) * img.bpp;
      const d = (y * w + x) * 3;
      out[d] = img.pixels[s];
      out[d + 1] = img.pixels[s + 1];
      out[d + 2] = img.pixels[s + 2];
    }
  }
  return { width: w, height: h, pixels: out };
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** Encodes an RGB image (Up filter on every row). */
export function encodeRgbPng({ width, height, pixels }) {
  const stride = width * 3;
  const raw = Buffer.alloc((stride + 1) * height);
  for (let y = 0; y < height; y++) {
    raw[y * (stride + 1)] = 2;
    for (let x = 0; x < stride; x++) {
      const cur = pixels[y * stride + x];
      const up = y > 0 ? pixels[(y - 1) * stride + x] : 0;
      raw[y * (stride + 1) + 1 + x] = (cur - up) & 255;
    }
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 2;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

/** Places RGB images side by side (same height) with a gap, on a background colour. */
export function hstack(images, gap = 6, bg = [40, 40, 40]) {
  const height = Math.max(...images.map((i) => i.height));
  const width = images.reduce((w, i) => w + i.width, 0) + gap * (images.length - 1);
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) pixels.set(bg, i * 3);
  let ox = 0;
  for (const img of images) {
    for (let y = 0; y < img.height; y++)
      img.pixels.copy(pixels, (y * width + ox) * 3, y * img.width * 3, (y + 1) * img.width * 3);
    ox += img.width + gap;
  }
  return { width, height, pixels };
}

/** Stacks RGB images vertically (same width or padded). */
export function vstack(images, gap = 6, bg = [40, 40, 40]) {
  const width = Math.max(...images.map((i) => i.width));
  const height = images.reduce((h, i) => h + i.height, 0) + gap * (images.length - 1);
  const pixels = Buffer.alloc(width * height * 3);
  for (let i = 0; i < width * height; i++) pixels.set(bg, i * 3);
  let oy = 0;
  for (const img of images) {
    for (let y = 0; y < img.height; y++)
      img.pixels.copy(pixels, (oy + y) * width * 3, y * img.width * 3, (y + 1) * img.width * 3);
    oy += img.height + gap;
  }
  return { width, height, pixels };
}

/** Nearest-neighbour upscale (for inspecting small details). */
export function upscale(img, k) {
  const width = img.width * k;
  const height = img.height * k;
  const pixels = Buffer.alloc(width * height * 3);
  for (let y = 0; y < height; y++)
    for (let x = 0; x < width; x++)
      img.pixels.copy(
        pixels,
        (y * width + x) * 3,
        (Math.floor(y / k) * img.width + Math.floor(x / k)) * 3,
        (Math.floor(y / k) * img.width + Math.floor(x / k)) * 3 + 3,
      );
  return { width, height, pixels };
}
