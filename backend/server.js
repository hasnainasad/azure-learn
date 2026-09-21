// Entry point: read config, connect to Cosmos DB, wire the real repository into the app.
const mongoose = require('mongoose');
const { loadConfig } = require('./src/config');
const { createApp } = require('./src/app');
const { userRepository } = require('./src/repositories/userRepository.mongo');
const { dbTestRoutes } = require('./src/routes/dbTest');

const config = loadConfig(); // throws (and the service exits) if JWT_SECRET is missing

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
  jwtSecret: config.jwtSecret,
  jwtExpiresIn: config.jwtExpiresIn,
  mountExtra: (a) => a.use('/api/db', dbTestRoutes(() => dbState)),
});

app.listen(config.port, '0.0.0.0', () => {
  console.log(`API listening on port ${config.port}`);
});
