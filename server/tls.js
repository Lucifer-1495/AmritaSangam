const fs = require('fs');
const path = require('path');

const certDir = path.join(__dirname, 'certs');

// TLS settings shared by the API server: TLS 1.2 or newer only.
const secureOptions = { minVersion: 'TLSv1.2', honorCipherOrder: true };

async function createDevelopmentCertificate(keyPath, certPath) {
  const selfsigned = require('selfsigned');
  const generated = await selfsigned.generate([{ name: 'commonName', value: 'localhost' }], {
    days: 365,
    keySize: 2048,
    algorithm: 'sha256',
    extensions: [{
      name: 'subjectAltName',
      altNames: [{ type: 2, value: 'localhost' }, { type: 7, ip: '127.0.0.1' }, { type: 7, ip: '::1' }],
    }],
  });
  fs.mkdirSync(path.dirname(keyPath), { recursive: true });
  fs.writeFileSync(keyPath, generated.private, { mode: 0o600 });
  fs.writeFileSync(certPath, generated.cert);
}

/**
 * Returns HTTPS options, or null when TLS_MODE=off (only for hosts where a proxy already terminates TLS).
 * Provide TLS_KEY_PATH / TLS_CERT_PATH for a real certificate. In development a self-signed certificate
 * for localhost is created automatically in server/certs on first start.
 */
async function loadTlsOptions() {
  if (String(process.env.TLS_MODE || '').toLowerCase() === 'off') return null;

  const keyPath = process.env.TLS_KEY_PATH || path.join(certDir, 'server.key');
  const certPath = process.env.TLS_CERT_PATH || path.join(certDir, 'server.crt');
  const haveFiles = fs.existsSync(keyPath) && fs.existsSync(certPath);

  if (!haveFiles) {
    if (process.env.NODE_ENV === 'production') {
      throw new Error('TLS certificate not found. Set TLS_KEY_PATH and TLS_CERT_PATH (or TLS_MODE=off behind a TLS-terminating proxy).');
    }
    if (process.env.TLS_KEY_PATH || process.env.TLS_CERT_PATH) {
      throw new Error(`TLS_KEY_PATH/TLS_CERT_PATH point to missing files (${keyPath}, ${certPath}).`);
    }
    await createDevelopmentCertificate(keyPath, certPath);
    console.log(`Created a self-signed development certificate in ${certDir}`);
  }

  return { ...secureOptions, key: fs.readFileSync(keyPath), cert: fs.readFileSync(certPath) };
}

module.exports = { loadTlsOptions };
