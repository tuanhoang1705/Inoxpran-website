'use strict'

const multer = require('multer');
const { BadRequestError } = require('../core/error.response');

const maxFileSize = Number(process.env.UPLOAD_MAX_SIZE || 1 * 1024 * 1024);
const maxDescriptionFileSize = Number(process.env.UPLOAD_DESC_MAX_SIZE || 5 * 1024 * 1024);
const maxProductFileSize = Number(process.env.UPLOAD_PRODUCT_MAX_SIZE || maxDescriptionFileSize);
const maxProductFieldSize = Number(process.env.UPLOAD_PRODUCT_FIELD_MAX_SIZE || 50 * 1024 * 1024);

const storage = multer.memoryStorage();
const base64FieldSize = (fileSize) => Math.ceil(fileSize * 4 / 3) + 1024 * 1024;

const imageFilter = (req, file, cb) => {
    if (file && file.mimetype && file.mimetype.startsWith('image/')) {
        return cb(null, true);
    }
    const err = new BadRequestError('Only image files are allowed');
    err.status = 400;
    return cb(err);
};

const createUpload = (fileSize, fieldSize = base64FieldSize(fileSize)) =>
    multer({
        storage,
        limits: {
            fileSize,
            fieldSize
        },
        fileFilter: (req, file, cb) => {
            req.uploadMaxFileSize = fileSize;
            return imageFilter(req, file, cb);
        }
    });

const upload = createUpload(maxFileSize);
const uploadLarge = createUpload(maxDescriptionFileSize);
const uploadProduct = createUpload(maxProductFileSize, maxProductFieldSize);

module.exports = {
    upload,
    uploadLarge,
    uploadProduct
};
