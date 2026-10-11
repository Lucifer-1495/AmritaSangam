const API_URL = (import.meta.env.VITE_API_URL || 'https://localhost:5000/api').replace(/\/$/, '');

export async function api(path, options = {}) {
  const headers = { Accept: 'application/json', ...options.headers };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      ...options,
      credentials: 'include',
      headers,
      body: options.body === undefined ? undefined : JSON.stringify(options.body),
    });
  } catch {
    throw new Error('Amrita Sangam could not reach the API. Make sure the FastAPI server is running.');
  }

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = String(result.error || result.message || '');
    const error = new Error(message.startsWith('API route not found')
      ? `API route not found: ${options.method || 'GET'} ${path}. Check VITE_API_URL and restart the FastAPI server so it loads the latest routes.`
      : message || `Request failed (${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return result;
}

export async function apiDownload(path, fileName) {
  let response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      headers: { Accept: 'text/csv' },
      credentials: 'include',
    });
  } catch {
    throw new Error('Amrita Sangam could not reach the API. Make sure the FastAPI server is running.');
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
