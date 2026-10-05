/* Gemeinsame Logik fuer Index-, Event- und Admin-Seite. Kein Framework, keine Abhaengigkeiten. */
window.TT = (function () {
  'use strict';

  const DATA_DIR = 'data/';
  const DEFAULT_BOUNDARY = 6; // Zeiten vor 06:00 gehoeren zur Nacht des Vortages

  /* ---------- Laden ---------- */

  async function loadManifest() {
    const res = await fetch(DATA_DIR + 'events.json', { cache: 'no-cache' });
    if (!res.ok) throw new Error('events.json nicht gefunden (' + res.status + ')');
    const json = await res.json();
    return json.events || [];
  }

  async function loadEventFile(file) {
    const res = await fetch(DATA_DIR + file, { cache: 'no-cache' });
    if (!res.ok) throw new Error(file + ' nicht gefunden (' + res.status + ')');
    return prepare(await res.json());
  }

  // Dateiname ist per Konvention <id>.json
  const loadEventById = (id) => loadEventFile(id + '.json');

  /* ---------- Zeiten ---------- */

  // "23:00" + Tagesdatum -> echtes Date. Zeiten vor dayBoundaryHour zaehlen als naechster Kalendertag.
  function resolveTime(dateStr, value, boundaryHour) {
    if (typeof value !== 'string') return null;
    if (value.includes('T')) {
      const d = new Date(value);
      return isNaN(d) ? null : d;
    }
    const m = value.match(/^(\d{1,2}):(\d{2})$/);
    if (!m) return null;
    const h = +m[1], min = +m[2];
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return null;
    d.setHours(h, min, 0, 0);
    if (h < boundaryHour) d.setDate(d.getDate() + 1);
    return d;
  }

  // Ergaenzt jedes Set um _start/_end (Date) und _dur (Minuten). Mutiert das Event.
  function prepare(ev) {
    const boundary = Number.isFinite(ev.dayBoundaryHour) ? ev.dayBoundaryHour : DEFAULT_BOUNDARY;
    ev.dayBoundaryHour = boundary;
    ev.days = ev.days || [];
    ev.floors = ev.floors || [];
    ev.sets = (ev.sets || []).filter((s) => s && s.id);

    const dayById = new Map(ev.days.map((d) => [d.id, d]));

    for (const s of ev.sets) {
      const day = dayById.get(s.day);
      if (!day) { s._start = s._end = null; continue; }
      const start = resolveTime(day.date, s.start, boundary);
      let end = resolveTime(day.date, s.end, boundary);
      // Sicherheitsnetz: 03:30->06:00 landet sonst auf unterschiedlichen Tagen falsch herum.
      if (start && end && end <= start) end = new Date(end.getTime() + 864e5);
      s._start = start;
      s._end = end;
      s._dur = start && end ? Math.round((end - start) / 6e4) : 0;
    }

    ev.sets.sort((a, b) => (a._start && b._start ? a._start - b._start : 0));
    return ev;
  }

  const setsForDay = (ev, dayId) =>
    ev.sets.filter((s) => s.day === dayId && s._start && s._end && s.status !== 'cancelled');

  const cancelledForDay = (ev, dayId) =>
    ev.sets.filter((s) => s.day === dayId && s.status === 'cancelled');

  // Welcher Tag ist "jetzt"? Sonst der naechste in der Zukunft, sonst der erste.
  function currentDayId(ev) {
    const now = Date.now();
    const ranges = ev.days.map((d) => {
      const sets = setsForDay(ev, d.id);
      if (!sets.length) return { id: d.id, from: Infinity, to: -Infinity };
      return {
        id: d.id,
        from: Math.min(...sets.map((s) => +s._start)),
        to: Math.max(...sets.map((s) => +s._end)),
      };
    });
    const live = ranges.find((r) => now >= r.from && now <= r.to);
    if (live) return live.id;
    const upcoming = ranges.filter((r) => r.from > now).sort((a, b) => a.from - b.from)[0];
    return upcoming ? upcoming.id : (ev.days[0] && ev.days[0].id) || null;
  }

  /* ---------- Favoriten (pro Browser, pro Event) ---------- */

  const favKey = (eventId) => 'tt.fav.' + eventId;

  function readStore(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }

  function writeStore(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false; // Privater Modus / Speicher voll
    }
  }

  function makeFavourites(eventId) {
    let ids = new Set(readStore(favKey(eventId), []));
    const persist = () => writeStore(favKey(eventId), [...ids]);
    return {
      has: (id) => ids.has(id),
      list: () => [...ids],
      size: () => ids.size,
      toggle(id) {
        ids.has(id) ? ids.delete(id) : ids.add(id);
        persist();
        return ids.has(id);
      },
      replaceAll(next) { ids = new Set(next); persist(); },
      merge(next) { next.forEach((id) => ids.add(id)); persist(); },
      clear() { ids = new Set(); persist(); },
    };
  }

  /* ---------- Teilen ---------- */

  // Set-IDs sind stabil -> Links bleiben gueltig, auch wenn Zeiten korrigiert werden.
  const encodeFavs = (idList) => idList.slice().sort().join('.');
  const decodeFavs = (str) => (str ? str.split('.').filter(Boolean) : []);

  function shareUrl(eventId, dayId, idList) {
    const u = new URL('event.html', location.href);
    u.searchParams.set('e', eventId);
    if (dayId) u.searchParams.set('d', dayId);
    u.searchParams.set('fav', encodeFavs(idList));
    return u.toString();
  }

  /* ---------- Darstellung ---------- */

  const pad = (n) => String(n).padStart(2, '0');
  const fmtTime = (d) => (d ? pad(d.getHours()) + ':' + pad(d.getMinutes()) : '--:--');

  function fmtDayDate(dateStr) {
    const d = new Date(dateStr + 'T00:00:00');
    if (isNaN(d)) return dateStr;
    return d.toLocaleDateString('de-DE', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  function fmtDuration(min) {
    if (!min) return '';
    const h = Math.floor(min / 60), m = min % 60;
    return (h ? h + ' h' : '') + (h && m ? ' ' : '') + (m ? m + ' min' : '');
  }

  // Legt sich ueberschneidende Sets auf parallele Spuren, damit nichts uebereinander liegt.
  function packLanes(sets) {
    const laneEnds = [];
    for (const s of sets) {
      let lane = laneEnds.findIndex((end) => end <= +s._start);
      if (lane === -1) { lane = laneEnds.length; laneEnds.push(0); }
      laneEnds[lane] = +s._end;
      s._lane = lane;
    }
    for (const s of sets) s._laneCount = laneEnds.length;
    return laneEnds.length;
  }

  // Deutsche Schreibweisen gleichwertig machen: "Jaeger" wird mit "jager",
  // "jaeger" und "jager" gefunden, egal ob die Daten Umlaut oder ue enthalten.
  function variants(str) {
    const strip = (x) => x.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
    // Ø/Æ/Å zerlegt NFD nicht – in Techno-Lineups aber Dauergast (GIØ, BØERY, SANTØS)
    const base = (str || '').toLowerCase()
      .replace(/ß/g, 'ss').replace(/ø/g, 'o').replace(/æ/g, 'ae').replace(/å/g, 'a')
      .replace(/đ|ð/g, 'd').replace(/ł/g, 'l').replace(/þ/g, 'th');
    const stripped = strip(base);
    const spelled = strip(base.replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue'));
    const collapsed = stripped.replace(/ae/g, 'a').replace(/oe/g, 'o').replace(/ue/g, 'u');
    // Ohne Satzzeichen, damit "obi" auch O.B.I. und "vorteks" auch VORTEK'S findet
    const squashed = stripped.replace(/[^a-z0-9]/g, '');
    return [...new Set([stripped, spelled, collapsed, squashed])].filter(Boolean);
  }

  function matchesQuery(set, query) {
    const q = (query || '').trim();
    if (!q) return true;
    const hay = variants((set.artist || '') + ' ' + (set.genre || ''));
    return q.split(/\s+/).every((term) =>
      variants(term).some((tv) => hay.some((h) => h.includes(tv))));
  }

  function escapeHtml(str) {
    return String(str == null ? '' : str).replace(/[&<>"']/g,
      (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }

  return {
    DATA_DIR, loadManifest, loadEventFile, loadEventById, prepare, resolveTime,
    setsForDay, cancelledForDay, currentDayId,
    makeFavourites, readStore, writeStore,
    encodeFavs, decodeFavs, shareUrl,
    fmtTime, fmtDayDate, fmtDuration, packLanes, matchesQuery, escapeHtml,
  };
})();
