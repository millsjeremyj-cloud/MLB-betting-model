// Server-side bullpen fatigue calculator
// Fetches last 3 days of boxscores, sums reliever pitch counts with day weights
// fatigue_factor = 0.85 + (weightedPitches/30) * 0.15, capped at 1.20
// Day weights: today=1.0, yesterday=0.6, 2 days ago=0.3

const MLB_API = 'https://statsapi.mlb.com/api/v1';

const MLB_TEAM_IDS = {
  LAA:108,ARI:109,BAL:110,BOS:111,CHC:112,CIN:113,CLE:114,COL:115,
  DET:116,HOU:117,KC:118,LAD:119,WSH:120,NYM:121,ATH:133,PIT:134,
  SD:135,SEA:136,SF:137,STL:138,TB:139,TEX:140,TOR:141,MIN:142,
  PHI:143,ATL:144,CWS:145,MIA:146,NYY:147,MIL:158,
};

function fmtDate(d) {
  return d.toISOString().slice(0, 10);
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  // Get team keys from query param, or do all teams
  const url = new URL(request.url);
  const teamsParam = url.searchParams.get('teams');
  const teamKeys = teamsParam
    ? teamsParam.split(',').map(t => t.trim().toUpperCase())
    : Object.keys(MLB_TEAM_IDS);

  const dayWeights = [1.0, 0.6, 0.3];
  const today = new Date();
  const dates = [];
  for (let d = 0; d <= 2; d++) {
    const dt = new Date(today);
    dt.setDate(dt.getDate() - d);
    dates.push(fmtDate(dt));
  }

  const results = {};

  for (const teamKey of teamKeys) {
    const teamId = MLB_TEAM_IDS[teamKey];
    if (!teamId) continue;

    let weightedPitches = 0;

    try {
      for (let dayIdx = 0; dayIdx < dates.length; dayIdx++) {
        const dateStr = dates[dayIdx];

        // Get schedule for this team on this date
        const schedUrl = `${MLB_API}/schedule?sportId=1&date=${dateStr}&teamId=${teamId}&hydrate=linescore`;
        const schedRes = await fetch(schedUrl);
        if (!schedRes.ok) continue;
        const schedData = await schedRes.json();

        const games = schedData.dates?.[0]?.games ?? [];

        for (const game of games) {
          const gamePk = game.gamePk;
          if (!gamePk) continue;
          if (game.status?.abstractGameState !== 'Final') continue;

          // Fetch boxscore
          const boxUrl = `${MLB_API}/game/${gamePk}/boxscore`;
          const boxRes = await fetch(boxUrl);
          if (!boxRes.ok) continue;
          const boxData = await boxRes.json();

          const awayId = boxData?.teams?.away?.team?.id;
          const homeId = boxData?.teams?.home?.team?.id;
          const teamSide = awayId === teamId ? 'away' : homeId === teamId ? 'home' : null;
          if (!teamSide) continue;

          const pitchers = boxData?.teams?.[teamSide]?.pitchers ?? [];
          const playerInfo = boxData?.teams?.[teamSide]?.players ?? {};

          for (const pid of pitchers) {
            const pKey = 'ID' + pid;
            const player = playerInfo[pKey];
            if (!player) continue;

            const gs = player?.stats?.pitching?.gamesStarted || 0;
            if (gs > 0) continue; // skip starters

            const pitchCount = player?.stats?.pitching?.numberOfPitches || 0;
            weightedPitches += pitchCount * dayWeights[dayIdx];
          }
        }
      }

      const fatigueScore = +weightedPitches.toFixed(1);
      const rawFatigue = 0.85 + (weightedPitches / 30) * 0.15;
      const fatigueFactor = +Math.min(rawFatigue, 1.20).toFixed(4);

      results[teamKey] = { fatigueScore, fatigueFactor };

    } catch (e) {
      results[teamKey] = { fatigueScore: 0, fatigueFactor: 1.0, error: e.message };
    }
  }

  return Response.json({
    fatigue: results,
    count: Object.keys(results).length,
    dates,
    fetchedAt: new Date().toISOString(),
  });
}
