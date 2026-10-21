
require('dotenv').config();

const API = process.env.MORI_URL || 'http://127.0.0.1:3001';
const USER = process.env.GROWTOPIA_GROWID;
const PASS = process.env.GROWTOPIA_PASSWORD;
const WORLD = (process.env.GROWTOPIA_WORLD || 'NOOBV2').toUpperCase();
const ADMIN_PASS = process.env.MORI_DASHBOARD_PASSWORD;

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

async function request(path, method = 'GET', body, token) {
  const response = await fetch(API + path, {
    method,
    headers: {
      ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {})
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
    signal: AbortSignal.timeout(15000)
  });

  const raw = await response.text();

  if (!response.ok) {
    throw new Error(`${path}: HTTP ${response.status} ${raw.slice(0, 150)}`);
  }

  return raw ? JSON.parse(raw) : null;
}

async function main() {
  if (!USER || !PASS || !ADMIN_PASS) {
    throw new Error('Missing required .env settings');
  }

  console.log('[GrowDetector] Starting...');
  console.log(`[GrowDetector] Account: ${USER}`);
  console.log(`[GrowDetector] World: ${WORLD}`);

  const status = await request('/auth/status');

  if (!status.registered) {
    console.log('[Mori] Setting up dashboard password...');
    await request('/auth/setup', 'POST', {
      password: ADMIN_PASS
    });
  }

  const login = await request('/auth/login', 'POST', {
    password: ADMIN_PASS
  });

  const token = login.token;

  if (!token) {
    throw new Error('Mori did not return an authentication token');
  }

  console.log('[Mori] Authentication successful.');

  const bots = await request('/bots', 'GET', undefined, token);

  let bot = bots.find(
    b => b.username?.toLowerCase() === USER.toLowerCase()
  );

  let id;

  if (bot) {
    id = bot.id;
    console.log(`[GrowDetector] Existing bot session: ${id}`);
  } else {
    console.log('[GrowDetector] Creating Growtopia bot...');

    const created = await request('/bots', 'POST', {
      username: USER,
      password: PASS
    }, token);

    id = created.id;
    console.log(`[GrowDetector] Bot created: ${id}`);
  }

  let lastStatus = '';
  let lastWarp = 0;
  let joined = false;

  while (true) {
    try {
      const state = await request(
        `/bots/${id}/state`, 'GET', undefined, token
      );

      const currentStatus = String(state.status || '');
      const currentWorld = String(
        state.world_name || state.world || ''
      ).toUpperCase();

      if (currentStatus !== lastStatus) {
        console.log(`[GrowDetector] Status: ${currentStatus}`);
        lastStatus = currentStatus;
      }

      if (currentWorld === WORLD) {
        if (!joined) {
          console.log(`[GrowDetector] Joined ${WORLD}!`);
          joined = true;
        }
      } else {
        joined = false;

        if (
          /online|in.?game|connected/i.test(currentStatus) &&
          Date.now() - lastWarp > 30000
        ) {
          console.log(`[GrowDetector] Warping to ${WORLD}...`);

          await request(`/bots/${id}/cmd`, 'POST', {
            type: 'warp',
            name: WORLD,
            id: ''
          }, token);

          lastWarp = Date.now();
        }
      }

    } catch (error) {
      console.error('[GrowDetector]', error.message);
    }

    await sleep(5000);
  }
}

main().catch(error => {
  console.error('[GrowDetector] Startup error:', error.message);
  process.exitCode = 1;
});
