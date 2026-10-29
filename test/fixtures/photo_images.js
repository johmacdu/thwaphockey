// test/fixtures/photo_images.js
//
// Tiny hand-built JPEG / PNG files for the photo endpoint tests. They are not
// decodable pictures, only structurally valid containers, which is all the
// server-side checks look at. Each carries GPS-style metadata so a test can
// prove the server strips it.

const seg = (marker, payload) => {
  const len = payload.length + 2;
  return Buffer.concat([Buffer.from([0xff, marker, len >> 8, len & 0xff]), payload]);
};

export const GPS_MARK = 'GPSLatitude=49.2827N';

export function jpegWithExif() {
  return Buffer.concat([
    Buffer.from([0xff, 0xd8]), // SOI
    seg(0xe0, Buffer.from('JFIF\0\x01\x01\0\0\x01\0\x01\0\0', 'latin1')), // APP0
    seg(0xe1, Buffer.from('Exif\0\0' + GPS_MARK, 'latin1')), // APP1 EXIF
    seg(0xfe, Buffer.from('comment: Lewie at 123 Main St', 'latin1')), // COM
    seg(0xdb, Buffer.alloc(65, 1)), // DQT
    seg(0xda, Buffer.from([1, 1, 0, 0, 63, 0])), // SOS header
    Buffer.from([0x12, 0x34, 0x56, 0x78]), // scan data
    Buffer.from([0xff, 0xd9]), // EOI
  ]);
}

const chunk = (type, data) => {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  return Buffer.concat([len, Buffer.from(type, 'latin1'), data, Buffer.alloc(4)]);
};

export function pngWithText() {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk('IHDR', Buffer.alloc(13, 1)),
    chunk('tEXt', Buffer.from('Comment\0' + GPS_MARK, 'latin1')),
    chunk('eXIf', Buffer.from(GPS_MARK, 'latin1')),
    chunk('IDAT', Buffer.from([1, 2, 3, 4])),
    chunk('IEND', Buffer.alloc(0)),
  ]);
}

export const dataUrl = (type, buf) => `data:image/${type};base64,${buf.toString('base64')}`;
export const JPEG_URL = dataUrl('jpeg', jpegWithExif());
export const PNG_URL = dataUrl('png', pngWithText());
