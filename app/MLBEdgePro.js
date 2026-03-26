'use client';

import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";

// ═══════════════════════════════════════════════════════════════════════════════
//  MATH ENGINE
// ═══════════════════════════════════════════════════════════════════════════════
function poissonPMF(k, lam) {
  if (lam <= 0) return k === 0 ? 1 : 0;
  let log = -lam + k * Math.log(lam);
  for (let i = 1; i <= k; i++) log -= Math.log(i);
  return Math.exp(log);
}
function pRunLineHome(lamH, lamA, spread = 1.5) {
  let p = 0;
  for (let h = 0; h <= 20; h++)
    for (let a = 0; a <= 20; a++)
      if (h - a >= spread) p += poissonPMF(h, lamH) * poissonPMF(a, lamA);
  return p;
}
function pOver(lamH, lamA, line) {
  let p = 0;
  for (let h = 0; h <= 20; h++)
    for (let a = 0; a <= 20; a++)
      if (h + a > line) p += poissonPMF(h, lamH) * poissonPMF(a, lamA);
  return p;
}
function pythagorean(xRA, xRH, exp = 1.83) {
  const pA = Math.pow(xRA, exp), pH = Math.pow(xRH, exp);
  return { away: pA / (pA + pH), home: pH / (pA + pH) };
}
function impliedFromML(ml) { return ml < 0 ? -ml / (-ml + 100) : 100 / (ml + 100); }
function mlFromProb(p) {
  if (p <= 0.001) return "+9999"; if (p >= 0.999) return "-9999";
  const v = p >= 0.5 ? Math.round(-(p / (1 - p)) * 100) : Math.round(((1 - p) / p) * 100);
  return (v > 0 ? "+" : "") + v;
}
function calcEdge(modelP, marketML) { return (modelP - impliedFromML(marketML)) * 100; }
function edgeColor(e) {
  if (e >= 6) return "#ffd166"; if (e >= 3.5) return "#f4a261";
  if (e >= 2) return "#e9c46a"; if (e >= -1) return "#7a95b5"; return "#e63946";
}
function edgeTier(e) {
  if (e >= 8)   return { label: "SHARP",  color: "#ffd166" };
  if (e >= 5)   return { label: "STRONG", color: "#f4a261" };
  if (e >= 4)   return { label: "BET",    color: "#e9c46a" };
  if (e >= 2.5) return { label: "LEAN",   color: "#c8b560" };
  if (e >= 1)   return { label: "SLIGHT", color: "#7a8899" };
  return               { label: "PASS",   color: "#e63946" };
}
function payoutFromOdds(odds, stake = 1) {
  return odds > 0 ? stake * (odds / 100) : stake * (100 / Math.abs(odds));
}
function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 7); }
function normName(s = "") {
  return s.toLowerCase()
    .replace(/[éèêàâîïôùûü]/g, c => ({ é:"e",è:"e",ê:"e",à:"a",â:"a",î:"i",ï:"i",ô:"o",ù:"u",û:"u",ü:"u" }[c] || c))
    .replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

// ═══════════════════════════════════════════════════════════════════════════════
//  CONSTANTS
// ═══════════════════════════════════════════════════════════════════════════════
const LEAGUE_AVG_ERA  = 4.20;
const LEAGUE_AVG_WHIP = 1.30;
const LEAGUE_AVG_K9   = 8.80;
const LEAGUE_AVG_RUNS = 4.60;
const MLB_API         = "https://statsapi.mlb.com/api/v1";
const ODDS_API_BASE   = "https://api.the-odds-api.com/v4";

// In-memory storage (replaced with persistent storage on deploy)
const _mem = {};
function memGet(k) { try { return _mem[k] ? JSON.parse(_mem[k]) : null; } catch { return null; } }
function memSet(k, v) { _mem[k] = JSON.stringify(v); }

// MLB official team IDs → model key
const MLB_TEAM_IDS = {
  108:"LAA",109:"ARI",110:"BAL",111:"BOS",112:"CHC",
  113:"CIN",114:"CLE",115:"COL",116:"DET",117:"HOU",
  118:"KC", 119:"LAD",120:"WSH",121:"NYM",133:"ATH",
  134:"PIT",135:"SD", 136:"SEA",137:"SF", 138:"STL",
  139:"TB", 140:"TEX",141:"TOR",142:"MIN",143:"PHI",
  144:"ATL",145:"CWS",146:"MIA",147:"NYY",158:"MIL",
};

const TEAM_NAME_MAP = {
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
function teamKey(name = "") {
  return TEAM_NAME_MAP[normName(name)] ?? normName(name).split(" ").pop().slice(0, 3).toUpperCase();
}

const SAVANT_TEAM = {
  ARI:"ARI",ATH:"ATH",OAK:"ATH",ATL:"ATL",BAL:"BAL",BOS:"BOS",
  CHC:"CHC",CIN:"CIN",CLE:"CLE",COL:"COL",CWS:"CWS",DET:"DET",
  HOU:"HOU",KC:"KC",LAA:"LAA",LAD:"LAD",MIA:"MIA",MIL:"MIL",
  MIN:"MIN",NYM:"NYM",NYY:"NYY",PHI:"PHI",PIT:"PIT",SD:"SD",
  SEA:"SEA",SF:"SF",STL:"STL",TB:"TB",TEX:"TEX",TOR:"TOR",WSH:"WSH",
};

// CORS proxy chain
const PROXIES = [
  url => url,
  url => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  url => `https://corsproxy.io/?${encodeURIComponent(url)}`,
];
async function fetchWithFallback(url) {
  for (const make of PROXIES) {
    try {
      const r = await fetch(make(url), { signal: AbortSignal.timeout(8000) });
      if (r.ok) return r.json();
    } catch {}
  }
  throw new Error(`Fetch failed: ${url.split("?")[0].slice(-50)}`);
}
async function proxyGetText(url) {
  for (const make of PROXIES) {
    try {
      const r = await fetch(make(url), { signal: AbortSignal.timeout(9000) });
      if (r.ok) return r.text();
    } catch {}
  }
  throw new Error("All proxies failed");
}
function parseCSV(text) {
  const lines = text.trim().split("\n");
  const headers = lines[0].split(",").map(h => h.trim().replace(/"/g, ""));
  return lines.slice(1).map(line => {
    const cols = line.split(",");
    const obj = {};
    headers.forEach((h, i) => { obj[h] = cols[i]?.trim().replace(/"/g, "") ?? ""; });
    return obj;
  });
}

// ═══════════════════════════════════════════════════════════════════════════════
//  PARK FACTORS
// ═══════════════════════════════════════════════════════════════════════════════
const PARK_FACTORS = {
  "Coors Field":1.13,"Fenway Park":1.04,"Chase Field":1.03,
  "Great American Ball Park":1.03,"Target Field":1.02,
  "Kauffman Stadium":1.01,"Nationals Park":1.01,"Angel Stadium":1.01,
  "loanDepot park":1.01,"Dodger Stadium":1.01,"Citizens Bank Park":1.01,
  "Truist Park":1.01,"Comerica Park":1.00,"Busch Stadium":1.00,
  "Oriole Park at Camden Yards":1.00,"Rogers Centre":1.00,
  "Yankee Stadium":1.00,"Daikin Park":1.00,"Rate Field":0.99,
  "Guaranteed Rate Field":0.99,"PNC Park":0.99,"Citi Field":0.98,
  "Oracle Park":0.97,"American Family Field":0.97,"Wrigley Field":0.97,
  "Petco Park":0.97,"Progressive Field":0.97,"Globe Life Field":0.97,
  "T-Mobile Park":0.91,"Tropicana Field":0.99,"Sutter Health Park":1.00,
};
function getParkFactor(venue = "") {
  if (PARK_FACTORS[venue]) return PARK_FACTORS[venue];
  const nv = normName(venue);
  for (const [k, v] of Object.entries(PARK_FACTORS))
    if (normName(k).split(" ").some(w => w.length > 4 && nv.includes(w))) return v;
  return 1.00;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  2025 BASELINE — Team Offense Indices (Statcast-based)
// ═══════════════════════════════════════════════════════════════════════════════
const TEAM_OFF_2025 = {
  ARI:{idx:0.998},ATH:{idx:0.998},ATL:{idx:1.010},BAL:{idx:0.985},BOS:{idx:1.012},
  CHC:{idx:1.015},CIN:{idx:1.015},CLE:{idx:0.957},COL:{idx:0.988},CWS:{idx:0.995},
  DET:{idx:1.023},HOU:{idx:1.009},KC:{idx:0.970},LAA:{idx:1.003},LAD:{idx:1.073},
  MIA:{idx:1.014},MIL:{idx:0.985},MIN:{idx:1.035},NYM:{idx:1.026},NYY:{idx:1.112},
  PHI:{idx:0.985},PIT:{idx:1.013},SD:{idx:1.040},SEA:{idx:1.031},SF:{idx:0.993},
  STL:{idx:0.977},TB:{idx:0.952},TEX:{idx:0.996},TOR:{idx:1.035},WSH:{idx:1.007},
};

// ═══════════════════════════════════════════════════════════════════════════════
//  2025 BASELINE — Bullpen Factors (Covers-based: higher = worse)
//  Formula: 0.50*(ERA/4.20) + 0.30*(WHIP/1.30) + 0.20*(600/SO)
// ═══════════════════════════════════════════════════════════════════════════════
const BULLPEN_2025 = {
  ARI:1.138,ATH:1.048,ATL:1.006,BAL:1.062,BOS:0.910,CHC:0.880,
  CIN:0.893,CLE:0.888,COL:1.183,CWS:0.956,DET:0.883,HOU:0.799,
  KC:0.923, LAA:1.108,LAD:0.990,MIA:1.025,MIL:0.810,MIN:1.073,
  NYM:0.918,NYY:1.025,PHI:0.861,PIT:0.870,SD:0.831, SEA:0.864,
  SF:1.016, STL:1.024,TB:0.878, TEX:0.925,TOR:0.836,WSH:1.235,
};

// ═══════════════════════════════════════════════════════════════════════════════
//  2025 BASELINE — Starting Pitcher Database
//  Factor = 0.50*(ERA/4.20) + 0.25*(WHIP/1.30) + 0.25*(9/K9)
//  Higher = worse pitcher (allows more runs)
// ═══════════════════════════════════════════════════════════════════════════════
function calcPitcherFactor({ era, whip, k9 }) {
  if (!era || era <= 0) return 1.0;
  return 0.50 * (era / LEAGUE_AVG_ERA) + 0.25 * (whip / LEAGUE_AVG_WHIP) + 0.25 * (9 / Math.max(k9, 1));
}

const SP_DB_RAW = {
  "gerrit cole":{era:2.50,whip:1.00,k9:13.0},"max fried":{era:3.01,whip:1.07,k9:10.2},
  "yoshinobu yamamoto":{era:3.00,whip:0.98,k9:10.8},"tarik skubal":{era:2.39,whip:0.95,k9:11.0},
  "paul skenes":{era:1.97,whip:0.95,k9:10.4},"chris sale":{era:3.01,whip:1.02,k9:10.8},
  "tyler glasnow":{era:3.49,whip:1.02,k9:11.8},"zack wheeler":{era:3.07,whip:1.01,k9:10.9},
  "pablo lopez":{era:3.45,whip:1.08,k9:9.8},"garrett crochet":{era:3.31,whip:1.12,k9:12.5},
  "corbin burnes":{era:2.92,whip:1.06,k9:10.5},"logan webb":{era:3.25,whip:1.08,k9:8.2},
  "luis castillo":{era:3.61,whip:1.12,k9:10.8},"framber valdez":{era:3.05,whip:1.12,k9:9.5},
  "kodai senga":{era:2.98,whip:1.01,k9:11.5},"freddy peralta":{era:3.35,whip:1.06,k9:11.8},
  "shane bieber":{era:3.32,whip:1.06,k9:10.2},"hunter greene":{era:3.53,whip:1.09,k9:11.8},
  "joe ryan":{era:3.61,whip:1.10,k9:10.5},"justin steele":{era:3.06,whip:1.10,k9:10.2},
  "shota imanaga":{era:2.91,whip:1.02,k9:10.0},"zac gallen":{era:3.47,whip:1.08,k9:9.5},
  "seth lugo":{era:3.58,whip:1.08,k9:8.5},"tanner bibee":{era:3.47,whip:1.09,k9:9.8},
  "brayan bello":{era:3.72,whip:1.18,k9:9.8},"george kirby":{era:3.70,whip:0.99,k9:8.8},
  "jack flaherty":{era:3.17,whip:1.18,k9:8.5},"ranger suarez":{era:3.00,whip:1.09,k9:8.5},
  "jose berrios":{era:3.76,whip:1.15,k9:9.2},"yusei kikuchi":{era:3.85,whip:1.18,k9:10.8},
  "zac eflin":{era:3.70,whip:1.14,k9:8.8},"sandy alcantara":{era:3.96,whip:1.21,k9:9.2},
  "blake snell":{era:3.87,whip:1.22,k9:11.2},"aaron nola":{era:3.59,whip:1.11,k9:9.8},
  "carlos rodon":{era:3.60,whip:1.15,k9:11.3},"dylan cease":{era:3.47,whip:1.14,k9:11.4},
  "walker buehler":{era:3.75,whip:1.15,k9:9.5},"merrill kelly":{era:3.77,whip:1.14,k9:8.2},
  "nathan eovaldi":{era:3.63,whip:1.10,k9:8.8},"sonny gray":{era:3.00,whip:1.05,k9:10.5},
  "bailey ober":{era:3.73,whip:1.12,k9:9.8},"brady singer":{era:3.63,whip:1.18,k9:9.5},
  "nick lodolo":{era:3.61,whip:1.12,k9:10.2},"andrew abbott":{era:3.70,whip:1.16,k9:10.8},
  "chase burns":{era:3.50,whip:1.10,k9:11.5},"mitch keller":{era:4.19,whip:1.26,k9:7.7},
  "sean manaea":{era:3.96,whip:1.14,k9:10.1},"casey mize":{era:3.84,whip:1.22,k9:8.8},
  "taj bradley":{era:4.50,whip:1.25,k9:9.0},"shane baz":{era:4.00,whip:1.20,k9:9.5},
  "hunter brown":{era:3.80,whip:1.18,k9:10.2},"cristian javier":{era:3.80,whip:1.18,k9:11.0},
  "spencer strider":{era:3.80,whip:1.10,k9:12.5},"luis severino":{era:4.54,whip:1.30,k9:6.9},
  "kyle bradish":{era:3.70,whip:1.16,k9:9.8},"joe musgrove":{era:3.88,whip:1.17,k9:9.1},
  "patrick corbin":{era:5.20,whip:1.48,k9:7.2},"braxton ashcraft":{era:2.71,whip:1.25,k9:9.2},
};

// Pre-compute factors
const SP_DB_2025 = {};
for (const [name, stats] of Object.entries(SP_DB_RAW)) {
  SP_DB_2025[name] = { ...stats, factor: calcPitcherFactor(stats) };
}

function getSPFactor2025(name = "") {
  const sp = SP_DB_2025[normName(name)];
  return sp ? sp.factor : 1.0;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  BLENDING (matches spreadsheet)
// ═══════════════════════════════════════════════════════════════════════════════
function blendOffenseIndex(key, savant2026) {
  const base = TEAM_OFF_2025[key];
  if (!base) return { idx: 1.0, pct: 0, label: "—" };
  const d = savant2026[key];
  if (!d || !d.idx2026 || d.pa < 50) return { idx: base.idx, pct: 0, label: "2025 only" };
  const w = Math.min(d.pa, 300) / 300 * 0.35;
  const blended = base.idx * (1 - w) + d.idx2026 * w;
  return { idx: +blended.toFixed(4), pct: Math.round(w * 100), pa2026: d.pa, label: `${Math.round((1 - w) * 100)}% '25 + ${Math.round(w * 100)}% '26` };
}

function blendSPFactor(name, mlbPitchers2026) {
  const key = normName(name);
  const sp25 = SP_DB_2025[key];
  const sp26 = mlbPitchers2026[key];
  if (!sp25 && !sp26) return { factor: 1.0, pct: 0, label: "Unknown" };
  if (!sp25) return { factor: calcPitcherFactor(sp26), pct: 100, label: "2026 only" };
  if (!sp26 || (sp26.ip ?? 0) < 5) return { factor: sp25.factor, pct: 0, label: "2025 only" };
  const w = Math.min(sp26.ip, 200) / 200 * 0.40;
  const blended = {
    era: sp25.era * (1 - w) + sp26.era * w,
    whip: sp25.whip * (1 - w) + sp26.whip * w,
    k9: sp25.k9 * (1 - w) + sp26.k9 * w,
  };
  return { factor: calcPitcherFactor(blended), pct: Math.round(w * 100), ip2026: sp26.ip, label: `${Math.round((1 - w) * 100)}% '25 + ${Math.round(w * 100)}% '26` };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MLB STATS API
// ═══════════════════════════════════════════════════════════════════════════════
async function mlbSchedule() {
  const now = new Date();
  const yest = new Date(now); yest.setDate(yest.getDate() - 1);
  const end = new Date(now); end.setDate(end.getDate() + 5);
  const fmt = d => d.toISOString().slice(0, 10);
  const season = now.getFullYear();
  const url = `${MLB_API}/schedule?sportId=1&startDate=${fmt(yest)}&endDate=${fmt(end)}&hydrate=probablePitcher,venue,linescore&gameType=R,S&season=${season}`;
  const d = await fetchWithFallback(url);
  const games = [];
  for (const dateObj of (d.dates ?? [])) {
    for (const g of (dateObj.games ?? [])) {
      const status = g.status?.abstractGameState ?? "Preview";
      const isLive = status === "Live";
      const isFinal = status === "Final";
      const homeT = g.teams?.home?.team ?? {};
      const awayT = g.teams?.away?.team ?? {};
      const hKey = MLB_TEAM_IDS[homeT.id] ?? teamKey(homeT.name ?? "");
      const aKey = MLB_TEAM_IDS[awayT.id] ?? teamKey(awayT.name ?? "");
      games.push({
        id: g.gamePk, home: homeT.name ?? "", away: awayT.name ?? "",
        homeKey: hKey, awayKey: aKey,
        homeAbbrev: homeT.abbreviation ?? hKey, awayAbbrev: awayT.abbreviation ?? aKey,
        homeScore: (isLive || isFinal) ? (g.teams?.home?.score ?? null) : null,
        awayScore: (isLive || isFinal) ? (g.teams?.away?.score ?? null) : null,
        isLive, isFinal,
        inning: g.linescore?.currentInning ?? null,
        isTopInning: g.linescore?.isTopInning ?? true,
        startUTC: g.gameDate, date: dateObj.date,
        venue: g.venue?.name ?? "",
        startLocal: new Date(g.gameDate).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit", timeZoneName: "short" }),
        awayPitcher: g.teams?.away?.probablePitcher?.fullName ?? "",
        homePitcher: g.teams?.home?.probablePitcher?.fullName ?? "",
        awayPitcherId: g.teams?.away?.probablePitcher?.id ?? null,
        homePitcherId: g.teams?.home?.probablePitcher?.id ?? null,
      });
    }
  }
  return games;
}

async function mlbStandings() {
  const season = new Date().getFullYear();
  const d = await fetchWithFallback(`${MLB_API}/standings?leagueId=103,104&season=${season}&hydrate=team,division&standingsTypes=regularSeason`);
  const out = {};
  for (const record of (d.records ?? [])) {
    const league = record.league?.id === 103 ? "AL" : "NL";
    const div = record.division?.name ?? "";
    for (const tr of (record.teamRecords ?? [])) {
      const team = tr.team ?? {};
      const key = MLB_TEAM_IDS[team.id] ?? teamKey(team.name ?? "");
      const gp = (tr.wins ?? 0) + (tr.losses ?? 0) || 1;
      out[key] = {
        displayName: team.name ?? "", abbrev: team.abbreviation ?? key,
        wins: tr.wins ?? 0, losses: tr.losses ?? 0, gamesPlayed: gp,
        pct: tr.winningPercentage ? parseFloat(tr.winningPercentage) : +(tr.wins / gp).toFixed(3),
        league, div, streak: tr.streak?.streakCode ?? "", gb: tr.gamesBack ?? "-",
      };
    }
  }
  return out;
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SAVANT 2026 — PA-weighted team xwOBA/xSLG → idx_2026
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchSavant2026Teams() {
  try {
    const res = await fetch('/api/savant');
    if (!res.ok) throw new Error('Savant proxy ' + res.status);
    const text = await res.text();
    if (!text || !text.includes(",")) throw new Error("Invalid CSV");
    const rows = parseCSV(text);
    const buckets = {};
    for (const row of rows) {
      const ta = (row.team ?? row.Team ?? row.team_id ?? "").toUpperCase();
      const key = SAVANT_TEAM[ta] ?? null;
      if (!key) continue;
      const pa = +row.pa || 0;
      const xwOBA = +(row.est_woba || row.xwOBA || 0);
      const xSLG = +(row.est_slg || row.xSLG || 0);
      if (pa < 1 || xwOBA <= 0) continue;
      if (!buckets[key]) buckets[key] = { xwSum: 0, xsSum: 0, pa: 0 };
      buckets[key].xwSum += xwOBA * pa;
      buckets[key].xsSum += xSLG * pa;
      buckets[key].pa += pa;
    }
    const out = {};
    const scores = [];
    for (const [key, b] of Object.entries(buckets)) {
      if (b.pa < 30) continue;
      const xwOBA = b.xwSum / b.pa;
      const xSLG = b.xsSum / b.pa;
      const score = 0.58 * xwOBA + 0.42 * xSLG;
      out[key] = { xwOBA, xSLG, pa: b.pa, score };
      scores.push(score);
    }
    if (scores.length > 5) {
      const avg = scores.reduce((a, b) => a + b, 0) / scores.length;
      for (const k of Object.keys(out)) out[k].idx2026 = out[k].score / avg;
    }
    return { data: out, error: null };
  } catch (e) {
    return { data: {}, error: e.message };
  }
}

async function fetchMLBPitchers2026() {
  try {
    const d = await fetch('/api/pitchers').then(r => r.json());
    const out = {};
    for (const block of (d.stats ?? [])) {
      for (const split of (block.splits ?? [])) {
        const name = split.player?.fullName ?? "";
        if (!name) continue;
        const s = split.stat ?? {};
        const ip = parseFloat(s.inningsPitched || 0);
        if (ip < 3) continue;
        const era = parseFloat(s.era || 0);
        const whip = parseFloat(s.whip || 0);
        const k = parseInt(s.strikeOuts || 0);
        const k9 = ip > 0 ? (k / ip) * 9 : 0;
        out[normName(name)] = { era, whip, k9, ip };
      }
    }
    return { data: out, error: null };
  } catch (e) {
    return { data: {}, error: e.message };
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  ODDS API
// ═══════════════════════════════════════════════════════════════════════════════
async function fetchOdds() {
  try {
    const r = await fetch('/api/odds');
    if (!r.ok) { const b = await r.json().catch(() => ({})); throw new Error(b.error || `Proxy ${r.status}`); }
    const { data: games, remaining, used } = await r.json();
    const map = {};
    for (const game of games) {
      const books = game.bookmakers ?? [];
      const book = ["draftkings", "fanduel", "betmgm", "pointsbetus"].map(k => books.find(b => b.key === k)).find(Boolean) ?? books[0];
      if (!book) continue;
      const mkt = {};
      for (const m of (book.markets ?? [])) {
        if (m.key === "h2h") {
          const hO = m.outcomes.find(o => o.name === game.home_team);
          const aO = m.outcomes.find(o => o.name === game.away_team);
          if (hO && aO) mkt.ml = { h: hO.price, a: aO.price };
        }
        if (m.key === "totals") {
          const ov = m.outcomes.find(o => o.name === "Over");
          const un = m.outcomes.find(o => o.name === "Under");
          if (ov && un) mkt.ou = { line: ov.point, ov: ov.price, un: un.price };
        }
      }
      map[normName(game.home_team)] = { ...mkt, book: book.title };
    }
    return { data: map, remaining: +remaining, used: +used };
  } catch (e) {
    throw e;
  }
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MODEL ENGINE — CORRECTED xR formula (matches spreadsheet with BP fix)
//
//  xR Away = 4.6 × AwayOff × AwayLineup ×
//            (0.65 × HomeSP_Blended + 0.35 × HomeBP × HomeBP_Fatigue) ×
//            Park × 0.98
//
//  xR Home = 4.6 × HomeOff × HomeLineup ×
//            (0.65 × AwaySP_Blended + 0.35 × AwayBP × AwayBP_Fatigue) ×
//            Park × 1.02
//
//  Pitcher Factor: higher = worse (allows more runs)
// ═══════════════════════════════════════════════════════════════════════════════
function runModel(awayTeam, homeTeam, awayPitcher, homePitcher, venue, blendedData = {}) {
  const aKey = teamKey(awayTeam), hKey = teamKey(homeTeam);

  // Offense indices (blended 2025/2026)
  const aOffIdx = blendedData.offense?.[aKey]?.idx ?? TEAM_OFF_2025[aKey]?.idx ?? 1.0;
  const hOffIdx = blendedData.offense?.[hKey]?.idx ?? TEAM_OFF_2025[hKey]?.idx ?? 1.0;

  // SP factors (blended season + recent form; higher = worse)
  const aSpF = blendedData.pitchers?.[normName(awayPitcher)]?.factor ?? getSPFactor2025(awayPitcher);
  const hSpF = blendedData.pitchers?.[normName(homePitcher)]?.factor ?? getSPFactor2025(homePitcher);

  // Bullpen factors (Covers-based; higher = worse) — live overrides 2025
  const aBP = blendedData.liveBP?.[aKey] ?? BULLPEN_2025[aKey] ?? 1.0;
  const hBP = blendedData.liveBP?.[hKey] ?? BULLPEN_2025[hKey] ?? 1.0;

  // BP fatigue (1.0 = avg, >1.0 = tired, capped 1.20)
  const aBPFat = blendedData.bpFatigue?.[aKey] ?? 1.0;
  const hBPFat = blendedData.bpFatigue?.[hKey] ?? 1.0;

  // Lineup strength (avg of 9 starters, 1.0 = avg)
  const aLineup = blendedData.lineups?.[aKey] ?? 1.0;
  const hLineup = blendedData.lineups?.[hKey] ?? 1.0;

  const pf = getParkFactor(venue);

  // CORRECTED: each team's offense faces the OPPOSING pitching
  const xRA = LEAGUE_AVG_RUNS * aOffIdx * aLineup * (0.65 * hSpF + 0.35 * hBP * hBPFat) * pf * 0.98;
  const xRH = LEAGUE_AVG_RUNS * hOffIdx * hLineup * (0.65 * aSpF + 0.35 * aBP * aBPFat) * pf * 1.02;

  const { away: winAway, home: winHome } = pythagorean(xRA, xRH);
  const projTotal = +(xRA + xRH).toFixed(2);
  const pRL_home = pRunLineHome(xRH, xRA, 1.5);

  return {
    xRA: +xRA.toFixed(3), xRH: +xRH.toFixed(3),
    winAway, winHome, projTotal,
    pRL_home, pRL_away: 1 - pRL_home,
    pOv: line => pOver(xRH, xRA, line),
    // All inputs for audit snapshot
    aSpF, hSpF, aBP, hBP, aBPFat, hBPFat, pf, aOffIdx, hOffIdx, aLineup, hLineup,
    aOffBlend: blendedData.offense?.[aKey],
    hOffBlend: blendedData.offense?.[hKey],
    aSpBlend: blendedData.pitchers?.[normName(awayPitcher)],
    hSpBlend: blendedData.pitchers?.[normName(homePitcher)],
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  P/L STATS CALCULATOR — split by Team Bets (ML) / Total Bets (O/U) / Overall
// ═══════════════════════════════════════════════════════════════════════════════
function calcBetStats(bets) {
  const auto = bets.filter(b => b.autoLogged);
  const settled = auto.filter(b => ["won", "lost", "push"].includes(b.status));
  const teamBets = settled.filter(b => ["ML_AWAY", "ML_HOME"].includes(b.market));
  const totalBets = settled.filter(b => ["OVER", "UNDER"].includes(b.market));

  function statsFor(subset) {
    const wins = subset.filter(b => b.status === "won").length;
    const losses = subset.filter(b => b.status === "lost").length;
    const pushes = subset.filter(b => b.status === "push").length;
    const wl = wins + losses;
    const wr = wl > 0 ? wins / wl : null;
    // 1u bets graded at opening odds
    const units = subset.reduce((sum, b) => {
      if (b.status === "won") return sum + payoutFromOdds(b.openingOdds ?? b.odds, 1);
      if (b.status === "lost") return sum - 1;
      return sum;
    }, 0);
    return { wins, losses, pushes, wl, wr, units, total: subset.length };
  }

  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  const recent = settled.filter(b => (b.settledDate ?? b.date) >= sevenDaysAgo);

  return {
    overall: statsFor(settled),
    team: statsFor(teamBets),
    totals: statsFor(totalBets),
    last7: statsFor(recent),
    pending: auto.filter(b => b.status === "pending").length,
    allAuto: auto,
  };
}

// ═══════════════════════════════════════════════════════════════════════════════
//  DESIGN TOKENS
// ═══════════════════════════════════════════════════════════════════════════════
const C = {
  bg: "#080c10", bg1: "#0d1420", bg2: "#111c2c", bg3: "#162236",
  border: "rgba(255,255,255,0.07)", borderLo: "rgba(255,255,255,0.03)",
  accent: "#ffd166", accentB: "#f4a261", accentG: "#06d6a0", accentR: "#e63946",
  text: "#eef2f7", textDim: "#7a95b5", textLo: "#3a5575", textLo2: "#24384f",
};

// ═══════════════════════════════════════════════════════════════════════════════
//  SMALL UI ATOMS
// ═══════════════════════════════════════════════════════════════════════════════
function Skel({ w = "100%", h = 14, r = 4 }) {
  return <div style={{ width: w, height: h, background: C.bg3, borderRadius: r, animation: "shimmer 1.6s infinite", flexShrink: 0 }} />;
}
function Tag({ label, color }) {
  return <span style={{ fontSize: 7, fontWeight: 700, letterSpacing: 1, padding: "2px 6px", borderRadius: 3,
    border: `1px solid ${color}`, color, textTransform: "uppercase", whiteSpace: "nowrap" }}>{label}</span>;
}
function BlendBadge({ blend }) {
  if (!blend || blend.pct === 0) return null;
  const col = blend.pct >= 25 ? "#06d6a0" : blend.pct >= 10 ? "#ffd166" : "#7a95b5";
  return <span style={{ fontSize: 7, color: col, border: `1px solid ${col}`, padding: "1px 4px", borderRadius: 3, letterSpacing: .5, whiteSpace: "nowrap" }}>{blend.label}</span>;
}
function ProbBar({ homeP, awayP }) {
  return (
    <div>
      <div style={{ position: "relative", height: 5, background: C.bg3, borderRadius: 3, margin: "5px 0 3px", overflow: "hidden" }}>
        <div style={{ position: "absolute", left: 0, top: 0, height: "100%", width: `${awayP * 100}%`,
          background: `linear-gradient(90deg,${C.accentB},${C.accent})`, borderRadius: 3 }} />
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", fontSize: 9, color: C.text }}>
        <span>{Math.round(awayP * 100)}%</span><span>{Math.round(homeP * 100)}%</span>
      </div>
    </div>
  );
}
function MktCell({ label, marketML, modelP, hasOdds }) {
  const e = hasOdds ? calcEdge(modelP, marketML) : null;
  const tier = e != null ? edgeTier(e) : null;
  const hot = e != null && e >= 2.5;
  return (
    <div style={{ flex: 1, background: hot ? "rgba(255,209,102,0.06)" : C.bg1,
      border: `1px solid ${hot ? "rgba(255,209,102,0.2)" : C.border}`,
      borderRadius: 8, padding: "9px 8px", textAlign: "center" }}>
      <div style={{ fontSize: 7, color: C.textLo, letterSpacing: 1, marginBottom: 5, textTransform: "uppercase",
        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{label}</div>
      {hasOdds
        ? <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, lineHeight: 1, color: hot ? C.accent : C.textDim }}>
            {marketML > 0 ? "+" : ""}{marketML}</div>
        : <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 22, lineHeight: 1, color: C.textLo2 }}>—</div>}
      <div style={{ fontSize: 8, color: C.textLo, marginTop: 3 }}>Model: {mlFromProb(modelP)}</div>
      {e != null && <div style={{ fontSize: 9, color: edgeColor(e), marginTop: 2, fontWeight: 600 }}>{e > 0 ? "+" : ""}{e.toFixed(1)}%</div>}
      {tier && Math.abs(e) >= 2.5 && <div style={{ display: "inline-block", fontSize: 7, color: tier.color,
        border: `1px solid ${tier.color}`, borderRadius: 3, padding: "1px 5px", marginTop: 3, fontWeight: 700 }}>{tier.label}</div>}
      {!hasOdds && <div style={{ fontSize: 7, color: C.textLo2, marginTop: 2 }}>Add API key</div>}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SCORE CARD — reusable P/L display
// ═══════════════════════════════════════════════════════════════════════════════
function ScoreCard({ label, s, color }) {
  if (s.total === 0) return null;
  return (
    <div style={{ background: C.bg3, borderRadius: 10, padding: "10px 14px", marginBottom: 8 }}>
      <div style={{ fontSize: 7.5, color: C.textLo, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>{label}</div>
      <div style={{ display: "grid", gridTemplateColumns: "repeat(3,1fr)", gap: 6 }}>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 28, lineHeight: 1,
            color: s.wins > s.losses ? C.accentG : s.wins < s.losses ? C.accentR : C.textDim }}>
            {s.wins}–{s.losses}{s.pushes > 0 ? `–${s.pushes}` : ""}
          </div>
          <div style={{ fontSize: 7.5, color: C.textLo, marginTop: 2 }}>
            W–L{s.pushes > 0 ? "–P" : ""} · {s.wr != null ? `${Math.round(s.wr * 100)}% WR` : "—"}
          </div>
        </div>
        <div style={{ textAlign: "center", borderLeft: `1px solid ${C.border}`, borderRight: `1px solid ${C.border}` }}>
          <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 28, lineHeight: 1,
            color: s.units >= 0 ? C.accentG : C.accentR }}>
            {s.units >= 0 ? "+" : ""}{s.units.toFixed(2)}u
          </div>
          <div style={{ fontSize: 7.5, color: C.textLo, marginTop: 2 }}>Units (1u @ opening)</div>
        </div>
        <div style={{ textAlign: "center" }}>
          <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 28, lineHeight: 1,
            color: s.wl > 0 ? (s.units / s.wl >= 0 ? C.accentG : C.accentR) : C.textDim }}>
            {s.wl > 0 ? `${(s.units / s.wl * 100).toFixed(1)}%` : "—"}
          </div>
          <div style={{ fontSize: 7.5, color: C.textLo, marginTop: 2 }}>ROI</div>
        </div>
      </div>
      {s.wr != null && (
        <div style={{ marginTop: 8 }}>
          <div style={{ display: "flex", justifyContent: "space-between", fontSize: 7, color: C.textLo2, marginBottom: 3 }}>
            <span>Win rate</span><span>{Math.round(s.wr * 100)}% (need 52.4% at −110)</span>
          </div>
          <div style={{ height: 4, background: C.bg2, borderRadius: 2, overflow: "hidden", position: "relative" }}>
            <div style={{ height: "100%", width: `${Math.min(s.wr * 100, 100)}%`,
              background: s.wr >= 0.524 ? C.accentG : C.accentR, borderRadius: 2 }} />
            <div style={{ position: "absolute", top: 0, left: "52.4%", width: 1, height: 4, background: C.accent, opacity: .5 }} />
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  AUTO BETS TAB — with Team / Total / Overall splits
// ═══════════════════════════════════════════════════════════════════════════════
function AutoBetsTab({ bets, onUpdate, onDelete }) {
  const [filter, setFilter] = useState("all");
  const stats = calcBetStats(bets);
  const auto = stats.allAuto;
  const shown = filter === "pending" ? auto.filter(b => b.status === "pending")
    : filter === "settled" ? auto.filter(b => b.status !== "pending") : auto;

  function settle(id, status) {
    const updated = bets.map(b => {
      if (b.id !== id) return b;
      const p = status === "won" ? payoutFromOdds(b.openingOdds ?? b.odds, 1) : status === "push" ? 0 : -1;
      return { ...b, status, payout: p, settledDate: new Date().toISOString() };
    });
    onUpdate(updated);
  }

  return (
    <div>
      {/* Header */}
      <div style={{ background: `linear-gradient(135deg,rgba(255,209,102,0.06),${C.bg1})`,
        border: `1px solid rgba(255,209,102,0.2)`, borderRadius: 13, padding: "16px", marginBottom: 14 }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 12 }}>
          <div>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 20, letterSpacing: 3, color: C.accent }}>AUTO BET LOG</div>
            <div style={{ fontSize: 7.5, color: C.textLo }}>≥2.5% edge · 1u per bet · graded at opening odds</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 28, lineHeight: 1, color: C.text }}>{auto.length}</div>
            <div style={{ fontSize: 7.5, color: C.textDim }}>total bets</div>
            {stats.pending > 0 && <div style={{ fontSize: 7.5, color: C.accentB, marginTop: 2 }}>{stats.pending} pending</div>}
          </div>
        </div>

        {stats.overall.total > 0 ? (
          <>
            <ScoreCard label="Overall (All Bets)" s={stats.overall} />
            {stats.last7.total > 0 && <ScoreCard label="Last 7 Days" s={stats.last7} />}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginTop: 4 }}>
              {stats.team.total > 0 && <ScoreCard label="Team Bets (ML)" s={stats.team} />}
              {stats.totals.total > 0 && <ScoreCard label="Total Bets (O/U)" s={stats.totals} />}
            </div>
          </>
        ) : (
          <div style={{ textAlign: "center", padding: "20px 0", color: C.textLo, fontSize: 9 }}>
            No settled auto-bets yet. Load odds to start auto-logging, then grade W/L/P below.
          </div>
        )}
      </div>

      {/* Filter + bet list */}
      {auto.length > 0 && (
        <>
          <div style={{ display: "flex", gap: 2, marginBottom: 10, background: C.bg1, borderRadius: 8, padding: 3 }}>
            {[["all", "All"], ["pending", "Pending"], ["settled", "Settled"]].map(([id, label]) => (
              <button key={id} onClick={() => setFilter(id)} style={{
                flex: 1, padding: "6px 0", border: "none", borderRadius: 6, cursor: "pointer",
                background: filter === id ? "rgba(255,209,102,0.12)" : "transparent",
                color: filter === id ? C.accent : C.textLo,
                fontSize: 8, fontWeight: 700, letterSpacing: 1, textTransform: "uppercase",
                fontFamily: "'DM Mono',monospace" }}>
                {label} ({id === "all" ? auto.length : id === "pending" ? auto.filter(b => b.status === "pending").length : auto.filter(b => b.status !== "pending").length})
              </button>
            ))}
          </div>

          {shown.map(bet => {
            const sColor = { won: C.accentG, lost: C.accentR, push: C.textDim, pending: C.accentB }[bet.status] ?? C.textDim;
            const t = edgeTier(bet.edge ?? 0);
            const betType = ["ML_AWAY", "ML_HOME"].includes(bet.market) ? "TEAM" : "TOTAL";
            return (
              <div key={bet.id} style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 10, padding: "11px 14px", marginBottom: 8 }}>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", gap: 5, alignItems: "center", flexWrap: "wrap", marginBottom: 4 }}>
                      <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 14, color: C.text, letterSpacing: 1 }}>{bet.game}</span>
                      <Tag label={t.label} color={t.color} />
                      <Tag label={betType} color={betType === "TEAM" ? "#7ec8e3" : "#c49bff"} />
                      <Tag label={bet.status.toUpperCase()} color={sColor} />
                    </div>
                    <div style={{ fontSize: 9, color: C.textDim, marginBottom: 2 }}>
                      <span style={{ color: C.text }}>{bet.pick} </span>
                      <span style={{ color: bet.odds > 0 ? C.accent : C.textDim }}>{bet.odds > 0 ? "+" : ""}{bet.odds}</span>
                      <span style={{ color: C.textLo }}> · 1u · </span>
                      <span style={{ color: edgeColor(bet.edge ?? 0) }}>{(bet.edge ?? 0).toFixed(1)}% edge</span>
                      {bet.modelP != null && <span style={{ color: C.textLo }}> · model {Math.round(bet.modelP * 100)}%</span>}
                    </div>
                    <div style={{ fontSize: 7.5, color: C.textLo2 }}>
                      {new Date(bet.date).toLocaleDateString("en-US", { month: "short", day: "numeric" })}
                      {bet.openingOdds && bet.closingOdds && bet.openingOdds !== bet.closingOdds &&
                        ` · Open: ${bet.openingOdds > 0 ? "+" : ""}${bet.openingOdds} → Close: ${bet.closingOdds > 0 ? "+" : ""}${bet.closingOdds}`}
                      {bet.notes && ` · ${bet.notes}`}
                    </div>
                  </div>
                  <div style={{ textAlign: "right", minWidth: 80 }}>
                    {bet.payout != null && (
                      <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 20,
                        color: bet.status === "won" ? C.accentG : bet.status === "lost" ? C.accentR : C.textDim }}>
                        {bet.payout >= 0 ? "+" : ""}{bet.payout.toFixed(2)}u
                      </div>
                    )}
                    {bet.status === "pending" && (
                      <div style={{ fontSize: 7.5, color: C.accentB, marginTop: 4, fontStyle: "italic" }}>Auto-grades at 11:30 PM</div>
                    )}
                    <button onClick={() => onDelete(bet.id)} style={{ marginTop: 4, background: "transparent",
                      border: "none", cursor: "pointer", color: C.textLo2, fontSize: 9 }}>✕</button>
                  </div>
                </div>
              </div>
            );
          })}
        </>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  GAME CARD
// ═══════════════════════════════════════════════════════════════════════════════
function GameCard({ game, standings, oddsEntry, blendedData }) {
  const [modelOpen, setModelOpen] = useState(false);
  const model = runModel(game.away, game.home, game.awayPitcher, game.homePitcher, game.venue, blendedData);
  const hasOdds = !!oddsEntry;
  const pOv = oddsEntry?.ou ? model.pOv(oddsEntry.ou.line) : model.pOv(model.projTotal);
  const pUn = 1 - pOv;
  const edges = hasOdds ? {
    mlH: oddsEntry.ml ? calcEdge(model.winHome, oddsEntry.ml.h) : -99,
    mlA: oddsEntry.ml ? calcEdge(model.winAway, oddsEntry.ml.a) : -99,
    ov: oddsEntry.ou ? calcEdge(pOv, oddsEntry.ou.ov) : -99,
    un: oddsEntry.ou ? calcEdge(pUn, oddsEntry.ou.un) : -99,
  } : {};
  const topEdge = hasOdds ? Math.max(...Object.values(edges)) : 0;
  const topTier = edgeTier(topEdge);
  const hS = standings[game.homeKey], aS = standings[game.awayKey];
  const hA = game.homeAbbrev, aA = game.awayAbbrev;

  return (
    <div style={{ background: `linear-gradient(150deg,${C.bg1},${C.bg})`,
      border: `1px solid ${topEdge >= 2.5 ? "rgba(255,209,102,0.25)" : C.border}`,
      borderRadius: 14, marginBottom: 14, overflow: "hidden",
      boxShadow: topEdge >= 4 ? "0 0 28px rgba(255,209,102,0.07)" : "none" }}>

      {/* Header */}
      <div style={{ padding: "13px 17px 11px", borderBottom: `1px solid ${C.borderLo}` }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 9 }}>
          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap" }}>
            <span style={{ fontSize: 8, color: C.textDim, letterSpacing: 1 }}>{game.startLocal}</span>
            {game.venue && <span style={{ fontSize: 7, color: C.textLo }}>{game.venue}</span>}
          </div>
          <div style={{ display: "flex", gap: 6, alignItems: "center" }}>
            {hasOdds && oddsEntry.book && <span style={{ fontSize: 7, color: C.textLo2 }}>{oddsEntry.book}</span>}
            {topEdge >= 2.5 && <Tag label={topTier.label} color={topTier.color} />}
          </div>
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr auto 1fr", gap: 10, alignItems: "center" }}>
          <div>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 32, letterSpacing: 2, color: C.text, lineHeight: 1 }}>{aA}</div>
            <div style={{ fontSize: 8, color: C.textDim }}>{game.away}</div>
            {game.awayPitcher && <div style={{ fontSize: 7.5, color: C.textLo, marginTop: 2 }}>🎯 {game.awayPitcher}</div>}
            {aS && <div style={{ fontSize: 7.5, color: C.textLo, marginTop: 2 }}>{aS.wins}–{aS.losses}</div>}
          </div>
          <div style={{ textAlign: "center", minWidth: 90 }}>
            <div style={{ fontSize: 7, color: C.textLo2, letterSpacing: 3, marginBottom: 4 }}>AT</div>
            <ProbBar homeP={model.winHome} awayP={model.winAway} />
            <div style={{ fontSize: 7.5, color: C.textLo, marginTop: 4 }}>xR {model.xRA.toFixed(2)}–{model.xRH.toFixed(2)}</div>
            <div style={{ fontSize: 7, color: C.textLo2 }}>Proj {model.projTotal}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 32, letterSpacing: 2, color: C.text, lineHeight: 1 }}>{hA}</div>
            <div style={{ fontSize: 8, color: C.textDim }}>{game.home}</div>
            {game.homePitcher && <div style={{ fontSize: 7.5, color: C.textLo, marginTop: 2 }}>{game.homePitcher} 🎯</div>}
            {hS && <div style={{ fontSize: 7.5, color: C.textLo, marginTop: 2 }}>{hS.wins}–{hS.losses}</div>}
          </div>
        </div>
      </div>

      {/* Markets — ML + O/U only (no RL per user request) */}
      <div style={{ padding: "11px 13px 9px", borderBottom: `1px solid ${C.borderLo}` }}>
        <div style={{ fontSize: 7, color: C.textLo2, letterSpacing: 2, textTransform: "uppercase", marginBottom: 5 }}>Moneyline</div>
        <div style={{ display: "flex", gap: 5, marginBottom: 9 }}>
          <MktCell label={aA} marketML={oddsEntry?.ml?.a} modelP={model.winAway} hasOdds={hasOdds && !!oddsEntry?.ml} />
          <MktCell label={hA} marketML={oddsEntry?.ml?.h} modelP={model.winHome} hasOdds={hasOdds && !!oddsEntry?.ml} />
        </div>
        <div style={{ fontSize: 7, color: C.textLo2, letterSpacing: 2, textTransform: "uppercase", marginBottom: 5 }}>
          Over / Under · {oddsEntry?.ou?.line ?? `~${model.projTotal}`}
        </div>
        <div style={{ display: "flex", gap: 5 }}>
          <MktCell label={`O ${oddsEntry?.ou?.line ?? model.projTotal}`} marketML={oddsEntry?.ou?.ov} modelP={pOv} hasOdds={hasOdds && !!oddsEntry?.ou} />
          <MktCell label={`U ${oddsEntry?.ou?.line ?? model.projTotal}`} marketML={oddsEntry?.ou?.un} modelP={pUn} hasOdds={hasOdds && !!oddsEntry?.ou} />
        </div>
      </div>

      {/* Auto flags */}
      {hasOdds && (() => {
        const betOpts = [
          ...(edges.mlA >= 2.5 ? [{ label: `${aA} ML`, edge: edges.mlA }] : []),
          ...(edges.mlH >= 2.5 ? [{ label: `${hA} ML`, edge: edges.mlH }] : []),
          ...(edges.ov >= 2.5 ? [{ label: `O ${oddsEntry.ou?.line}`, edge: edges.ov }] : []),
          ...(edges.un >= 2.5 ? [{ label: `U ${oddsEntry.ou?.line}`, edge: edges.un }] : []),
        ].sort((a, b) => b.edge - a.edge);
        if (!betOpts.length) return null;
        return (
          <div style={{ padding: "8px 13px", display: "flex", gap: 6, flexWrap: "wrap", alignItems: "center",
            background: "rgba(255,209,102,0.03)", borderBottom: `1px solid ${C.borderLo}` }}>
            <span style={{ fontSize: 8, color: C.accent, letterSpacing: 1 }}>✓ AUTO</span>
            {betOpts.map(b => {
              const t = edgeTier(b.edge);
              return (
                <div key={b.label} style={{ background: C.bg3, border: `1px solid ${t.color}`,
                  borderRadius: 6, padding: "3px 9px", color: t.color, fontSize: 8,
                  fontFamily: "'DM Mono',monospace", fontWeight: 700 }}>
                  {b.label} <span style={{ opacity: .65, fontWeight: 400, marginLeft: 4 }}>{b.edge.toFixed(1)}%</span>
                </div>
              );
            })}
          </div>
        );
      })()}

      {/* Model inputs toggle */}
      <div onClick={() => setModelOpen(!modelOpen)}
        style={{ padding: "8px 17px", cursor: "pointer", display: "flex",
          justifyContent: "space-between", alignItems: "center", background: "rgba(0,0,0,0.2)" }}>
        <span style={{ fontSize: 8, color: C.textDim, letterSpacing: 1.2, textTransform: "uppercase" }}>⚾ Model Inputs</span>
        <span style={{ color: C.textLo2, fontSize: 8 }}>{modelOpen ? "▲" : "▼"}</span>
      </div>
      {modelOpen && (
        <div style={{ padding: "12px 17px", background: `${C.bg}dd` }}>
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
            {[
              { label: `${aA} Offense`, val: model.aOffIdx.toFixed(3), note: model.aOffBlend?.label ?? "2025 only" },
              { label: `${hA} Offense`, val: model.hOffIdx.toFixed(3), note: model.hOffBlend?.label ?? "2025 only" },
              { label: game.awayPitcher || "Away SP", val: model.aSpF.toFixed(3), note: `${model.aSpBlend?.label ?? "2025 only"} (↑=worse)` },
              { label: game.homePitcher || "Home SP", val: model.hSpF.toFixed(3), note: `${model.hSpBlend?.label ?? "2025 only"} (↑=worse)` },
              { label: "Away BP (Covers)", val: model.aBP.toFixed(3), note: `Fatigue: ${model.aBPFat.toFixed(2)}` },
              { label: "Home BP (Covers)", val: model.hBP.toFixed(3), note: `Fatigue: ${model.hBPFat.toFixed(2)}` },
              { label: "Away Lineup", val: model.aLineup.toFixed(3), note: "Avg 9 starters" },
              { label: "Home Lineup", val: model.hLineup.toFixed(3), note: "Avg 9 starters" },
              { label: "Park Factor", val: model.pf.toFixed(2), note: game.venue || "—" },
              { label: "Proj Total", val: model.projTotal.toString(), note: `xR ${model.xRA.toFixed(2)} + ${model.xRH.toFixed(2)}` },
            ].map(r => (
              <div key={r.label} style={{ background: C.bg3, borderRadius: 7, padding: "8px 10px" }}>
                <div style={{ fontSize: 7, color: C.textLo, marginBottom: 3, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{r.label}</div>
                <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, color: C.text, lineHeight: 1 }}>{r.val}</div>
                <div style={{ fontSize: 7, color: C.textLo2, marginTop: 2 }}>{r.note}</div>
              </div>
            ))}
          </div>
          <div style={{ marginTop: 8, fontSize: 7.5, color: C.textLo2, lineHeight: 1.7, borderTop: `1px solid ${C.bg3}`, paddingTop: 8 }}>
            xR_Away = 4.6 × AwayOff × AwayLineup × (0.65×HomeSP + 0.35×HomeBP×HomeFat) × Park × 0.98<br />
            xR_Home = 4.6 × HomeOff × HomeLineup × (0.65×AwaySP + 0.35×AwayBP×AwayFat) × Park × 1.02<br />
            Win% = xR^1.83 Pythagorean · Higher pitcher factor = worse (more runs allowed)
          </div>
        </div>
      )}
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  LIVE CARD
// ═══════════════════════════════════════════════════════════════════════════════
function LiveCard({ game, standings, blendedData }) {
  const model = runModel(game.away, game.home, game.awayPitcher, game.homePitcher, game.venue, blendedData);
  const hWin = (game.homeScore ?? 0) > (game.awayScore ?? 0);
  const tied = game.homeScore === game.awayScore;
  const inning = game.inning ? (game.isTopInning ? "▲" : "▼") + game.inning : "LIVE";
  return (
    <div style={{ background: `linear-gradient(135deg,rgba(6,214,160,0.04),${C.bg1} 80%)`,
      border: "1px solid rgba(6,214,160,0.2)", borderRadius: 13, padding: "14px 17px", marginBottom: 10 }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 10 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <div style={{ width: 7, height: 7, borderRadius: "50%", background: C.accentG,
            boxShadow: `0 0 8px ${C.accentG}`, animation: "pulse 1.5s infinite" }} />
          <span style={{ fontSize: 8, fontWeight: 700, color: C.accentG, letterSpacing: 2 }}>LIVE · {inning}</span>
        </div>
        <span style={{ fontSize: 7.5, color: C.textLo }}>Proj {model.projTotal} · {game.venue}</span>
      </div>
      <div style={{ display: "flex", alignItems: "center" }}>
        <div style={{ flex: 1 }}>
          <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 26, letterSpacing: 2, color: C.text }}>{game.awayAbbrev}</div>
          <div style={{ fontSize: 8, color: C.textDim }}>{game.away}</div>
        </div>
        <div style={{ flex: 1.3, textAlign: "center" }}>
          <div style={{ display: "flex", justifyContent: "center", alignItems: "baseline", gap: 8 }}>
            <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 52, lineHeight: 1,
              color: tied ? C.text : !hWin ? C.accent : "#3a5566" }}>{game.awayScore ?? "-"}</span>
            <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 20, color: C.textLo2 }}>—</span>
            <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 52, lineHeight: 1,
              color: tied ? C.text : hWin ? C.accent : "#3a5566" }}>{game.homeScore ?? "-"}</span>
          </div>
          <ProbBar homeP={model.winHome} awayP={model.winAway} />
        </div>
        <div style={{ flex: 1, textAlign: "right" }}>
          <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 26, letterSpacing: 2, color: C.text }}>{game.homeAbbrev}</div>
          <div style={{ fontSize: 8, color: C.textDim }}>{game.home}</div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  SETTINGS
