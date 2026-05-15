import { bqTable, getBigQueryClient } from "../../config/bigQuery.config.js";
import { getFirestoreClient } from "../../config/firestore.config.js";
import { fetchProjectionsForMatch } from "./engine.services.js";
import { callWinger } from "./winger.services.js";

// Formation slots: 1 GK is implied. Defenders + midfielders + forwards must
// sum to 10. The selector chooses the highest-projected player per position.
export const FORMATIONS = {
  "3-4-3": { DEF: 3, MID: 4, FWD: 3 },
  "3-5-2": { DEF: 3, MID: 5, FWD: 2 },
  "4-3-3": { DEF: 4, MID: 3, FWD: 3 },
  "4-4-2": { DEF: 4, MID: 4, FWD: 2 },
  "4-5-1": { DEF: 4, MID: 5, FWD: 1 },
  "5-3-2": { DEF: 5, MID: 3, FWD: 2 },
  "5-4-1": { DEF: 5, MID: 4, FWD: 1 }
};

// Status → startingProbability cap. Used to keep the optimizer from picking
// players who are injured or out, and to dampen the projection for
// questionable players.
const STATUS_PROB_CAPS = {
  fit: 1.0,
  questionable: 0.4,
  injured: 0,
  out: 0,
  unknown: 1.0
};

function adjustedStartingProb(player) {
  const cap = STATUS_PROB_CAPS[player.status] ?? STATUS_PROB_CAPS.unknown;
  // Kickbase reports `prob` on a 0..4 scale (3 = likely start, 4 = certain).
  // Normalise into a 0..1 probability before applying the status cap.
  const raw = Number(player.startingProbability ?? 2.5);
  const baseProb = raw > 1 ? Math.min(1, Math.max(0, raw / 4)) : Math.min(1, Math.max(0, raw));
  return Math.min(baseProb, cap);
}

// Kickbase tags every player with its own internal team id which does NOT
// match the openligadb team_id we use for fixtures/predictions. Bridge via
// the team name as it appears on the Kickbase squad payload.
const KICKBASE_NAME_TO_OPENLIGADB_NAME = {
  Leverkusen: "Bayer 04 Leverkusen",
  "Bayer Leverkusen": "Bayer 04 Leverkusen",
  Bayern: "FC Bayern München",
  "FC Bayern": "FC Bayern München",
  "FC Bayern München": "FC Bayern München",
  Dortmund: "Borussia Dortmund",
  "Borussia Dortmund": "Borussia Dortmund",
  "RB Leipzig": "RB Leipzig",
  Leipzig: "RB Leipzig",
  Stuttgart: "VfB Stuttgart",
  "VfB Stuttgart": "VfB Stuttgart",
  Frankfurt: "Eintracht Frankfurt",
  "Eintracht Frankfurt": "Eintracht Frankfurt",
  "M'gladbach": "Borussia Mönchengladbach",
  Mönchengladbach: "Borussia Mönchengladbach",
  "Borussia Mönchengladbach": "Borussia Mönchengladbach",
  "Union Berlin": "1. FC Union Berlin",
  "1. FC Union Berlin": "1. FC Union Berlin",
  Hoffenheim: "TSG Hoffenheim",
  "TSG Hoffenheim": "TSG Hoffenheim",
  Wolfsburg: "VfL Wolfsburg",
  "VfL Wolfsburg": "VfL Wolfsburg",
  Freiburg: "SC Freiburg",
  "SC Freiburg": "SC Freiburg",
  Mainz: "1. FSV Mainz 05",
  "1. FSV Mainz 05": "1. FSV Mainz 05",
  Augsburg: "FC Augsburg",
  "FC Augsburg": "FC Augsburg",
  "St. Pauli": "FC St. Pauli",
  "FC St. Pauli": "FC St. Pauli",
  "Werder Bremen": "SV Werder Bremen",
  "SV Werder Bremen": "SV Werder Bremen",
  Bremen: "SV Werder Bremen",
  Heidenheim: "1. FC Heidenheim 1846",
  "1. FC Heidenheim": "1. FC Heidenheim 1846",
  Köln: "1. FC Köln",
  "1. FC Köln": "1. FC Köln",
  "FC Köln": "1. FC Köln",
  Hamburg: "Hamburger SV",
  "Hamburger SV": "Hamburger SV",
  HSV: "Hamburger SV"
};

