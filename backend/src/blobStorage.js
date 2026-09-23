// Uploads and streams back the KYC document files. Unlike Mongo and the JWT secret
// (slice 6, via Key Vault), this needs no secret of its own to configure: Blob Storage
// supports Azure AD data-plane access directly, so the app VM's managed identity reaches
// it the same way it already reaches Key Vault - just via a different RBAC role (Storage
// Blob Data Contributor) instead of "read this one secret". STORAGE_ACCOUNT_NAME isn't a
// secret either - it's just a name - so like KEY_VAULT_URI it's fine to sit in plain text
// in /etc/api.env.
//
// One blob per user, named after their userId: a resubmission just uploads over the same
// blob name, which is how a block blob upload already behaves - no separate "delete the
// old one first" step needed (see the "overwrite" decision for this slice).
//
// @azure/storage-blob is required lazily, only once a storage account is actually
// configured, so local dev/tests never need Azure installed, reachable, or authenticated.
const fs = require('fs');
const { parseEnvFile } = require('./envFile');

function createBlobStore({ env = process.env, envFilePath, containerClientFactory } = {}) {
  let fileVars = {};
  if (envFilePath) {
    try {
      fileVars = parseEnvFile(fs.readFileSync(envFilePath, 'utf8'));
    } catch {
      fileVars = {}; // a missing file is fine - env vars alone might have everything we need
    }
  }

  const accountName = env.STORAGE_ACCOUNT_NAME || fileVars.STORAGE_ACCOUNT_NAME;
  const containerName = env.STORAGE_CONTAINER_NAME || fileVars.STORAGE_CONTAINER_NAME || 'kyc-documents';

  if (!accountName && !containerClientFactory) {
    // Not provisioned/wired yet in this environment. Callers get a store that fails
    // clearly the moment it's actually used, rather than every caller having to check
    // "is this even configured" before every call.
    return {
      configured: false,
      async upload() {
        throw new Error('Blob storage is not configured (STORAGE_ACCOUNT_NAME is not set)');
      },
      async download() {
        throw new Error('Blob storage is not configured (STORAGE_ACCOUNT_NAME is not set)');
      },
    };
  }

  const containerClient = containerClientFactory
    ? containerClientFactory(accountName, containerName)
    : defaultContainerClient(accountName, containerName);

  return {
    configured: true,

    async upload(blobName, buffer, { contentType }) {
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      await blockBlobClient.uploadData(buffer, { blobHTTPHeaders: { blobContentType: contentType } });
    },

    // Throws if the blob doesn't exist - callers already know from the Mongo record
    // whether a document was ever submitted, so "missing when one was expected" is
    // treated as an error rather than a null result.
    async download(blobName) {
      const blockBlobClient = containerClient.getBlockBlobClient(blobName);
      const resp = await blockBlobClient.download();
      return { stream: resp.readableStreamBody, contentType: resp.contentType, contentLength: resp.contentLength };
    },
  };
}

function defaultContainerClient(accountName, containerName) {
  const { BlobServiceClient } = require('@azure/storage-blob');
  const { DefaultAzureCredential } = require('@azure/identity');
  // Same credential chain as secretsLoader.js - on the app VM, this resolves to its
  // system-assigned managed identity. No account key or SAS token anywhere in this code.
  const serviceClient = new BlobServiceClient(
    `https://${accountName}.blob.core.windows.net`,
    new DefaultAzureCredential(),
  );
  return serviceClient.getContainerClient(containerName);
}

module.exports = { createBlobStore };