// ═══════════════════════════════════════════════════════════════════════════════
function SettingsPanel({ settings, onSave, onFetchOdds, oddsStatus, oddsInfo, mlbStatus, savantStatus, pitcherStatus, blendedData, onRefreshSavant, onRefreshPitchers }) {
  const [local, setLocal] = useState(settings);
  const blendingTeams = Object.values(blendedData.offense ?? {}).filter(b => b.pct > 0).length;
  const blendingPitchers = Object.values(blendedData.pitchers ?? {}).filter(b => b.pct > 0).length;
  return (
    <div>
      <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px", marginBottom: 12 }}>
        <div style={{ fontSize: 8, color: C.textDim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 12 }}>The Odds API</div>
        <button onClick={() => onFetchOdds()}
          style={{ width: "100%", background: "rgba(255,209,102,0.1)", border: `1px solid ${C.accent}`, borderRadius: 7,
            padding: "10px 14px", color: C.accent, cursor: "pointer", fontSize: 9, fontWeight: 700,
            letterSpacing: 1, fontFamily: "'DM Mono',monospace" }}>↻ REFRESH ODDS</button>
        {oddsStatus && <div style={{ fontSize: 8.5, color: oddsStatus.startsWith("✓") ? C.accentG : C.accentR, marginTop: 8 }}>{oddsStatus}</div>}
        {oddsInfo?.remaining != null && <div style={{ fontSize: 7.5, color: C.textLo, marginTop: 3 }}>{oddsInfo.remaining} requests remaining · API key secured server-side</div>}
      </div>

      <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px", marginBottom: 12 }}>
        <div style={{ fontSize: 8, color: C.textDim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>Refresh Schedule (CT)</div>
        <div style={{ fontSize: 8, color: C.textDim, lineHeight: 2, fontFamily: "'DM Mono',monospace",
          background: C.bg, borderRadius: 8, padding: "12px" }}>
          <div><span style={{ color: C.accent }}>8:00 AM</span> — Full refresh (schedule, odds, model, Savant, pitchers)</div>
          <div><span style={{ color: C.accentB }}>~30min pre-pitch</span> — Lineups + odds refresh per game window</div>
          <div><span style={{ color: C.accentB }}>~5min pre-pitch</span> — Closing odds capture</div>
          <div><span style={{ color: C.accentG }}>11:30 PM</span> — Auto-grade bets from MLB final scores</div>
        </div>
        <div style={{ marginTop: 6, fontSize: 7.5, color: C.textLo2 }}>
          Game windows grouped by 60min clusters. Triggers created dynamically each morning.
        </div>
      </div>

      <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px", marginBottom: 12 }}>
        <div style={{ fontSize: 8, color: C.textDim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>Google Sheets Audit Log</div>
        <div style={{ fontSize: 8.5, color: C.textDim, lineHeight: 1.8 }}>
          <span style={{ color: C.accent }}>Status:</span> Will be connected during deployment<br />
          Each flagged bet logs: date, matchup, pick, market, opening/closing odds, model prob,
          edge%, all model inputs (offense idx, SP factor, BP factor, BP fatigue, lineup strength,
          park factor, xRA, xRH, projected total), result, and P/L.
        </div>
      </div>

      <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px", marginBottom: 12 }}>
        <div style={{ fontSize: 8, color: C.textDim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 10 }}>Blend Status</div>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <div style={{ background: C.bg3, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 7.5, color: C.textDim, marginBottom: 4 }}>Team Offense</div>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 24, color: savantStatus === "live" ? C.accentG : C.accentB, lineHeight: 1 }}>{blendingTeams}/30</div>
            <div style={{ fontSize: 7.5, marginTop: 4, color: savantStatus === "live" ? C.accentG : C.accentB }}>
              {savantStatus === "live" ? "🟢 Savant loaded" : "🟡 Loading…"}</div>
          </div>
          <div style={{ background: C.bg3, borderRadius: 8, padding: "10px 12px" }}>
            <div style={{ fontSize: 7.5, color: C.textDim, marginBottom: 4 }}>Pitcher Blend</div>
            <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 24, color: pitcherStatus === "live" ? C.accentG : C.accentB, lineHeight: 1 }}>{blendingPitchers}</div>
            <div style={{ fontSize: 7.5, marginTop: 4, color: pitcherStatus === "live" ? C.accentG : C.accentB }}>
              {pitcherStatus === "live" ? "🟢 MLB stats loaded" : "🟡 Loading…"}</div>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, marginTop: 8 }}>
          <button onClick={onRefreshSavant} style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px",
            color: C.textDim, cursor: "pointer", fontSize: 8, fontFamily: "'DM Mono',monospace" }}>↻ Refresh Savant</button>
          <button onClick={onRefreshPitchers} style={{ flex: 1, background: C.bg, border: `1px solid ${C.border}`, borderRadius: 7, padding: "8px",
            color: C.textDim, cursor: "pointer", fontSize: 8, fontFamily: "'DM Mono',monospace" }}>↻ Refresh Pitchers</button>
        </div>
      </div>

      <div style={{ background: C.bg1, border: `1px solid ${C.border}`, borderRadius: 12, padding: "16px" }}>
        <div style={{ fontSize: 8, color: C.textDim, letterSpacing: 2, textTransform: "uppercase", marginBottom: 8 }}>Model Formula</div>
        <div style={{ fontSize: 8, color: C.textDim, lineHeight: 2, fontFamily: "'DM Mono',monospace",
          background: C.bg, borderRadius: 8, padding: "12px", overflowX: "auto" }}>
          <div style={{ color: C.textLo, marginBottom: 4 }}>// Corrected — each offense faces OPPOSING pitching</div>
          <div>xR_Away = 4.6 × <span style={{ color: C.accent }}>AwayOff</span> × <span style={{ color: "#7ec8e3" }}>AwayLineup</span> × (0.65 × <span style={{ color: C.accentB }}>HomeSP</span> + 0.35 × <span style={{ color: C.accentG }}>HomeBP</span> × <span style={{ color: "#c49bff" }}>HomeFat</span>) × <span style={{ color: "#a78bfa" }}>Park</span> × 0.98</div>
          <div>xR_Home = 4.6 × <span style={{ color: C.accent }}>HomeOff</span> × <span style={{ color: "#7ec8e3" }}>HomeLineup</span> × (0.65 × <span style={{ color: C.accentB }}>AwaySP</span> + 0.35 × <span style={{ color: C.accentG }}>AwayBP</span> × <span style={{ color: "#c49bff" }}>AwayFat</span>) × <span style={{ color: "#a78bfa" }}>Park</span> × 1.02</div>
          <div style={{ marginTop: 6 }}>Win% = xR^1.83 / (xRA^1.83 + xRH^1.83)  ← Pythagorean</div>
          <div style={{ marginTop: 4, color: C.textLo }}>// Pitcher factor: higher = worse (more runs)</div>
          <div>SP = 0.50×(ERA/4.20) + 0.25×(WHIP/1.30) + 0.25×(9/K9)</div>
          <div style={{ marginTop: 4, color: C.textLo }}>// Edge thresholds</div>
          <div>BET ≥ 4.0%  ·  LEAN ≥ 2.5%  ·  PASS below 2.5%</div>
        </div>
      </div>
    </div>
  );
}

