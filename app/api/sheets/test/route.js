// GET /api/sheets/test — Verifies Google Sheets connection and writes headers
export async function GET() {
  const SCOPES = 'https://www.googleapis.com/auth/spreadsheets';

  try {
    const keyJson = process.env.GOOGLE_SERVICE_ACCOUNT_KEY;
    const sheetId = process.env.GOOGLE_SHEETS_ID;

    if (!keyJson) return Response.json({ error: 'GOOGLE_SERVICE_ACCOUNT_KEY not set' }, { status: 500 });
    if (!sheetId) return Response.json({ error: 'GOOGLE_SHEETS_ID not set' }, { status: 500 });

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

    const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
    });

    if (!tokenRes.ok) {
      const err = await tokenRes.text();
      return Response.json({ error: 'Token exchange failed', details: err }, { status: 500 });
    }

    const tokenData = await tokenRes.json();
    const token = tokenData.access_token;

    // Write headers to Sheet1!A1
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

    const writeRes = await fetch(
      `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}/values/Sheet1!A1:AK1?valueInputOption=RAW`,
      {
        method: 'PUT',
        headers: {
          'Authorization': 'Bearer ' + token,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          range: 'Sheet1!A1:AK1',
          majorDimension: 'ROWS',
          values: [HEADERS],
        }),
      }
    );

    if (!writeRes.ok) {
      const err = await writeRes.text();
      return Response.json({ error: 'Sheet write failed', details: err }, { status: 500 });
    }

    return Response.json({
      success: true,
      message: 'Google Sheets connected! Headers written to row 1.',
      serviceAccount: key.client_email,
      sheetId: sheetId,
    });

  } catch (e) {
    return Response.json({ error: e.message, stack: e.stack?.substring(0, 200) }, { status: 500 });
  }
}