/**
 * Build a kickbaseTeamName → openligadb team_id lookup from the BQ teams
 * table that we already populate in Scout. We need this at request time
 * because Kickbase ids don't line up with openligadb ids (kickbase says
 * Leverkusen has tid 7, but openligadb's 7 is Dortmund).
 *
 * @returns {Promise<Map<string, string>>}
 */
async function loadOpenligadbTeamIdByName() {
  const bq = getBigQueryClient();
  const [rows] = await bq.query({
    query: `SELECT team_id, name FROM \`${bqTable("teams")}\``
  });
  const map = new Map();
  for (const row of rows) {
    if (row.name) map.set(row.name, String(row.team_id));
  }
  return map;
}

function resolveOpenligadbTeamId({ kbTeamName, teamIdByName }) {
  if (!kbTeamName) return null;
  // Direct match first (openligadb canonical name → id).
  if (teamIdByName.has(kbTeamName)) return teamIdByName.get(kbTeamName);
  // Translate via the Kickbase → openligadb name map.
  const canonical = KICKBASE_NAME_TO_OPENLIGADB_NAME[kbTeamName];
  if (canonical && teamIdByName.has(canonical)) return teamIdByName.get(canonical);
  return null;
}

// Risk profiles shape three flavours of recommendation:
//   conservative — only proven starters from clear favorites
//   balanced     — the default, no extra filters
//   bold         — include rotation candidates + bias the captain to a
//                  high-ceiling pick (FWD on the team with the highest xG)
export const RISK_PROFILES = {
  conservative: {
    label: "Konservativ",
    minStartingProb: 0.6,
    minTeamWinProb: 0.3,
    captainStrategy: "safest"
  },
  balanced: {
    label: "Normal",
    minStartingProb: 0.0,
    minTeamWinProb: 0.0,
    captainStrategy: "highest"
  },
  bold: {
    label: "Mutig",
    minStartingProb: 0.3,
    minTeamWinProb: 0.0,
    captainStrategy: "ceiling"
  }
};

function resolveRiskProfile(key) {
  return RISK_PROFILES[key] ?? RISK_PROFILES.balanced;
}

function applyRiskFilter(players, profile) {
  return players.filter((p) => {
    if (adjustedStartingProb(p) < profile.minStartingProb) return false;
    if (!p.matchInfo) return true; // no fixture, will be skipped later anyway
    const winProb = p.matchInfo.isHome
      ? Number(p.matchInfo.probHomeWin ?? 0)
      : Number(p.matchInfo.probAwayWin ?? 0);
    if (winProb && winProb < profile.minTeamWinProb) return false;
    return true;
  });
}

function pickCaptain(startingXI, profile) {
  if (!startingXI.length) return null;
  if (profile.captainStrategy === "safest") {
    // safest = highest expectedPoints among players with startingProb >= 0.8;
    // falls back to plain highest if none qualify.
    const safe = startingXI.filter((p) => (p.startingProbability ?? 0) >= 0.8);
    const pool = safe.length ? safe : startingXI;
    return pool.reduce((b, p) => ((p.expectedPoints ?? 0) > (b?.expectedPoints ?? -1) ? p : b));
  }
  if (profile.captainStrategy === "ceiling") {
    // ceiling = FWD or MID on a team with high expectedGoals (top quartile).
    // We don't have a quartile boundary here, so use a hard threshold of 1.8.
    const upsidePicks = startingXI.filter((p) => {
      const isAttacker = p.position === "FWD" || p.position === "MID";
      const teamXg = Number(p.projectionBreakdown?.teamExpectedGoals ?? 0);
      return isAttacker && teamXg >= 1.8;
    });
    const pool = upsidePicks.length ? upsidePicks : startingXI;
    return pool.reduce((b, p) => ((p.expectedPoints ?? 0) > (b?.expectedPoints ?? -1) ? p : b));
  }
  // default "highest"
  return startingXI.reduce((b, p) => ((p.expectedPoints ?? 0) > (b?.expectedPoints ?? -1) ? p : b));
}

