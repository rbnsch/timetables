/* Timetable-Ansicht: Raster/Liste, Favoriten, Suche, Live-Marker, Teilen. */
(function () {
  'use strict';

  const $ = (sel, root) => (root || document).querySelector(sel);
  const params = new URLSearchParams(location.search);

  const state = {
    ev: null,
    dayId: null,
    view: null,          // 'grid' | 'list'
    query: '',
    onlyFavs: false,
    favs: null,
    parts: null,         // Teilbesuche: { setId: [vonMin, bisMin] }
    sharedIds: null,     // IDs aus einem geteilten Link
    sharedParts: null,
    viewingShared: false,
    didAutoScroll: false,
  };

  const VIEW_KEY = 'tt.view';

  /* ---------- Start ---------- */

  async function init() {
    const id = params.get('e');
    if (!id) return fail('Kein Event angegeben.');

    try {
      state.ev = await TT.loadEventById(id);
    } catch (err) {
      return fail('Timetable konnte nicht geladen werden: ' + TT.escapeHtml(err.message));
    }

    const ev = state.ev;
    // Vor dem ersten Render, damit nichts kurz in der Standardfarbe aufblitzt.
    TT.applyTheme(ev.theme);
    document.title = ev.name + ' – Timetable';
    $('#evname').textContent = ev.name;
    if (ev.venue) $('#evvenue').textContent = ev.venue;

    state.favs = TT.makeFavourites(ev.id);
    state.parts = TT.makePartials(ev.id);

    const shared = TT.decodeFavs(params.get('fav'));
    const knownIds = new Set(ev.sets.map((s) => s.id));
    const validShared = shared.filter((sid) => knownIds.has(sid));
    if (validShared.length) {
      state.sharedIds = new Set(validShared);
      const incoming = TT.decodeParts(params.get('part'));
      state.sharedParts = {};
      for (const id of Object.keys(incoming)) {
        if (state.sharedIds.has(id)) state.sharedParts[id] = incoming[id];
      }
      state.viewingShared = true;
      showSharedBanner(validShared.length, shared.length - validShared.length);
    }

    const wantedDay = params.get('d');
    state.dayId = ev.days.some((d) => d.id === wantedDay) ? wantedDay : TT.currentDayId(ev);

    const storedView = TT.readStore(VIEW_KEY, null);
    state.view = storedView === 'grid' || storedView === 'list'
      ? storedView
      : (window.matchMedia('(max-width: 760px)').matches ? 'list' : 'grid');

    buildDayTabs();
    wireControls();

    // Einmalige Delegation: #view wird bei jedem Render neu befuellt, bleibt aber bestehen.
    // Der ★ liegt im Set-Element, darum zuerst darauf pruefen.
    $('#view').addEventListener('click', (e) => {
      const star = e.target.closest('[data-edit]');
      if (star) { openPartial(star.dataset.edit); return; }
      const el = e.target.closest('[data-set]');
      if (!el) return;
      const set = state.ev.sets.find((s) => s.id === el.dataset.set);
      if (set) toggleFav(set);
    });

    // Set-Bloecke sind divs mit role="button" – Tastatur muss von Hand nachgezogen werden.
    $('#view').addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      const star = e.target.closest('[data-edit]');
      if (star) return; // echte <button>, macht der Browser selbst
      const el = e.target.closest('[data-set]');
      if (!el) return;
      e.preventDefault();
      const set = state.ev.sets.find((s) => s.id === el.dataset.set);
      if (set) toggleFav(set);
    });

    wirePartialDialog();

    render();

    tickClock();
    setInterval(tickClock, 15000);
    setInterval(() => render({ keepScroll: true }), 60000);

    let resizeTimer;
    window.addEventListener('resize', () => {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(() => render({ keepScroll: true }), 180);
    });
  }

  function fail(html) {
    $('#view').innerHTML = '<div class="error">' + html + '</div>';
  }

  /* ---------- Favoriten-Quelle ---------- */

  const activeIds = () => (state.viewingShared ? state.sharedIds : new Set(state.favs.list()));
  const activeParts = () => (state.viewingShared ? (state.sharedParts || {}) : state.parts.all());
  const isFav = (set) => activeIds().has(set.id);

  // Teilbesuch eines Sets als echte Zeiten – oder null, wenn das ganze Set gilt.
  const partFor = (set) =>
    (isFav(set) ? TT.partialRange(set, activeParts()[set.id]) : null);

  function toggleFav(set) {
    if (state.viewingShared) {
      flash('Das ist ein geteilter Plan. Oben „Zu meinem Plan hinzufügen“ oder „Eigenen Plan“ wählen.');
      return;
    }
    const nowFav = state.favs.toggle(set.id);
    // Entfernt man das Set, ergibt ein gespeicherter Teilbesuch keinen Sinn mehr.
    if (!nowFav) state.parts.clear(set.id);
    else if (!TT.readStore('tt.hint.part', false)) {
      TT.writeStore('tt.hint.part', true);
      flash('Tipp: Auf den ★ tippen, wenn du nur einen Teil des Sets sehen willst.');
    }
    render({ keepScroll: true });
  }

  /* ---------- Banner für geteilte Pläne ---------- */

  function showSharedBanner(count, dropped) {
    const el = $('#banner');
    el.hidden = false;
    el.innerHTML =
      '<p><strong>Geteilter Plan</strong> mit ' + count + ' Set' + (count === 1 ? '' : 's') +
      '. Deine eigenen Favoriten sind unberührt.' +
      (dropped ? ' <span class="faint">(' + dropped + ' Set(s) aus dem Link existieren nicht mehr.)</span>' : '') +
      '</p>' +
      '<button class="btn sm" id="adopt">Zu meinem Plan hinzufügen</button>' +
      '<button class="btn sm ghost" id="ownplan">Eigenen Plan</button>';

    $('#adopt').addEventListener('click', () => {
      state.favs.merge([...state.sharedIds]);
      if (state.sharedParts) state.parts.merge(state.sharedParts);
      leaveShared('Übernommen – ' + state.favs.size() + ' Sets in deinem Plan.');
    });
    $('#ownplan').addEventListener('click', () => leaveShared(''));
  }

  function leaveShared(message) {
    state.viewingShared = false;
    state.sharedIds = null;
    const el = $('#banner');
    if (message) {
      el.innerHTML = '<p>' + TT.escapeHtml(message) + '</p>';
      setTimeout(() => { el.hidden = true; }, 4000);
    } else {
      el.hidden = true;
    }
    state.sharedParts = null;
    const u = new URL(location.href);
    u.searchParams.delete('fav');
    u.searchParams.delete('part');
    history.replaceState(null, '', u);
    render({ keepScroll: true });
  }

  function flash(msg) {
    const el = $('#banner');
    el.hidden = false;
    el.innerHTML = '<p>' + TT.escapeHtml(msg) + '</p>';
    clearTimeout(flash._t);
    flash._t = setTimeout(() => { el.hidden = true; }, 4500);
  }

  /* ---------- Tagesreiter ---------- */

  function buildDayTabs() {
    const box = $('#daytabs');
    const ev = state.ev;
    if (ev.days.length < 2) { box.hidden = true; return; }

    box.innerHTML = '';
    for (const d of ev.days) {
      const b = document.createElement('button');
      b.className = 'daytab';
      b.type = 'button';
      b.setAttribute('aria-pressed', String(d.id === state.dayId));
      b.innerHTML = '<b>' + TT.escapeHtml(d.label || d.id) + '</b><span>' +
        TT.escapeHtml(TT.fmtDayDate(d.date)) + '</span>';
      b.addEventListener('click', () => {
        state.dayId = d.id;
        state.didAutoScroll = false;
        [...box.children].forEach((c, i) =>
          c.setAttribute('aria-pressed', String(ev.days[i].id === d.id)));
        const u = new URL(location.href);
        u.searchParams.set('d', d.id);
        history.replaceState(null, '', u);
        render();
      });
      box.appendChild(b);
    }
  }

  /* ---------- Steuerung ---------- */

  function wireControls() {
    const gridBtn = $('#viewGrid'), listBtn = $('#viewList');
    const syncView = () => {
      gridBtn.setAttribute('aria-pressed', String(state.view === 'grid'));
      listBtn.setAttribute('aria-pressed', String(state.view === 'list'));
    };
    const setView = (v) => {
      state.view = v;
      TT.writeStore(VIEW_KEY, v);
      state.didAutoScroll = false;
      syncView();
      render();
    };
    gridBtn.addEventListener('click', () => setView('grid'));
    listBtn.addEventListener('click', () => setView('list'));
    syncView();

    const input = $('#q');
    input.addEventListener('input', () => {
      state.query = input.value;
      $('#qclear').hidden = !input.value;
      render({ keepScroll: true });
    });
    $('#qclear').addEventListener('click', () => {
      input.value = '';
      state.query = '';
      $('#qclear').hidden = true;
      input.focus();
      render({ keepScroll: true });
    });

    $('#onlyFavs').addEventListener('click', (e) => {
      state.onlyFavs = !state.onlyFavs;
      e.currentTarget.setAttribute('aria-pressed', String(state.onlyFavs));
      render();
    });

    $('#share').addEventListener('click', openShare);
    $('#export').addEventListener('click', openExport);
    wireExport();
  }

  /* ---------- Export ---------- */

  function openExport() {
    const n = activeIds().size;
    $('#exportInfo').textContent = n
      ? n + ' markierte Sets insgesamt. Bild und Druck zeigen den gerade gewählten Tag.'
      : 'Noch nichts markiert – Bild und Druck zeigen dann den Timetable ohne Hervorhebungen.';
    $('#exportMsg').textContent = '';
    $('#exportDlg').showModal();
  }

  const exportMsg = (text) => { $('#exportMsg').textContent = text; };

  function wireExport() {
    $('#expPng').addEventListener('click', async () => {
      exportMsg('Bild wird erzeugt…');
      try {
        const res = await TTExport.pngForDay(state.ev, state.dayId, activeIds(), activeParts());
        exportMsg('Bild gespeichert (' + res.width + '×' + res.height + ' px, ' +
          res.favCount + ' markiert).');
      } catch (err) {
        exportMsg('Ging nicht: ' + err.message);
      }
    });

    // Der Druck nutzt die Bildschirmansicht – im Raster wird das Ergebnis am ehesten
    // zu dem, was man erwartet, darum vorher dorthin wechseln.
    $('#expPdf').addEventListener('click', () => {
      $('#exportDlg').close();
      setTimeout(() => TTExport.printPlan(), 120);
    });

    $('#expBackup').addEventListener('click', () => {
      const res = TTExport.downloadBackup();
      exportMsg(res.sets
        ? 'Backup gespeichert: ' + res.sets + ' Sets aus ' + res.events + ' Event(s).'
        : 'Es gibt noch keine Markierungen zum Sichern.');
    });

    $('#expRestore').addEventListener('click', () => $('#restoreFile').click());

    $('#restoreFile').addEventListener('change', async (e) => {
      const file = e.target.files && e.target.files[0];
      e.target.value = '';
      if (!file) return;
      try {
        const data = await TTExport.readBackup(file);
        const count = Object.values(data.favorites).reduce((n, a) => n + (a || []).length, 0);
        const replace = confirm(
          'Backup mit ' + count + ' markierten Sets aus ' +
          Object.keys(data.favorites).length + ' Event(s).\n\n' +
          'OK = bestehende Markierungen ERSETZEN\n' +
          'Abbrechen = mit vorhandenen ZUSAMMENFÜHREN');
        const res = TTExport.applyBackup(data, replace ? 'replace' : 'merge');
        exportMsg('Eingespielt: ' + res.sets + ' Sets in ' + res.events + ' Event(s).');
        state.favs = TT.makeFavourites(state.ev.id);
        render({ keepScroll: true });
      } catch (err) {
        exportMsg('Ging nicht: ' + err.message);
      }
    });
  }

  // Beim Drucken ist die Kopfleiste ausgeblendet – diese Zeile ersetzt sie auf dem Papier.
  function updatePrintHead() {
    const day = state.ev.days.find((d) => d.id === state.dayId);
    const n = activeIds().size;
    $('#printhead').innerHTML =
      '<h1>' + TT.escapeHtml(state.ev.name) + '</h1>' +
      '<div class="sub">' + TT.escapeHtml(
        [day && day.label, day && day.date ? TT.fmtDayDate(day.date) : '', state.ev.venue]
          .filter(Boolean).join(' · ')) + '</div>' +
      (n ? '<div class="legend"><b>★ hervorgehoben</b> = mein Plan · ' +
           'ausgegraute Sets laufen parallel</div>' : '');
  }

  /* ---------- Teilbesuch ---------- */

  let partTarget = null;

  function openPartial(setId) {
    if (state.viewingShared) {
      flash('Das ist ein geteilter Plan. Erst „Zu meinem Plan hinzufügen“ wählen.');
      return;
    }
    const s = state.ev.sets.find((x) => x.id === setId);
    if (!s || !s._dur) return;
    partTarget = s;

    const dur = s._dur;
    const cur = TT.partialRange(s, state.parts.get(s.id)) || { from: 0, to: dur };
    const floor = state.ev.floors.find((f) => f.id === s.floor);

    $('#partWho').textContent = s.artist + ' · ' +
      TT.fmtTime(s._start) + '–' + TT.fmtTime(s._end) +
      (floor ? ' · ' + (floor.name || floor.id) : '');

    writePartInputs(cur.from, cur.to);
    syncPartInfo();
    $('#partDlg').showModal();
  }

  // Offsets (Minuten ab Set-Beginn) <-> "HH:MM" im Zeitfeld.
  const offsetToClock = (s, min) => TT.fmtTime(new Date(+s._start + min * 6e4));

  // Beruecksichtigt den Tageswechsel: bei einem Set 23:00-01:00 gehoert "00:30" zum Folgetag.
  function clockToOffset(s, value) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(value || '');
    if (!m) return null;
    const d = new Date(s._start);
    d.setHours(+m[1], +m[2], 0, 0);
    const diff = Math.round((d - s._start) / 6e4);
    // Eine Uhrzeit kann denselben Abend zweimal meinen (22:30-Set, Eingabe "03:00").
    // Darum die Variante nehmen, die dem Set am naechsten liegt – so landet "21:00"
    // am Anfang und "03:00" am Ende, statt jeweils am falschen Rand.
    const abstand = (x) => (x < 0 ? -x : (x > s._dur ? x - s._dur : 0));
    const alt = diff + (diff < 0 ? 1440 : -1440);
    return abstand(alt) < abstand(diff) ? alt : diff;
  }

  // Liest beide Felder, begrenzt auf das Set und sorgt dafuer, dass "bis" nach "von" liegt.
  function readPartInputs() {
    const dur = partTarget._dur;
    const raw = {
      from: clockToOffset(partTarget, $('#partFrom').value),
      to: clockToOffset(partTarget, $('#partTo').value),
    };

    let from = raw.from == null ? 0 : raw.from;
    let to = raw.to == null ? dur : raw.to;
    const ausserhalb = (raw.from != null && (raw.from < 0 || raw.from > dur)) ||
                       (raw.to != null && raw.to > dur);

    from = Math.max(0, Math.min(from, Math.max(0, dur - 1)));
    to = Math.max(0, Math.min(to, dur));
    if (to <= from) to = Math.min(dur, from + 1);

    return { from, to, dur, ausserhalb };
  }

  function writePartInputs(from, to) {
    $('#partFrom').value = offsetToClock(partTarget, from);
    $('#partTo').value = offsetToClock(partTarget, to);
  }

  function syncPartInfo(korrigieren) {
    if (!partTarget) return;
    const { from, to, dur, ausserhalb } = readPartInputs();
    if (korrigieren) writePartInputs(from, to);

    const ganz = from <= 0 && to >= dur;
    const hinweis = ausserhalb
      ? ' Auf die Set-Zeiten begrenzt.'
      : '';
    $('#partInfo').textContent = (ganz
      ? 'Das ist das ganze Set (' + TT.fmtDuration(dur) + ').'
      : TT.fmtDuration(to - from) + ' von ' + TT.fmtDuration(dur) +
        ' · du verpasst ' + TT.fmtDuration(dur - (to - from)) + '.') + hinweis;
  }

  function wirePartialDialog() {
    // Beim Tippen nur rechnen, erst beim Verlassen des Feldes korrigieren –
    // sonst springt einem die halb eingetippte Zeit unter den Fingern weg.
    $('#partFrom').addEventListener('input', () => syncPartInfo(false));
    $('#partTo').addEventListener('input', () => syncPartInfo(false));
    $('#partFrom').addEventListener('blur', () => syncPartInfo(true));
    $('#partTo').addEventListener('blur', () => syncPartInfo(true));

    for (const b of document.querySelectorAll('#partDlg [data-preset]')) {
      b.addEventListener('click', () => {
        if (!partTarget) return;
        const dur = partTarget._dur;
        const half = Math.round(dur / 2);
        const ranges = {
          first: [0, half],
          second: [half, dur],
          start30: [0, Math.min(30, dur)],
          end30: [Math.max(0, dur - 30), dur],
        };
        const r = ranges[b.dataset.preset];
        if (!r) return;
        writePartInputs(r[0], r[1]);
        syncPartInfo(true);
      });
    }

    $('#partReset').addEventListener('click', () => {
      if (partTarget) state.parts.clear(partTarget.id);
      $('#partDlg').close();
      render({ keepScroll: true });
    });

    $('#partSave').addEventListener('click', () => {
      if (!partTarget) return;
      const { from, to, dur } = readPartInputs();
      if (from <= 0 && to >= dur) state.parts.clear(partTarget.id);
      else state.parts.set(partTarget.id, from, to);
      $('#partDlg').close();
      render({ keepScroll: true });
    });
  }

  /* ---------- Teilen ---------- */

  function openShare() {
    const ids = [...activeIds()];
    const parts = activeParts();
    const dlg = $('#shareDlg');
    const url = TT.shareUrl(state.ev.id, state.dayId, ids, parts);
    const teil = ids.filter((id) => parts[id]).length;

    $('#shareInfo').textContent = ids.length
      ? ids.length + ' markierte Sets' + (teil ? ', davon ' + teil + ' nur teilweise' : '') +
        '. Der Link zeigt deinen Plan – Favoriten der Empfänger bleiben erhalten.'
      : 'Du hast noch keine Sets markiert. Der Link zeigt dann nur den Timetable.';
    $('#shareUrl').value = url;

    const nativeBtn = $('#shareNative');
    nativeBtn.hidden = !navigator.share;

    dlg.showModal();
    $('#shareUrl').select();

    $('#shareCopy').onclick = async () => {
      try {
        await navigator.clipboard.writeText(url);
        $('#shareCopy').textContent = 'Kopiert ✓';
      } catch (e) {
        $('#shareUrl').select();
        document.execCommand && document.execCommand('copy');
        $('#shareCopy').textContent = 'Kopiert ✓';
      }
      setTimeout(() => { $('#shareCopy').textContent = 'Kopieren'; }, 2000);
    };
    nativeBtn.onclick = () => navigator.share({ title: state.ev.name, url }).catch(() => {});
  }

  /* ---------- Rendern ---------- */

  function visibleSets() {
    const favIds = activeIds();
    return state.ev.sets.filter((s) => {
      if (s.day !== state.dayId || !s._start || !s._end) return false;
      if (state.onlyFavs && !favIds.has(s.id)) return false;
      return true;
    });
  }

  function render(opts) {
    const keepScroll = opts && opts.keepScroll;
    const scroller = $('.grid-scroll');
    const prevScroll = keepScroll && scroller ? scroller.scrollTop : null;

    const sets = visibleSets();
    const favCount = activeIds().size;
    const btn = $('#onlyFavs');
    btn.textContent = '★ Nur meine Sets' + (favCount ? ' (' + favCount + ')' : '');
    btn.setAttribute('aria-pressed', String(state.onlyFavs));

    const host = $('#view');
    updatePrintHead();

    if (!sets.length) {
      host.innerHTML = '<div class="empty">' + (
        state.onlyFavs
          ? 'Für diesen Tag hast du noch nichts markiert.<br><span class="faint">Sets antippen, um sie zu deinem Plan hinzuzufügen.</span>'
          : 'Für diesen Tag sind noch keine Sets eingetragen.'
      ) + '</div>';
      updateCount(0, 0);
      return;
    }

    const matching = sets.filter((s) => TT.matchesQuery(s, state.query));
    updateCount(matching.length, sets.length);

    if (state.view === 'grid') renderGrid(host, sets, matching);
    else renderList(host, matching);

    const newScroller = $('.grid-scroll');
    if (prevScroll != null && newScroller) newScroller.scrollTop = prevScroll;
    else if (state.view === 'grid') maybeScrollToNow();
  }

  function updateCount(shown, total) {
    const el = $('#count');
    if (!state.query) { el.textContent = total ? total + ' Sets' : ''; return; }
    el.textContent = shown + ' von ' + total + ' Sets';
  }

  // "Vorbei" nur markieren, solange der Tag noch laeuft. Bei einem Event, das
  // komplett vorueber ist, waere sonst jeder einzelne Block ausgegraut.
  const tagLaeuftNoch = (sets, now) =>
    sets.length > 0 && now <= Math.max(...sets.map((x) => +x._end));

  function setClasses(s, matching, now, markPast) {
    const cls = ['set'];
    if (isFav(s)) cls.push('fav');
    if (s.status === 'cancelled') cls.push('cancelled');
    if (now >= s._start && now <= s._end) cls.push('playing');
    else if (markPast && s._end < now) cls.push('past');
    if (state.query && !matching.has(s.id)) cls.push('dimmed');
    if (s._dur <= 45) cls.push('short');
    return cls;
  }

  function badges(s) {
    let out = '';
    if (s.status === 'cancelled') out += '<span class="badge cancelled">abgesagt</span>';
    if (s.status === 'moved') out += '<span class="badge moved">verschoben</span>';
    if (s.status === 'new') out += '<span class="badge new">neu</span>';
    if (s.b2b) out += '<span class="badge b2b">b2b</span>';
    return out;
  }

  // ★ nur auf markierten Sets – dort ist er der Einstieg in den Teilbesuch.
  function starHtml(s, cls) {
    if (!isFav(s)) return '';
    const part = partFor(s);
    const label = part
      ? 'Teilbesuch ändern: ' + TT.fmtTime(part.start) + ' bis ' + TT.fmtTime(part.end)
      : 'Nur einen Teil von ' + s.artist + ' besuchen';
    return '<button type="button" class="' + cls + '" data-edit="' + TT.escapeHtml(s.id) + '" ' +
      'title="Nur einen Teil besuchen" aria-label="' + TT.escapeHtml(label) + '">★</button>';
  }

  // Dunkelt die Minuten ab, die man nicht mitnimmt – der Rest des Blocks bleibt hell.
  function shadeHtml(s, part, ppm, blockH) {
    if (!part) return '';
    const full = s._dur * ppm;
    const scale = full > 0 ? blockH / full : 1;
    const top = part.from * ppm * scale;
    const bottom = blockH - part.to * ppm * scale;
    let out = '';
    if (top > 0.5) out += '<span class="shade" style="top:0;height:' + top + 'px"></span>';
    if (bottom > 0.5) out += '<span class="shade" style="bottom:0;height:' + bottom + 'px"></span>';
    return out;
  }

  // Floors, die in sets vorkommen, aber nicht in ev.floors deklariert sind.
  function appendOrphanFloors(floors, ev, sets) {
    const known = new Set(ev.floors.map((f) => f.id));
    for (const s of sets) {
      if (known.has(s.floor) || floors.some((f) => f.id === s.floor)) continue;
      floors.push({ id: s.floor, name: s.floor || 'Ohne Floor' });
    }
  }

  /* ---------- Raster ---------- */

  function renderGrid(host, sets, matchingList) {
    const ev = state.ev;
    const matching = new Set(matchingList.map((s) => s.id));
    const now = new Date();
    const markPast = tagLaeuftNoch(sets, now);
    const ppm = parseFloat(getComputedStyle(document.documentElement)
      .getPropertyValue('--ppm')) || 1.6;

    const floors = ev.floors.filter((f) => sets.some((s) => s.floor === f.id));
    // Sets auf einem unbekannten Floor gehen sonst still verloren.
    appendOrphanFloors(floors, ev, sets);

    const minStart = new Date(Math.min(...sets.map((s) => +s._start)));
    const maxEnd = new Date(Math.max(...sets.map((s) => +s._end)));
    const from = new Date(minStart); from.setMinutes(0, 0, 0);
    const to = new Date(maxEnd);
    if (to.getMinutes() || to.getSeconds()) { to.setMinutes(0, 0, 0); to.setHours(to.getHours() + 1); }

    const totalMin = Math.max(60, (to - from) / 6e4);
    const height = totalMin * ppm;
    const topOf = (d) => ((d - from) / 6e4) * ppm;

    const head = floors.map((f) =>
      '<div class="floorname" style="--floor:' + TT.escapeHtml(f.color || 'var(--accent)') + '">' +
      TT.escapeHtml(f.name || f.id) + '</div>').join('');

    let ticks = '', lines = '';
    for (let m = 0; m <= totalMin; m += 30) {
      const t = new Date(+from + m * 6e4);
      const y = m * ppm;
      const onHour = t.getMinutes() === 0;
      if (onHour) ticks += '<div class="tick" style="top:' + y + 'px">' + TT.fmtTime(t) + '</div>';
      lines += '<div class="hourline' + (onHour ? '' : ' halfline') + '" style="top:' + y + 'px"></div>';
    }

    const lanesHtml = floors.map((f) => {
      const mine = sets.filter((s) => s.floor === f.id)
        .sort((a, b) => a._start - b._start);
      TT.packLanes(mine);

      const blocks = mine.map((s) => {
        const w = 100 / (s._laneCount || 1);
        const style = [
          'top:' + topOf(s._start) + 'px',
          'height:' + Math.max(20, s._dur * ppm - 3) + 'px',
          'left:' + (s._lane * w) + '%',
          'width:calc(' + w + '% - 4px)',
          '--floor:' + (f.color || 'var(--accent)'),
        ].join(';');

        const part = partFor(s);
        const cls = setClasses(s, matching, now, markPast);
        if (part) cls.push('partial');
        const blockH = Math.max(20, s._dur * ppm - 3);

        return '<div class="' + cls.join(' ') + '" role="button" tabindex="0" ' +
          'style="' + TT.escapeHtml(style) + '" data-set="' + TT.escapeHtml(s.id) + '" ' +
          'aria-pressed="' + isFav(s) + '">' +
          shadeHtml(s, part, ppm, blockH) +
          '<span class="artist">' + TT.escapeHtml(s.artist) + badges(s) + '</span>' +
          '<span class="time">' + (part
            ? '✂ ' + TT.fmtTime(part.start) + '–' + TT.fmtTime(part.end)
            : TT.fmtTime(s._start) + '–' + TT.fmtTime(s._end)) + '</span>' +
          (s.genre ? '<span class="meta">' + TT.escapeHtml(s.genre) + '</span>' : '') +
          starHtml(s, 'pin') +
          '</div>';
      }).join('');

      return '<div class="lane" data-floor="' + TT.escapeHtml(f.id) + '">' + lines + blocks + '</div>';
    }).join('');

    const showNow = now >= from && now <= to;
    const nowHtml = showNow
      ? '<div class="nowline" id="nowline" style="top:' + topOf(now) + 'px"></div>'
      : '';

    host.innerHTML =
      '<div class="grid-scroll">' +
        '<div class="grid-head"><div class="corner"></div>' + head + '</div>' +
        // +22px = Innenabstand aus dem CSS, damit 1 Minute wirklich --ppm Pixel bleibt
        '<div class="grid-body" style="height:' + (height + 22) + 'px">' +
          '<div class="axis">' + ticks + '</div>' +
          '<div class="lanes">' + lanesHtml + nowHtml + '</div>' +
        '</div>' +
      '</div>';

  }

  function maybeScrollToNow() {
    if (state.didAutoScroll) return;
    const line = $('#nowline'), scroller = $('.grid-scroll');
    if (!line || !scroller) return;
    state.didAutoScroll = true;
    // offsetTop zaehlt ab .lanes, nicht ab der Scrollbox – darum ueber die Rects messen.
    const delta = line.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
    scroller.scrollTop = Math.max(0, scroller.scrollTop + delta - scroller.clientHeight * 0.3);
  }

  /* ---------- Liste ---------- */

  function renderList(host, sets) {
    const ev = state.ev;
    const now = new Date();
    const markPast = tagLaeuftNoch(sets, now);
    const floors = ev.floors.filter((f) => sets.some((s) => s.floor === f.id));
    appendOrphanFloors(floors, ev, sets);

    if (!sets.length) {
      host.innerHTML = '<div class="empty">Keine Treffer für „' +
        TT.escapeHtml(state.query) + '“.</div>';
      return;
    }

    host.innerHTML = '<div class="list">' + floors.map((f) => {
      const mine = sets.filter((s) => s.floor === f.id).sort((a, b) => a._start - b._start);
      const rows = mine.map((s) => {
        const cls = ['row'];
        if (isFav(s)) cls.push('fav');
        if (s.status === 'cancelled') cls.push('cancelled');
        if (now >= s._start && now <= s._end) cls.push('playing');
        else if (markPast && s._end < now) cls.push('past');

        const part = partFor(s);
        if (part) cls.push('partial');

        const meta = part
          ? ['✂ nur ' + TT.fmtDuration(part.minutes) +
             ' (Set: ' + TT.fmtTime(s._start) + '–' + TT.fmtTime(s._end) + ')', s.genre, s.note]
            .filter(Boolean).join(' · ')
          : [TT.fmtDuration(s._dur), s.genre, s.note].filter(Boolean).join(' · ');

        return '<div class="' + cls.join(' ') + '" role="button" tabindex="0" ' +
          'style="--floor:' + TT.escapeHtml(f.color || 'var(--accent)') + '" ' +
          'data-set="' + TT.escapeHtml(s.id) + '" aria-pressed="' + isFav(s) + '">' +
          '<span class="when"><b>' + TT.fmtTime(part ? part.start : s._start) + '</b>' +
          TT.fmtTime(part ? part.end : s._end) + '</span>' +
          '<span class="body"><span class="artist">' + TT.escapeHtml(s.artist) + badges(s) + '</span>' +
          (meta ? '<span class="meta">' + TT.escapeHtml(meta) + '</span>' : '') + '</span>' +
          (isFav(s) ? starHtml(s, 'star') : '<span class="star">☆</span>') +
          '</div>';
      }).join('');

      return '<section class="list-floor" style="--floor:' +
        TT.escapeHtml(f.color || 'var(--accent)') + '">' +
        '<h2>' + TT.escapeHtml(f.name || f.id) +
        ' <span class="count">' + mine.length + '</span></h2>' + rows + '</section>';
    }).join('') + '</div>';

  }

  /* ---------- Uhr ---------- */

  function tickClock() {
    const el = $('#clock');
    const now = new Date();
    el.textContent = TT.fmtTime(now);

    const sets = state.ev ? TT.setsForDay(state.ev, state.dayId) : [];
    const live = sets.length &&
      now >= new Date(Math.min(...sets.map((s) => +s._start))) &&
      now <= new Date(Math.max(...sets.map((s) => +s._end)));
    el.classList.toggle('live', !!live);

    const line = $('#nowline');
    if (line && sets.length) {
      const ppm = parseFloat(getComputedStyle(document.documentElement)
        .getPropertyValue('--ppm')) || 1.6;
      const from = new Date(Math.min(...sets.map((s) => +s._start)));
      from.setMinutes(0, 0, 0);
      line.style.top = (((now - from) / 6e4) * ppm) + 'px';
    }
  }

  document.addEventListener('DOMContentLoaded', init);
})();
