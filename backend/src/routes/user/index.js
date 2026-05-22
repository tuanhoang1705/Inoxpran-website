'use strict'

const express = require('express');
const userController = require('../../controllers/user.controller');
const asyncHandler = require('../../helpers/asyncHandler');
const { authenticationUser } = require('../../auth/authUtils');
const { upload } = require('../../middleware/upload');
const { uploadSingleImage } = require('../../middleware/firebaseUpload');

const router = express.Router();

router.post('/signup', asyncHandler(userController.signUp));
router.post('/login', asyncHandler(userController.login));
router.get('/verify', asyncHandler(userController.verifyEmail));
router.post('/verify', asyncHandler(userController.verifyEmail));
router.post('/verify/resend', asyncHandler(userController.resendVerification));
router.post('/forgot-password', asyncHandler(userController.requestPasswordReset));
router.post('/reset-password', asyncHandler(userController.resetPassword));

router.use(authenticationUser);

router.post('/logout', asyncHandler(userController.logout));
router.post('/refresh-token', asyncHandler(userController.handlerRefreshToken));
router.get('/profile', asyncHandler(userController.getProfile));
router.patch('/profile', upload.single('avatar'), uploadSingleImage({ field: 'avatar', folder: 'users' }), asyncHandler(userController.updateProfile));
router.post('/change-password', asyncHandler(userController.changePassword));

module.exports = router;
