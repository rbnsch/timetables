/* Export: Bild (PNG), Druck/PDF und Backup der Markierungen. */
window.TTExport = (function () {
  'use strict';

  const FAV_PREFIX = 'tt.fav.';
  const PART_PREFIX = 'tt.part.';

  function download(blob, filename) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }

  const slug = (s) => (s || '')
    .toLowerCase()
    .replace(/ä/g, 'ae').replace(/ö/g, 'oe').replace(/ü/g, 'ue').replace(/ß/g, 'ss')
    .replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'timetable';

  /* ---------- Backup ---------- */

  // Alle Markierungen aus allen Events einsammeln.
  function collectFavourites() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || key.indexOf(FAV_PREFIX) !== 0) continue;
      try {
        const ids = JSON.parse(localStorage.getItem(key));
        if (Array.isArray(ids) && ids.length) out[key.slice(FAV_PREFIX.length)] = ids;
      } catch (e) { /* kaputter Eintrag wird uebersprungen */ }
    }
    return out;
  }

  // Teilbesuche aller Events: { eventId: { setId: [von, bis] } }
  function collectPartials() {
    const out = {};
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (!key || key.indexOf(PART_PREFIX) !== 0) continue;
      try {
        const map = JSON.parse(localStorage.getItem(key));
        if (map && typeof map === 'object' && Object.keys(map).length) {
          out[key.slice(PART_PREFIX.length)] = map;
        }
      } catch (e) { /* kaputter Eintrag wird uebersprungen */ }
    }
    return out;
  }

  function downloadBackup() {
    const favourites = collectFavourites();
    const payload = {
      type: 'timetable-favorites',
      version: 2,
      exported: new Date().toISOString(),
      favorites: favourites,
      partials: collectPartials(),
    };
    const stamp = new Date().toISOString().slice(0, 10);
    download(new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' }),
      'timetable-favoriten-' + stamp + '.json');
    return {
      events: Object.keys(favourites).length,
      sets: Object.values(favourites).reduce((n, a) => n + a.length, 0),
    };
  }

  async function readBackup(file) {
    const data = JSON.parse(await file.text());
    if (!data || data.type !== 'timetable-favorites' || !data.favorites ||
        typeof data.favorites !== 'object') {
      throw new Error('Das ist keine Timetable-Backup-Datei.');
    }
    return data;
  }

  // mode: 'merge' behaelt vorhandene Markierungen, 'replace' ersetzt sie pro Event.
  function applyBackup(data, mode) {
    let events = 0, sets = 0;
    for (const eventId of Object.keys(data.favorites)) {
      const incoming = data.favorites[eventId];
      if (!Array.isArray(incoming)) continue;
      const key = FAV_PREFIX + eventId;
      let next = incoming.filter((id) => typeof id === 'string');
      if (mode === 'merge') {
        let current = [];
        try { current = JSON.parse(localStorage.getItem(key)) || []; } catch (e) { current = []; }
        next = [...new Set([...current, ...next])];
      }
      localStorage.setItem(key, JSON.stringify(next));
      events++;
      sets += next.length;
    }

    // Aeltere Backups (version 1) haben kein partials – dann bleibt es einfach leer.
    const parts = (data.partials && typeof data.partials === 'object') ? data.partials : {};
    for (const eventId of Object.keys(parts)) {
      const incoming = parts[eventId];
      if (!incoming || typeof incoming !== 'object') continue;
      const key = PART_PREFIX + eventId;
      let next = {};
      for (const setId of Object.keys(incoming)) {
        const r = incoming[setId];
        if (Array.isArray(r) && r.length === 2 && isFinite(r[0]) && isFinite(r[1])) next[setId] = r;
      }
      if (mode === 'merge') {
        let current = {};
        try { current = JSON.parse(localStorage.getItem(key)) || {}; } catch (e) { current = {}; }
        next = Object.assign(current, next);
      }
      localStorage.setItem(key, JSON.stringify(next));
    }

    return { events, sets };
  }

  /* ---------- Bild ---------- */

  function roundRect(ctx, x, y, w, h, r) {
    const rad = Math.min(r, w / 2, h / 2);
    ctx.beginPath();
    if (ctx.roundRect) { ctx.roundRect(x, y, w, h, rad); return; }
    ctx.moveTo(x + rad, y);
    ctx.arcTo(x + w, y, x + w, y + h, rad);
    ctx.arcTo(x + w, y + h, x, y + h, rad);
    ctx.arcTo(x, y + h, x, y, rad);
    ctx.arcTo(x, y, x + w, y, rad);
    ctx.closePath();
  }

  function fit(ctx, text, max) {
    if (ctx.measureText(text).width <= max) return text;
    let t = text;
    while (t.length > 1 && ctx.measureText(t + '…').width > max) t = t.slice(0, -1);
    return t + '…';
  }

  const partialOf = (set, partMap) =>
    (partMap ? TT.partialRange(set, partMap[set.id]) : null);

  // "#abc" / "#aabbcc" -> [r,g,b]; alles andere (rgb(), Farbnamen) -> null
  function toRgb(c) {
    const m = /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((c || '').trim());
    if (!m) return null;
    const h = m[1].length === 3 ? m[1].replace(/./g, (x) => x + x) : m[1];
    return [parseInt(h.slice(0, 2), 16), parseInt(h.slice(2, 4), 16), parseInt(h.slice(4, 6), 16)];
  }

  const mix = (a, b, t) =>
    (a && b) ? 'rgb(' + a.map((v, i) => Math.round(v + (b[i] - v) * t)).join(',') + ')' : null;

  // Farben aus der aktiven Palette ziehen, damit das Bild wie die Seite aussieht.
  function palette() {
    const v = (name, fb) => TT.themeColor(name, fb);
    const accent = v('--accent', '#ffd84d');
    const panel = v('--bg-raised', '#15171f');
    const accentRgb = toRgb(accent);
    const white = [255, 255, 255];
    return {
      bg: v('--bg', '#0c0d12'),
      panel: panel,
      line: v('--line', '#262a36'),
      soft: v('--line-soft', '#1c1f29'),
      fg: v('--fg', '#eef0f6'),
      dim: v('--fg-dim', '#969cb0'),
      faint: v('--fg-faint', '#636a80'),
      accent: accent,
      // Hintergrund des markierten Blocks: Akzent leicht in die Flaeche gemischt
      favBg: mix(toRgb(panel), accentRgb, 0.17) || panel,
      // Schrift darauf: Akzent Richtung Weiss aufgehellt, sonst zu dunkel
      favFg: mix(accentRgb, white, 0.45) || accent,
      favDim: mix(accentRgb, white, 0.15) || accent,
      shade: toRgb(v('--bg', '#0c0d12')),
    };
  }

  // Zeichnet den Tag als Bild: Markiertes leuchtet, der Rest bleibt lesbar, aber grau.
  function pngForDay(ev, dayId, favIds, partMap) {
    const C = palette();
    const day = ev.days.find((d) => d.id === dayId) || {};
    const sets = ev.sets
      .filter((s) => s.day === dayId && s._start && s._end)
      .sort((a, b) => a._start - b._start);
    if (!sets.length) throw new Error('Für diesen Tag gibt es nichts zu exportieren.');

    const floors = ev.floors.filter((f) => sets.some((s) => s.floor === f.id));
    for (const s of sets) {
      if (!floors.some((f) => f.id === s.floor)) floors.push({ id: s.floor, name: s.floor });
    }

    const S = 2, PPM = 1.15, AXIS = 52, COL = 170, PAD = 20;
    const HEAD = 74, FLOORH = 30, FOOT = 34;

    const from = new Date(Math.min(...sets.map((s) => +s._start)));
    from.setMinutes(0, 0, 0);
    const to = new Date(Math.max(...sets.map((s) => +s._end)));
    if (to.getMinutes() || to.getSeconds()) { to.setMinutes(0, 0, 0); to.setHours(to.getHours() + 1); }

    const totalMin = Math.max(60, (to - from) / 6e4);
    const gridH = totalMin * PPM;
    const W = PAD * 2 + AXIS + floors.length * COL;
    const H = HEAD + FLOORH + gridH + FOOT;

    const canvas = document.createElement('canvas');
    canvas.width = W * S;
    canvas.height = H * S;
    const ctx = canvas.getContext('2d');
    ctx.scale(S, S);
    ctx.textBaseline = 'top';

    ctx.fillStyle = C.bg;
    ctx.fillRect(0, 0, W, H);

    // Kopfzeile
    const favCount = sets.filter((s) => favIds.has(s.id)).length;
    ctx.fillStyle = C.fg;
    ctx.font = '700 21px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText(fit(ctx, ev.name || 'Timetable', W - PAD * 2 - 150), PAD, 20);

    ctx.fillStyle = C.dim;
    ctx.font = '13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    const sub = [day.label, day.date ? TT.fmtDayDate(day.date) : '', ev.venue]
      .filter(Boolean).join(' · ');
    ctx.fillText(fit(ctx, sub, W - PAD * 2 - 150), PAD, 47);

    if (favCount) {
      ctx.fillStyle = C.accent;
      ctx.font = '600 14px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.textAlign = 'right';
      ctx.fillText('★ ' + favCount + (favCount === 1 ? ' Set markiert' : ' Sets markiert'), W - PAD, 24);
      ctx.textAlign = 'left';
    }

    const gridTop = HEAD + FLOORH;
    const topOf = (d) => gridTop + ((d - from) / 6e4) * PPM;

    // Floor-Köpfe
    floors.forEach((f, i) => {
      const x = PAD + AXIS + i * COL;
      ctx.fillStyle = f.color || C.accent;
      ctx.fillRect(x, HEAD, COL - 4, 3);
      ctx.fillStyle = C.fg;
      ctx.font = '600 13px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
      ctx.fillText(fit(ctx, f.name || f.id, COL - 14), x + 2, HEAD + 10);
    });

    // Stundenraster
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    for (let m = 0; m <= totalMin; m += 60) {
      const t = new Date(+from + m * 6e4);
      const y = gridTop + m * PPM;
      ctx.strokeStyle = C.soft;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(PAD + AXIS, y + 0.5);
      ctx.lineTo(W - PAD, y + 0.5);
      ctx.stroke();
      ctx.fillStyle = C.faint;
      ctx.fillText(TT.fmtTime(t), PAD, y - 6);
    }

    // Sets
    floors.forEach((f, i) => {
      const colX = PAD + AXIS + i * COL;
      const mine = sets.filter((s) => s.floor === f.id).sort((a, b) => a._start - b._start);
      TT.packLanes(mine);

      for (const s of mine) {
        const lanes = s._laneCount || 1;
        const w = (COL - 6) / lanes;
        const x = colX + s._lane * w;
        const y = topOf(s._start);
        const h = Math.max(16, (s._dur * PPM) - 3);
        const fav = favIds.has(s.id);
        const off = s.status === 'cancelled';
        const part = fav ? partialOf(s, partMap) : null;

        ctx.fillStyle = fav ? C.favBg : C.panel;
        roundRect(ctx, x, y, w - 3, h, 6);
        ctx.fill();
        ctx.strokeStyle = fav ? C.accent : C.line;
        ctx.lineWidth = fav ? 1.5 : 1;
        roundRect(ctx, x, y, w - 3, h, 6);
        ctx.stroke();

        // Floor-Farbe als Kante links
        ctx.fillStyle = fav ? C.accent : (f.color || C.line);
        ctx.globalAlpha = fav ? 1 : 0.55;
        ctx.fillRect(x, y + 2, 2.5, h - 4);
        ctx.globalAlpha = 1;

        // Nicht besuchte Minuten abdunkeln – der gewaehlte Ausschnitt bleibt hell.
        if (part) {
          const scale = h / Math.max(1, s._dur * PPM);
          const a = part.from * PPM * scale;
          const b = part.to * PPM * scale;
          ctx.save();
          roundRect(ctx, x, y, w - 3, h, 6);
          ctx.clip();
          ctx.fillStyle = C.shade
            ? 'rgba(' + C.shade.join(',') + ',0.72)'
            : 'rgba(12,13,18,0.72)';
          if (a > 0.5) ctx.fillRect(x, y, w - 3, a);
          if (h - b > 0.5) ctx.fillRect(x, y + b, w - 3, h - b);
          ctx.restore();
        }

        // Bei markierten Sets sitzt rechts oben der ★ – dafuer Platz lassen.
        const textW = w - 16 - (fav ? 11 : 0);
        const shownRange = part
          ? TT.fmtTime(part.start) + '–' + TT.fmtTime(part.end)
          : TT.fmtTime(s._start) + '–' + TT.fmtTime(s._end);
        ctx.fillStyle = fav ? C.favFg : (off ? C.faint : C.dim);
        ctx.font = (fav ? '700 ' : '600 ') + '12px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
        const name = (s.artist || '') + (off ? ' (abgesagt)' : '');
        ctx.fillText(fit(ctx, name, textW), x + 7, y + 5);

        if (h > 30) {
          ctx.fillStyle = fav ? C.favDim : C.faint;
          ctx.font = '11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
          ctx.fillText((part ? '\u2702 ' : '') + shownRange, x + 7, y + 21);
        }
        if (fav) {
          ctx.fillStyle = C.accent;
          ctx.font = '11px system-ui, sans-serif';
          ctx.textAlign = 'right';
          ctx.fillText('★', x + w - 7, y + 5);
          ctx.textAlign = 'left';
        }

      }
    });

    // Fußzeile
    ctx.fillStyle = C.faint;
    ctx.font = '11px system-ui, -apple-system, "Segoe UI", Roboto, sans-serif';
    ctx.fillText('Stand ' + new Date().toLocaleString('de-DE',
      { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      PAD, H - FOOT + 10);
    ctx.textAlign = 'right';
    ctx.fillText(location.host + location.pathname.replace(/[^/]*$/, ''), W - PAD, H - FOOT + 10);
    ctx.textAlign = 'left';

    return new Promise((resolve, reject) => {
      canvas.toBlob((blob) => {
        if (!blob) return reject(new Error('Bild konnte nicht erzeugt werden.'));
        download(blob, slug(ev.name) + '-' + slug(day.label || dayId) + '.png');
        resolve({ width: W, height: H, favCount });
      }, 'image/png');
    });
  }

  /* ---------- Druck / PDF ---------- */

  function printPlan() {
    window.print();
  }

  return { downloadBackup, readBackup, applyBackup, collectFavourites, collectPartials, pngForDay, printPlan };
})();
