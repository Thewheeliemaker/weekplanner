# Weekplanner — Project Briefing

Dit document bevat alles wat je nodig hebt om verder te werken aan dit project. Plak het als eerste bericht in een nieuw gesprek.

*Laatst bijgewerkt: 7 november 2026*

## Wat is het?

Een gezinsplanner webapp voor het gezin van Rick: **Siem**, **Mare**, **Merel** en **Rick**. De app synchroniseert een fysiek weekbord met een digitale versie. Gebouwd als vanilla JS + Vite app, gehost op Vercel, met Supabase als database.

- **Productie**: https://weekplanner-lemon.vercel.app
- **GitHub**: Thewheeliemaker/weekplanner (pushen naar `main` = deploy naar productie)
- **Lokaal pad**: `C:\Users\Gebruiker\Weekplanner`
- **Dev server**: `npx vite --host --port 5174`. Lokaal bestaat `/api` niet: inloggen werkt dan zonder wachtwoordcheck, maar zonder Supabase-sessie geeft de database (door RLS) lege lijsten terug.

## Tech stack

- **Frontend**: vanilla JS (geen framework), Vite 8.3 als bundler, één `index.html` + `src/main.js` + `src/style.css`
- **Backend**: Vercel Serverless Functions (Node.js, ESM, in `/api/`)
- **Database**: Supabase (PostgreSQL) via `@supabase/supabase-js`, plus Supabase Auth (één gedeeld gezinsaccount)
- **Geplande taken**: Supabase `pg_cron` + `pg_net` (elke 5 min naar `/api/tick`), plus twee Vercel crons als vangnet
- **Push notifications**: Web Push via het `web-push` npm package
- **AI**: Anthropic API (Claude Haiku 4.5) voor het interpreteren van tekst en het scannen van roosters
- **Hosting**: Vercel Hobby (max 2 crons van 1x/dag, max 12 functions; nu 9 in gebruik)
- **Fonts**: Bricolage Grotesque (koppen), Public Sans (tekst), IBM Plex Mono (mono)

## Bestandsstructuur

```
index.html            — volledige HTML (single page app, 4 tabs)
src/
  main.js             — alle app-logica (~1440 regels)
  style.css           — alle styling met CSS custom properties
  supabase.js         — Supabase client init
  holidays.js         — Nederlandse feestdagen berekenen (gedeeld met api/)
api/
  auth.js             — wachtwoordcheck + limiet op inlogpogingen, geeft het agenda-token terug
  data.js             — CRUD op Supabase-tabellen (service key), push bij nieuwe items
  digest.js           — ochtend-digest (Vercel cron, vangnet bij openen van de app, testknop)
  tick.js             — elke 5 min door pg_cron aangeroepen: herinneringen + digest
  backup.js           — backups maken, tonen en terugzetten
  parse.js            — AI tekst-parsing (snel toevoegen)
  ocr.js              — AI foto-scanning (werkrooster)
  calendar.js         — ICS feed (token vereist)
  subscribe.js        — push subscription opslaan
  _lib/               — gedeelde helpers; geen routes, door het underscore-voorvoegsel
    auth.js           — checkPassword (constant-time, faalt dicht), calendarToken, tokensEqual
    digest.js         — runDigest(): opbouw digest + atomaire claim per dag
    reminders.js      — runReminders(): herinneringen die nu verstuurd moeten worden
    time.js           — datum/tijd in Europe/Amsterdam
public/
  sw.js               — service worker: offline-cache van de app + push
  manifest.json, icons
supabase/migrations/  — 001 t/m 010 (handmatig uitvoeren in de Supabase SQL Editor)
vercel.json           — Vercel cron-configuratie (vangnet voor de digest)
.env                  — Supabase URL + anon key + VAPID public key (lokaal)
```

## Tabbladen in de app

