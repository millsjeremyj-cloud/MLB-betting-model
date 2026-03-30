// Enhanced lineup strength calculator
// 1. Fetches confirmed/projected starting lineups from MLB API
// 2. Loads player xwOBA from Savant (current season, fallback to previous)
// 3. Calculates lineup_strength = average of 9 starters' (xwOBA / 0.320)
// 4. Returns full player breakdown for the game model view

const MLB_API = 'https://statsapi.mlb.com/api/v1';

const MLB_TEAM_IDS_REV = {
  108:"LAA",109:"ARI",110:"BAL",111:"BOS",112:"CHC",113:"CIN",114:"CLE",115:"COL",
  116:"DET",117:"HOU",118:"KC",119:"LAD",120:"WSH",121:"NYM",133:"ATH",134:"PIT",
  135:"SD",136:"SEA",137:"SF",138:"STL",139:"TB",140:"TEX",141:"TOR",142:"MIN",
  143:"PHI",144:"ATL",145:"CWS",146:"MIA",147:"NYY",158:"MIL",
};

// Player data cache (xwOBA lookup)
let playerCache = null;
let cacheTime = 0;
const CACHE_TTL = 6 * 60 * 60 * 1000; // 6 hours

async function loadPlayerData() {
  if (playerCache && Date.now() - cacheTime < CACHE_TTL) return playerCache;

  const season = new Date().getFullYear();
  const map = {};

  // Try current season first, then previous
  for (const yr of [season, season - 1]) {
    try {
      const url = `https://baseballsavant.mlb.com/leaderboard/expected_statistics?type=batter&year=${yr}&position=&team=&min=10&csv=true`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': '*/*' },
      });
      if (!res.ok) continue;
      const text = await res.text();
      if (!text || !text.includes(',')) continue;

      const lines = text.trim().split('\n');
      const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
      const pidIdx = headers.indexOf('player_id');
      const nameIdx = headers.indexOf('last_name, first_name');
      const xwIdx = headers.findIndex(h => h === 'est_woba' || h === 'xwOBA');
      const paIdx = headers.indexOf('pa');

      if (pidIdx === -1 || xwIdx === -1) continue;

      for (let i = 1; i < lines.length; i++) {
        const cols = lines[i].split(',');
        const pid = cols[pidIdx]?.trim().replace(/"/g, '');
        const name = cols[nameIdx]?.trim().replace(/"/g, '') || '';
        const xw = parseFloat(cols[xwIdx]?.trim().replace(/"/g, ''));
        const pa = parseInt(cols[paIdx]?.trim().replace(/"/g, '') || '0');
        if (pid && xw > 0) {
          // If we already have current season data, don't overwrite with previous
          if (!map[pid]) {
            map[pid] = { xwOBA: xw, name, pa, season: yr };
          }
        }
      }

      if (Object.keys(map).length > 100) break; // got good data, stop
    } catch (e) {
      continue;
    }
  }

  // If Savant failed entirely, try MLB Stats API for basic batting stats
  if (Object.keys(map).length === 0) {
    try {
      const season = new Date().getFullYear();
      for (const yr of [season, season - 1]) {
        const url = `${MLB_API}/stats?stats=season&season=${yr}&group=hitting&sportId=1&limit=500`;
        const res = await fetch(url);
        if (!res.ok) continue;
        const data = await res.json();
        for (const block of (data.stats || [])) {
          for (const split of (block.splits || [])) {
            const pid = String(split.player?.id || '');
            const name = split.player?.fullName || '';
            if (!pid) continue;
            const s = split.stat || {};
            const obp = parseFloat(s.obp || 0);
            const slg = parseFloat(s.slg || 0);
            // Approximate xwOBA from OBP/SLG: xwOBA ≈ 0.7*OBP + 0.3*SLG (rough proxy)
            const approxXwOBA = obp > 0 ? 0.7 * obp + 0.3 * slg : 0;
            if (approxXwOBA > 0 && !map[pid]) {
              map[pid] = { xwOBA: +approxXwOBA.toFixed(3), name, pa: parseInt(s.plateAppearances || 0), season: yr, approx: true };
            }
          }
        }
        if (Object.keys(map).length > 100) break;
      }
    } catch (e) {}
  }

  if (Object.keys(map).length > 0) {
    playerCache = map;
    cacheTime = Date.now();
  }

  return map;
}

async function fetchGameLineup(gamePk, teamSide) {
  // Try boxscore first (has batting order for live/final games)
  try {
    const boxUrl = `${MLB_API}/game/${gamePk}/boxscore`;
    const boxRes = await fetch(boxUrl);
    if (boxRes.ok) {
      const boxData = await boxRes.json();
      const battingOrder = boxData?.teams?.[teamSide]?.battingOrder;
      if (battingOrder && battingOrder.length >= 9) {
        const players = boxData?.teams?.[teamSide]?.players || {};
        return battingOrder.map(pid => {
          const pKey = 'ID' + pid;
          const p = players[pKey];
          return {
            id: String(pid),
            name: p?.person?.fullName || `Player ${pid}`,
          };
        });
      }
    }
  } catch (e) {}

  // Try game feed for lineups
  try {
    const feedUrl = `${MLB_API}/game/${gamePk}/feed/live`;
    const feedRes = await fetch(feedUrl);
    if (feedRes.ok) {
      const feedData = await feedRes.json();
      const lineup = feedData?.liveData?.boxscore?.teams?.[teamSide]?.battingOrder;
      if (lineup && lineup.length >= 9) {
        const players = feedData?.liveData?.boxscore?.teams?.[teamSide]?.players || {};
        return lineup.map(pid => {
          const pKey = 'ID' + pid;
          const p = players[pKey];
          return {
            id: String(pid),
            name: p?.person?.fullName || `Player ${pid}`,
          };
        });
      }
    }
  } catch (e) {}

  return [];
}

export async function GET() {
  try {
    const now = new Date();
    const today = now.toISOString().slice(0, 10);
    const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

    // Fetch schedule
    const schedUrl = `${MLB_API}/schedule?sportId=1&startDate=${today}&endDate=${tomorrow}&hydrate=probablePitcher,venue&gameType=R,S`;
    const schedRes = await fetch(schedUrl);
    if (!schedRes.ok) throw new Error('Schedule HTTP ' + schedRes.status);
    const schedData = await schedRes.json();

    // Load player xwOBA data
    const playerData = await loadPlayerData();
    const hasPlayerData = Object.keys(playerData).length > 0;

    const results = {};

    for (const dateObj of (schedData.dates || [])) {
      for (const game of (dateObj.games || [])) {
        const gamePk = game.gamePk;
        if (!gamePk) continue;

        const awayId = game.teams?.away?.team?.id;
        const homeId = game.teams?.home?.team?.id;
        const awayKey = MLB_TEAM_IDS_REV[awayId] || '';
        const homeKey = MLB_TEAM_IDS_REV[homeId] || '';

        for (const [side, teamKey] of [['away', awayKey], ['home', homeKey]]) {
          if (!teamKey) continue;

          const lineup = await fetchGameLineup(gamePk, side);
          const confirmed = lineup.length >= 9;

          const players = [];
          let ratingSum = 0;
          let ratedCount = 0;

          for (const p of lineup.slice(0, 9)) {
            const pd = playerData[p.id];
            if (pd) {
              const rating = pd.xwOBA / 0.320;
              players.push({
                pid: p.id,
                name: p.name || pd.name || `Player ${p.id}`,
                xwOBA: pd.xwOBA,
                rating: +rating.toFixed(3),
                season: pd.season,
                approx: pd.approx || false,
              });
              ratingSum += rating;
              ratedCount++;
            } else {
              players.push({
                pid: p.id,
                name: p.name || `Player ${p.id}`,
                xwOBA: null,
                rating: 1.0,
              });
              ratingSum += 1.0;
              ratedCount++;
            }
          }

          const factor = ratedCount > 0 ? ratingSum / ratedCount : 1.0;

          results[teamKey] = {
            gamePk,
            teamKey,
            factor: +factor.toFixed(4),
            players,
            confirmed,
            ratedCount,
            totalPlayers: lineup.length,
          };
        }
      }
    }

    return Response.json({
      lineups: results,
      count: Object.keys(results).length,
      hasPlayerData,
      playerCount: Object.keys(playerData).length,
      date: today,
      fetchedAt: new Date().toISOString(),
    });

  } catch (e) {
    return Response.json({ error: e.message, lineups: {} }, { status: 500 });
  }
}
