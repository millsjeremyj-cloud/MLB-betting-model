// 11:30 PM CT — Auto-grade bets from final scores
// Reads pending bets from Google Sheets, fetches MLB final scores, grades each bet,
// writes result + profit back to the sheet.

const MLB_TEAM_IDS_REV = {
  108:"LAA",109:"ARI",110:"BAL",111:"BOS",112:"CHC",113:"CIN",114:"CLE",115:"COL",
  116:"DET",117:"HOU",118:"KC",119:"LAD",120:"WSH",121:"NYM",133:"ATH",134:"PIT",
  135:"SD",136:"SEA",137:"SF",138:"STL",139:"TB",140:"TEX",141:"TOR",142:"MIN",
  143:"PHI",144:"ATL",145:"CWS",146:"MIA",147:"NYY",158:"MIL",
};

function normalizeKey(name) {
  const map = {
    "arizona diamondbacks":"ARI","athletics":"ATH","atlanta braves":"ATL",
    "baltimore orioles":"BAL","boston red sox":"BOS","chicago cubs":"CHC",
    "chicago white sox":"CWS","cincinnati reds":"CIN","cleveland guardians":"CLE",
    "colorado rockies":"COL","detroit tigers":"DET","houston astros":"HOU",
    "kansas city royals":"KC","los angeles angels":"LAA","los angeles dodgers":"LAD",
    "miami marlins":"MIA","milwaukee brewers":"MIL","minnesota twins":"MIN",
    "new york mets":"NYM","new york yankees":"NYY","philadelphia phillies":"PHI",
    "pittsburgh pirates":"PIT","san diego padres":"SD","seattle mariners":"SEA",
    "san francisco giants":"SF","st. louis cardinals":"STL","tampa bay rays":"TB",
    "texas rangers":"TEX","toronto blue jays":"TOR","washington nationals":"WSH",
  };
  return map[name.toLowerCase().trim()] || name.toUpperCase().trim();
}

function payoutFromOdds(odds, stake = 1) {
  return odds > 0 ? stake * (odds / 100) : stake * (100 / Math.abs(odds));
}