/**
 * Budget-constrained best XI. Picks from a pool of (already-projected)
 * players such that:
 *   - position slots match the formation
 *   - sum(marketValue) ≤ budget
 *   - sum(expectedPoints) is maximised
 *
 * Search strategy: for each formation, take the top-K candidates per
 * position by expectedPoints (K big enough that the optimal XI is almost
 * certainly contained), then brute-force every combination and keep the
 * best one that fits the budget. K=10 keeps combinations at ~1M per
 * formation — runs in well under a second in Node.
 *
 * @param {Array<object>} pool players with { expectedPoints, marketValue, position, ... }
 * @param {object} formation { DEF, MID, FWD }
 * @param {number} budget total marketValue cap in € (e.g. 150_000_000)
 * @param {number} [topK=10] candidate breadth per position
 * @returns {{ lineup: Array<object>, totalExpectedPoints: number, totalMarketValue: number } | null}
 */
function pickBestXIWithBudget(pool, formation, budget, topK = 10) {
  const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of pool) {
    if (!byPos[p.position]) continue;
    if ((p.expectedPoints ?? 0) <= 0) continue;
    byPos[p.position].push(p);
  }
  for (const k of Object.keys(byPos)) {
    byPos[k].sort((a, b) => (b.expectedPoints ?? 0) - (a.expectedPoints ?? 0));
  }
  const top = {
    GK: byPos.GK.slice(0, Math.max(topK, 4)),
    DEF: byPos.DEF.slice(0, Math.max(topK, formation.DEF + 4)),
    MID: byPos.MID.slice(0, Math.max(topK, formation.MID + 4)),
    FWD: byPos.FWD.slice(0, Math.max(topK, formation.FWD + 4))
  };

  if (
    top.GK.length < 1 ||
    top.DEF.length < formation.DEF ||
    top.MID.length < formation.MID ||
    top.FWD.length < formation.FWD
  ) {
    return null;
  }

  const defCombos = combinations(top.DEF, formation.DEF);
  const midCombos = combinations(top.MID, formation.MID);
  const fwdCombos = combinations(top.FWD, formation.FWD);

  let best = null;
  for (const gk of top.GK) {
    const gkCost = Number(gk.marketValue) || 0;
    const gkPts = Number(gk.expectedPoints) || 0;
    if (gkCost > budget) continue;
    for (const defs of defCombos) {
      const dCost = sumMarketValue(defs);
      if (gkCost + dCost > budget) continue;
      const dPts = sumExpectedPoints(defs);
      for (const mids of midCombos) {
        const mCost = sumMarketValue(mids);
        if (gkCost + dCost + mCost > budget) continue;
        const mPts = sumExpectedPoints(mids);
        for (const fwds of fwdCombos) {
          const fCost = sumMarketValue(fwds);
          const total = gkCost + dCost + mCost + fCost;
          if (total > budget) continue;
          const points = gkPts + dPts + mPts + sumExpectedPoints(fwds);
          if (!best || points > best.points) {
            best = { points, cost: total, picks: [gk, ...defs, ...mids, ...fwds] };
          }
        }
      }
    }
  }

  if (!best) return null;
  return {
    lineup: best.picks,
    totalExpectedPoints: best.points,
    totalMarketValue: best.cost
  };
}

function sumMarketValue(arr) {
  let s = 0;
  for (const p of arr) s += Number(p.marketValue) || 0;
  return s;
}

function sumExpectedPoints(arr) {
  let s = 0;
  for (const p of arr) s += Number(p.expectedPoints) || 0;
  return s;
}

function combinations(arr, k) {
  // Generate every k-combination of arr indices, materialise the picks.
  const result = [];
  const idx = new Array(k);
  const n = arr.length;
  function recurse(start, depth) {
    if (depth === k) {
      result.push(idx.map((i) => arr[i]));
      return;
    }
    for (let i = start; i <= n - (k - depth); i += 1) {
      idx[depth] = i;
      recurse(i + 1, depth + 1);
    }
  }
  recurse(0, 0);
  return result;
}

