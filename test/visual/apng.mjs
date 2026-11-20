// Minimal APNG (animated PNG) writer for test captures. Frames are PNG buffers of identical size and
// format (CDP screenshots of the same clip); their image data is reused as-is. Test tooling only.
import zlib from 'node:zlib';

function chunks(png) {
  const out = [];
  for (let at = 8; at < png.length;) {
    const length = png.readUInt32BE(at);
    out.push({
      type: png.toString('latin1', at + 4, at + 8),
      data: png.subarray(at + 8, at + 8 + length),
    });
    at += 12 + length;
  }
  return out;
}

function chunk(type, data) {
  const head = Buffer.alloc(8);
  head.writeUInt32BE(data.length, 0);
  head.write(type, 4, 'latin1');
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(zlib.crc32(Buffer.concat([head.subarray(4), data])) >>> 0, 0);
  return Buffer.concat([head, data, crc]);
}

/** frames: [{ png: Buffer, delayMs: number }] → APNG buffer that loops forever. */
export function encodeApng(frames) {
  const first = chunks(frames[0].png);
  const ihdr = first.find((c) => c.type === 'IHDR').data;
  const width = ihdr.readUInt32BE(0);
  const height = ihdr.readUInt32BE(4);
  const parts = [Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr)];
  const actl = Buffer.alloc(8);
  actl.writeUInt32BE(frames.length, 0);
  actl.writeUInt32BE(0, 4); // loop forever
  parts.push(chunk('acTL', actl));
  let seq = 0;
  frames.forEach((frame, i) => {
    const fctl = Buffer.alloc(26);
    fctl.writeUInt32BE(seq++, 0);
    fctl.writeUInt32BE(width, 4);
    fctl.writeUInt32BE(height, 8);
    fctl.writeUInt32BE(0, 12);
    fctl.writeUInt32BE(0, 16);
    fctl.writeUInt16BE(Math.max(1, Math.round(frame.delayMs)), 20);
    fctl.writeUInt16BE(1000, 22);
    fctl.writeUInt8(0, 24); // dispose: none
    fctl.writeUInt8(0, 25); // blend: source
    parts.push(chunk('fcTL', fctl));
    for (const c of chunks(frame.png).filter((c) => c.type === 'IDAT')) {
      if (i === 0) parts.push(chunk('IDAT', c.data));
      else {
        const seqBuf = Buffer.alloc(4);
        seqBuf.writeUInt32BE(seq++, 0);
        parts.push(chunk('fdAT', Buffer.concat([seqBuf, c.data])));
      }
    }
  });
  parts.push(chunk('IEND', Buffer.alloc(0)));
  return Buffer.concat(parts);
}