1. **Week**: weekoverzicht als tabel (kolommen = gezinsleden, rijen = dagen). Swipe voor vorige/volgende week. Items zijn klikbaar voor details en bewerken. De "+"-knop opent het toevoegformulier. Toont het weer, verjaardagen, feestdagen (🇳🇱) en een ⚠ bij overlappende tijden.
2. **Boodschappen**: boodschappenlijst met afvinken en favorieten om snel toe te voegen.
3. **Bord**: items die digitaal zijn toegevoegd maar nog niet op het fysieke bord staan. Vinkje = "overgezet". Bevat ook de scanner voor werkroosters.
4. **Profiel**: instellingen voor thema, weer-locatie, digest aan/uit + tijdstip (06:00–09:30 per half uur), agenda-link (met token) en uitloggen.

## Datamodel (Supabase-tabellen)

### `entries` — alle afspraken
- `title`, `who` (Siem|Mare|Merel|Rick|Algemeen, of meerdere kommagescheiden), `category` (eten|bijzonder|null)
- `type`: wekelijks | jaarlijks | eenmalig | periode
- `weekday` (bij wekelijks), `date` (YYYY-MM-DD), `end_date` (bij periode/wekelijks)
- `time`, `note`, `reminder_minutes` (0/15/30/60/1440 of null), `birth_year` (bij jaarlijks = verjaardag)
- `skip_dates` (JSONB array), `source` (handmatig|foto|beschrijving)
- `op_fysiek_bord` (bool), `photo_id`, `created_at`
- ⚠ **Er is géén kolom `end_time`.** De roosterscan zet de eindtijd als "Tot HH:MM" in `note`.

### `boodschappen` — boodschappenlijst
- `naam`, `afgevinkt` (bool), `created_at`

### `favorieten` — boodschappen die je snel kunt toevoegen
- `naam`, `created_at`

### `photos` — geparkeerd
- `asset_url`, `uploaded_at`, `status`, `ai_summary`

### `settings` — key-value instellingen
- `id` (string key), `value` (JSONB), `updated_at`
- Bekende keys: `location`, `digest_optout` (array van namen), `digest_time` ("HH:MM"), `digest_last_sent` (datumstring)
- Schrijven altijd met de `upsert`-actie van `/api/data`. Een `update` op een rij die nog niet bestaat doet stilletjes niets.

### Alleen voor de server (geen policies, alleen bereikbaar met de service key)
- `push_subscriptions`: `endpoint` (uniek), `subscription` (JSON-tekst), `user_name`
- `backups`: `entries_json`, `entry_count`, `created_at` (wekelijks op zondag, 14 dagen bewaard)
- `api_usage`: `endpoint`, `created_at`. Gebruikt voor de AI-limiet (60 per uur) en voor mislukte inlogpogingen (`auth_fail`)
- `reminder_log`: `entry_id` + `occurrence` (primary key), zodat elke herinnering maar één keer gaat
- Functie `claim_digest(p_day)`: claimt de digest van vandaag atomair, zodat hij nooit dubbel gaat

## Beveiliging en login

- **Login-scherm**: 4 knoppen (Siem/Mare/Merel/Rick) + wachtwoordveld. Het scherm staat standaard verborgen; wie al ingelogd is, gaat direct de app in en de wachtwoordcheck gebeurt op de achtergrond.
- **Flow**:
  1. De app stuurt een POST naar `/api/auth`, die het wachtwoord controleert tegen `APP_PASSWORD`.
  2. Daarna logt de app in bij Supabase Auth met `gezin@weekplanner.app` en **hetzelfde wachtwoord**.
- **Opslag**: `localStorage` houdt `wp-auth` (wachtwoord, nodig voor de API-calls), `wp-user` en `wp-cal-token` bij. Supabase bewaart zijn eigen sessie.
- **RLS (migratie 009)**: lezen mag alleen voor de rol `authenticated`. Alle schrijfacties lopen via `/api/*` met de service-role key; de anon key mag niets.
- **Supabase Auth-instellingen die zo moeten blijven**: Email-provider **aan**, "Allow new users to sign up" **uit**, anonieme logins **uit**.
- **Wachtwoord wijzigen = op twee plekken**: `APP_PASSWORD` op Vercel én het wachtwoord van het gezinsaccount in Supabase. Daarmee verandert ook het agenda-token, tenzij `CALENDAR_TOKEN` is gezet.
- **Agenda-feed**: `/api/calendar?token=…`. Het token is `CALENDAR_TOKEN`, of als die ontbreekt een HMAC van `APP_PASSWORD`. Aanrader: een los, willekeurig `CALENDAR_TOKEN` zetten.
- **Limiet op inlogpogingen**: max 10 mislukte pogingen per 15 minuten.

