const express = require('express');
const os = require('os');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

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

// Later: add MongoDB here (e.g. mongoose.connect(process.env.MONGO_URL))

app.listen(PORT, '0.0.0.0', () => {
  console.log(`API listening on port ${PORT}`);
});