// ═══════════════════════════════════════════════════════════════════════════════
//  MAIN APP
// ═══════════════════════════════════════════════════════════════════════════════
export default function MLBEdgePro() {
  const [games, setGames] = useState([]);
  const [standings, setStandings] = useState({});
  const [oddsMap, setOddsMap] = useState({});
  const [savant2026, setSavant2026] = useState({});
  const [pitchers2026, setPitchers2026] = useState({});
  const [coversBP, setCoversBP] = useState({});
  const [bpFatigue, setBpFatigue] = useState({});
  const [bets, setBets] = useState([]);
  const [settings, setSettings] = useState({});
  const [oddsStatus, setOddsStatus] = useState("");
  const [oddsInfo, setOddsInfo] = useState({});
  const [mlbStatus, setMlbStatus] = useState("loading");
  const [savantStatus, setSavantStatus] = useState("loading");
  const [pitcherStatus, setPitcherStatus] = useState("loading");
  const [bpStatus, setBpStatus] = useState("loading");
  const [loading, setLoading] = useState(true);
  const [mlbError, setMlbError] = useState(null);
  const [tab, setTab] = useState("games");
  const autoLogRef = useRef(new Set());
  const refreshRef = useRef(null);

  const blendedData = useMemo(() => {
    const offense = {}, pitchers = {};
    for (const key of Object.keys(TEAM_OFF_2025)) offense[key] = blendOffenseIndex(key, savant2026);
    for (const name of Object.keys(SP_DB_2025)) pitchers[name] = blendSPFactor(name, pitchers2026);
    for (const [name, sp] of Object.entries(pitchers2026))
      if (!pitchers[name]) pitchers[name] = { factor: calcPitcherFactor(sp), pct: 100, label: "2026 only" };
    // Merge Covers bullpen factors (override 2025 hardcoded values when available)
    const liveBP = {};
    for (const [key, data] of Object.entries(coversBP)) {
      liveBP[key] = data.factor;
    }
    return { offense, pitchers, bpFatigue, lineups: {}, liveBP };
  }, [savant2026, pitchers2026, coversBP, bpFatigue]);

  useEffect(() => {
    const b = memGet("mlb-edge:bets") ?? [];
    const s = memGet("mlb-edge:settings") ?? {};
    setBets(b); setSettings(s);
    handleFetchOdds();
    loadMLB();
    loadSavant();
    loadPitchers();
    loadBullpen();
    loadFatigue();
    refreshRef.current = setInterval(loadMLB, 45000);
    return () => clearInterval(refreshRef.current);
  }, []);

  async function loadMLB() {
    try {
      const [gms, stand] = await Promise.all([mlbSchedule(), mlbStandings()]);
      setGames(gms); setStandings(stand);
      setMlbStatus("live"); setMlbError(null);
    } catch (e) { setMlbStatus("error"); setMlbError(e.message); }
    finally { setLoading(false); }
  }
  async function loadSavant() {
    setSavantStatus("loading");
    const { data } = await fetchSavant2026Teams();
    if (Object.keys(data).length > 0) { setSavant2026(data); setSavantStatus("live"); }
    else setSavantStatus("error");
  }
  async function loadPitchers() {
    setPitcherStatus("loading");
    const { data } = await fetchMLBPitchers2026();
    if (Object.keys(data).length > 0) { setPitchers2026(data); setPitcherStatus("live"); }
    else setPitcherStatus("error");
  }
  async function loadBullpen() {
    setBpStatus("loading");
    try {
      const res = await fetch('/api/bullpen');
      if (!res.ok) throw new Error('Bullpen proxy ' + res.status);
      const { teams } = await res.json();
      if (teams && Object.keys(teams).length > 0) { setCoversBP(teams); setBpStatus("live"); }
      else setBpStatus("error");
    } catch { setBpStatus("error"); }
  }
  async function loadFatigue() {
    try {
      const res = await fetch('/api/fatigue');
      if (!res.ok) return;
      const { fatigue } = await res.json();
      if (fatigue && Object.keys(fatigue).length > 0) {
        const map = {};
        for (const [key, data] of Object.entries(fatigue)) {
          map[key] = data.fatigueFactor ?? 1.0;
        }
        setBpFatigue(map);
      }
    } catch {}
  }
  async function handleFetchOdds() {
    setOddsStatus("Fetching odds…");
    try {
      const { data, remaining, used } = await fetchOdds();
      setOddsMap(data); setOddsInfo({ remaining, used });
      setOddsStatus(`✓ ${Object.keys(data).length} games loaded`);
    } catch (e) { setOddsStatus(`Error: ${e.message}`); }
  }
  function handleSaveSettings(s) { setSettings(s); memSet("mlb-edge:settings", s); }
  function handleUpdateBets(b) { setBets(b); memSet("mlb-edge:bets", b); }
  function handleDeleteBet(id) { const u = bets.filter(b => b.id !== id); setBets(u); memSet("mlb-edge:bets", u); }

  function getOdds(game) {
    const e = oddsMap[normName(game.home)];
    if (e) return e;
    for (const [k, v] of Object.entries(oddsMap)) {
      const words = normName(game.home).split(" ");
      if (words.some(w => w.length > 3 && k.includes(w))) return v;
    }
    return null;
  }

  // Auto-log bets with ≥2.5% edge (ML + O/U only, with full model snapshot)
  useEffect(() => {
    if (!games.length || !Object.keys(oddsMap).length) return;
    const upcoming = games.filter(g => !g.isLive && !g.isFinal);
    const newBets = [];
    for (const game of upcoming) {
      const odds = getOdds(game);
      if (!odds) continue;
      const model = runModel(game.away, game.home, game.awayPitcher, game.homePitcher, game.venue, blendedData);
      const pOv = odds.ou ? model.pOv(odds.ou.line) : null;
      const pUn = pOv != null ? 1 - pOv : null;
      const candidates = [
        odds.ml && { market: "ML_AWAY", label: `${game.awayAbbrev} ML`, odds: odds.ml.a, modelP: model.winAway, edge: calcEdge(model.winAway, odds.ml.a) },
        odds.ml && { market: "ML_HOME", label: `${game.homeAbbrev} ML`, odds: odds.ml.h, modelP: model.winHome, edge: calcEdge(model.winHome, odds.ml.h) },
        (odds.ou && pOv != null) && { market: "OVER", label: `O ${odds.ou.line}`, odds: odds.ou.ov, modelP: pOv, edge: calcEdge(pOv, odds.ou.ov) },
        (odds.ou && pUn != null) && { market: "UNDER", label: `U ${odds.ou.line}`, odds: odds.ou.un, modelP: pUn, edge: calcEdge(pUn, odds.ou.un) },
      ].filter(Boolean).filter(c => c.edge >= 2.5);

      for (const c of candidates) {
        const key = `${game.id}-${c.market}`;
        if (autoLogRef.current.has(key)) continue;
        autoLogRef.current.add(key);
        newBets.push({
          id: uid(), date: new Date().toISOString(),
          game: `${game.awayAbbrev} @ ${game.homeAbbrev}`,
          gameId: game.id, gameDate: game.date, market: c.market, pick: c.label,
          odds: c.odds, openingOdds: c.odds, closingOdds: null,
          stake: 1, modelP: c.modelP, marketImplied: impliedFromML(c.odds),
          edge: +c.edge.toFixed(2), status: "pending", payout: null,
          // Full model snapshot for Google Sheets audit
          snapshot: {
            awayOff: model.aOffIdx, homeOff: model.hOffIdx,
            awaySP: model.aSpF, homeSP: model.hSpF,
            awayBP: model.aBP, homeBP: model.hBP,
            awayBPFat: model.aBPFat, homeBPFat: model.hBPFat,
            awayLineup: model.aLineup, homeLineup: model.hLineup,
            parkFactor: model.pf, xRA: model.xRA, xRH: model.xRH,
            projTotal: model.projTotal, winProbAway: model.winAway,
          },
          notes: `${game.awayPitcher || "?"} vs ${game.homePitcher || "?"} · PF${model.pf.toFixed(2)}`,
          autoLogged: true,
        });
      }
    }
    if (newBets.length > 0) {
      setBets(prev => {
        const existing = new Set(prev.map(b => `${b.gameId}-${b.market}`));
        const fresh = newBets.filter(b => !existing.has(`${b.gameId}-${b.market}`));
        if (!fresh.length) return prev;
        const updated = [...fresh, ...prev]; memSet("mlb-edge:bets", updated); return updated;
      });
    }
  }, [oddsMap, games, blendedData]);

  const today = new Date().toISOString().slice(0, 10);
  const twoDaysOut = new Date(Date.now() + 2 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const liveGames = games.filter(g => g.isLive);
  const todayGames = games.filter(g => !g.isLive && !g.isFinal && g.date === today);
  const futureGames = games.filter(g => !g.isLive && !g.isFinal && g.date > today && g.date <= twoDaysOut && g.awayPitcher && g.homePitcher);
  const recentGames = games.filter(g => g.isFinal).slice(-10).reverse();
  const stats = calcBetStats(bets);

  // Best bets: today + upcoming games with ≥2.5% edge, sorted by top edge
  const bestBets = useMemo(() => {
    const eligible = [...todayGames, ...futureGames];
    const picks = [];
    for (const game of eligible) {
      const odds = getOdds(game);
      if (!odds) continue;
      const model = runModel(game.away, game.home, game.awayPitcher, game.homePitcher, game.venue, blendedData);
      const pOv = odds.ou ? model.pOv(odds.ou.line) : null;
      const pUn = pOv != null ? 1 - pOv : null;
      const candidates = [
        odds.ml && { game, label: `${game.awayAbbrev} ML`, odds: odds.ml.a, modelP: model.winAway, edge: calcEdge(model.winAway, odds.ml.a), market: "ML" },
        odds.ml && { game, label: `${game.homeAbbrev} ML`, odds: odds.ml.h, modelP: model.winHome, edge: calcEdge(model.winHome, odds.ml.h), market: "ML" },
        (odds.ou && pOv != null) && { game, label: `O ${odds.ou.line}`, odds: odds.ou.ov, modelP: pOv, edge: calcEdge(pOv, odds.ou.ov), market: "O/U" },
        (odds.ou && pUn != null) && { game, label: `U ${odds.ou.line}`, odds: odds.ou.un, modelP: pUn, edge: calcEdge(pUn, odds.ou.un), market: "O/U" },
      ].filter(Boolean).filter(c => c.edge >= 2.5);
      picks.push(...candidates);
    }
    return picks.sort((a, b) => b.edge - a.edge);
  }, [todayGames, futureGames, oddsMap, blendedData]);

  const TABS = [
    { id: "games", label: `Games (${liveGames.length + todayGames.length})` },
    { id: "best", label: `Best Bets${bestBets.length > 0 ? ` (${bestBets.length})` : ""}` },
    { id: "upcoming", label: `Upcoming (${futureGames.length})` },
    { id: "results", label: "Results" },
    { id: "auto", label: `Log${stats.pending > 0 ? ` (${stats.pending})` : ""}` },
    { id: "settings", label: "Settings" },
  ];

  return (
    <div style={{ minHeight: "100vh", background: C.bg, color: C.text, fontFamily: "'DM Mono','Courier New',monospace", paddingBottom: 60 }}>
      {/* HEADER */}
      <div style={{ background: `linear-gradient(180deg,${C.bg1},${C.bg})`, position: "sticky", top: 0, zIndex: 200,
        borderBottom: "1px solid rgba(255,209,102,0.1)", padding: "18px 16px 14px" }}>
        <div style={{ maxWidth: 600, margin: "0 auto" }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
            <div>
              <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 36, letterSpacing: 7, lineHeight: 1,
                background: `linear-gradient(90deg,${C.accentB},${C.accent})`,
                WebkitBackgroundClip: "text", WebkitTextFillColor: "transparent" }}>MLB EDGE PRO</div>
              <div style={{ fontSize: 7.5, color: C.textLo, letterSpacing: 2.5, textTransform: "uppercase", marginTop: 2 }}>
                Corrected Model · Lineup Strength · Auto-Log · Audit Trail
              </div>
            </div>
            <div style={{ textAlign: "right", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 5 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                {liveGames.length > 0 && <>
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: C.accentG,
                    boxShadow: `0 0 6px ${C.accentG}`, animation: "pulse 1.5s infinite" }} />
                  <span style={{ fontSize: 7.5, color: C.accentG, letterSpacing: 1.5 }}>{liveGames.length} LIVE</span>
                </>}
                <button onClick={loadMLB} style={{ background: "rgba(255,209,102,0.08)",
                  border: `1px solid rgba(255,209,102,0.2)`, borderRadius: 5, padding: "3px 9px",
                  color: C.accent, cursor: "pointer", fontSize: 7.5, fontFamily: "'DM Mono',monospace" }}>↻</button>
              </div>
              <div style={{ display: "flex", gap: 5 }}>
                <span style={{ fontSize: 7, color: mlbStatus === "live" ? C.accentG : C.accentR }}>
                  {mlbStatus === "live" ? "🟢" : "🔴"} MLB</span>
                <span style={{ fontSize: 7, color: Object.keys(oddsMap).length > 0 ? C.accentG : C.textLo }}>
                  {Object.keys(oddsMap).length > 0 ? "🟢" : "🔴"} ODDS</span>
                <span style={{ fontSize: 7, color: savantStatus === "live" ? C.accentG : C.accentB }}>
                  {savantStatus === "live" ? "🟢" : "🟡"} SAV</span>
                <span style={{ fontSize: 7, color: bpStatus === "live" ? C.accentG : C.accentB }}>
                  {bpStatus === "live" ? "🟢" : "🟡"} BP</span>
              </div>
            </div>
          </div>
          {/* Live P/L strip */}
          {stats.overall.total > 0 && (
            <div style={{ marginTop: 10, background: "rgba(255,209,102,0.05)", border: "1px solid rgba(255,209,102,0.15)",
              borderRadius: 8, padding: "8px 12px" }}>
              <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap" }}>
                <span style={{ fontSize: 7.5, color: C.accent, fontWeight: 700, letterSpacing: 1 }}>SEASON</span>
                <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 14, color: C.text }}>
                  {stats.overall.wins}–{stats.overall.losses}
                </span>
                <span style={{ fontSize: 9, fontWeight: 700, color: stats.overall.units >= 0 ? C.accentG : C.accentR }}>
                  {stats.overall.units >= 0 ? "+" : ""}{stats.overall.units.toFixed(2)}u
                </span>
                {stats.team.total > 0 && <span style={{ fontSize: 7.5, color: stats.team.units >= 0 ? C.accentG : C.accentR }}>
                  ML {stats.team.units >= 0 ? "+" : ""}{stats.team.units.toFixed(2)}u
                </span>}
                {stats.totals.total > 0 && <span style={{ fontSize: 7.5, color: stats.totals.units >= 0 ? C.accentG : C.accentR }}>
                  O/U {stats.totals.units >= 0 ? "+" : ""}{stats.totals.units.toFixed(2)}u
                </span>}
              </div>
              {(stats.last7.total > 0 || stats.pending > 0) && (
                <div style={{ display: "flex", gap: 14, alignItems: "center", flexWrap: "wrap", marginTop: 4,
                  borderTop: "1px solid rgba(255,255,255,0.04)", paddingTop: 4 }}>
                  {stats.last7.total > 0 && <>
                    <span style={{ fontSize: 7.5, color: C.textDim, fontWeight: 700, letterSpacing: 1 }}>LAST 7D</span>
                    <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 13, color: C.textDim }}>
                      {stats.last7.wins}–{stats.last7.losses}
                    </span>
                    <span style={{ fontSize: 8, fontWeight: 700, color: stats.last7.units >= 0 ? C.accentG : C.accentR }}>
                      {stats.last7.units >= 0 ? "+" : ""}{stats.last7.units.toFixed(2)}u
                    </span>
                  </>}
                  {stats.pending > 0 && <span style={{ fontSize: 7.5, color: C.accentB }}>{stats.pending} pending</span>}
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* TAB BAR */}
      <div style={{ background: C.bg1, borderBottom: `1px solid ${C.border}`, position: "sticky", top: 92, zIndex: 100, overflowX: "auto" }}>
        <div style={{ maxWidth: 600, margin: "0 auto", display: "flex", padding: "0 8px" }}>
          {TABS.map(t => (
            <button key={t.id} onClick={() => setTab(t.id)} style={{
              padding: "10px 12px", border: "none", background: "transparent", cursor: "pointer",
              color: tab === t.id ? C.accent : C.textLo, fontSize: 8, fontWeight: 700, letterSpacing: .8,
              textTransform: "uppercase", fontFamily: "'DM Mono',monospace", whiteSpace: "nowrap",
              borderBottom: tab === t.id ? `2px solid ${C.accent}` : "2px solid transparent" }}>
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* CONTENT */}
      <div style={{ maxWidth: 600, margin: "0 auto", padding: "14px 12px" }}>
        {mlbError && (
          <div style={{ background: "rgba(230,57,70,0.07)", border: "1px solid rgba(230,57,70,0.25)",
            borderRadius: 9, padding: "10px 14px", marginBottom: 12, fontSize: 8.5, color: C.accentR }}>
            ⚠ MLB API error: {mlbError} — Click ↻ to retry.
          </div>
        )}
        {loading && <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>{[100, 80, 100].map((h, i) => <Skel key={i} h={h} />)}</div>}

        {!loading && tab === "games" && (
          <>
            {liveGames.length > 0 && (
              <section>
                <div style={{ fontSize: 7.5, color: C.textLo2, letterSpacing: 3, textTransform: "uppercase", marginBottom: 8 }}>⚾ In Progress</div>
                {liveGames.map(g => <LiveCard key={g.id} game={g} standings={standings} blendedData={blendedData} />)}
              </section>
            )}
            {todayGames.length > 0
              ? <section>
                  <div style={{ fontSize: 7.5, color: C.textLo2, letterSpacing: 3, textTransform: "uppercase", marginBottom: 8, marginTop: liveGames.length ? 12 : 0 }}>
                    Today · {todayGames.length} Game{todayGames.length !== 1 ? "s" : ""}
                  </div>
                  {todayGames.map(g => <GameCard key={g.id} game={g} standings={standings} oddsEntry={getOdds(g)} blendedData={blendedData} />)}
                </section>
              : !loading && <div style={{ textAlign: "center", padding: "30px 0", color: C.textLo, fontSize: 10 }}>No games scheduled for today.</div>
            }
          </>
        )}

        {!loading && tab === "best" && (
          bestBets.length === 0
            ? <div style={{ textAlign: "center", padding: "40px 0", color: C.textLo, fontSize: 10 }}>
                No edges ≥2.5% found. Load odds in Settings or check back closer to game time.
              </div>
            : <div>
                <div style={{ fontSize: 7.5, color: C.textLo2, letterSpacing: 3, textTransform: "uppercase", marginBottom: 10 }}>
                  Top Edges · {bestBets.length} pick{bestBets.length !== 1 ? "s" : ""} · Sorted by edge %
                </div>
                {bestBets.map((b, i) => {
                  const t = edgeTier(b.edge);
                  const betType = b.market === "ML" ? "TEAM" : "TOTAL";
                  return (
                    <div key={`${b.game.id}-${b.label}-${i}`} style={{
                      background: i === 0 ? `linear-gradient(135deg,rgba(255,209,102,0.08),${C.bg1})` : C.bg1,
                      border: `1px solid ${i < 3 ? "rgba(255,209,102,0.25)" : C.border}`,
                      borderRadius: 12, padding: "14px 16px", marginBottom: 8,
                      boxShadow: i === 0 ? "0 0 24px rgba(255,209,102,0.06)" : "none" }}>
                      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
                        <div style={{ flex: 1 }}>
                          <div style={{ display: "flex", gap: 6, alignItems: "center", flexWrap: "wrap", marginBottom: 6 }}>
                            {i === 0 && <span style={{ fontSize: 8, color: C.accent, fontWeight: 700 }}>👑</span>}
                            <span style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, color: C.text, letterSpacing: 1 }}>
                              {b.label}
                            </span>
                            <Tag label={t.label} color={t.color} />
                            <Tag label={betType} color={betType === "TEAM" ? "#7ec8e3" : "#c49bff"} />
                          </div>
                          <div style={{ fontSize: 9, color: C.textDim }}>
                            {b.game.awayAbbrev} @ {b.game.homeAbbrev}
                            <span style={{ color: C.textLo }}> · {b.game.startLocal}</span>
                          </div>
                          {b.game.awayPitcher && b.game.homePitcher && (
                            <div style={{ fontSize: 7.5, color: C.textLo, marginTop: 3 }}>
                              {b.game.awayPitcher} vs {b.game.homePitcher}
                            </div>
                          )}
                        </div>
                        <div style={{ textAlign: "right", minWidth: 90 }}>
                          <div style={{ fontFamily: "'Bebas Neue',sans-serif", fontSize: 28, lineHeight: 1, color: C.accent }}>
                            {b.edge.toFixed(1)}%
                          </div>
                          <div style={{ fontSize: 8, color: C.textDim, marginTop: 2 }}>edge</div>
                          <div style={{ fontSize: 9, color: b.odds > 0 ? C.accent : C.textDim, marginTop: 4 }}>
                            {b.odds > 0 ? "+" : ""}{b.odds}
                          </div>
                          <div style={{ fontSize: 7.5, color: C.textLo }}>
                            Model: {Math.round(b.modelP * 100)}%
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
        )}

        {!loading && tab === "upcoming" && (
          futureGames.length === 0
            ? <div style={{ textAlign: "center", padding: "40px 0", color: C.textLo, fontSize: 10 }}>No upcoming games in range.</div>
            : (() => {
                const byDate = {};
                futureGames.forEach(g => { (byDate[g.date] = byDate[g.date] ?? []).push(g); });
                return Object.entries(byDate).map(([date, dg]) => (
                  <section key={date}>
                    <div style={{ fontSize: 7.5, color: C.textLo2, letterSpacing: 2, textTransform: "uppercase", margin: "10px 0 8px" }}>
                      {new Date(date + "T12:00:00").toLocaleDateString("en-US", { weekday: "long", month: "short", day: "numeric" })} · {dg.length} game{dg.length !== 1 ? "s" : ""}
                    </div>
                    {dg.map(g => <GameCard key={g.id} game={g} standings={standings} oddsEntry={getOdds(g)} blendedData={blendedData} />)}
                  </section>
                ));
              })()
        )}

        {!loading && tab === "results" && (
          <>
            <div style={{ fontSize: 7.5, color: C.textLo2, letterSpacing: 3, textTransform: "uppercase", marginBottom: 10 }}>Recent Final Results</div>
            {recentGames.length === 0
              ? <div style={{ textAlign: "center", padding: "40px 0", color: C.textLo, fontSize: 10 }}>No recent results.</div>
              : <div style={{ background: C.bg1, borderRadius: 11, overflow: "hidden", border: `1px solid ${C.border}` }}>
                  {recentGames.map((g, i) => {
                    const hWin = (g.homeScore ?? 0) > (g.awayScore ?? 0);
                    return (
                      <div key={g.id} style={{ display: "flex", alignItems: "center", padding: "10px 14px",
                        borderBottom: i < recentGames.length - 1 ? `1px solid ${C.borderLo}` : "none" }}>
                        <span style={{ width: 58, fontSize: 7.5, color: C.textLo2 }}>{g.date}</span>
                        <span style={{ flex: 1, fontFamily: "'Bebas Neue',sans-serif", fontSize: 15, letterSpacing: 1, color: !hWin ? C.accent : C.textDim }}>{g.awayAbbrev}</span>
                        <span style={{ width: 50, textAlign: "center", fontFamily: "'Bebas Neue',sans-serif", fontSize: 18, color: C.text }}>{g.awayScore}–{g.homeScore}</span>
                        <span style={{ flex: 1, textAlign: "right", fontFamily: "'Bebas Neue',sans-serif", fontSize: 15, letterSpacing: 1, color: hWin ? C.accent : C.textDim }}>{g.homeAbbrev}</span>
                      </div>
                    );
                  })}
                </div>
            }
          </>
        )}

        {tab === "auto" && <AutoBetsTab bets={bets} onUpdate={handleUpdateBets} onDelete={handleDeleteBet} />}

        {tab === "settings" && (
          <SettingsPanel settings={settings} onSave={handleSaveSettings}
            onFetchOdds={handleFetchOdds} oddsStatus={oddsStatus} oddsInfo={oddsInfo}
            mlbStatus={mlbStatus} savantStatus={savantStatus} pitcherStatus={pitcherStatus}
            blendedData={blendedData} onRefreshSavant={loadSavant} onRefreshPitchers={loadPitchers} />
        )}
      </div>
    </div>
  );
}
