// Google Sheets API integration for MLB Edge Pro audit log
// Supports: POST /api/sheets (log a bet), PATCH /api/sheets (grade a bet), GET /api/sheets (read bets)

const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';
const SHEETS_API = 'https://sheets.googleapis.com/v4/spreadsheets';

// ── Auth: build JWT and exchange for access token ──────────────────────────
async function getAccessToken() {
  const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
  if (!keyJson) throw new Error('GOOGLE_SERVICE_ACCOUNT_KEY not set');

  const key = JSON.parse(keyJson);
  const now = Math.floor(Date.now() / 1000);

  const header = btoa(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const payload = btoa(JSON.stringify({
    iss: key.client_email,
    scope: SCOPES,
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  })).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const unsigned = header + '.' + payload;

  // Import the private key and sign
  const pemBody = key.private_key
    .replace(/-----BEGIN PRIVATE KEY-----/, '')
    .replace(/-----END PRIVATE KEY-----/, '')
    .replace(/\n/g, '');
  const binaryKey = Uint8Array.from(atob(pemBody), c => c.charCodeAt(0));

  const cryptoKey = await crypto.subtle.importKey(
    'pkcs8', binaryKey, { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign']
  );

  const signature = await crypto.subtle.sign(
    'RSASSA-PKCS1-v1_5', cryptoKey, new TextEncoder().encode(unsigned)
  );

  const sig = btoa(String.fromCharCode(...new Uint8Array(signature)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');

  const jwt = unsigned + '.' + sig;

  // Exchange JWT for access token
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });

  if (!tokenRes.ok) {
    const err = await tokenRes.text();
    throw new Error('Token exchange failed: ' + err);
  }

  const tokenData = await tokenRes.json();
  return tokenData.access_token;
}

// ── Sheets helpers ─────────────────────────────────────────────────────────
const SHEET_ID = () => process.env.GOOGLE_SHEETS_ID;

const HEADERS = [
  'bet_id', 'date', 'away', 'home', 'bet_type', 'bet_side', 'pick',
  'model_prob', 'model_line', 'edge_pct', 'flag_type',
  'opening_odds', 'closing_odds',
  'away_off_index', 'home_off_index', 'away_pitcher_factor', 'home_pitcher_factor',
  'away_bullpen_factor', 'home_bullpen_factor', 'away_bp_fatigue', 'home_bp_fatigue',
  'away_lineup_factor', 'home_lineup_factor', 'park_factor',
  'exp_runs_away', 'exp_runs_home', 'win_prob_away', 'projected_total',
  'result', 'away_score', 'home_score', 'total_score', 'profit',
  'status', 'created_at', 'graded_at', 'model_version'
];

async function sheetsRequest(path, method = 'GET', body = null) {
  const token = await getAccessToken();
  const opts = {
    method,
    headers: {
      'Authorization': 'Bearer ' + token,
      'Content-Type': 'application/json',
    },
  };
  if (body) opts.body = JSON.stringify(body);

  const res = await fetch(`${SHEETS_API}/${SHEET_ID()}${path}`, opts);
  if (!res.ok) {
    const err = await res.text();
    throw new Error(`Sheets API ${res.status}: ${err}`);
  }
  return res.json();
}

async function ensureHeaders() {
  // Check if row 1 has headers
  try {
    const data = await sheetsRequest('/values/Sheet1!A1:AK1');
    if (data.values && data.values[0] && data.values[0].length >= HEADERS.length) {
      return; // headers already exist
    }
  } catch (e) {
    // Sheet might be empty, that's fine
  }

  // Write headers
  await sheetsRequest('/values/Sheet1!A1:AK1?valueInputOption=RAW', 'PUT', {
    range: 'Sheet1!A1:AK1',
    majorDimension: 'ROWS',
    values: [HEADERS],
  });
}

async function appendRow(values) {
  await ensureHeaders();
  await sheetsRequest(
    '/values/Sheet1!A:AK:append?valueInputOption=RAW&insertDataOption=INSERT_ROWS',
    'POST',
    { majorDimension: 'ROWS', values: [values] }
  );
}

async function findBetRow(betId) {
  const data = await sheetsRequest('/values/Sheet1!A:A');
  const rows = data.values || [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i][0] === betId) return i + 1; // 1-indexed
  }
  return null;
}

