'use strict'

const {
  deleteImageFromStorage,
  deleteImageVariantsFromStorage,
  uploadImage,
  uploadBase64Image: uploadBase64ImageToStorage
} = require('../services/storage.service');
const { isStorageArtifactReferenced } = require('../services/pendingStorageUpload.service');

const trackUploadedArtifact = (req, result) => {
  if (!result?.url && !result?.path) return;
  if (!Array.isArray(req.uploadedStorageArtifacts)) req.uploadedStorageArtifacts = [];
  req.uploadedStorageArtifacts.push(result);
};

const cleanupUploadedArtifacts = async (req) => {
  const artifacts = Array.isArray(req?.uploadedStorageArtifacts)
    ? req.uploadedStorageArtifacts
    : [];
  for (const artifact of artifacts) {
    try {
      if (await isStorageArtifactReferenced(artifact)) continue;
    } catch (error) {
      console.error('Failed to verify uploaded artifact references', {
        path: artifact?.path || null,
        error: error?.message || 'storage-reference-check-failed'
      });
      continue;
    }
    await Promise.allSettled([
      deleteImageFromStorage({ path: artifact?.path, url: artifact?.url }),
      artifact?.variants
        ? deleteImageVariantsFromStorage(artifact.variants)
        : Promise.resolve(null)
    ]);
  }
  req.uploadedStorageArtifacts = [];
};

const uploadAllAndTrack = async (req, tasks) => {
  const settled = await Promise.allSettled(tasks);
  const uploaded = settled
    .filter((item) => item.status === 'fulfilled')
    .map((item) => item.value)
    .filter(Boolean);
  uploaded.forEach((result) => trackUploadedArtifact(req, result));
  const failed = settled.find((item) => item.status === 'rejected');
  if (failed) throw failed.reason;
  return uploaded;
};

const extractFilesForField = (req, field) => {
  if (!req) return [];

  // upload.single() case
  if (req.file && req.file.fieldname === field) return [req.file];

  // upload.array() hoặc upload.any() case
  if (Array.isArray(req.files)) {
    return req.files.filter(f => f.fieldname === field);
  }

  // upload.fields() case
  if (req.files && req.files[field]) {
    return req.files[field];
  }

  return [];
};

const uploadSingleImage = ({ field, folder, validation, optimization }) => {
    return async (req, res, next) => {
        const files = extractFilesForField(req, field);
        const file = files[0];
        if (!file) return next();

        try {
            const result = await uploadImage({ file, folder, validation, optimization });
            trackUploadedArtifact(req, result);
            req.body[field] = result.url;
            req.body[`${field}_path`] = result.path;
            if (result.variants) {
                req.body[`${field}_variants`] = result.variants;
            }
            return next();
        } catch (error) {
            return next(error);
        }
    };
};

const uploadBase64Image = ({ field, folder, validation, optimization }) => {
    return async (req, res, next) => {
        const value = req?.body?.[field];
        if (!value || typeof value !== 'string') return next();
        if (!value.startsWith('data:')) return next();

        try {
            const fileName = req.body?.[`${field}_name`];
            const result = await uploadBase64ImageToStorage({
                dataUrl: value,
                folder,
                fileName,
                validation,
                optimization
            });
            trackUploadedArtifact(req, result);
            req.body[field] = result.url;
            req.body[`${field}_path`] = result.path;
            if (result.variants) {
                req.body[`${field}_variants`] = result.variants;
            }
            return next();
        } catch (error) {
            return next(error);
        }
    };
};

const parseBase64Array = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    try {
        const parsed = JSON.parse(value);
        return Array.isArray(parsed) ? parsed : [value];
    } catch {
        return [value];
    }
};

const parseJsonArrayField = (value) => {
    if (!value) return [];
    if (Array.isArray(value)) return value;
    if (typeof value !== 'string') return [];
    const trimmed = value.trim();
    if (!trimmed) return [];
    try {
        const parsed = JSON.parse(trimmed);
        if (Array.isArray(parsed)) return parsed;
        return [parsed];
    } catch {
        return [value];
    }
};

const normalizeCropState = (value) => {
    if (!value || typeof value !== 'object') return undefined;
    const zoom = Number(value.zoom);
    const offsetX = Number(value.offsetX);
    const offsetY = Number(value.offsetY);
    const hasZoom = Number.isFinite(zoom);
    const hasOffsetX = Number.isFinite(offsetX);
    const hasOffsetY = Number.isFinite(offsetY);
    if (!hasZoom && !hasOffsetX && !hasOffsetY) return undefined;
    return {
        ...(hasZoom ? { zoom } : {}),
        ...(hasOffsetX ? { offsetX } : {}),
        ...(hasOffsetY ? { offsetY } : {})
    };
};

const uploadBase64Images = ({
    field,
    folder,
    outputField,
    nameField,
    stateField,
    validation,
    optimization
}) => {
    return async (req, res, next) => {
        const rawValue = req?.body?.[field];
        const dataUrls = parseBase64Array(rawValue).filter(
            (entry) => typeof entry === 'string' && entry.startsWith('data:')
        );
        if (!dataUrls.length) return next();

        const rawNames = nameField ? req?.body?.[nameField] : req?.body?.[`${field}_names`];
        const names = parseBase64Array(rawNames);
        const rawStates = stateField
            ? req?.body?.[stateField]
            : req?.body?.[`${field}_states`];
        const states = parseJsonArrayField(rawStates);
        try {
            const uploads = await uploadAllAndTrack(
                req,
                dataUrls.map((dataUrl, index) =>
                    uploadBase64ImageToStorage({
                        dataUrl,
                        folder,
                        fileName: names[index],
                        validation,
                        optimization
                    })
                )
            );
            const results = uploads
                .filter(Boolean)
                .map((result, index) => {
                    const cropState = normalizeCropState(states[index]);
                    const item = {
                        url: result.url,
                        path: result.path,
                        ...(result.variants ? { variants: result.variants } : {})
                    };
                    return cropState ? { ...item, crop_state: cropState } : item;
                });
            if (!results.length) return next();
            const targetField = outputField || field;
            const existing = parseJsonArrayField(req.body?.[targetField]);
            req.body[targetField] = [...existing, ...results];
            return next();
        } catch (error) {
            return next(error);
        }
    };
};

const uploadMultipleImages = ({ field, folder, validation, optimization }) => {
    return async (req, res, next) => {
        const files = extractFilesForField(req, field);
        if (!files.length) return next();

        try {
            const uploads = await uploadAllAndTrack(
                req,
                files.map((file) => uploadImage({ file, folder, validation, optimization }))
            );
            const existing = parseJsonArrayField(req.body?.[field]);
            req.body[field] = [
                ...existing,
                ...uploads.map((result) => ({
                    url: result.url,
                    path: result.path,
                    ...(result.variants ? { variants: result.variants } : {})
                }))
            ];
            return next();
        } catch (error) {
            console.log(error);
            return next(error);
        }
    };
};

module.exports = {
    cleanupUploadedArtifacts,
    uploadSingleImage,
    uploadBase64Image,
    uploadMultipleImages,
    uploadBase64Images
};
