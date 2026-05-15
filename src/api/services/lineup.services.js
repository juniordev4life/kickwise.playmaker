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
  log
}) {
  const formation = FORMATIONS[formationKey];
  if (!formation) {
    const err = new Error(
      `Unknown formation '${formationKey}'. Valid: ${Object.keys(FORMATIONS).join(", ")}`
    );
    err.statusCode = 400;
    throw err;
  }

  const squadResponse = await callWinger({
    method: "GET",
    path: `/api/v1/kickbase/squad/${encodeURIComponent(leagueId)}`,
    kbToken,
    log
  });
  const squad = squadResponse?.players ?? [];

  const matchdayFixtures = await loadMatchdayFixtures(seasonId, matchday);
  const fixtureByTeam = new Map();
  for (const fx of matchdayFixtures) {
    fixtureByTeam.set(String(fx.home_team_id), { ...fx, isHome: true });
    fixtureByTeam.set(String(fx.away_team_id), { ...fx, isHome: false });
  }

  const enriched = await Promise.all(
    squad.map(async (p) => {
      const fsData = await loadPlayerSnapshot(p.playerId);
      const fixture = fixtureByTeam.get(String(p.teamId));
      return {
        ...p,
        startingProbability: fsData?.startingProbability ?? null,
        imageUrl: fsData?.imageUrl ?? null,
        averagePoints: Number.isFinite(p.average) ? p.average : (fsData?.averagePoints ?? 0),
        teamName: fsData?.teamName ?? null,
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
        startingProbability: p.startingProbability ?? null
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

  // Merge projection back into the enriched squad
  const scored = enriched.map((p) => {
    const proj = projectionByPlayerId.get(String(p.playerId));
    return {
      ...p,
      expectedPoints: proj?.expectedPoints ?? 0,
      projectionBreakdown: proj?.breakdown ?? null
    };
  });

  // Pick best XI for the formation
  const startingXI = pickBestXI(scored, formation);

  // Captain = highest expected within the starting XI
  const captain = startingXI.reduce(
    (best, p) => (p.expectedPoints > (best?.expectedPoints ?? -1) ? p : best),
    null
  );

  const totalExpected =
    startingXI.reduce((s, p) => s + (p.expectedPoints ?? 0), 0) +
    (captain ? captain.expectedPoints : 0); // captain doubles

  return {
    seasonId,
    matchday,
    formation: formationKey,
    lineup: startingXI,
    bench: scored
      .filter((p) => !startingXI.find((s) => s.playerId === p.playerId))
      .sort((a, b) => (b.expectedPoints ?? 0) - (a.expectedPoints ?? 0)),
    captain: captain ? { playerId: captain.playerId, name: captain.name } : null,
    totalExpectedPoints: totalExpected
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
