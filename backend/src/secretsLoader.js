// The one place server.js and scripts/make-admin.js both get MONGO_URL and JWT_SECRET
// from - either Azure Key Vault (production, via the app VM's managed identity) or a
// local env var / env file (local dev and automated tests, with zero Azure dependency).
//
// KEY_VAULT_URI is not itself a secret - it's just a URL - so it's fine for it to stay
// in the plain-text /etc/api.env file (alongside PORT, NODE_ENV) even after this slice.
// What moves OUT of that file are the two things that actually matter: the database
// connection string and the token-signing secret.
//
// @azure/identity and @azure/keyvault-secrets are required lazily, only once a vault
// URI is actually configured, so running this project locally or in CI never needs
// Azure installed, reachable, or authenticated against.
const fs = require('fs');
const { parseEnvFile } = require('./envFile');

async function loadSecrets({ env = process.env, envFilePath, keyVaultClientFactory } = {}) {
  let fileVars = {};
  if (envFilePath) {
    try {
      fileVars = parseEnvFile(fs.readFileSync(envFilePath, 'utf8'));
    } catch {
      fileVars = {}; // a missing file is fine - env vars alone might have everything we need
    }
  }

  const vaultUri = env.KEY_VAULT_URI || fileVars.KEY_VAULT_URI;
  if (vaultUri) {
    const client = keyVaultClientFactory ? keyVaultClientFactory(vaultUri) : defaultKeyVaultClient(vaultUri);
    const [mongoSecret, jwtSecret] = await Promise.all([
      client.getSecret('MongoUrl'),
      client.getSecret('JwtSecret'),
    ]);
    return { mongoUrl: mongoSecret.value, jwtSecret: jwtSecret.value, source: `key-vault (${vaultUri})` };
  }

  return {
    mongoUrl: env.MONGO_URL || fileVars.MONGO_URL || null,
    jwtSecret: env.JWT_SECRET || fileVars.JWT_SECRET,
    source: envFilePath ? `local env file (${envFilePath})` : 'process.env',
  };
}

function defaultKeyVaultClient(vaultUri) {
  const { DefaultAzureCredential } = require('@azure/identity');
  const { SecretClient } = require('@azure/keyvault-secrets');
  // DefaultAzureCredential tries several auth methods in order; on the app VM the one
  // that succeeds is its system-assigned managed identity (no key, password, or
  // certificate anywhere in our code or config - Azure itself vouches for the VM).
  return new SecretClient(vaultUri, new DefaultAzureCredential());
}

module.exports = { loadSecrets };
