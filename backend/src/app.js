// Builds the Express app. It receives its dependencies (user repository, secret) as
// arguments instead of importing them, so tests can plug in an in-memory repository
// and run without any database.
const express = require('express');
const os = require('os');
const multer = require('multer');
const { authRoutes } = require('./routes/auth');
const { riskRoutes } = require('./routes/risk');
const { kycRoutes } = require('./routes/kyc');
const { fundsRoutes } = require('./routes/funds');
const { recommendationRoutes } = require('./routes/recommendation');
const { pricesRoutes } = require('./routes/prices');
const { createPriceFeedService } = require('./services/priceFeedService');

function createApp({ userRepo, profileRepo, kycRepo, jwtSecret, jwtExpiresIn, priceFeedService, blobStore, mountExtra }) {
  const app = express();
  app.use(express.json({ limit: '100kb' }));

  // Health check - handy for testing each network hop while learning
  app.get('/api/health', (req, res) => {
    res.json({ status: 'ok', time: new Date().toISOString() });
  });

  // Shows which machine answered - proves traffic reached the private subnet VM
  app.get('/api/info', (req, res) => {
    const ips = Object.values(os.networkInterfaces())
      .flat()
      .filter((i) => i.family === 'IPv4' && !i.internal)
      .map((i) => i.address);
    res.json({
      message: 'Hello from the Node.js backend in the private subnet',
      hostname: os.hostname(),
      privateIPs: ips,
      nodeVersion: process.version,
      // X-Forwarded-For is set by nginx on the web VM
      caller: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
    });
  });

  app.use('/api/auth', authRoutes({ userRepo, jwtSecret, jwtExpiresIn }));
  if (profileRepo) app.use('/api/risk', riskRoutes({ profileRepo, jwtSecret }));
  if (kycRepo) app.use('/api/kyc', kycRoutes({ kycRepo, userRepo, jwtSecret, blobStore }));
  app.use('/api/funds', fundsRoutes({ jwtSecret })); // reference data - no repo dependency
  if (profileRepo && kycRepo) app.use('/api/recommendation', recommendationRoutes({ profileRepo, kycRepo, jwtSecret }));
  // Falls back to a real (well, mock-real) priceFeedService when the caller doesn't
  // supply one, the same way express() etc. isn't injected - but tests can still pass a
  // fake service to control retries/failures/latency deterministically.
  app.use('/api/prices', pricesRoutes({ priceFeedService: priceFeedService || createPriceFeedService(), jwtSecret }));

  // Lets server.js attach database-specific routes (the Cosmos test endpoints)
  if (mountExtra) mountExtra(app);

  // Unknown /api paths -> JSON 404 instead of an HTML error page
  app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));

  // Last-resort error handler: log the details, tell the client as little as possible
  // eslint-disable-next-line no-unused-vars
  app.use((err, req, res, next) => {
    if (err.type === 'entity.parse.failed') {
      return res.status(400).json({ error: 'Invalid JSON body' });
    }
    // Thrown by multer itself (e.g. LIMIT_FILE_SIZE) before the KYC upload route's own
    // try/catch ever runs, since it happens in upload.single()'s middleware, not in the
    // route handler - so it has to be handled here instead of alongside the other
    // ValidationError cases each route already catches locally.
    if (err instanceof multer.MulterError) {
      const message = err.code === 'LIMIT_FILE_SIZE' ? 'Document must be 5MB or smaller' : 'Could not process the uploaded file';
      return res.status(400).json({ error: message });
    }
    console.error('Unhandled error:', err);
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

module.exports = { createApp };