## Herinneringen en digest

- **pg_cron (migratie 010)**: elke 5 minuten een `net.http_post` naar `/api/tick` met `Authorization: Bearer <CRON_SECRET>`. Het secret staat alleen in Vercel en in de cron-job, niet in git.
- **`/api/tick`** draait twee dingen:
  - `runReminders()`: pushmelding aan de personen van het item (bij Algemeen aan iedereen). Ook "1 dag van tevoren" werkt. Er is een inhaalvenster van 10 minuten.
  - `runDigest()`: één keer per dag, zodra `digest_time` voorbij is.
- **Digest-inhoud**: weer, feestdag, verjaardagen, afspraken, avondeten. Persoonlijke begroetingen: Merel = "schoonheid", Mare = "scheetje", Siem = "kakkie".
- **Vangnetten**: twee Vercel crons (05:00 en 06:00 UTC) en een trigger bij het openen van de app. Dankzij `claim_digest` gaat er nooit iets dubbel.
- **Op zondag** maakt de digest ook een backup.
- **Push-TTL**: 6 uur voor de digest, 1 uur voor herinneringen.
- **Push alleen voor Merel en Rick** (`PUSH_USERS` in main.js). De kinderen krijgen nog geen push.

**Controleren in de Supabase SQL Editor:**
```sql
select created, status_code, left(content::text, 200) from net._http_response order by created desc limit 5;
select start_time, status, return_message from cron.job_run_details order by start_time desc limit 5;
```

## Andere functies

- **Feestdagen**: `src/holidays.js` berekent ze (Pasen-algoritme, Koningsdag op 26 april als 27 april een zondag is). Ze worden getoond als alleen-lezen items met id `feestdag-YYYY-MM-DD`. Staat er al een rij met dezelfde titel en datum in de database (migratie 007, t/m 2028), dan wordt de berekende versie niet getoond.
- **Overlapwaarschuwing**: items met een tijd die binnen 60 minuten van elkaar vallen, krijgen een ⚠ met tooltip. Bij het opslaan vraagt de app om bevestiging; bij wekelijkse items kijkt hij 8 weken vooruit. Avondeten en feestdagen tellen niet mee.
- **Offline**:
  - De service worker gebruikt network-first voor pagina's en cache-first voor `/assets`. Hij wordt alleen in productie geregistreerd.
  - De data staat in `localStorage` (`wp-cache-entries/groceries/favorites`) en wordt bij offline getoond met een balk.
  - Schrijven geeft offline een nette foutmelding.
- **Ongedaan maken na verwijderen**: zet de rij terug met het originele `id` en `created_at`, en `silent: true`, zodat er geen "Nieuw op het bord"-push uitgaat.
- **Roosterscan**:
  - Alle diensten gaan in één insert. Dat levert één samenvattende pushmelding op in plaats van één per dienst.
  - "Vrij" wordt opgeslagen als "Naam vrij".

## Environment variables (op Vercel)

- `VITE_SUPABASE_URL`: Supabase project-URL
- `VITE_SUPABASE_ANON_KEY`: Supabase anon/public key (door RLS mag die zonder login niets)
- `SUPABASE_SERVICE_ROLE_KEY`: Supabase service role (alleen server-side)
- `APP_PASSWORD`: gedeeld wachtwoord, gelijk aan het wachtwoord van het gezinsaccount in Supabase Auth
- `VITE_VAPID_PUBLIC_KEY` / `VAPID_PRIVATE_KEY`: keys voor web push
- `ANTHROPIC_API_KEY`: voor `/api/parse` en `/api/ocr`
- `CRON_SECRET`: **verplicht**. Precies dezelfde waarde als in de pg_cron-job (64 hex-tekens). Gevoelig: Vercel toont hem na het opslaan niet meer. Een 401 van `/api/tick` geeft `secretLength`/`tokenLength` terug om verschillen op te sporen.
- `CALENDAR_TOKEN`: optioneel, maar aan te raden (zie Beveiliging)

