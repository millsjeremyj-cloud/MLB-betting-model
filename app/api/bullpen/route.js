// Server-side proxy for Covers.com bullpen stats
// Scrapes team bullpen ERA, WHIP, SO and calculates bullpen_factor
// Factor formula: 0.50*(ERA/4.20) + 0.30*(WHIP/1.30) + 0.20*(600/SO)
// Blended toward 1.0 based on sample size (SO/200)

export async function GET() {
  const season = new Date().getFullYear();
  const url = 'https://www.covers.com/sport/baseball/mlb/statistics/team-bullpenera/' + season;

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'Accept': 'text/html',
      },
    });

    if (!res.ok) throw new Error('Covers HTTP ' + res.status);
    const html = await res.text();

    // Parse the table - Covers format: Team | ERA | SV | H | ER | WHIP | HR | BB | SO
    const teamMap = {
      'Washington':'WSH','Colorado':'COL','LA Angels':'LAA','Arizona':'ARI',
      'Minnesota':'MIN','Baltimore':'BAL','Athletics':'ATH','NY Yankees':'NYY',
      'Miami':'MIA','LA Dodgers':'LAD','Philadelphia':'PHI','Atlanta':'ATL',
      'Chi. White Sox':'CWS','Detroit':'DET','Toronto':'TOR','NY Mets':'NYM',
      'Cincinnati':'CIN','Pittsburgh':'PIT','Tampa Bay':'TB','Chi. Cubs':'CHC',
      'St. Louis':'STL','Seattle':'SEA','Houston':'HOU','Kansas City':'KC',
      'Milwaukee':'MIL','Texas':'TEX','San Francisco':'SF','Cleveland':'CLE',
      'Boston':'BOS','San Diego':'SD',
    };

    // Extract table rows using regex
    // Look for rows with team stats pattern
    const results = {};
    
    // Try multiple patterns to find the data
    // Pattern: team name followed by numeric stats
    const rowPattern = /<td[^>]*>([^<]+)<\/td>\s*<td[^>]*>([\d.]+)<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>([\d.]+)<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>\s*<td[^>]*>(\d+)<\/td>/gi;
    
    let match;
    while ((match = rowPattern.exec(html)) !== null) {
      const rawTeam = match[1].trim();
      const era = parseFloat(match[2]);
      const whip = parseFloat(match[6]);
      const so = parseInt(match[9]);

      // Find team key
      let teamKey = teamMap[rawTeam];
      if (!teamKey) {
        // Try partial match
        for (const [name, key] of Object.entries(teamMap)) {
          if (rawTeam.includes(name) || name.includes(rawTeam)) {
            teamKey = key;
            break;
          }
        }
      }
      if (!teamKey || results[teamKey]) continue;

      let factor = 1.0;
      if (era && whip && so) {
        const rawFactor = 0.50 * (era / 4.20) + 0.30 * (whip / 1.30) + 0.20 * (600 / so);
        const sampleWeight = Math.min(so / 200, 1.0);
        factor = rawFactor * sampleWeight + 1.0 * (1 - sampleWeight);
      }

      results[teamKey] = {
        era: +era.toFixed(2),
        whip: +whip.toFixed(2),
        so,
        factor: +factor.toFixed(4),
      };
    }

    // If regex didn't work, try simpler text extraction
    if (Object.keys(results).length === 0) {
      // Alternative: look for team names near numbers
      for (const [coversName, modelKey] of Object.entries(teamMap)) {
        const idx = html.indexOf(coversName);
        if (idx === -1) continue;
        
        // Extract nearby numbers
        const chunk = html.substring(idx, idx + 500);
        const nums = chunk.match(/[\d.]+/g);
        if (nums && nums.length >= 6) {
          const era = parseFloat(nums[0]);
          const whip = parseFloat(nums[4]) || parseFloat(nums[3]);
          const so = parseInt(nums[nums.length - 1]) || parseInt(nums[7]);
          
          if (era > 0 && era < 10 && whip > 0 && whip < 3 && so > 0) {
            const rawFactor = 0.50 * (era / 4.20) + 0.30 * (whip / 1.30) + 0.20 * (600 / Math.max(so, 1));
            const sampleWeight = Math.min(so / 200, 1.0);
            const factor = rawFactor * sampleWeight + 1.0 * (1 - sampleWeight);
            
            results[modelKey] = {
              era: +era.toFixed(2),
              whip: +whip.toFixed(2),
              so,
              factor: +factor.toFixed(4),
            };
          }
        }
      }
    }

    return Response.json({
      teams: results,
      count: Object.keys(results).length,
      season,
      fetchedAt: new Date().toISOString(),
    });

  } catch (e) {
    return Response.json({ error: e.message, teams: {} }, { status: 500 });
  }
}
