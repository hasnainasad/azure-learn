const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { Readable } = require('node:stream');
const { createBlobStore } = require('../src/blobStorage');

// A real temp file each test can point envFilePath at, same approach as secretsLoader.test.js.
function tempEnvFile(contents) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'blobstore-test-')), 'api.env');
  fs.writeFileSync(file, contents);
  return file;
}

// A fake container client: no real network call, no real Azure credential - this is what
// makes the configured BRANCH of createBlobStore testable without an actual storage
// account. The live managed-identity upload/download can only be proven on the real app VM.
function fakeContainerClient() {
  const blockBlobs = new Map();
  const client = {
    getBlockBlobClient(blobName) {
      return {
        async uploadData(buffer, opts) {
          blockBlobs.set(blobName, { buffer, contentType: opts?.blobHTTPHeaders?.blobContentType });
        },
        async download() {
          const blob = blockBlobs.get(blobName);
          if (!blob) throw new Error(`fake container: no blob named "${blobName}"`);
          return { readableStreamBody: Readable.from(blob.buffer), contentType: blob.contentType, contentLength: blob.buffer.length };
        },
      };
    },
  };
  return { client, blockBlobs };
}

describe('createBlobStore - not configured', () => {
  test('reports unconfigured with no STORAGE_ACCOUNT_NAME anywhere, and fails clearly on use', async () => {
    const store = createBlobStore({ env: {} });
    assert.equal(store.configured, false);
    await assert.rejects(() => store.upload('x', Buffer.from('y'), { contentType: 'text/plain' }), /not configured/);
    await assert.rejects(() => store.download('x'), /not configured/);
  });
});

describe('createBlobStore - configured', () => {
  test('uploads and downloads a blob via the injected container client', async () => {
    const { client, blockBlobs } = fakeContainerClient();
    let receivedAccount, receivedContainer;
    const store = createBlobStore({
      env: { STORAGE_ACCOUNT_NAME: 'stlab' },
      containerClientFactory: (account, container) => {
        receivedAccount = account;
        receivedContainer = container;
        return client;
      },
    });
    assert.equal(store.configured, true);
    assert.equal(receivedAccount, 'stlab');
    assert.equal(receivedContainer, 'kyc-documents'); // default when STORAGE_CONTAINER_NAME isn't set

    await store.upload('user-1', Buffer.from('hello'), { contentType: 'application/pdf' });
    assert.equal(blockBlobs.get('user-1').contentType, 'application/pdf');

    const { stream, contentType, contentLength } = await store.download('user-1');
    assert.equal(contentType, 'application/pdf');
    assert.equal(contentLength, 5);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), 'hello');
  });

  test('re-uploading the same blob name overwrites it, with no separate delete step', async () => {
    const { client } = fakeContainerClient();
    const store = createBlobStore({ env: { STORAGE_ACCOUNT_NAME: 'stlab' }, containerClientFactory: () => client });
    await store.upload('user-1', Buffer.from('first version'), { contentType: 'application/pdf' });
    await store.upload('user-1', Buffer.from('second version'), { contentType: 'image/png' });

    const { stream, contentType } = await store.download('user-1');
    assert.equal(contentType, 'image/png');
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    assert.equal(Buffer.concat(chunks).toString(), 'second version');
  });

  test('reads STORAGE_ACCOUNT_NAME from the env FILE when it is not in process.env, same as KEY_VAULT_URI', async () => {
    const file = tempEnvFile('STORAGE_ACCOUNT_NAME=stlab2\nPORT=3000\n');
    const { client } = fakeContainerClient();
    let receivedAccount;
    const store = createBlobStore({
      env: {},
      envFilePath: file,
      containerClientFactory: (account) => {
        receivedAccount = account;
        return client;
      },
    });
    assert.equal(store.configured, true);
    assert.equal(receivedAccount, 'stlab2');
  });

  test('a custom STORAGE_CONTAINER_NAME overrides the "kyc-documents" default', async () => {
    const { client } = fakeContainerClient();
    let receivedContainer;
    createBlobStore({
      env: { STORAGE_ACCOUNT_NAME: 'stlab', STORAGE_CONTAINER_NAME: 'custom-container' },
      containerClientFactory: (account, container) => {
        receivedContainer = container;
        return client;
      },
    });
    assert.equal(receivedContainer, 'custom-container');
  });

  test('downloading a blob that was never uploaded rejects instead of returning something empty', async () => {
    const { client } = fakeContainerClient();
    const store = createBlobStore({ env: { STORAGE_ACCOUNT_NAME: 'stlab' }, containerClientFactory: () => client });
    await assert.rejects(() => store.download('nobody'));
  });
});
