'use strict'

const express = require('express');

const router = express.Router();

router.use('/blog', require('./blog'));
router.use('/chat', require('./chat'));

module.exports = router;