export async function GET(request) {
  const authHeader = request.headers.get('authorization');
  const cronSecret = process.env.CRON_SECRET;
  if (cronSecret && authHeader !== `Bearer ${cronSecret}`) {
    return Response.json({ error: 'Unauthorized' }, { status: 401 });
  }

  const results = {
    timestamp: new Date().toISOString(),
    type: 'grade',
    gamesChecked: 0,
    betsGraded: 0,
    details: [],
    error: null,
  };

  try {
    // 1. Fetch today's final scores from MLB API
    const now = new Date();
    const today = now.toLocaleDateString('en-CA', { timeZone: 'America/Chicago' });

    const schedUrl =
      'https://statsapi.mlb.com/api/v1/schedule?sportId=1&date=' +
      encodeURIComponent(today) + '&hydrate=linescore';

    const schedRes = await fetch(schedUrl);
    if (!schedRes.ok) throw new Error('MLB Schedule HTTP ' + schedRes.status);
    const schedData = await schedRes.json();

    // Build game results map: "AWAY_HOME" -> { awayScore, homeScore, totalScore }
    const gameResults = {};
    for (const dateObj of (schedData.dates || [])) {
      for (const game of (dateObj.games || [])) {
        results.gamesChecked++;
        if (game.status?.abstractGameState !== 'Final') continue;

        const awayId = game.teams?.away?.team?.id;
        const homeId = game.teams?.home?.team?.id;
        const awayKey = MLB_TEAM_IDS_REV[awayId] || normalizeKey(game.teams?.away?.team?.name || '');
        const homeKey = MLB_TEAM_IDS_REV[homeId] || normalizeKey(game.teams?.home?.team?.name || '');
        const awayScore = game.teams?.away?.score ?? null;
        const homeScore = game.teams?.home?.score ?? null;

        if (awayScore != null && homeScore != null) {
          gameResults[`${awayKey}_${homeKey}`] = { awayKey, homeKey, awayScore, homeScore, totalScore: awayScore + homeScore };
          // Also index by date_away_home for exact matching
          gameResults[`${today}_${awayKey}_${homeKey}`] = { awayKey, homeKey, awayScore, homeScore, totalScore: awayScore + homeScore };
        }
      }
    }

    // 2. Read pending bets from Google Sheets
    const appUrl = process.env.APP_URL || `https://${request.headers.get('host')}`;
    const sheetsRes = await fetch(`${appUrl}/api/sheets`, {
      headers: { 'Authorization': `Bearer ${cronSecret}` },
    });
    if (!sheetsRes.ok) throw new Error('Sheets read failed: ' + sheetsRes.status);
    const { bets } = await sheetsRes.json();

    const pending = (bets || []).filter(b => b.status === 'PENDING');

    // 3. Grade each pending bet
    for (const bet of pending) {
      // Try to match game: date_away_home or just away_home
      const dateKey = `${bet.date}_${bet.away}_${bet.home}`;
      const simpleKey = `${bet.away}_${bet.home}`;
      const game = gameResults[dateKey] || gameResults[simpleKey];

      if (!game) continue; // game not final yet or not today

      let result = '';
      let profit = 0;
      const openingOdds = +bet.opening_odds || 0;

      if (bet.bet_type === 'Side') {
        // ML bet: did the picked side win?
        const pickedSide = bet.bet_side;
        if (pickedSide === 'Away') {
          if (game.awayScore > game.homeScore) { result = 'W'; profit = payoutFromOdds(openingOdds, 1); }
          else if (game.awayScore < game.homeScore) { result = 'L'; profit = -1; }
          else { result = 'P'; profit = 0; }
        } else if (pickedSide === 'Home') {
          if (game.homeScore > game.awayScore) { result = 'W'; profit = payoutFromOdds(openingOdds, 1); }
          else if (game.homeScore < game.awayScore) { result = 'L'; profit = -1; }
          else { result = 'P'; profit = 0; }
        }
      } else if (bet.bet_type === 'Total') {
        // O/U bet: compare total score to the line
        const line = +bet.model_line || +bet.opening_odds; // fallback
        // Extract the total line from the pick (e.g., "O 7" -> 7)
        const pickMatch = (bet.pick || '').match(/[OU]\s*([\d.]+)/);
        const totalLine = pickMatch ? +pickMatch[1] : null;

        if (totalLine != null) {
          if (bet.bet_side === 'Over') {
            if (game.totalScore > totalLine) { result = 'W'; profit = payoutFromOdds(openingOdds, 1); }
            else if (game.totalScore < totalLine) { result = 'L'; profit = -1; }
            else { result = 'P'; profit = 0; }
          } else if (bet.bet_side === 'Under') {
            if (game.totalScore < totalLine) { result = 'W'; profit = payoutFromOdds(openingOdds, 1); }
            else if (game.totalScore > totalLine) { result = 'L'; profit = -1; }
            else { result = 'P'; profit = 0; }
          }
        }
      }

      if (!result) continue;

      // 4. Write grade back to Google Sheets
      try {
        const gradeRes = await fetch(`${appUrl}/api/sheets`, {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${cronSecret}`,
          },
          body: JSON.stringify({
            betId: bet.bet_id,
            result,
            awayScore: game.awayScore,
            homeScore: game.homeScore,
            profit: +profit.toFixed(3),
          }),
        });

        if (gradeRes.ok) {
          results.betsGraded++;
          results.details.push({
            betId: bet.bet_id,
            game: `${bet.away} @ ${bet.home}`,
            pick: bet.pick,
            result,
            score: `${game.awayScore}-${game.homeScore}`,
            profit: +profit.toFixed(3),
          });
        }
      } catch (e) {
        results.details.push({ betId: bet.bet_id, error: e.message });
      }
    }

    results.status = 'success';

  } catch (e) {
    results.error = e.message;
    results.status = 'error';
  }

  return Response.json(results);
}
