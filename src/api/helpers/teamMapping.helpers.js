// Kickbase tags every player and team with its own internal id which does
// NOT match the openligadb team_id we use for fixtures/predictions. Bridge
// via team name (Kickbase short form → openligadb canonical name).
export const KICKBASE_NAME_TO_OPENLIGADB_NAME = {
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
 * Translate a Kickbase team name to the openligadb canonical name as it
 * appears in our BQ `teams` table. Returns the input unchanged if no
 * mapping is known — callers can then fall back to exact-name lookup.
 *
 * @param {string} kbTeamName
 * @returns {string}
 *
 * @example
 *   kickbaseTeamNameToOpenligadbName("Leverkusen") // → "Bayer 04 Leverkusen"
 */
export function kickbaseTeamNameToOpenligadbName(kbTeamName) {
  if (!kbTeamName) return "";
  return KICKBASE_NAME_TO_OPENLIGADB_NAME[kbTeamName] ?? kbTeamName;
}