/**
 * Compose the best-projected starting XI for a user's Kickbase squad for a
 * given matchday and formation. Pulls the squad via Winger, enriches each
 * player with the latest Firestore snapshot (for startingProbability and
 * imageUrl), joins to the openligadb matchday in BigQuery to know which
 * fixture each player plays in, and asks the Engine for per-player
 * projections.
 *
 * @param {object} args
 * @param {string} args.leagueId Kickbase league id
 * @param {string} args.kbToken Kickbase bearer token
 * @param {string} args.seasonId
 * @param {number} args.matchday
 * @param {string} args.formationKey one of FORMATIONS keys
 * @param {import("fastify").FastifyBaseLogger} [args.log]
 * @returns {Promise<object>}
 *
 * @example
 *   const r = await buildOptimizedLineup({ leagueId, kbToken, seasonId: "2025/2026", matchday: 34, formationKey: "4-4-2" });
 *   r.lineup[0].name // top GK
 */
export async function buildOptimizedLineup({
  leagueId,
  kbToken,
  seasonId,
  matchday,
  formationKey,
  riskProfileKey = "balanced",
  log
}) {
  const isAuto = formationKey === "auto";
  if (!isAuto && !FORMATIONS[formationKey]) {
    const err = new Error(
      `Unknown formation '${formationKey}'. Valid: ${Object.keys(FORMATIONS).join(", ") + ", auto"}`
    );
    err.statusCode = 400;
    throw err;
  }

  const [squadResponse, matchdayFixtures, teamIdByName] = await Promise.all([
    callWinger({
      method: "GET",
      path: `/api/v1/kickbase/squad/${encodeURIComponent(leagueId)}`,
      kbToken,
      log
    }),
    loadMatchdayFixtures(seasonId, matchday),
    loadOpenligadbTeamIdByName()
  ]);
  const squad = squadResponse?.players ?? [];

  const fixtureByTeam = new Map();
  for (const fx of matchdayFixtures) {
    fixtureByTeam.set(String(fx.home_team_id), { ...fx, isHome: true });
    fixtureByTeam.set(String(fx.away_team_id), { ...fx, isHome: false });
  }

  const enriched = await Promise.all(
    squad.map(async (p) => {
      const fsData = await loadPlayerSnapshot(p.playerId);
      const kbTeamName = fsData?.teamName ?? p.teamName ?? null;
      // Translate Kickbase teamId → openligadb teamId via the team name.
      const openligadbTeamId =
        resolveOpenligadbTeamId({ kbTeamName, teamIdByName }) ?? String(p.teamId ?? "");
      const fixture = fixtureByTeam.get(openligadbTeamId);
      return {
        ...p,
        teamId: openligadbTeamId,
        kickbaseTeamId: String(p.teamId ?? ""),
        startingProbability: fsData?.startingProbability ?? null,
        imageUrl: fsData?.imageUrl ?? null,
        averagePoints: Number.isFinite(p.average) ? p.average : (fsData?.averagePoints ?? 0),
        teamName: kbTeamName,
        // matchInfo is null when the player's team has no fixture this
        // matchday (Cup competitions, postponed games). The optimizer skips
        // such players so we don't recommend someone who won't play.
        matchInfo: fixture
          ? {
              matchId: fixture.match_id,
              opponentTeamId: fixture.isHome ? fixture.away_team_id : fixture.home_team_id,
              isHome: fixture.isHome
            }
          : null
      };
    })
  );

  // Group by matchId, ignore players without a fixture
  const grouped = new Map();
  for (const p of enriched) {
    if (!p.matchInfo) continue;
    const matchId = String(p.matchInfo.matchId);
    if (!grouped.has(matchId)) grouped.set(matchId, []);
    grouped.get(matchId).push(p);
  }

  // Ask the Engine for projections per match; in parallel
  const engineResponses = await Promise.all(
    Array.from(grouped.entries()).map(async ([matchId, players]) => {
      const payload = players.map((p) => ({
        playerId: String(p.playerId),
        teamId: String(p.teamId),
        position: p.position,
        averagePoints: Number(p.averagePoints ?? 0),
        // Status-adjusted startingProbability: injured / out players are
        // floored to 0 here (so they're never recommended), questionable
        // players are capped at 0.4. The Engine never sees their fitness
        // flag — it sees a low probability number.
        startingProbability: adjustedStartingProb(p)
      }));
      const data = await fetchProjectionsForMatch({ matchId, players: payload, log });
      return { matchId, data };
    })
  );

  // Index projections by playerId
  const projectionByPlayerId = new Map();
  for (const r of engineResponses) {
    if (!r.data) continue;
    for (const proj of r.data.projections ?? []) {
      projectionByPlayerId.set(String(proj.playerId), proj);
    }
  }

  // Merge projection back into the enriched squad, then carry through the
  // match's outcome probabilities on every player so risk-profile filters
  // can reason about them downstream.
  const scored = enriched.map((p) => {
    const proj = projectionByPlayerId.get(String(p.playerId));
    return {
      ...p,
      expectedPoints: proj?.expectedPoints ?? 0,
      projectionBreakdown: proj?.breakdown ?? null,
      matchInfo: p.matchInfo
        ? {
            ...p.matchInfo,
            probHomeWin: proj?.breakdown?.isHome
              ? proj?.breakdown?.teamWinProbability
              : 1 - (proj?.breakdown?.teamWinProbability ?? 0),
            probAwayWin: proj?.breakdown?.isHome
              ? 1 - (proj?.breakdown?.teamWinProbability ?? 0)
              : proj?.breakdown?.teamWinProbability
          }
        : null
    };
  });

  const riskProfile = resolveRiskProfile(riskProfileKey);
  const filtered = applyRiskFilter(scored, riskProfile);

  // Pick best XI. In "auto" mode we evaluate every formation and pick the
  // one with the highest total — small enough (7 formations × O(n log n)
  // sort) that we just brute force.
  const candidateFormations = isAuto ? Object.keys(FORMATIONS) : [formationKey];
  let best = null;
  for (const key of candidateFormations) {
    const lineupCandidate = pickBestXI(filtered, FORMATIONS[key]);
    const total = lineupCandidate.reduce((s, p) => s + (p.expectedPoints ?? 0), 0);
    if (!best || total > best.total) {
      best = { key, lineupCandidate, total };
    }
  }
  // If the risk filter wiped out enough players that we can't fill the XI,
  // fall back to the unfiltered pool — better a recommendation with one
  // questionable pick than nothing.
  if (!best || best.lineupCandidate.length < 11) {
    best = null;
    for (const key of candidateFormations) {
      const lineupCandidate = pickBestXI(scored, FORMATIONS[key]);
      const total = lineupCandidate.reduce((s, p) => s + (p.expectedPoints ?? 0), 0);
      if (!best || total > best.total) {
        best = { key, lineupCandidate, total };
      }
    }
  }
  const startingXI = best.lineupCandidate;
  const chosenFormation = best.key;

  const captain = pickCaptain(startingXI, riskProfile);

  const totalExpected =
    startingXI.reduce((s, p) => s + (p.expectedPoints ?? 0), 0) +
    (captain ? captain.expectedPoints : 0); // captain doubles

  // Flag risky picks so the UI can warn the user — these are players we
  // recommended despite questionable / unknown fitness.
  const warnings = startingXI
    .filter((p) => p.status && p.status !== "fit" && p.status !== "unknown")
    .map((p) => ({
      playerId: p.playerId,
      name: p.name,
      status: p.status
    }));

  return {
    seasonId,
    matchday,
    formation: chosenFormation,
    requestedFormation: formationKey,
    riskProfile: riskProfileKey,
    lineup: startingXI,
    bench: scored
      .filter((p) => !startingXI.find((s) => s.playerId === p.playerId))
      .sort((a, b) => (b.expectedPoints ?? 0) - (a.expectedPoints ?? 0)),
    captain: captain ? { playerId: captain.playerId, name: captain.name } : null,
    totalExpectedPoints: totalExpected,
    warnings
  };
}

