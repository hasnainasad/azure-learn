// Entry point: load secrets (Azure Key Vault in production, a local env file for
// dev/tests), connect to Cosmos DB, wire the real repository into the app.
const mongoose = require('mongoose');
const { loadSecrets } = require('./src/secretsLoader');
const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');
const { userRepository } = require('./src/repositories/userRepository.mongo');
const { profileRepository } = require('./src/repositories/profileRepository.mongo');
const { kycRepository } = require('./src/repositories/kycRepository.mongo');
const { dbTestRoutes } = require('./src/routes/dbTest');

async function main() {
  // If /etc/api.env sets KEY_VAULT_URI, MongoUrl and JwtSecret come from Azure Key
  // Vault via this VM's managed identity. Otherwise this falls back to MONGO_URL /
  // JWT_SECRET straight from that same file, exactly as before this slice - so local
  // dev and CI still run with no Azure account at all.
  const secrets = await loadSecrets({ envFilePath: process.env.ENV_FILE || '/etc/api.env' });
  console.log(`Secrets loaded from: ${secrets.source}`);

  // loadConfig still does its own validation (throws if JWT_SECRET is missing or too
  // short) - we're just handing it the resolved secrets instead of letting it read
  // MONGO_URL/JWT_SECRET off process.env itself.
  const config = loadConfig({ ...process.env, MONGO_URL: secrets.mongoUrl, JWT_SECRET: secrets.jwtSecret });

  let dbState = 'not configured';
  if (config.mongoUrl) {
    dbState = 'connecting';
    mongoose
      .connect(config.mongoUrl, { dbName: 'roboadvisor', serverSelectionTimeoutMS: 8000 })
      .then(() => {
        dbState = 'connected';
        console.log('MongoDB connected');
      })
      .catch((e) => {
        dbState = 'error: ' + e.message;
        console.error('MongoDB error:', e.message);
      });
  }

  const app = createApp({
    userRepo: userRepository,
    profileRepo: profileRepository,
    kycRepo: kycRepository,
    jwtSecret: config.jwtSecret,
    jwtExpiresIn: config.jwtExpiresIn,
    mountExtra: (a) => a.use('/api/db', dbTestRoutes(() => dbState)),
  });

  app.listen(config.port, '0.0.0.0', () => {
    console.log(`API listening on port ${config.port}`);
  });
}

main().catch((err) => {
  console.error('Startup failed:', err.message);
  process.exit(1);
});
