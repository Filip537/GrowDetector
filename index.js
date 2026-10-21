
require('dotenv').config();

const API = process.env.MORI_URL || 'http://127.0.0.1:3000';
const USER = process.env.GROWTOPIA_GROWID;
const PASS = process.env.GROWTOPIA_PASSWORD;
const WORLD = (process.env.GROWTOPIA_WORLD || 'NOOBV2').toUpperCase();

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function request(path, method = 'GET', body) {
  const response = await fetch(API + path, {
    method,
    headers: { 'Content-Type': 'application/json' },
    ...(body ? { body: JSON.stringify(body) } : {})
  });

  const text = await response.text();

  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status} ${text.slice(0, 150)}`);
  }

  return text ? JSON.parse(text) : null;
}

async function main() {
  if (!USER || !PASS) {
    throw new Error('Missing Growtopia credentials in .env');
  }

  console.log('[GrowDetector] Starting...');
  console.log(`[GrowDetector] Account: ${USER}`);
  console.log(`[GrowDetector] Target: ${WORLD}`);

  const auth = await request('/auth/status');
  console.log('[Mori] Authentication status:', auth);

  // Stop here until Mori authentication is configured correctly.
  // Never send Growtopia credentials through an unauthenticated API.
  console.log('[GrowDetector] Mori API connection successful.');
  console.log('[GrowDetector] Next: authenticate and create bot session.');
}

main().catch(err => {
  console.error('[GrowDetector] Error:', err.message);
  process.exitCode = 1;
});
