// The Cosmos DB connectivity test endpoints from the previous step, moved out of server.js.
// Kept so you can still prove "API -> private endpoint -> Cosmos" works at any time.
const express = require('express');
const mongoose = require('mongoose');

const Visit =
  mongoose.models.Visit ||
  mongoose.model('Visit', new mongoose.Schema({ at: { type: Date, default: Date.now }, from: String }));

function dbTestRoutes(getDbState) {
  const router = express.Router();

  router.get('/health', async (req, res) => {
    try {
      await mongoose.connection.db.admin().ping();
      res.json({ status: 'ok', db: getDbState() });
    } catch (e) {
      res.status(503).json({ status: 'error', db: getDbState(), error: e.message });
    }
  });

  router.post('/visit', async (req, res, next) => {
    try {
      const from = req.headers['x-forwarded-for'] || req.socket.remoteAddress;
      const doc = await Visit.create({ from });
      res.status(201).json(doc);
    } catch (err) {
      next(err);
    }
  });

  router.get('/visits', async (req, res, next) => {
    try {
      const count = await Visit.countDocuments();
      const latest = await Visit.find().sort({ _id: -1 }).limit(5).lean();
      res.json({ count, latest });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

module.exports = { dbTestRoutes };
