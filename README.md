# Timetables

Interaktive Festival-Timetables als reine statische Seite – läuft unverändert auf GitHub Pages.
Kein Server, keine Datenbank, keine Anmeldung.

- **Raster- und Listenansicht**, umschaltbar (Auswahl wird gemerkt)
- **Mehrere Festivaltage**, Reiter zum Wechseln
- **Favoriten antippen** → eigener Laufplan, pro Browser gespeichert
- **„Nur meine Sets“**-Filter, **Suche** nach Acts/Genre, **Live-Marker** für die aktuelle Uhrzeit
- **Teilen-Link**, der den eigenen Plan weitergibt, ohne fremde Favoriten zu überschreiben
- **Export** als Bild (PNG) oder PDF – markierte Sets hervorgehoben, der Rest ausgegraut
- **Backup** aller Markierungen als Datei, jederzeit wieder einspielbar

## Dateien

```
index.html      Übersicht aller Events
event.html      Timetable eines Events   (?e=<event-id>&d=<tag-id>&fav=<ids>)
assets/         core.js (Logik), event.js (Ansicht), export.js (Bild/PDF/Backup), style.css
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

**Von Hand:** eine Datei nach dem Muster von `data/hive-indoor-2026.json` anlegen und
den Dateinamen in `data/events.json` ergänzen.

> **Achtung beim Teilen:** `index.html` listet *alle* Events aus `events.json` auf. Sobald dort ein
> zweites Event steht, kann jeder, der einen Event-Link hat, über die Startseite auch die anderen
> finden. Wer das nicht will, trägt neue Events nicht in `events.json` ein – sie bleiben dann über
> ihren direkten Link erreichbar, tauchen aber in keiner Liste auf.

## Last-Minute-Änderungen

Alles läuft über den GitHub-Web-Editor – geht auch vom Handy:

1. **https://github.com/rbnsch/timetables** → `data/` → die Event-Datei antippen
2. Stift-Symbol oben rechts
3. Ändern → **Commit changes**
4. Nach ~30 Sekunden ist es live

### Notfall-Spickzettel

Ein Set sieht im JSON so aus:

```json
{ "id": "tc05", "day": "d1", "floor": "colosseum", "artist": "KOBOSIL", "start": "21:00", "end": "22:30" },
```

| Situation | Was ändern |
|---|---|
| **DJ fällt aus** | `"status": "cancelled"` vor der schließenden Klammer ergänzen. Das Set bleibt durchgestrichen stehen, statt spurlos zu verschwinden – so sehen alle, dass der Slot tot ist. |
| **Set wird länger** | `"end"` erhöhen. Und beim **nächsten** Set auf demselben Floor `"start"` gleich mitziehen, sonst überlappen sie. |
| **Act kommt dazu** | Ganze Zeile kopieren, einfügen, `"id"` auf etwas Neues ändern (z.B. `"tc99"`), Rest anpassen. |
| **Umbenennung** | Nur `"artist"` ändern. Die `id` **nicht** anfassen – sonst verlieren alle ihre Markierung. |

### Die drei Fallen im JSON

1. **Komma am Zeilenende** – jede Set-Zeile endet mit `,`, nur die letzte vor der `]` nicht.
2. **Anführungszeichen** – alle Werte in `"..."`, auch Uhrzeiten: `"start": "23:00"`, nicht `23:00`.
3. **Zeiten über Mitternacht** – einfach `"01:30"` schreiben. Dank `dayBoundaryHour` landet das automatisch auf dem Folgetag; kein Datum nötig.

GitHub prüft die Syntax nicht. Wenn nach dem Commit auf der Seite *„Timetable konnte nicht geladen werden"* steht, ist meist ein Komma zu viel oder zu wenig im Spiel. Dann hilft **History → vorherige Version → Revert**, und du bist in 30 Sekunden zurück im funktionierenden Zustand.

> Zum Gegenprüfen vor dem Commit: Text in einen JSON-Validator wie <https://jsonlint.com> einfügen. Der zeigt die fehlerhafte Zeile an.

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

## Export und Backup

Button **Export** im Timetable:

| | |
|---|---|
| **Als Bild (PNG)** | Der gewählte Tag als Grafik: markierte Sets leuchten gelb mit ★, alle anderen bleiben lesbar, aber ausgegraut. Gut zum Verschicken per Messenger. |
| **Als PDF / drucken** | Öffnet den Druckdialog, dort „Als PDF speichern“. Druckt hell auf weiß statt clubschwarz, mit Legende und derselben Hervorhebung. |
| **Backup speichern** | Alle Markierungen **aller** Events als `.json`. |
| **Backup laden** | Spielt so eine Datei wieder ein – wahlweise *ersetzen* oder mit Vorhandenem *zusammenführen*. |

Backup und Wiederherstellung gibt es zusätzlich unten auf der Startseite, weil sie alle Events betreffen.
So kommen die Markierungen auch vom Handy auf den Laptop – oder zurück, wenn jemand seine Browserdaten löscht.

Das Backup enthält nur Set-IDs, keine Namen:

```json
{
  "type": "timetable-favorites",
  "version": 1,
  "exported": "2026-10-05T12:00:00.000Z",
  "favorites": { "hive-indoor-2027": ["f03", "f11"] }
}
```

## Wer darf was ändern?

Ändern kann den Timetable **nur, wer Schreibrechte auf das GitHub-Repository hat** – also du.
Die Seite selbst hat kein Backend und keine Schreib-Schnittstelle; Besucher laden nur fertige Dateien.

Es gibt auf der Seite keinerlei Bearbeitungsfunktion – weder sichtbar noch versteckt.

Ebenso sind Markierungen **pro Browser**: Niemand kann die Favoriten eines anderen verändern,
auch nicht über einen Teilen-Link (der schlägt nur vor, zu übernehmen).

Was öffentlich ist: **alles im Repository.** Bei einem öffentlichen Repo kann jeder mit dem Link
auch `index.html` aufrufen und damit alle eingetragenen Events sehen – ein Teilen-Link schränkt
nicht auf ein Event ein, er springt nur direkt dorthin.

## Grenzen

Favoriten liegen im `localStorage` – also **pro Browser und pro Gerät**. Ohne Backend gibt es
keinen Sync zwischen Handy und Laptop; der Teilen-Link ist der Weg dorthin. Im privaten Modus
oder nach dem Löschen der Browserdaten sind die Markierungen weg.
