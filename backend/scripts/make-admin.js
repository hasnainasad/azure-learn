// One-off admin promotion, run directly on the server:
//   sudo node scripts/make-admin.js asad@example.com
//
// Deliberately NOT an API endpoint. Granting admin access through the running app
// would mean "the app can make anyone an admin", which is a bigger attack surface
// than "someone with a shell on the VM can". Real systems do this via a separate
// admin tool or a database console, not a normal HTTP route.
//
// Reads /etc/api.env itself (see src/envFile.js) instead of relying on `source` in
// bash, which silently mangles a Cosmos DB connection string's "&" characters.
const fs = require('fs');
const mongoose = require('mongoose');
const { UserModel } = require('../src/repositories/userRepository.mongo');
const { parseEnvFile } = require('../src/envFile');

const ENV_FILE = process.env.ENV_FILE || '/etc/api.env';

function readEnvFile(path) {
  try {
    return parseEnvFile(fs.readFileSync(path, 'utf8'));
  } catch (err) {
    if (err.code === 'EACCES') {
      console.error(`Cannot read ${path} (permission denied). Run this script with sudo.`);
    } else if (err.code === 'ENOENT') {
      console.error(`${path} does not exist.`);
    } else {
      console.error(`Could not read ${path}: ${err.message}`);
    }
    process.exit(1);
  }
}

async function main() {
  const email = process.argv[2];
  if (!email) {
    console.error('Usage: sudo node scripts/make-admin.js <email>');
    process.exit(1);
  }
  const mongoUrl = process.env.MONGO_URL || readEnvFile(ENV_FILE).MONGO_URL;
  if (!mongoUrl) {
    console.error(`MONGO_URL was not found in ${ENV_FILE} or in the environment.`);
    process.exit(1);
  }

  await mongoose.connect(mongoUrl, { dbName: 'roboadvisor', serverSelectionTimeoutMS: 8000 });
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
