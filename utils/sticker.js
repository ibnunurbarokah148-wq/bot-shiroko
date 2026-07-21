const webpmux = require('node-webpmux');

async function tambahMetadataStiker(bufferWebp, packName, authorName) {
    const img = new webpmux.Image();
    await img.load(bufferWebp);

    // Format JSON wajib standar WhatsApp
    const jsonMeta = {
        "sticker-pack-id": "ShirokoSystem",
        "sticker-pack-name": packName,
        "sticker-pack-publisher": authorName,
        "emojis": ["🐺", "✨"]
    };

    // Header byte khusus untuk format EXIF WEBP
    const exifAttr = Buffer.from([0x49, 0x49, 0x2A, 0x00, 0x08, 0x00, 0x00, 0x00, 0x01, 0x00, 0x41, 0x57, 0x07, 0x00, 0x00, 0x00, 0x00, 0x00, 0x16, 0x00, 0x00, 0x00]);
    const jsonBuff = Buffer.from(JSON.stringify(jsonMeta), "utf-8");
    const exif = Buffer.concat([exifAttr, jsonBuff]);
    exif.writeUIntLE(jsonBuff.length, 14, 4);

    img.exif = exif;
    return await img.save(null); // Kembalikan sebagai buffer yang sudah disuntik
}

module.exports = { tambahMetadataStiker };
