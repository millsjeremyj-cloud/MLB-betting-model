// Dynamic pitcher stats for all probable starters
// For each pitcher in today's schedule:
//   1. Try current season stats from MLB API
//   2. Fall back to previous season if insufficient IP
//   3. Calculate pitcher factor: 0.50*(ERA/4.20) + 0.25*(WHIP/1.30) + 0.25*(9/K9)
//   4. Also fetch pitcher handedness for lineup splits (future use)
//
// This replaces the hardcoded SP_DB_2025 as the primary data source.

const MLB_API = 'https://statsapi.mlb.com/api/v1';

function calcPitcherFactor(era, whip, k9) {
  if (!era || era <= 0 || !whip || !k9) return null;
  return 0.50 * (era / 4.20) + 0.25 * (whip / 1.30) + 0.25 * (9 / Math.max(k9, 1));
}

export async function GET() {
  const now = new Date();
  const season = now.getFullYear();
  const prevSeason = season - 1;
  const today = now.toISOString().slice(0, 10);
  const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString().slice(0, 10);

  try {
    // 1. Fetch schedule with probable pitchers
    const schedUrl = `${MLB_API}/schedule?sportId=1&startDate=${today}&endDate=${tomorrow}&hydrate=probablePitcher(note)&gameType=R,S`;
    const schedRes = await fetch(schedUrl);
    if (!schedRes.ok) throw new Error('Schedule HTTP ' + schedRes.status);
    const schedData = await schedRes.json();

    // Collect all probable pitcher IDs and names
    const pitcherMap = {}; // id -> { name, teamKey }
    for (const dateObj of (schedData.dates || [])) {
      for (const game of (dateObj.games || [])) {
        const ap = game.teams?.away?.probablePitcher;
        const hp = game.teams?.home?.probablePitcher;
        if (ap?.id) pitcherMap[ap.id] = { name: ap.fullName || '', id: ap.id };
        if (hp?.id) pitcherMap[hp.id] = { name: hp.fullName || '', id: hp.id };
      }
    }

    const pitcherIds = Object.keys(pitcherMap);
    const results = {};

    // 2. Fetch stats for each pitcher
    for (const pid of pitcherIds) {
      const info = pitcherMap[pid];
      let era = null, whip = null, k9 = null, ip = null, throws = '', source = '';

      // Try current season first
      for (const trySeason of [season, prevSeason]) {
        try {
          const statUrl = `${MLB_API}/people/${pid}/stats?stats=season&group=pitching&season=${trySeason}`;
          const statRes = await fetch(statUrl);
          if (!statRes.ok) continue;
          const statData = await statRes.json();

          const splits = statData.stats?.[0]?.splits;
          if (!splits || splits.length === 0) continue;

          const s = splits[0].stat || {};
          const tryIP = parseFloat(s.inningsPitched || 0);

          // Need at least 20 IP for current season, or accept anything for fallback
          if (tryIP < 20 && trySeason === season) continue;
          if (tryIP < 5) continue;

          era = parseFloat(s.era || 0);
          whip = parseFloat(s.whip || 0);
          const strikeoutsPer9 = parseFloat(s.strikeoutsPer9Inn || 0);
          // If k9 not directly available, calculate from strikeouts and IP
          k9 = strikeoutsPer9 > 0 ? strikeoutsPer9 : (parseInt(s.strikeOuts || 0) / tryIP) * 9;
          ip = tryIP;
          source = trySeason === season ? `${season} season (${tryIP} IP)` : `${prevSeason} season (${tryIP} IP)`;
          break;
        } catch (e) {
          continue;
        }
      }

      // Try to get handedness
      try {
        const personUrl = `${MLB_API}/people/${pid}`;
        const personRes = await fetch(personUrl);
        if (personRes.ok) {
          const personData = await personRes.json();
          throws = personData.people?.[0]?.pitchHand?.code || '';
        }
      } catch (e) {}

      const factor = calcPitcherFactor(era, whip, k9);

      const normName = (info.name || '').toLowerCase()
        .replace(/[éèêàâîïôùûü]/g, c => ({ é:'e',è:'e',ê:'e',à:'a',â:'a',î:'i',ï:'i',ô:'o',ù:'u',û:'u',ü:'u' }[c] || c))
        .replace(/[^a-z0-9 ]/g, '').replace(/\s+/g, ' ').trim();

      results[normName] = {
        id: pid,
        name: info.name,
        era: era != null ? +era.toFixed(2) : null,
        whip: whip != null ? +whip.toFixed(3) : null,
        k9: k9 != null ? +k9.toFixed(1) : null,
        ip: ip != null ? +ip.toFixed(1) : null,
        factor: factor != null ? +factor.toFixed(4) : null,
        throws,
        source,
      };
    }

    return Response.json({
      pitchers: results,
      count: Object.keys(results).length,
      season,
      fetchedAt: new Date().toISOString(),
    });

  } catch (e) {
    return Response.json({ error: e.message, pitchers: {} }, { status: 500 });
  }
}
