// db/database.js (CommonJS)
'use strict';

const mongoose = require('mongoose');
require('dotenv').config();

const connectString = process.env.MONGODB_URI;

const { countConnect } = require('../helpers/check.connect'); 
const { ensureApiKey } = require('../helpers/bootstrapApiKey');

class Database {
  constructor() {
    this.connect();
  }

  // connect
  connect(type = 'mongodb') {
    const enableMongooseDebug = String(process.env.MONGOOSE_DEBUG || '').trim().toLowerCase() === 'true';
    mongoose.set('debug', enableMongooseDebug ? { color: true } : false);

    mongoose
      .connect(connectString, {
        // recommended options (adjust as needed)
        // useNewUrlParser: true,            // for very old mongoose versions
        // useUnifiedTopology: true,
        autoIndex: true,
        maxPoolSize: 50,
        
      })
      .then(() => {
        console.log('Connected MongoDB Success PRO', countConnect());
        ensureApiKey().catch((err) => {
          console.warn('API key bootstrap failed:', err?.message || err);
        });
      })
      .catch((err) => {
        console.error('MongoDB connection error:', err?.message || err);
      });
  }

  static getInstance() {
    if (!Database.instance) {
      Database.instance = new Database();
    }
    return Database.instance;
  }
}


const instanceMongodb = Database.getInstance();
module.exports = instanceMongodb;
// If you also want to export the class for testing:
// module.exports.Database = Database;


