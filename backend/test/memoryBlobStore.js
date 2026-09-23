// In-memory stand-in for src/blobStorage.js's createBlobStore, in the same spirit as
// memoryKycRepo.js/memoryUserRepo.js - lets kyc.test.js exercise the full submit-and-
// fetch-the-document flow through createApp() with no real Azure Storage account.
function createMemoryBlobStore() {
  const blobs = new Map(); // blobName -> { buffer, contentType }

  return {
    configured: true,
    async upload(blobName, buffer, { contentType }) {
      blobs.set(blobName, { buffer: Buffer.from(buffer), contentType });
    },
    async download(blobName) {
      const blob = blobs.get(blobName);
      if (!blob) {
        const err = new Error(`memory blob store: no blob named "${blobName}"`);
        err.statusCode = 404;
        throw err;
      }
      const { Readable } = require('node:stream');
      return { stream: Readable.from(blob.buffer), contentType: blob.contentType, contentLength: blob.buffer.length };
    },
    // Test-only helper, not part of the real blobStorage.js interface - lets tests assert
    // on what actually got uploaded without going through an HTTP download round trip.
    _get(blobName) {
      return blobs.get(blobName);
    },
  };
}

module.exports = { createMemoryBlobStore };
