'use strict'

const express = require('express');
const { apiKey, permission, PERMISSIONS } = require('../auth/checkAuth');

const router = express.Router();

// check apiKey
router.use(apiKey);

// check permission
router.use(permission(PERMISSIONS.PUBLIC));

router.use('/v1/api/mail', require('./mail'));
router.use('/v1/api/contact', require('./contact'));
router.use('/v1/api/checkout', require('./checkout'));
router.use('/v1/api/inventory', require('./inventory'));
router.use('/v1/api/cart', require('./cart'));
router.use('/v1/api/shipping', require('./shipping'));
router.use('/v1/api/discount', require('./discount'));
router.use('/v1/api/product', require('./product'));
router.use('/v1/api/blog', require('./blog'));
router.use('/v1/api/ai', require('./ai'));
router.use('/v1/api/newsletter', require('./newsletter'));
router.use('/v1/api/site-settings', require('./site'));
router.use('/v1/api/telemetry', require('./telemetry'));
router.use('/v1/api/user', require('./user'));
router.use('/v1/api/admin', require('./admin'));
router.use('/v1/api/automation', require('./automation'));

module.exports = router;
