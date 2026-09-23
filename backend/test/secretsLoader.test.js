const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { loadSecrets } = require('../src/secretsLoader');

// A real temp file each test can point envFilePath at - exercises the actual
// fs.readFileSync + parseEnvFile path, not just a mocked filesystem.
function tempEnvFile(contents) {
  const file = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'secrets-test-')), 'api.env');
  fs.writeFileSync(file, contents);
  return file;
}

// A fake Key Vault client: no real network call, no real Azure credential - this is
// what makes the Key Vault BRANCH of loadSecrets testable without an actual vault. The
// live managed-identity fetch itself can only be proven on the real app VM.
function fakeKeyVaultClient(secretsByName) {
  const requested = [];
  const client = {
    getSecret: async (name) => {
      requested.push(name);
      if (!(name in secretsByName)) throw new Error(`fake vault: no secret named "${name}"`);
      return { value: secretsByName[name] };
    },
  };
  return { client, requested };
}

describe('loadSecrets - local fallback (no Key Vault configured)', () => {
  test('reads MONGO_URL/JWT_SECRET straight from process.env-like input when no env file is given', async () => {
    const secrets = await loadSecrets({ env: { MONGO_URL: 'mongodb://x', JWT_SECRET: 'y'.repeat(32) } });
    assert.equal(secrets.mongoUrl, 'mongodb://x');
    assert.equal(secrets.jwtSecret, 'y'.repeat(32));
    assert.equal(secrets.source, 'process.env');
  });

  test('reads from the env file when the values are not already in env', async () => {
    const file = tempEnvFile(`MONGO_URL=mongodb://from-file\nJWT_SECRET=${'z'.repeat(32)}\n`);
    const secrets = await loadSecrets({ env: {}, envFilePath: file });
    assert.equal(secrets.mongoUrl, 'mongodb://from-file');
    assert.equal(secrets.jwtSecret, 'z'.repeat(32));
    assert.ok(secrets.source.includes(file));
  });

  test('an env var wins over the same key in the file', async () => {
    const file = tempEnvFile('MONGO_URL=mongodb://from-file\n');
    const secrets = await loadSecrets({ env: { MONGO_URL: 'mongodb://from-env' }, envFilePath: file });
    assert.equal(secrets.mongoUrl, 'mongodb://from-env');
  });

  test('a missing env file does not throw - just falls through with whatever env already had', async () => {
    const secrets = await loadSecrets({ env: {}, envFilePath: '/no/such/file/here.env' });
    assert.equal(secrets.mongoUrl, null);
    assert.equal(secrets.jwtSecret, undefined);
  });
});

describe('loadSecrets - Key Vault path', () => {
  test('fetches MongoUrl and JwtSecret from the injected client when KEY_VAULT_URI is set in env', async () => {
    const { client, requested } = fakeKeyVaultClient({ MongoUrl: 'mongodb://from-vault', JwtSecret: 'v'.repeat(32) });
    const secrets = await loadSecrets({
      env: { KEY_VAULT_URI: 'https://kv-test.vault.azure.net/' },
      keyVaultClientFactory: () => client,
    });
    assert.equal(secrets.mongoUrl, 'mongodb://from-vault');
    assert.equal(secrets.jwtSecret, 'v'.repeat(32));
    assert.ok(secrets.source.startsWith('key-vault'));
    assert.deepEqual(requested.sort(), ['JwtSecret', 'MongoUrl']);
  });

  test('also takes the Key Vault path when KEY_VAULT_URI is only in the env FILE, not process.env', async () => {
    // This is the scenario make-admin.js runs under: `sudo node ...` often does not
    // pass the caller's environment through, so KEY_VAULT_URI has to be readable from
    // /etc/api.env itself, the same as it would be for the systemd-started server.
    const file = tempEnvFile('KEY_VAULT_URI=https://kv-test.vault.azure.net/\nPORT=3000\n');
    const { client } = fakeKeyVaultClient({ MongoUrl: 'mongodb://from-vault-2', JwtSecret: 'w'.repeat(32) });
    const secrets = await loadSecrets({ env: {}, envFilePath: file, keyVaultClientFactory: () => client });
    assert.equal(secrets.mongoUrl, 'mongodb://from-vault-2');
  });

  test('Key Vault takes priority even if MONGO_URL/JWT_SECRET are also present (stale leftovers in the file)', async () => {
    const { client } = fakeKeyVaultClient({ MongoUrl: 'mongodb://correct-source', JwtSecret: 'k'.repeat(32) });
    const secrets = await loadSecrets({
      env: {
        KEY_VAULT_URI: 'https://kv-test.vault.azure.net/',
        MONGO_URL: 'mongodb://should-be-ignored',
        JWT_SECRET: 'ignored-too',
      },
      keyVaultClientFactory: () => client,
    });
    assert.equal(secrets.mongoUrl, 'mongodb://correct-source');
    assert.equal(secrets.jwtSecret, 'k'.repeat(32));
  });

  test('the factory receives the configured vault URI', async () => {
    const { client } = fakeKeyVaultClient({ MongoUrl: 'x', JwtSecret: 'y'.repeat(32) });
    let receivedUri;
    await loadSecrets({
      env: { KEY_VAULT_URI: 'https://kv-specific.vault.azure.net/' },
      keyVaultClientFactory: (uri) => { receivedUri = uri; return client; },
    });
    assert.equal(receivedUri, 'https://kv-specific.vault.azure.net/');
  });
});
