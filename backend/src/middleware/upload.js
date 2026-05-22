'use strict'

const multer = require('multer');
const { BadRequestError } = require('../core/error.response');

const maxFileSize = Number(process.env.UPLOAD_MAX_SIZE || 1 * 1024 * 1024);
const maxDescriptionFileSize = Number(process.env.UPLOAD_DESC_MAX_SIZE || 5 * 1024 * 1024);

const storage = multer.memoryStorage();

const imageFilter = (req, file, cb) => {
    if (file && file.mimetype && file.mimetype.startsWith('image/')) {
        return cb(null, true);
    }
    const err = new BadRequestError('Only image files are allowed');
    err.status = 400;
    return cb(err);
};

const createUpload = (fileSize) =>
    multer({
        storage,
        limits: {
            fileSize
        },
        fileFilter: (req, file, cb) => {
            req.uploadMaxFileSize = fileSize;
            return imageFilter(req, file, cb);
        }
    });

const upload = createUpload(maxFileSize);
const uploadLarge = createUpload(maxDescriptionFileSize);

module.exports = {
    upload,
    uploadLarge
};
