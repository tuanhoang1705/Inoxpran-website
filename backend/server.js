// src/server.js
const dotenv = require('dotenv');
dotenv.config();

const app = require('./src/app'); 
// import { connectDB } from './src/config/db.js';

const HOST = process.env.HOST || '0.0.0.0';
// Bind to localhost only
const PORT = Number(process.env.PORT) || 3056;

(async () => {
  try {
    // await connectDB(process.env.MONGODB_URI);

    const server = app.listen(PORT, HOST, () => {
      console.log(`API listening at http://${HOST}:${PORT}`);
    });

    // Graceful shutdown
    const shutdown = (sig) => {
      console.log(`${sig} received. Shutting down...`);
      server.close(() => {
        console.log('HTTP server closed.');
        process.exit(0);
      });
      // Force exit if not closed in time
      setTimeout(() => process.exit(1), 10_000).unref();
    };

    process.on('SIGINT', () => shutdown('SIGINT'));
    process.on('SIGTERM', () => shutdown('SIGTERM'));
  } catch (err) {
    console.error('Startup error:', err);
    process.exit(1);
  }
})();
