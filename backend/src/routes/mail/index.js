'use strict'

const express = require('express');
const asyncHandler = require('../../helpers/asyncHandler');
const mailController = require('../../controllers/mail.controller');

const router = express.Router();

router.post('/test/sdsdjskdjsldfslkfjlk2130923u4sdjlk', asyncHandler(mailController.test));

module.exports = router;
