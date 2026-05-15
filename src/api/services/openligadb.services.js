import { request } from "undici";

const DEFAULT_BASE_URL = "https://api.openligadb.de";

function baseUrl() {
  return process.env.OPENLIGADB_BASE_URL ?? DEFAULT_BASE_URL;
}

/**
 * Fetch a single openligadb match by id and normalize it into Kickwise's
 * match-detail shape.
 *
 * @param {string|number} matchId
 * @returns {Promise<object>} normalized match
 *
 * @example
 *   const match = await fetchMatchDetail("72513");
 */
export async function fetchMatchDetail(matchId) {
  const url = new URL(`/getmatchdata/${encodeURIComponent(matchId)}`, baseUrl()).toString();
  const response = await request(url, { method: "GET", headersTimeout: 15_000 });
  const text = await response.body.text();
  if (response.statusCode !== 200) {
    const err = new Error(`openligadb ${response.statusCode}: ${text.slice(0, 200)}`);
    err.statusCode = response.statusCode === 404 ? 404 : 502;
    throw err;
  }
  const raw = JSON.parse(text);
  if (!raw || !raw.matchID) {
    const err = new Error(`Match ${matchId} not found in openligadb`);
    err.statusCode = 404;
    throw err;
  }
  return normalize(raw);
}

function normalize(raw) {
  const final = (raw.matchResults ?? []).find(
    (r) => r.resultName === "Endergebnis" || r.resultTypeID === 2
  );
  const half = (raw.matchResults ?? []).find(
    (r) => r.resultName === "Halbzeitergebnis" || r.resultTypeID === 1
  );

  const homeTeam = raw.team1 ?? {};
  const awayTeam = raw.team2 ?? {};

  return {
    matchId: String(raw.matchID),
    leagueName: raw.leagueName ?? null,
    leagueShortcut: raw.leagueShortcut ?? null,
    leagueSeason: raw.leagueSeason ?? null,
    matchday: raw.group?.groupOrderID ?? null,
    matchdayName: raw.group?.groupName ?? null,
    kickoffAt: raw.matchDateTimeUTC ?? raw.matchDateTime ?? null,
    isFinished: Boolean(raw.matchIsFinished),
    location: raw.location?.locationCity
      ? {
          city: raw.location.locationCity,
          stadium: raw.location.locationStadium
        }
      : null,
    homeTeam: {
      teamId: String(homeTeam.teamId ?? ""),
      name: homeTeam.teamName ?? "",
      shortName: homeTeam.shortName ?? null,
      logoUrl: homeTeam.teamIconUrl ?? null
    },
    awayTeam: {
      teamId: String(awayTeam.teamId ?? ""),
      name: awayTeam.teamName ?? "",
      shortName: awayTeam.shortName ?? null,
      logoUrl: awayTeam.teamIconUrl ?? null
    },
    finalScore: final ? { home: final.pointsTeam1, away: final.pointsTeam2 } : null,
    halfTimeScore: half ? { home: half.pointsTeam1, away: half.pointsTeam2 } : null,
    goals: (raw.goals ?? [])
      .sort((a, b) => (a.matchMinute ?? 0) - (b.matchMinute ?? 0))
      .map((g) => ({
        goalId: String(g.goalID),
        minute: g.matchMinute ?? null,
        scorerId: g.goalGetterID ? String(g.goalGetterID) : null,
        scorerName: g.goalGetterName ?? "",
        scoreHome: g.scoreTeam1 ?? null,
        scoreAway: g.scoreTeam2 ?? null,
        isPenalty: Boolean(g.isPenalty),
        isOwnGoal: Boolean(g.isOwnGoal),
        isOvertime: Boolean(g.isOvertime),
        comment: g.comment ?? null
      }))
  };
}
