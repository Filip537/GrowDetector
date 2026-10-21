require('dotenv').config();
const guardian = require('./guardian');
console.log('GT-BOTS initialized. Growtopia connection is not configured yet.');
guardian.start();

require('dotenv').config();

const API = 'http://127.0.0.1:3000';
const USER = process.env.GROWTOPIA_GROWID;
const PASS = process.env.GROWTOPIA_PASSWORD;
const WORLD = (process.env.GROWTOPIA_WORLD || 'NOOBV2').toUpperCase();
const ADMIN_PASS = process.env.MORI_DASHBOARD_PASSWORD;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(path, method = 'GET', body, token) {
  const response = await fetch(API + path, {
    method,
    headers: {
      ...(body ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000)
  });

  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status}`);
  }

  if (response.status === 204) return null;
  return response.json();
}

async function main() {
  if (!USER || !PASS || !ADMIN_PASS) {
    throw new Error('Missing required .env settings.');
  }

  console.log('[GrowDetector] Starting...');
  console.log(`[GrowDetector] Account: ${USER}`);
  console.log(`[GrowDetector] Target: ${WORLD}`);

  const authStatus = await request('/auth/status');

  if (!authStatus.registered) {
    console.log('[Mori] Initializing dashboard authentication...');
    await request('/auth/setup', 'POST', {
      password: ADMIN_PASS
    });
  }

  const login = await request('/auth/login', 'POST', {
    password: ADMIN_PASS
  });

  const token = login.token;

  console.log('[Mori] API authenticated.');

  const existing = await request('/bots', 'GET', null, token);
  let bot = existing.find(
    b => b.username?.toLowerCase() === USER.toLowerCase()
  );

  let id;

  if (bot) {
    id = bot.id;
    console.log(`[GrowDetector] Reusing bot session ${id}`);
  } else {
    console.log('[GrowDetector] Creating bot session...');

    const created = await request('/bots', 'POST', {
      username: USER,
      password: PASS
    }, token);

    id = created.id;
  }

  let lastStatus = '';
  let lastWarp = 0;
  let joined = false;

  while (true) {
    try {
      const state = await request(
        `/bots/${id}/state`, 'GET', null, token
      );

      if (state.status !== lastStatus) {
        console.log(`[GrowDetector] Status: ${state.status}`);
        lastStatus = state.status;
      }

      const currentWorld = (state.world_name || '').toUpperCase();

      if (currentWorld === WORLD) {
        if (!joined) {
          console.log(`[GrowDetector] Joined ${WORLD} successfully!`);
          joined = true;
        }
      } else {
        joined = false;

        if (state.status === 'in_game' &&
            Date.now() - lastWarp > 30000) {

          console.log(`[GrowDetector] Entering ${WORLD}...`);

          await request(`/bots/${id}/cmd`, 'POST', {
            type: 'warp',
            name: WORLD,
            id: ''
          }, token);

          lastWarp = Date.now();
        }
      }

      if (state.status === 'update_required') {
        throw new Error('Mori client update required.');
      }

    } catch (error) {
      console.error('[GrowDetector]', error.message);

      if (error.message.includes('HTTP 401') ||
          error.message.includes('HTTP 404') ||
          error.message.includes('update required')) {
        throw error;
      }
    }

    await sleep(5000);
  }
}

main().catch(error => {
  console.error('[GrowDetector] Startup failed:', error.message);
  process.exitCode = 1;
});
