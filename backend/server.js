const express = require('express');
const os = require('os');
const mongoose = require('mongoose');

const app = express();
const PORT = process.env.PORT || 3000;
app.use(express.json());

// --- Database: Cosmos DB for MongoDB, reached over the private endpoint ---
const MONGO_URL = process.env.MONGO_URL;
let dbState = 'not configured';
if (MONGO_URL) {
  mongoose
    .connect(MONGO_URL, { dbName: 'roboadvisor', serverSelectionTimeoutMS: 8000 })
    .then(() => { dbState = 'connected'; console.log('MongoDB connected'); })
    .catch((e) => { dbState = 'error: ' + e.message; console.error('MongoDB error:', e.message); });
}
const Visit = mongoose.model(
  'Visit',
  new mongoose.Schema({ at: { type: Date, default: Date.now }, from: String })
);

// --- Original endpoints ---
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', time: new Date().toISOString() });
});

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
    caller: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
  });
});

// --- Database test endpoints ---
app.get('/api/db/health', async (req, res) => {
  try {
    await mongoose.connection.db.admin().ping();
    res.json({ status: 'ok', db: dbState });
  } catch (e) {
    res.status(503).json({ status: 'error', db: dbState, error: e.message });
  }
});

app.post('/api/db/visit', async (req, res) => {
  try {
    const v = await Visit.create({ from: req.headers['x-forwarded-for'] || req.socket.remoteAddress });
    res.status(201).json(v);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.get('/api/db/visits', async (req, res) => {
  try {
    const count = await Visit.countDocuments();
    const latest = await Visit.find().sort({ _id: -1 }).limit(5);
    res.json({ count, latest });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API listening on port ${PORT}`);
});
