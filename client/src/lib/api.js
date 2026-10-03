import { supabase } from './supabaseClient';

const API_URL = (import.meta.env.VITE_API_URL || 'https://localhost:5000/api').replace(/\/$/, '');

export async function api(path, options = {}) {
  const sessionResult = supabase ? await supabase.auth.getSession() : null;
  const accessToken = sessionResult?.data.session?.access_token;
  const headers = { Accept: 'application/json', ...options.headers };

  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new Error('CampusSphere could not reach the API. Make sure the Express server is running.');
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    if (String(result.error || '').startsWith('API route not found')) {
      throw new Error(`API route not found: ${options.method || 'GET'} ${path}. Check VITE_API_URL and restart the Express server so it loads the latest routes.`);
    }
    throw new Error(result.error || result.message || `Request failed (${response.status}).`);
  }
  return result;
}

export async function apiDownload(path, fileName) {
  const sessionResult = supabase ? await supabase.auth.getSession() : null;
  const accessToken = sessionResult?.data.session?.access_token;
  const headers = { Accept: 'text/csv' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, { headers });
  } catch {
    throw new Error('CampusSphere could not reach the API. Make sure the Express server is running.');
  }

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || result.message || `Download failed (${response.status}).`);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  link.click();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}
