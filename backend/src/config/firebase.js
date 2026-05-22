'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const admin = require('firebase-admin');
const BACKEND_ROOT_DIR = path.resolve(__dirname, '../..');
const DEFAULT_SERVICE_ACCOUNT_PATH = path.join(BACKEND_ROOT_DIR, 'credentials', 'file.json');

const expandHomePath = (value) => {
    if (!value) return value;
    if (value === '~') return os.homedir();
    if (value.startsWith('~/') || value.startsWith('~\\')) {
        return path.join(os.homedir(), value.slice(2));
    }
    return value;
};

const dedupePaths = (paths = []) => {
    const seen = new Set();
    const output = [];
    for (const item of paths) {
        const normalized = String(item || '').trim();
        if (!normalized || seen.has(normalized)) continue;
        seen.add(normalized);
        output.push(normalized);
    }
    return output;
};

const resolveServiceAccountPathCandidates = () => {
    const envPath = expandHomePath(process.env.GOOGLE_APPLICATION_CREDENTIALS);
    const candidates = [];

    if (envPath) {
        if (path.isAbsolute(envPath)) {
            candidates.push(envPath);
        } else {
            // Support both "credentials/file.json" and "../backend/credentials/file.json"
            // regardless of whether the server is started from repo root or backend/.
            candidates.push(path.resolve(process.cwd(), envPath));
            candidates.push(path.resolve(BACKEND_ROOT_DIR, envPath));
            candidates.push(path.join(BACKEND_ROOT_DIR, 'credentials', path.basename(envPath)));
        }
    }

    candidates.push(DEFAULT_SERVICE_ACCOUNT_PATH);
    return dedupePaths(candidates);
};

const loadJsonFile = (filePath) => {
    if (!filePath || !fs.existsSync(filePath)) {
        return null;
    }
    const raw = fs.readFileSync(filePath, 'utf8');
    return JSON.parse(raw);
};

const resolveServiceAccount = () => {
    const candidatePaths = resolveServiceAccountPathCandidates();
    for (const serviceAccountPath of candidatePaths) {
        const serviceAccount = loadJsonFile(serviceAccountPath);
        if (serviceAccount) {
            return serviceAccount;
        }
    }

    throw new Error(
        `Missing Firebase service account. Checked paths: ${candidatePaths.join(', ')}. ` +
            'Set GOOGLE_APPLICATION_CREDENTIALS to a valid JSON file or place credentials at backend/credentials/file.json.'
    );
};

const resolveStorageBucket = (serviceAccount) => {
    if (process.env.FIREBASE_STORAGE_BUCKET) {
        return process.env.FIREBASE_STORAGE_BUCKET;
    }
    if (serviceAccount?.project_id) {
        return `${serviceAccount.project_id}.appspot.com`;
    }
    throw new Error('Missing Firebase storage bucket. Set FIREBASE_STORAGE_BUCKET.');
};

const initFirebase = () => {
    if (admin.apps.length) {
        return admin.app();
    }

    const serviceAccount = resolveServiceAccount();
    const storageBucket = resolveStorageBucket(serviceAccount);

    return admin.initializeApp({
        credential: admin.credential.cert(serviceAccount),
        storageBucket
    });
};

const getBucket = () => {
    const app = initFirebase();
    return app.storage().bucket();
};

module.exports = {
    initFirebase,
    getBucket
};
