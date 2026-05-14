# kickwise.playmaker

API-Gateway für Kickwise. Sitzt zwischen Striker und den datenführenden Services (Winger, BigQuery, Firestore).

## Verantwortung

- **Auth-Sessions**: Eigenes JWT-Cookie, signiert mit einem Secret aus Secret Manager
- **Token-Storage**: Kickbase-Token pro User in Firestore (`users/{kickbaseUserId}`)
- **Aggregation**: kombiniert Live-Daten vom Winger mit historischen Daten aus BigQuery
- **Schutzschicht**: nur das, was hier offen ist, sieht der Browser

## Endpoints (Phase 1)

| Methode | Pfad | Auth | Zweck |
|---------|------|------|-------|
| POST | `/api/v1/auth/login` | — | E-Mail + Passwort → Kickbase-Login via Winger → JWT-Cookie |
| POST | `/api/v1/auth/logout` | ✓ | Cookie löschen, Kickbase-Token aus Firestore räumen |
| GET | `/api/v1/auth/me` | ✓ | aktueller User + Profil |
| GET | `/api/v1/matchday/current` | ✓ | aktueller Bundesliga-Spieltag (Spielplan + ggf. Ergebnisse) |
| GET | `/api/v1/matchday/:matchday` | ✓ | beliebiger Spieltag |
| GET | `/api/v1/league/me/leagues` | ✓ | meine Kickbase-Ligen |
| GET | `/api/v1/league/:leagueId/ranking` | ✓ | Tabelle einer Liga (über Winger) |
| GET | `/api/v1/squad/:leagueId` | ✓ | eigener Kader in einer Liga (über Winger) |
| GET | `/health` | — | Liveness |

## Response-Envelope

Alle Endpoints antworten mit:

```json
{
  "traceId": "req-id",
  "code": 200,
  "title": "Success",
  "message": "...",
  "data": { },
  "errors": []
}
```

## Lokal starten

```bash
cp .env.example .env.local
# .env.local anpassen — JWT_SECRET setzen, WINGER_URL prüfen
npm install
npm run dev    # läuft auf Port 3000
```

Voraussetzung für komplette Login-Flows: parallel laufender Winger (`cd ../kickwise.winger && npm run dev`).

## Lokale Firestore-Entwicklung

```bash
# Option A: gegen echte Firestore in kickwise-prod (Vorsicht — Production!)
gcloud auth application-default login

# Option B: Firestore-Emulator
npm install -g firebase-tools
firebase emulators:start --only firestore --project kickwise-prod
# In einem zweiten Terminal:
export FIRESTORE_EMULATOR_HOST=localhost:8080
npm run dev
```

## Tests

```bash
npm run test:run
npm run test:coverage
```
