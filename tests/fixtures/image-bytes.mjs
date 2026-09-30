// Picture files built byte by byte for the image-attach suites: real headers
// with the dimensions a test asks for, and just enough body to be the type they
// claim. They are not meant to decode; the checks under test read headers.

const le16 = (value) => Buffer.from([value & 0xff, (value >> 8) & 0xff]);
const le24 = (value) => Buffer.from([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff]);
const le32 = (value) => Buffer.from([value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff]);

export const png = (width = 1, height = 1, pad = 0) => {
  const head = Buffer.alloc(33);
  Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).copy(head);
  head.writeUInt32BE(13, 8); head.write("IHDR", 12); head.writeUInt32BE(width, 16); head.writeUInt32BE(height, 20);
  return Buffer.concat([head, Buffer.alloc(pad, 7)]);
};

export const jpeg = (width = 1, height = 1, pad = 0) => Buffer.concat([
  Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10]), Buffer.from("JFIF\0\x01\x01\x00\x00\x01\x00\x01\x00\x00", "binary"),
  Buffer.from([0xff, 0xc0, 0x00, 0x11, 0x08, height >> 8, height & 0xff, width >> 8, width & 0xff, 0x03, 0x01, 0x22, 0x00, 0x02, 0x11, 0x01, 0x03, 0x11, 0x01]),
  Buffer.alloc(pad, 5), Buffer.from([0xff, 0xd9]),
]);

export const gif = (width = 1, height = 1, pad = 0) => Buffer.concat([Buffer.from("GIF89a"), le16(width), le16(height), Buffer.from([0, 0, 0]), Buffer.alloc(pad, 3), Buffer.from([0x3b])]);

const riff = (chunk, body, pad) => Buffer.concat([Buffer.from("RIFF"), le32(4 + 8 + body.length + pad), Buffer.from("WEBP"), Buffer.from(chunk), le32(body.length + pad), body, Buffer.alloc(pad, 1)]);
export const webpX = (width = 1, height = 1, pad = 0) => riff("VP8X", Buffer.concat([Buffer.from([0, 0, 0, 0]), le24(width - 1), le24(height - 1)]), pad);
export const webpL = (width = 1, height = 1, pad = 0) => riff("VP8L", Buffer.concat([Buffer.from([0x2f]), le32(((width - 1) & 0x3fff) | (((height - 1) & 0x3fff) << 14))]), pad);
export const webpLossy = (width = 1, height = 1, pad = 0) => riff("VP8 ", Buffer.concat([Buffer.from([0x10, 0x02, 0x00, 0x9d, 0x01, 0x2a]), le16(width), le16(height)]), pad);

/** Files that are not pictures, or not one of the four types, for the refusals. */
export const notPictures = {
  text: Buffer.from("just some words that are not a picture at all"),
  pdf: Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj\n"),
  svg: Buffer.from('<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><script>alert(1)</script></svg>'),
  html: Buffer.from("<!doctype html><html><body>hello</body></html>"),
  exe: Buffer.concat([Buffer.from("MZ"), Buffer.alloc(64, 0)]),
  bmp: Buffer.concat([Buffer.from("BM"), Buffer.alloc(64, 0)]),
  zip: Buffer.concat([Buffer.from([0x50, 0x4b, 0x03, 0x04]), Buffer.alloc(64, 0)]),
};