// ── POST: Log a new flagged bet ────────────────────────────────────────────
export async function POST(request) {
  try {
    const bet = await request.json();
    const snap = bet.snapshot || {};

    const betType = ['ML_AWAY', 'ML_HOME'].includes(bet.market) ? 'Side' : 'Total';
    const betSide = { ML_AWAY: 'Away', ML_HOME: 'Home', OVER: 'Over', UNDER: 'Under' }[bet.market] || bet.market;
    const flagType = (bet.edge >= 4 ? 'BET' : 'LEAN') + ' ' + betSide.toUpperCase();

    const row = [
      bet.id || '',
      bet.gameDate || bet.date?.substring(0, 10) || '',
      bet.game?.split(' @ ')[0] || '',
      bet.game?.split(' @ ')[1] || '',
      betType,
      betSide,
      bet.pick || '',
      bet.modelP != null ? +bet.modelP.toFixed(4) : '',
      bet.odds || '',
      bet.edge != null ? +bet.edge.toFixed(2) : '',
      flagType,
      bet.openingOdds || bet.odds || '',
      bet.closingOdds || '',
      snap.awayOff || '', snap.homeOff || '',
      snap.awaySP || '', snap.homeSP || '',
      snap.awayBP || '', snap.homeBP || '',
      snap.awayBPFat || '', snap.homeBPFat || '',
      snap.awayLineup || '', snap.homeLineup || '',
      snap.parkFactor || '',
      snap.xRA || '', snap.xRH || '',
      snap.winProbAway || '', snap.projTotal || '',
      '', '', '', '', '', // result, scores, profit — filled on grading
      'PENDING',
      new Date().toISOString(),
      '',
      '2026.2',
    ];

    await appendRow(row);
    return Response.json({ success: true, betId: bet.id });

  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// ── PATCH: Grade a bet ─────────────────────────────────────────────────────
export async function PATCH(request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  try {
    const { betId, result, awayScore, homeScore, closingOdds, profit } = await request.json();

    const rowNum = await findBetRow(betId);
    if (!rowNum) return Response.json({ error: 'Bet not found: ' + betId }, { status: 404 });

    const totalScore = (awayScore ?? 0) + (homeScore ?? 0);

    // Update result columns (AC-AK = columns 29-37)
    // result=col29, away_score=30, home_score=31, total_score=32, profit=33, status=34, graded_at=36
    const range = `Sheet1!AC${rowNum}:AK${rowNum}`;
    await sheetsRequest(`/values/${range}?valueInputOption=RAW`, 'PUT', {
      range,
      majorDimension: 'ROWS',
      values: [[
        result || '',
        awayScore ?? '',
        homeScore ?? '',
        totalScore,
        profit != null ? +profit.toFixed(3) : '',
        result === 'W' ? 'GRADED' : result === 'L' ? 'GRADED' : result === 'P' ? 'GRADED' : 'PENDING',
        new Date().toISOString(),
        '2026.2',
      ]],
    });

    // Update closing odds if provided (col M = column 13)
    if (closingOdds != null) {
      const clRange = `Sheet1!M${rowNum}`;
      await sheetsRequest(`/values/${clRange}?valueInputOption=RAW`, 'PUT', {
        range: clRange,
        majorDimension: 'ROWS',
        values: [[closingOdds]],
      });
    }

    return Response.json({ success: true, rowNum, result });

  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}

// ── GET: Read all bets (for sync — no auth required, read-only) ────────────
export async function GET(request) {

  try {
    await ensureHeaders();
    const data = await sheetsRequest('/values/Sheet1!A:AK');
    const rows = data.values || [];
    if (rows.length < 2) return Response.json({ bets: [] });

    const headers = rows[0];
    const bets = rows.slice(1).map(row => {
      const obj = {};
      headers.forEach((h, i) => { obj[h] = row[i] ?? ''; });
      return obj;
    });

    return Response.json({ bets, count: bets.length });

  } catch (e) {
    return Response.json({ error: e.message }, { status: 500 });
  }
}