function pickBestXI(allPlayers, formation) {
  const byPos = { GK: [], DEF: [], MID: [], FWD: [] };
  for (const p of allPlayers) {
    if (!byPos[p.position]) continue;
    byPos[p.position].push(p);
  }
  for (const k of Object.keys(byPos)) {
    byPos[k].sort((a, b) => (b.expectedPoints ?? 0) - (a.expectedPoints ?? 0));
  }
  const lineup = [];
  if (byPos.GK[0]) lineup.push(byPos.GK[0]);
  lineup.push(...byPos.DEF.slice(0, formation.DEF));
  lineup.push(...byPos.MID.slice(0, formation.MID));
  lineup.push(...byPos.FWD.slice(0, formation.FWD));
  return lineup;
}

async function loadMatchdayFixtures(seasonId, matchday) {
  const bq = getBigQueryClient();
  const [rows] = await bq.query({
    query: `
      SELECT match_id, home_team_id, away_team_id, kickoff_at
      FROM \`${bqTable("matches")}\`
      WHERE season_id = @seasonId AND matchday = @matchday
    `,
    params: { seasonId, matchday },
    types: { seasonId: "STRING", matchday: "INT64" }
  });
  return rows;
}

async function loadPlayerSnapshot(playerId) {
  if (!playerId) return null;
  const db = getFirestoreClient();
  const doc = await db.collection("players").doc(String(playerId)).get();
  return doc.exists ? doc.data() : null;
}

