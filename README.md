# Timetables

Interaktive Festival-Timetables als reine statische Seite – läuft unverändert auf GitHub Pages.
Kein Server, keine Datenbank, keine Anmeldung.

- **Raster- und Listenansicht**, umschaltbar (Auswahl wird gemerkt)
- **Mehrere Festivaltage**, Reiter zum Wechseln
- **Favoriten antippen** → eigener Laufplan, pro Browser gespeichert
- **„Nur meine Sets“**-Filter, **Suche** nach Acts/Genre, **Live-Marker** für die aktuelle Uhrzeit
- **Teilen-Link**, der den eigenen Plan weitergibt, ohne fremde Favoriten zu überschreiben

## Dateien

```
index.html      Übersicht aller Events
event.html      Timetable eines Events   (?e=<event-id>&d=<tag-id>&fav=<ids>)
admin.html      Editor für Last-Minute-Änderungen (erzeugt JSON, schreibt nichts)
assets/         core.js (Logik), event.js (Ansicht), style.css
data/events.json          Liste der Event-Dateien
data/<event-id>.json      ein Event
```

Der Dateiname **muss** `<id>.json` heißen und zur `id` im JSON passen – daraus baut `event.html` den Link.

## Lokal ansehen

Nicht per Doppelklick öffnen – der Browser darf dann aus `file://` kein JSON laden.
Stattdessen im Projektordner:

```bash
python3 -m http.server 8099
```

Dann <http://localhost:8099> aufrufen.

## Auf GitHub Pages veröffentlichen

1. Auf github.com ein neues Repository anlegen, z.B. `timetables` (public).
2. Im Projektordner:

   ```bash
   git init -b main
   git add .
   git commit -m "Timetable-Seite"
   git remote add origin https://github.com/<dein-name>/timetables.git
   git push -u origin main
   ```

3. Im Repo: **Settings → Pages → Source: „Deploy from a branch“ → Branch `main` / `/ (root)` → Save.**
4. Nach ein bis zwei Minuten liegt die Seite unter `https://<dein-name>.github.io/timetables/`.

Jeder weitere `git push` (oder jede Änderung über den Web-Editor) ist nach ~30 Sekunden live.

## Neues Event hinzufügen

**Der bequeme Weg:** Screenshot bzw. Foto des Timetables in den Chat werfen – ich lege
`data/<event-id>.json` an und trage die Datei in `data/events.json` ein. Hilfreich dabei:
Datum der Tage und wie die Floors heißen, falls das Bild das nicht hergibt.

**Von Hand:** eine Datei nach dem Muster von `data/demo-festival-2026.json` anlegen und
den Dateinamen in `data/events.json` ergänzen.

Die Beispieldatei `demo-festival-2026.json` ist erfunden – löschen, sobald echte Events drin sind
(dann auch den Eintrag aus `events.json` entfernen).

## Last-Minute-Änderungen

`admin.html` öffnen → Event laden → ändern → **„JSON kopieren“** → auf GitHub
`data/<event-id>.json` öffnen, Stift-Symbol, Inhalt ersetzen, „Commit changes“. Geht auch vom Handy.

Der Editor hilft bei genau den Fällen, die nachts auftreten:

| Situation | Vorgehen |
|---|---|
| DJ fällt aus | Status auf **abgesagt** – Set bleibt sichtbar und durchgestrichen, statt spurlos zu verschwinden |
| Set wird länger/kürzer | Endzeit ändern, dann **⇩ anschließen** – das nächste Set auf dem Floor rückt automatisch nach |
| Act kommt dazu | **+ Set**, Name und Zeiten eintragen |
| Floor/Tag fehlt | **+ Floor** bzw. **+ Tag** |

Unter der Tabelle läuft eine Plausibilitätsprüfung mit: Überschneidungen auf einem Floor,
doppelte IDs, fehlende Namen, unsinnige Zeiten. **„Vorschau öffnen“** zeigt den Stand so,
wie er nach dem Commit aussähe – ohne dass ihn schon jemand sieht.

### Die eine Regel: Set-IDs nie ändern

Favoriten hängen an der `id` eines Sets, nicht an Name oder Uhrzeit. Deshalb bleiben markierte
Sets erhalten, wenn ein Set verschoben oder umbenannt wird. Vergibt man dagegen eine neue `id`,
verlieren alle ihre Markierung für dieses Set – und bereits verschickte Teilen-Links zeigen es nicht mehr.

## Datenformat

```jsonc
{
  "id": "hive-indoor-2027",          // = Dateiname ohne .json
  "name": "Hive Indoor Festival",
  "venue": "Messe Erfurt",           // optional
  "dayBoundaryHour": 6,              // Zeiten vor 06:00 zählen zur Nacht des Tages

  "days":   [{ "id": "fr", "label": "Freitag", "date": "2027-02-12" }],
  "floors": [{ "id": "main", "name": "Mainfloor", "color": "#ff4d6d" }],

  "sets": [
    {
      "id": "f01",                   // stabil halten!
      "day": "fr",
      "floor": "main",
      "artist": "Name",
      "start": "23:00",
      "end": "01:00",                // 01:00 landet dank dayBoundaryHour korrekt nach Mitternacht
      "genre": "Hard Techno",        // optional
      "b2b": true,                   // optional, zeigt ein b2b-Label
      "note": "Live-Set",            // optional
      "status": "cancelled"          // optional: cancelled | moved | new
    }
  ]
}
```

`dayBoundaryHour: 6` heißt: Alles vor 06:00 gehört zur Nacht des angegebenen Tages.
Ein Set von 23:00 bis 05:00 am 12.02. läuft also korrekt bis zum Morgen des 13.02.
Bei einem Open Air, das mittags beginnt und vor Mitternacht endet, kann der Wert auf `0` stehen.

## Grenzen

Favoriten liegen im `localStorage` – also **pro Browser und pro Gerät**. Ohne Backend gibt es
keinen Sync zwischen Handy und Laptop; der Teilen-Link ist der Weg dorthin. Im privaten Modus
oder nach dem Löschen der Browserdaten sind die Markierungen weg.
