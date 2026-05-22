// place files you want to import through the `$lib` alias in this folder.
import { API_BASE_URL } from '$env/static/private';

export const API_BASE = (API_BASE_URL || 'http://localhost:3056/v1/api').replace(/\/$/, '');