/**
 * Compose the best XI from the *entire Bundesliga* (not the user's squad)
 * within a budget cap on total market value. Daily-fantasy-style:
 *   - given a budget B and a formation (or "auto")
 *   - pick 1 GK + N defenders + M midfielders + F forwards
 *   - max sum(expectedPoints)
 *   - subject to sum(marketValue) ≤ B
 *
 * No Kickbase token needed since we don't read user squad.
 *
 * @param {object} args
 * @param {string} args.seasonId
 * @param {number} args.matchday
 * @param {string} args.formationKey one of FORMATIONS keys or "auto"
 * @param {number} args.budget total marketValue cap in € (e.g. 150_000_000)
 * @param {import("fastify").FastifyBaseLogger} [args.log]
 * @returns {Promise<object>}
 *
 * @example
 *   const r = await buildBudgetLineup({
 *     seasonId: "2025/2026", matchday: 34,
 *     formationKey: "auto", budget: 150_000_000
 *   });
 */
export async function buildBudgetLineup({
  seasonId,
  matchday,
  formationKey,
  budget,
  riskProfileKey = "balanced",
  log
}) {
  const isAuto = formationKey === "auto";
  if (!isAuto && !FORMATIONS[formationKey]) {
    const err = new Error(
      `Unknown formation '${formationKey}'. Valid: ${Object.keys(FORMATIONS).join(", ") + ", auto"}`
    );
    err.statusCode = 400;
    throw err;
  }
  if (!Number.isFinite(budget) || budget <= 0) {
    const err = new Error("budget must be a positive number (in €)");
    err.statusCode = 400;
    throw err;
  }

  // Load all Bundesliga players + fixtures + team-id map in parallel.
  const [allPlayers, matchdayFixtures, teamIdByName] = await Promise.all([
    loadAllBundesligaPlayers(),
    loadMatchdayFixtures(seasonId, matchday),
    loadOpenligadbTeamIdByName()
  ]);

  const fixtureByTeam = new Map();
  for (const fx of matchdayFixtures) {
    fixtureByTeam.set(String(fx.home_team_id), { ...fx, isHome: true });
    fixtureByTeam.set(String(fx.away_team_id), { ...fx, isHome: false });
  }

  // Translate every player's Kickbase teamId to the openligadb teamId via
  // teamName so the fixture join hits the right match. Players whose team
  // has no Bundesliga fixture this matchday are filtered out.
  const eligible = allPlayers
    .map((p) => {
      const openligadbTeamId =
        resolveOpenligadbTeamId({ kbTeamName: p.teamName, teamIdByName }) ?? String(p.teamId ?? "");
      return {
        ...p,
        teamId: openligadbTeamId,
        kickbaseTeamId: String(p.teamId ?? ""),
        matchInfo: fixtureByTeam.get(openligadbTeamId) ?? null
      };
    })
    .filter((p) => p.matchInfo);

  // Group by matchId so we can batch the Engine projections one call per match.
  const grouped = new Map();
  for (const p of eligible) {
    const matchId = String(p.matchInfo.match_id);
    if (!grouped.has(matchId)) grouped.set(matchId, []);
    grouped.get(matchId).push(p);
  }

  const engineResponses = await Promise.all(
    Array.from(grouped.entries()).map(async ([matchId, players]) => {
      const payload = players.map((p) => ({
        playerId: String(p.playerId),
        teamId: String(p.teamId),
        position: p.position,
        averagePoints: Number(p.averagePoints ?? 0),
        startingProbability: adjustedStartingProb(p)
      }));
      const data = await fetchProjectionsForMatch({ matchId, players: payload, log });
      return { matchId, data };
    })
  );

  const projectionByPlayerId = new Map();
  for (const r of engineResponses) {
    if (!r.data) continue;
    for (const proj of r.data.projections ?? []) {
      projectionByPlayerId.set(String(proj.playerId), proj);
    }
  }

  const scored = eligible.map((p) => {
    const proj = projectionByPlayerId.get(String(p.playerId));
    return {
      ...p,
      expectedPoints: proj?.expectedPoints ?? 0,
      projectionBreakdown: proj?.breakdown ?? null,
      matchInfo: p.matchInfo
        ? {
            ...p.matchInfo,
            probHomeWin: proj?.breakdown?.isHome
              ? proj?.breakdown?.teamWinProbability
              : 1 - (proj?.breakdown?.teamWinProbability ?? 0),
            probAwayWin: proj?.breakdown?.isHome
              ? 1 - (proj?.breakdown?.teamWinProbability ?? 0)
              : proj?.breakdown?.teamWinProbability
          }
        : null
    };
  });

  const riskProfile = resolveRiskProfile(riskProfileKey);
  const filteredPool = applyRiskFilter(scored, riskProfile);
  const poolForSearch = filteredPool.length >= 25 ? filteredPool : scored;

  const candidateFormations = isAuto ? Object.keys(FORMATIONS) : [formationKey];
  let best = null;
  for (const key of candidateFormations) {
    const result = pickBestXIWithBudget(poolForSearch, FORMATIONS[key], budget);
    if (!result) continue;
    if (!best || result.totalExpectedPoints > best.totalExpectedPoints) {
      best = { ...result, formation: key };
    }
  }

  if (!best) {
    return {
      seasonId,
      matchday,
      formation: formationKey,
      budget,
      riskProfile: riskProfileKey,
      lineup: [],
      captain: null,
      totalExpectedPoints: 0,
      totalMarketValue: 0,
      message: "No formation fits within the given budget."
    };
  }

  const captain = pickCaptain(best.lineup, riskProfile);
  const totalWithCaptain = best.totalExpectedPoints + (captain ? captain.expectedPoints : 0);

  return {
    seasonId,
    matchday,
    formation: best.formation,
    requestedFormation: formationKey,
    riskProfile: riskProfileKey,
    budget,
    lineup: best.lineup,
    captain: captain ? { playerId: captain.playerId, name: captain.name } : null,
    totalExpectedPoints: totalWithCaptain,
    totalMarketValue: best.totalMarketValue,
    budgetRemaining: budget - best.totalMarketValue
  };
}

async function loadAllBundesligaPlayers() {
  const db = getFirestoreClient();
  const snap = await db.collection("players").get();
  return snap.docs.map((d) => {
    const data = d.data();
    return {
      playerId: data.playerId ?? d.id,
      name: data.name,
      teamId: data.teamId,
      teamName: data.teamName ?? null,
      position: data.position,
      status: data.status,
      marketValue: Number(data.marketValue ?? 0),
      averagePoints: Number(data.averagePoints ?? 0),
      startingProbability: data.startingProbability ?? null,
      imageUrl: data.imageUrl ?? null
    };
  });
}
