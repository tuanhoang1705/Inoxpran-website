'use strict'

//
const dev = {
    app: {
        port: process.env.NODE_ENV
    },
    db: {
        url: process.env.MONGODB_URI,
    }
}

const pro = {
    app: {
        port: 3000
    },
    db: {
        url: process.env.MONGODB_URI
    }
}

module.exports = config;