## Recente beslissingen en geleerde lessen

### November 2026 — review en uitbreidingen
- Supabase Auth met één gedeeld account gekozen in plaats van per persoon: het blijft simpel en realtime blijft werken.
- Geheime waarden nooit in git of chat. Voor het instellen kreeg de gebruiker een tijdelijk bestand, dat daarna is verwijderd.
- Plakfouten in Vercel kwamen echt voor (er stond een commando of extra tekens in `CRON_SECRET`). De code negeert nu spaties, en de 401-melding laat de lengtes zien.
- Het oude per-gebruiker-formaat van `digest_last_sent` (object) wordt nog geaccepteerd en wordt vanzelf een datumstring.
- "Vandaag" in `/api/parse` en `/api/ocr` volgt nu de tijd in Amsterdam, niet UTC.
- `src/ics.js` (ongebruikt) is verwijderd. De ICS-feed staat alleen in `api/calendar.js`.

### iOS date inputs (oktober 2026)
- iOS Safari negeert `width: 100%` op `input[type="date"]`, waardoor het veld te breed wordt.
- **Oplossing**: `appearance: none; -webkit-appearance: none;` + een eigen SVG-kalendericoon + een expliciete `min-height: 42px`.
- De datumvelden (Vanaf/Tot en met) staan naast elkaar via een CSS Grid `auto-fit` wrapper (`.date-fields`).

### Digest (oktober–november 2026)
- Timing per gebruiker was niet betrouwbaar met alleen Vercel Hobby crons. Daarom is het één tijdstip voor het hele gezin geworden, nu via pg_cron vrij te kiezen.

### Bord-tabblad
- De prullenbak-iconen naast items zijn verwijderd (verwarrend). Items markeer je als "overgezet" met het vinkje.

## Openstaande wensen

- Push voor de kinderen (`PUSH_USERS` uitbreiden)
- Eindtijdveld in het formulier (eerst de kolom `end_time` toevoegen) en die gebruiken in de ICS-feed (nu altijd 1 uur)
- Locatie wordt per apparaat in `localStorage` gecachet; wie hem wijzigt, ziet dat alleen op het eigen apparaat
- ICS-feed: `DTSTAMP` ontbreekt, en boven de 800 items vallen de nieuwste weg
- Het item "Nieuwe feestdagen inladen" (1-1-2029) kan weg; feestdagen worden nu berekend
- Weekmenu gekoppeld aan boodschappen; klusjes voor de kinderen

## Conventies

- Geen framework, geen build-time templating: alles vanilla JS met de `$('id')` helper
- State object `state` bevat `entries`, `groceries`, `favorites`, `currentUser`, `addType`, `weekOffset`, etc.
- DB-schrijfacties via de wrapper `dbWrite(action, table, {id, data, ids, silent})`, die een POST doet naar `/api/data`. Acties: `insert`, `update`, `upsert` (alleen settings), `delete`, `update_many`, `delete_many`
- Lezen rechtstreeks via de Supabase client (vereist de gezinssessie), plus realtime subscriptions voor live updates
- Toast-notificaties via `toast(msg)`
- Modals via `showChoiceModal(title, body, buttons)`, die het id van de gekozen knop teruggeeft
- Verwijderen met ongedaan maken via `deleteOneWithUndo(table, id, rowData, label)`; `rowData` in DB-vorm (snake_case)
- Nieuwe API-routes: wachtwoord altijd via `checkPassword()` uit `api/_lib/auth.js`; nooit de anon key server-side gebruiken
- Nieuwe tabellen: RLS aan, alleen `for select to authenticated` als de client moet lezen
- Commits op een eigen branch, dan fast-forward naar `main` en pushen (Vercel deployt automatisch)
- De hele app is ~1 HTML-bestand + 1 JS-bestand + 1 CSS-bestand. Houd het simpel.
