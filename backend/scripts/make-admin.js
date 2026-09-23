// One-off admin promotion, run directly on the server:
//   sudo node scripts/make-admin.js asad@example.com
//
// Deliberately NOT an API endpoint. Granting admin access through the running app
// would mean "the app can make anyone an admin", which is a bigger attack surface
// than "someone with a shell on the VM can". Real systems do this via a separate
// admin tool or a database console, not a normal HTTP route.
//
// Gets its Mongo connection string the same way server.js does (see
// src/secretsLoader.js): from Azure Key Vault if /etc/api.env sets KEY_VAULT_URI,
// otherwise straight from that file - read as plain text, never via `source` in bash,
// which silently mangles a Cosmos DB connection string's "&" characters.
const mongoose = require('mongoose');
const { UserModel } = require('../src/repositories/userRepository.mongo');
const { loadSecrets } = require('../src/secretsLoader');

const ENV_FILE = process.env.ENV_FILE || '/etc/api.env';

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: sudo node scripts/make-admin.js <email>');
    process.exit(1);
  }

  const secrets = await loadSecrets({ envFilePath: ENV_FILE });
  if (!secrets.mongoUrl) {
    console.error(`Could not find a Mongo connection string (checked Key Vault, then ${ENV_FILE}). Run this with sudo?`);
    process.exit(1);
  }
  console.log(`Using Mongo connection string from: ${secrets.source}`);

  await mongoose.connect(secrets.mongoUrl, { dbName: 'roboadvisor', serverSelectionTimeoutMS: 8000 });
  const result = await UserModel.updateOne({ email: email.trim().toLowerCase() }, { $set: { role: 'admin' } });
  if (result.matchedCount === 0) {
    console.error(`No user found with email ${email}`);
    process.exitCode = 1;
  } else {
    console.log(`${email} is now an admin.`);
  }
  await mongoose.disconnect();
}

main().catch((err) => {
  console.error(err.message);
  process.exit(1);
});
