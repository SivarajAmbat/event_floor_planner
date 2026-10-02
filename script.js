/* Basecamp Event Floor Planner — vanilla JS, no dependencies.
 * All geometry is in feet. x runs along the room length (horizontal), y along the width (vertical).
 */
(function () {
  'use strict';

  /* ------------------------------------------------------------------ */
  /* Constants & table catalogue                                         */
  /* ------------------------------------------------------------------ */
  var CHAIR = 1.4;        // chair footprint (square), ft
  var GAP = 0.1;          // gap between table edge and chair, ft
  var PITCH = 1.5;        // minimum chair centre-to-centre spacing, ft
  var EPS = 0.001;
  var TIGHT_AISLE = 3;    // smallest aisle (ft) below which the layout counts as very tight
  var TIGHT_COVER = 0.9;  // share of usable floor taken by groups + aisles that counts as very tight
  var STORAGE_KEY = 'basecamp-floor-planner-v1';

  var TYPES = {
    r5: { label: '5 ft Round', shape: 'round', w: 5, h: 5 },
    r6: { label: '6 ft Round', shape: 'round', w: 6, h: 6 },
    b6: { label: '6 ft Rectangle', shape: 'rect', w: 6, h: 2.5 },
    b8: { label: '8 ft Rectangle', shape: 'rect', w: 8, h: 2.5 }
  };
  var TYPE_KEYS = ['r5', 'r6', 'b6', 'b8'];

  /* ------------------------------------------------------------------ */
  /* State                                                               */
  /* ------------------------------------------------------------------ */
  function defaults() {
    return {
      room: { width: 54, length: 105 },
      target: 500,
      type: 'b6',
      chairs: 5,
      aisle: 3,
      wall: 2,
      showZones: true,
      showLabels: true,
      auto: false,       // true while the layout is the untouched output of "Auto-Arrange for N"
      tables: [],        // {id, type, chairs, x, y, rot}  (x,y = table centre)
      nextId: 1
    };
  }

  function num(v, min, max, fallback) {
    v = Number(v);
    if (!isFinite(v)) return fallback;
    return Math.min(max, Math.max(min, v));
  }

  function load() {
    var s = defaults();
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return s;
      var d = JSON.parse(raw);
      s.room.width = num(d.room && d.room.width, 10, 500, s.room.width);
      s.room.length = num(d.room && d.room.length, 10, 500, s.room.length);
      s.target = Math.round(num(d.target, 1, 5000, s.target));
      s.type = TYPES[d.type] ? d.type : s.type;
      s.chairs = Math.round(num(d.chairs, 1, 10, s.chairs));
      s.aisle = num(d.aisle, 0, 20, s.aisle);
      s.wall = num(d.wall, 0, 20, s.wall);
      s.showZones = d.showZones !== false;
      s.showLabels = d.showLabels !== false;
      s.auto = d.auto === true;
      var maxId = 0;
      (Array.isArray(d.tables) ? d.tables : []).forEach(function (t) {
        if (!t || !TYPES[t.type]) return;
        var id = Math.round(num(t.id, 1, 1e9, ++maxId));
        maxId = Math.max(maxId, id);
        s.tables.push({
          id: id, type: t.type,
          chairs: Math.round(num(t.chairs, 1, 10, 5)),
          x: num(t.x, -1000, 2000, 0), y: num(t.y, -1000, 2000, 0),
          rot: ((Math.round(num(t.rot, 0, 360, 0) / 90) * 90) % 360)
        });
      });
      s.nextId = Math.max(maxId + 1, Math.round(num(d.nextId, 1, 1e9, 1)));
    } catch (e) { /* ignore corrupt or unavailable storage */ }
    return s;
  }

  var S = load();
  var selectedId = null;
  var view = { scale: 8, tx: 0, ty: 0 };
  var userZoomed = false;
  var els = {};            // table id -> {g, zone}
  var lastEval = null;
  var $ = function (id) { return document.getElementById(id); };
  var svg = $('plan');

  function save() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        room: S.room, target: S.target, type: S.type, chairs: S.chairs,
        aisle: S.aisle, wall: S.wall, showZones: S.showZones, showLabels: S.showLabels,
        auto: S.auto, tables: S.tables, nextId: S.nextId
      }));
      var n = $('saveNote');
      n.textContent = 'Saved locally ✓';
    } catch (e) {
      $('saveNote').textContent = 'Local saving unavailable';
    }
  }

  /* ------------------------------------------------------------------ */
  /* Formatting helpers                                                  */
  /* ------------------------------------------------------------------ */
  function fmtN(n) { return Math.round(n).toLocaleString('en-US'); }
  function fmtFt(v) { return (Math.round(v * 100) / 100) + ' ft'; }
  function fmtFtIn(v) {
    var inches = Math.round(v * 12), ft = Math.floor(inches / 12), inch = inches % 12;
    return inch ? ft + ' ft ' + inch + ' in' : ft + ' ft';
  }
  function esc(s) { return String(s).replace(/[&<>"]/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]; }); }
  function r6(v) { return Math.round(v * 1e6) / 1e6; }

  /* ------------------------------------------------------------------ */
  /* Geometry: chairs and group bounding boxes                           */
  /* ------------------------------------------------------------------ */
  function rotPt(x, y, deg) {
    var r = deg * Math.PI / 180, c = Math.cos(r), s = Math.sin(r);
    return [x * c - y * s, x * s + y * c];
  }

  // Chair positions in table-local coordinates (rotation 0). a = chair rotation in degrees (back faces outward).
  var chairCache = {};
  function chairLayout(key, n) {
    var ck = key + '|' + n;
    if (chairCache[ck]) return chairCache[ck];
    var t = TYPES[key], out = [], i, k;
    if (t.shape === 'round') {
      var R = t.w / 2 + GAP + CHAIR / 2;
      for (i = 0; i < n; i++) {
        var phi = -90 + 360 * i / n, rad = phi * Math.PI / 180;
        out.push({ x: R * Math.cos(rad), y: R * Math.sin(rad), a: phi + 90 });
      }
    } else {
      var capL = Math.floor(t.w / PITCH), capE = Math.max(1, Math.floor(t.h / PITCH));
      var top, bot, left = 0, right = 0;
      if (n <= 2 * capL) { top = Math.ceil(n / 2); bot = n - top; }
      else {
        top = bot = capL;
        var rem = Math.min(n - 2 * capL, 2 * capE);
        right = Math.ceil(rem / 2); left = rem - right;
      }
      var yOff = t.h / 2 + GAP + CHAIR / 2, xOff = t.w / 2 + GAP + CHAIR / 2;
      for (i = 0; i < top; i++) out.push({ x: -t.w / 2 + (i + 0.5) * t.w / top, y: -yOff, a: 0 });
      for (i = 0; i < bot; i++) out.push({ x: -t.w / 2 + (i + 0.5) * t.w / bot, y: yOff, a: 180 });
      for (i = 0; i < right; i++) out.push({ x: xOff, y: -t.h / 2 + (i + 0.5) * t.h / right, a: 90 });
      for (i = 0; i < left; i++) out.push({ x: -xOff, y: -t.h / 2 + (i + 0.5) * t.h / left, a: 270 });
    }
    chairCache[ck] = out;
    return out;
  }

  // Corners of a chair (as a polygon) after table rotation, in table-local coordinates.
  function chairPoly(c, rotDeg) {
    var h = CHAIR / 2, pts = [], k, p;
    var corners = [[-h, -h], [h, -h], [h, h], [-h, h]];
    for (k = 0; k < 4; k++) {
      p = rotPt(corners[k][0], corners[k][1], c.a);
      p = rotPt(p[0] + c.x, p[1] + c.y, rotDeg);
      pts.push(p);
    }
    return pts;
  }

  // Bounding box (relative to the table centre) of table + chairs at a given rotation.
  var boxCache = {};
  function groupBox(key, n, rotDeg) {
    var ck = key + '|' + n + '|' + rotDeg;
    if (boxCache[ck]) return boxCache[ck];
    var t = TYPES[key], pts = [];
    [[-t.w / 2, -t.h / 2], [t.w / 2, -t.h / 2], [t.w / 2, t.h / 2], [-t.w / 2, t.h / 2]].forEach(function (p) {
      pts.push(rotPt(p[0], p[1], rotDeg));
    });
    chairLayout(key, n).forEach(function (c) {
      chairPoly(c, rotDeg).forEach(function (p) { pts.push(p); });
    });
    var b = { minx: Infinity, miny: Infinity, maxx: -Infinity, maxy: -Infinity };
    pts.forEach(function (p) {
      b.minx = Math.min(b.minx, p[0]); b.maxx = Math.max(b.maxx, p[0]);
      b.miny = Math.min(b.miny, p[1]); b.maxy = Math.max(b.maxy, p[1]);
    });
    b.minx = r6(b.minx); b.miny = r6(b.miny); b.maxx = r6(b.maxx); b.maxy = r6(b.maxy);
    boxCache[ck] = b;
    return b;
  }

  function boxOf(t) {
    var b = groupBox(t.type, t.chairs, t.rot);
    return { x0: t.x + b.minx, y0: t.y + b.miny, x1: t.x + b.maxx, y1: t.y + b.maxy };
  }

  function tableArea(key) {
    var t = TYPES[key];
    return t.shape === 'round' ? Math.PI * t.w * t.w / 4 : t.w * t.h;
  }

  /* ------------------------------------------------------------------ */
  /* Evaluation: overlaps, clearances, capacity                          */
  /* ------------------------------------------------------------------ */
  function evaluate() {
    var L = S.room.length, W = S.room.width, wall = S.wall, aisle = S.aisle;
    var tabs = S.tables, n = tabs.length, boxes = [], flags = {}, i, j;
    for (i = 0; i < n; i++) { boxes.push(boxOf(tabs[i])); flags[tabs[i].id] = { overlap: false, clear: false, outside: false }; }
    var minGap = Infinity;
    for (i = 0; i < n; i++) {
      var a = boxes[i], f = flags[tabs[i].id];
      if (a.x0 < wall - EPS || a.y0 < wall - EPS || a.x1 > L - wall + EPS || a.y1 > W - wall + EPS) f.outside = true;
      for (j = i + 1; j < n; j++) {
        var b = boxes[j];
        var gx = Math.max(a.x0 - b.x1, b.x0 - a.x1), gy = Math.max(a.y0 - b.y1, b.y0 - a.y1);
        var gap = Math.max(gx, gy);
        if (gap < -EPS) { f.overlap = true; flags[tabs[j].id].overlap = true; }
        else if (gap < aisle - EPS) { f.clear = true; flags[tabs[j].id].clear = true; }
        if (gap < minGap) minGap = gap;
      }
    }
    var ev = {
      flags: flags, total: n, chairs: 0, accommodated: 0, validTables: 0, conflicts: 0,
      occupied: 0, minGap: minGap, coverage: 0
    };
    var halo = 0;
    for (i = 0; i < n; i++) {
      var t = tabs[i], ff = flags[t.id];
      ev.chairs += t.chairs;
      if (ff.overlap || ff.clear || ff.outside) { ev.conflicts++; continue; }
      ev.validTables++;
      ev.accommodated += t.chairs;
      ev.occupied += tableArea(t.type) + t.chairs * CHAIR * CHAIR;
      halo += (boxes[i].x1 - boxes[i].x0 + aisle) * (boxes[i].y1 - boxes[i].y0 + aisle);
    }
    var usable = Math.max(1, (L - 2 * wall + aisle) * (W - 2 * wall + aisle));
    ev.coverage = halo / usable;
    ev.unused = Math.max(0, L * W - ev.occupied);
    return ev;
  }

  function statusInfo(ev) {
    var tgt = S.target, acc = ev.accommodated, lines = [];
    if (!ev.total) {
      return { cls: 'empty', title: 'NO TABLES YET', lines: [
        ['0 / ' + fmtN(tgt) + ' participants accommodated', true],
        ['Use “Auto-Arrange for ' + fmtN(tgt) + ' People” or add tables manually.']] };
    }
    if (acc < tgt) {
      lines.push([fmtN(acc) + ' / ' + fmtN(tgt) + ' participants accommodated', true]);
      lines.push([fmtN(tgt - acc) + ' participants cannot be accommodated.']);
      if (ev.conflicts) lines.push([ev.conflicts + ' table' + (ev.conflicts === 1 ? '' : 's') + ' overlap, break clearance or sit outside the room and are not counted.']);
      lines.push(['Add more space or reduce table/chair requirements.']);
      return { cls: 'bad', title: '⚠ SPACE INSUFFICIENT', lines: lines };
    }
    var reasons = [];
    if (ev.conflicts) reasons.push(ev.conflicts + ' table' + (ev.conflicts === 1 ? '' : 's') + ' break clearance rules (not counted).');
    if (ev.validTables > 1 && ev.minGap < TIGHT_AISLE - 0.01) reasons.push('Smallest aisle is ' + fmtFt(ev.minGap) + ' (under ' + TIGHT_AISLE + ' ft).');
    if (ev.coverage >= TIGHT_COVER) reasons.push('Tables and aisles fill ' + Math.round(ev.coverage * 100) + '% of the usable floor.');
    if (reasons.length) {
      lines.push([fmtN(acc) + ' / ' + fmtN(tgt) + ' participants accommodated', true]);
      lines.push(['The layout has limited circulation space.']);
      reasons.forEach(function (r) { lines.push([r]); });
      return { cls: 'warn', title: '⚠ VERY TIGHT LAYOUT', lines: lines };
    }
    lines.push([fmtN(acc) + ' / ' + fmtN(tgt) + ' participants accommodated', true]);
    lines.push([ev.validTables + ' tables · ' + ev.chairs + ' chairs']);
    lines.push(['Remaining space: ' + fmtN(ev.unused) + ' sq ft']);
    return { cls: 'ok', title: '✓ SPACE SUFFICIENT', lines: lines };
  }

  /* ------------------------------------------------------------------ */
  /* Placement algorithms                                                */
  /* ------------------------------------------------------------------ */

  // Fill a rectangle with a uniform grid of groups at one rotation.
  function gridFill(rect, box, rot, aisle, out) {
    var bw = box.maxx - box.minx, bh = box.maxy - box.miny;
    if (rect.w < bw - EPS || rect.h < bh - EPS) return { cols: 0, rows: 0, px: 0, py: 0 };
    var px = bw + aisle, py = bh + aisle;
    var cols = Math.floor((rect.w + aisle + EPS) / px), rows = Math.floor((rect.h + aisle + EPS) / py);
    for (var r = 0; r < rows; r++) {
      for (var c = 0; c < cols; c++) {
        out.push({ x: r6(rect.x0 + c * px - box.minx), y: r6(rect.y0 + r * py - box.miny), rot: rot });
      }
    }
    return { cols: cols, rows: rows, px: px, py: py };
  }

  // Best uniform arrangement of one table type + chair count. Tries both orientations
  // as the main grid and fills the leftover right/bottom strips with the other orientation.
  function packUniform(key, n, L, W, wall, aisle, max) {
    var ux = wall, uy = wall, uw = L - 2 * wall, uh = W - 2 * wall;
    if (uw <= 0 || uh <= 0) return [];
    var rots = TYPES[key].shape === 'round' ? [0] : [0, 90];
    var best = null;
    rots.forEach(function (rA) {
      var list = [];
      var bA = groupBox(key, n, rA);
      var m = gridFill({ x0: ux, y0: uy, w: uw, h: uh }, bA, rA, aisle, list);
      var mainCount = list.length;
      if (rots.length > 1) {
        var rB = rA === 0 ? 90 : 0, bB = groupBox(key, n, rB);
        var usedW = m.cols ? m.cols * m.px : 0, usedH = m.rows ? m.rows * m.py : 0;
        gridFill({ x0: ux + usedW, y0: uy, w: uw - usedW, h: uh }, bB, rB, aisle, list);
        if (m.cols && m.rows) gridFill({ x0: ux, y0: uy + usedH, w: usedW - aisle, h: uh - usedH }, bB, rB, aisle, list);
      }
      if (!best || list.length > best.list.length) {
        best = { list: list, mainCount: mainCount, m: m, uw: uw, uh: uh };
      }
    });
    var list = best.list;
    if (list.length > max) return list.slice(0, max);
    if (list.length === best.mainCount && best.m.cols && best.m.rows) {
      // single clean grid: centre it in the usable area
      var dx = (uw - (best.m.cols * best.m.px - aisle)) / 2, dy = (uh - (best.m.rows * best.m.py - aisle)) / 2;
      list.forEach(function (p) { p.x = r6(p.x + dx); p.y = r6(p.y + dy); });
    }
    return list;
  }

  // Row-by-row packing for mixed tables (keeps each table's own rotation). Returns placed/unplaced.
  function shelfPack(tables) {
    var L = S.room.length, W = S.room.width, wall = S.wall, aisle = S.aisle;
    var items = tables.map(function (t) { return { t: t, b: groupBox(t.type, t.chairs, t.rot) }; });
    items.sort(function (p, q) { return (q.b.maxy - q.b.miny) - (p.b.maxy - p.b.miny) || p.t.id - q.t.id; });
    var x = wall, y = wall, rowH = 0, placed = [], dropped = [];
    items.forEach(function (it) {
      var bw = it.b.maxx - it.b.minx, bh = it.b.maxy - it.b.miny;
      if (x + bw > L - wall + EPS && x > wall) { y += rowH + aisle; x = wall; rowH = 0; }
      if (x + bw > L - wall + EPS || y + bh > W - wall + EPS) { dropped.push(it.t); return; }
      it.t.x = r6(x - it.b.minx); it.t.y = r6(y - it.b.miny);
      placed.push(it.t);
      x += bw + aisle; rowH = Math.max(rowH, bh);
    });
    return { placed: placed, dropped: dropped };
  }

  // First free position (lowest row, then leftmost) for a new group, or null.
  function findFreeSpot(key, n, rot) {
    var L = S.room.length, W = S.room.width, wall = S.wall, aisle = S.aisle;
    var b = groupBox(key, n, rot), bw = b.maxx - b.minx, bh = b.maxy - b.miny;
    var boxes = S.tables.map(boxOf);
    var xs = [wall], ys = [wall];
    boxes.forEach(function (q) { xs.push(r6(q.x1 + aisle)); ys.push(r6(q.y1 + aisle)); });
    var asc = function (p, q) { return p - q; };
    xs.sort(asc); ys.sort(asc);
    for (var yi = 0; yi < ys.length; yi++) {
      var y = ys[yi];
      if (y + bh > W - wall + EPS) break;
      for (var xi = 0; xi < xs.length; xi++) {
        var x = xs[xi];
        if (x + bw > L - wall + EPS) break;
        var ok = true;
        for (var k = 0; k < boxes.length; k++) {
          var q = boxes[k];
          var gx = Math.max(x - q.x1, q.x0 - (x + bw)), gy = Math.max(y - q.y1, q.y0 - (y + bh));
          if (Math.max(gx, gy) < aisle - EPS) { ok = false; break; }
        }
        if (ok) return { x: r6(x - b.minx), y: r6(y - b.miny) };
      }
    }
    return null;
  }

  var projCache = { key: '', val: null };
  function projection() {
    var key = [S.type, S.chairs, S.room.length, S.room.width, S.wall, S.aisle].join('|');
    if (projCache.key !== key) {
      projCache = { key: key, val: packUniform(S.type, S.chairs, S.room.length, S.room.width, S.wall, S.aisle, Infinity).length };
    }
    return projCache.val;
  }

  /* ------------------------------------------------------------------ */
  /* Layout actions                                                      */
  /* ------------------------------------------------------------------ */
  function autoArrangeTarget(silent) {
    var needed = Math.ceil(S.target / S.chairs);
    var pl = packUniform(S.type, S.chairs, S.room.length, S.room.width, S.wall, S.aisle, needed);
    S.tables = pl.map(function (p, i) { return { id: i + 1, type: S.type, chairs: S.chairs, x: p.x, y: p.y, rot: p.rot }; });
    S.nextId = pl.length + 1;
    S.auto = true;
    selectedId = null;
    if (!silent) {
      var people = pl.length * S.chairs;
      toast('Tables required: ' + needed + ' · placed: ' + pl.length + ' · ' + fmtN(people) + ' participants accommodated' +
        (pl.length < needed ? ' (room is full)' : ''));
    }
  }

  function autoArrangeExisting() {
    if (!S.tables.length) { toast('There are no tables to arrange yet.'); return; }
    if (S.auto) { autoArrangeTarget(false); return; }
    var first = S.tables[0];
    var uniform = S.tables.every(function (t) { return t.type === first.type && t.chairs === first.chairs; });
    var dropped = 0;
    if (uniform) {
      var pl = packUniform(first.type, first.chairs, S.room.length, S.room.width, S.wall, S.aisle, S.tables.length);
      var kept = S.tables.slice(0, pl.length);
      dropped = S.tables.length - kept.length;
      kept.forEach(function (t, i) { t.x = pl[i].x; t.y = pl[i].y; t.rot = pl[i].rot; });
      S.tables = kept;
    } else {
      var res = shelfPack(S.tables);
      dropped = res.dropped.length;
      S.tables = res.placed.sort(function (a, b) { return a.id - b.id; });
    }
    if (selectedId && !S.tables.some(function (t) { return t.id === selectedId; })) selectedId = null;
    toast(dropped ? 'Rearranged. ' + dropped + ' table' + (dropped === 1 ? '' : 's') + ' did not fit and ' + (dropped === 1 ? 'was' : 'were') + ' removed.' : 'Tables rearranged.');
  }

  function addTable() {
    var rot = 0;
    var spot = findFreeSpot(S.type, S.chairs, 0);
    if (!spot && TYPES[S.type].shape === 'rect') { spot = findFreeSpot(S.type, S.chairs, 90); rot = 90; }
    if (!spot) { toast('No room for another ' + TYPES[S.type].label + ' with these clearances.'); return; }
    var t = { id: S.nextId++, type: S.type, chairs: S.chairs, x: spot.x, y: spot.y, rot: rot };
    S.tables.push(t);
    S.auto = false;
    selectedId = t.id;
    afterChange(true);
  }

  /* ------------------------------------------------------------------ */
  /* SVG rendering                                                       */
  /* ------------------------------------------------------------------ */
  var SVG_CSS =
    '.ruler{font:600 1.7px sans-serif;fill:#7b879b}' +
    '.dimlabel{font:700 2.2px sans-serif;fill:#3b4658}' +
    '.grid-minor{stroke:#cfd8e6;stroke-width:1;stroke-opacity:.55;fill:none;vector-effect:non-scaling-stroke}' +
    '.grid-major{stroke:#9fb0c8;stroke-width:1;stroke-opacity:.6;fill:none;vector-effect:non-scaling-stroke}' +
    '.room-border{fill:none;stroke:#1b2433;stroke-width:2.5;vector-effect:non-scaling-stroke}' +
    '.wall-inner{fill:none;stroke:#8c9ab0;stroke-width:1;stroke-dasharray:5 4;vector-effect:non-scaling-stroke}' +
    '.zone{fill:#fff;stroke:#b3c6df;stroke-width:1;stroke-dasharray:3 3;vector-effect:non-scaling-stroke}' +
    '.zone.warn{fill:#fff6d9;stroke:#e0a100}.zone.bad{fill:#ffe3e3;stroke:#c62828}' +
    '.tbl{cursor:move}' +
    '.tshape{fill:#dbe6f8;stroke:#3a5a97;stroke-width:1.5;vector-effect:non-scaling-stroke}' +
    '.chair{fill:#a9bad6;stroke:#5d7194;stroke-width:1;vector-effect:non-scaling-stroke}' +
    '.tbl.warn .tshape{fill:#ffe8a6;stroke:#b87503}.tbl.warn .chair{fill:#f3cf70;stroke:#b87503}' +
    '.tbl.bad .tshape{fill:#ffc9c9;stroke:#c62828}.tbl.bad .chair{fill:#f0a0a0;stroke:#c62828}' +
    '.tbl.sel .tshape{stroke:#1f6feb;stroke-width:3}.tbl.sel .chair{stroke:#1f6feb;stroke-width:2}' +
    '.tlabel{font:700 1.5px sans-serif;fill:#1b2433;text-anchor:middle;dominant-baseline:central;pointer-events:none}' +
    '.hide-labels .tlabel{display:none}';

  function gridPaths(L, W) {
    var minor = '', major = '', x, y;
    for (x = 5; x < L; x += 5) (x % 25 === 0 ? (major += 'M' + x + ' 0V' + W) : (minor += 'M' + x + ' 0V' + W));
    for (y = 5; y < W; y += 5) (y % 25 === 0 ? (major += 'M0 ' + y + 'H' + L) : (minor += 'M0 ' + y + 'H' + L));
    return '<path class="grid-minor" d="' + minor + '"/><path class="grid-major" d="' + major + '"/>';
  }

  function tableMarkup(t) {
    var def = TYPES[t.type], s = '';
    s += '<g class="tbl" data-id="' + t.id + '" transform="translate(' + t.x + ' ' + t.y + ') rotate(' + t.rot + ')">';
    chairLayout(t.type, t.chairs).forEach(function (c) {
      s += '<rect class="chair" x="' + (-CHAIR / 2) + '" y="' + (-CHAIR / 2) + '" width="' + CHAIR + '" height="' + CHAIR +
        '" rx="0.35" transform="translate(' + r6(c.x) + ' ' + r6(c.y) + ') rotate(' + r6(c.a) + ')"/>';
    });
    if (def.shape === 'round') s += '<circle class="tshape" r="' + def.w / 2 + '"/>';
    else s += '<rect class="tshape" x="' + (-def.w / 2) + '" y="' + (-def.h / 2) + '" width="' + def.w + '" height="' + def.h + '" rx="0.2"/>';
    s += '<text class="tlabel" transform="rotate(' + (-t.rot) + ')">T' + t.id + '</text></g>';
    return s;
  }

  function buildPlan() {
    var L = S.room.length, W = S.room.width, wall = S.wall, z = S.showZones, s = '', x, y;
    s += '<style>' + SVG_CSS + '</style>';
    s += '<defs><pattern id="hatch" patternUnits="userSpaceOnUse" width="1.6" height="1.6" patternTransform="rotate(45)">' +
      '<rect width="1.6" height="1.6" fill="#f3f5f8"/><line x1="0" y1="0" x2="0" y2="1.6" stroke="#dde2ea" stroke-width="0.35"/></pattern></defs>';
    s += '<rect x="0" y="0" width="' + L + '" height="' + W + '" fill="' + (z && wall > 0 ? 'url(#hatch)' : (z ? '#e6f1fb' : '#fff')) + '"/>';
    if (z && wall > 0 && L > 2 * wall && W > 2 * wall) {
      s += '<rect x="' + wall + '" y="' + wall + '" width="' + (L - 2 * wall) + '" height="' + (W - 2 * wall) + '" fill="#e6f1fb"/>';
    }
    s += gridPaths(L, W);
    if (z && wall > 0 && L > 2 * wall && W > 2 * wall) {
      s += '<rect class="wall-inner" x="' + wall + '" y="' + wall + '" width="' + (L - 2 * wall) + '" height="' + (W - 2 * wall) + '"/>';
    }
    s += '<rect class="room-border" x="0" y="0" width="' + L + '" height="' + W + '"/>';
    // rulers & dimension labels
    for (x = 0; x <= L; x += 10) s += '<text class="ruler" x="' + x + '" y="-0.9" text-anchor="middle">' + x + '</text>';
    for (y = 10; y <= W; y += 10) s += '<text class="ruler" x="-0.9" y="' + y + '" text-anchor="end" dominant-baseline="central">' + y + '</text>';
    s += '<text class="dimlabel" x="' + L / 2 + '" y="-3.4" text-anchor="middle">' + fmtFt(L) + ' (length)</text>';
    s += '<text class="dimlabel" transform="translate(-4.2 ' + W / 2 + ') rotate(-90)" text-anchor="middle">' + fmtFt(W) + ' (width)</text>';
    s += '<g id="gZones">';
    if (z) S.tables.forEach(function (t) {
      var b = boxOf(t);
      s += '<rect class="zone" data-zid="' + t.id + '" x="' + r6(b.x0) + '" y="' + r6(b.y0) + '" width="' + r6(b.x1 - b.x0) + '" height="' + r6(b.y1 - b.y0) + '" rx="0.6"/>';
    });
    s += '</g><g id="gTables">';
    S.tables.forEach(function (t) { s += tableMarkup(t); });
    s += '</g>';
    svg.innerHTML = s;
    svg.setAttribute('class', S.showLabels ? '' : 'hide-labels');
    els = {};
    svg.querySelectorAll('.tbl').forEach(function (g) { els[g.getAttribute('data-id')] = { g: g, zone: null }; });
    svg.querySelectorAll('.zone').forEach(function (r) { var e = els[r.getAttribute('data-zid')]; if (e) e.zone = r; });
  }

  function applyFlags(ev) {
    S.tables.forEach(function (t) {
      var e = els[t.id]; if (!e) return;
      var f = ev.flags[t.id];
      var cls = f.overlap || f.outside ? 'bad' : (f.clear ? 'warn' : '');
      e.g.setAttribute('class', 'tbl' + (cls ? ' ' + cls : '') + (t.id === selectedId ? ' sel' : ''));
      if (e.zone) e.zone.setAttribute('class', 'zone' + (cls ? ' ' + cls : ''));
    });
  }

  /* ------------------------------------------------------------------ */
  /* Panels                                                              */
  /* ------------------------------------------------------------------ */
  function renderDashboard(ev) {
    var L = S.room.length, W = S.room.width;
    $('dRoom').textContent = fmtN2(L) + ' × ' + fmtN2(W) + ' ft';
    $('dArea').textContent = fmtN(L * W) + ' sq ft';
    $('dTarget').textContent = fmtN(S.target);
    $('dTables').textContent = ev.total;
    $('dChairs').textContent = ev.chairs;
    $('dPeople').textContent = ev.accommodated;
    $('dUnused').textContent = fmtN(ev.unused) + ' sq ft';
    $('dAisle').textContent = fmtFt(S.aisle);
    $('dWall').textContent = fmtFt(S.wall);
    $('dMinGap').textContent = ev.total > 1 && isFinite(ev.minGap) ? fmtFt(Math.max(0, ev.minGap)) : '—';
    var st = statusInfo(ev), card = $('statusCard');
    card.className = 'card stat status ' + st.cls;
    card.innerHTML = '<div class="s-title">' + st.title + '</div>' + st.lines.map(function (l) {
      return '<div class="s-line' + (l[1] ? ' strong' : '') + '">' + esc(l[0]) + '</div>';
    }).join('');
    $('emptyHint').hidden = ev.total > 0;
  }
  function fmtN2(v) { return String(Math.round(v * 100) / 100); }

  function renderInputsStatic() {
    $('roomArea').textContent = fmtN(S.room.length * S.room.width) + ' sq ft';
    var label = 'Auto-Arrange for ' + fmtN(S.target) + ' People';
    $('btnAuto500').textContent = label;
    $('btnAuto500b').textContent = label;
    var def = TYPES[S.type];
    $('typeDim').textContent = 'Dimensions: ' + (def.shape === 'round' ? def.w + ' ft diameter' : def.w + ' × ' + def.h + ' ft');
    $('addSummary').textContent = 'Adds: ' + def.label + ' · ' + S.chairs + ' chairs';
    var needed = Math.ceil(S.target / S.chairs), fit = projection(), p = $('projection');
    var people = fit * S.chairs;
    p.className = 'projection ' + (fit >= needed ? 'good' : 'short');
    p.innerHTML = 'Needs <b>' + needed + '</b> tables (' + S.chairs + ' chairs each).<br>Room fits up to <b>' + fit + '</b> → <b>' + fmtN(people) + '</b> participants' +
      (fit >= needed ? ' ✓' : ' (short by ' + fmtN(S.target - people) + ')');
  }

  function renderSelected(ev) {
    var t = S.tables.filter(function (q) { return q.id === selectedId; })[0];
    $('selEmpty').hidden = !!t;
    $('selFields').hidden = !t;
    if (!t) return;
    var def = TYPES[t.type];
    $('selId').textContent = 'T' + t.id;
    $('selType').textContent = def.label;
    $('selDim').textContent = def.shape === 'round' ? def.w + ' ft dia.' : def.w + ' × ' + def.h + ' ft';
    $('selDim').title = def.shape === 'round' ? fmtFtIn(def.w) + ' diameter' : fmtFtIn(def.w) + ' × ' + fmtFtIn(def.h);
    if (document.activeElement !== $('selTableChairs')) $('selTableChairs').value = t.chairs;
    $('selPeople').textContent = t.chairs;
    $('btnRotate').disabled = def.shape === 'round';
    var f = ev.flags[t.id], msg = $('selMsg');
    if (f.outside) { msg.className = 'sel-msg bad'; msg.textContent = '⚠ Outside the room / wall clearance'; }
    else if (f.overlap) { msg.className = 'sel-msg bad'; msg.textContent = '⚠ Overlaps another table'; }
    else if (f.clear) { msg.className = 'sel-msg warn'; msg.textContent = '⚠ Closer than ' + fmtFt(S.aisle) + ' to another table'; }
    else { msg.className = 'sel-msg ok'; msg.textContent = '✓ Placement OK'; }
  }

  function refreshStatus() {
    lastEval = evaluate();
    applyFlags(lastEval);
    renderDashboard(lastEval);
    renderSelected(lastEval);
  }

  function render() {
    buildPlan();
    renderInputsStatic();
    refreshStatus();
    if (!userZoomed) fitView(); else applyView();
  }

  function afterChange(doSave) {
    render();
    if (doSave !== false) save();
  }

  /* settings (room, target, type, chairs, clearances) changed */
  function settingsChanged() {
    if (S.auto && S.tables.length) autoArrangeTarget(true);
    afterChange();
  }

  /* ------------------------------------------------------------------ */
  /* View: zoom & pan (implemented through the SVG viewBox)              */
  /* ------------------------------------------------------------------ */
  function clampScale(s) { return Math.min(120, Math.max(1, s)); }

  function applyView() {
    var r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    svg.setAttribute('viewBox', r6(-view.tx / view.scale) + ' ' + r6(-view.ty / view.scale) + ' ' + r6(r.width / view.scale) + ' ' + r6(r.height / view.scale));
  }

  function fitView() {
    var r = svg.getBoundingClientRect();
    if (!r.width || !r.height) return;
    var pad = 24, L = S.room.length, W = S.room.width;
    // reserve a few feet for the ruler labels on the top/left
    view.scale = clampScale(Math.min((r.width - 2 * pad) / (L + 6), (r.height - 2 * pad) / (W + 6)));
    view.tx = (r.width - L * view.scale) / 2 + 2 * view.scale;
    view.ty = (r.height - W * view.scale) / 2 + 2 * view.scale;
    userZoomed = false;
    applyView();
  }

  function resetView() {
    view.scale = 10; view.tx = 6 * 10; view.ty = 6 * 10;
    userZoomed = true;
    applyView();
  }

  function zoomAt(clientX, clientY, factor) {
    var r = svg.getBoundingClientRect(), px = clientX - r.left, py = clientY - r.top;
    var wx = (px - view.tx) / view.scale, wy = (py - view.ty) / view.scale;
    view.scale = clampScale(view.scale * factor);
    view.tx = px - wx * view.scale; view.ty = py - wy * view.scale;
    userZoomed = true;
    applyView();
  }

  function zoomCenter(f) {
    var r = svg.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, f);
  }

  /* ------------------------------------------------------------------ */
  /* Pointer interaction: select, drag, pan, wheel zoom                  */
  /* ------------------------------------------------------------------ */
  function toWorld(e) {
    var pt = svg.createSVGPoint();
    pt.x = e.clientX; pt.y = e.clientY;
    var p = pt.matrixTransform(svg.getScreenCTM().inverse());
    return { x: p.x, y: p.y };
  }

  function select(id) {
    selectedId = id;
    applyFlags(lastEval || evaluate());
    renderSelected(lastEval || evaluate());
  }

  var drag = null, pan = null;

  svg.addEventListener('pointerdown', function (e) {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    var g = e.target.closest ? e.target.closest('.tbl') : null;
    try { svg.setPointerCapture(e.pointerId); } catch (err) { /* ignore */ }
    if (g) {
      var id = Number(g.getAttribute('data-id'));
      var t = S.tables.filter(function (q) { return q.id === id; })[0];
      if (!t) return;
      select(id);
      var w = toWorld(e);
      drag = { id: id, t: t, sx: w.x, sy: w.y, ox: t.x, oy: t.y, moved: false };
    } else {
      pan = { x: e.clientX, y: e.clientY, tx: view.tx, ty: view.ty, moved: false };
    }
  });

  svg.addEventListener('pointermove', function (e) {
    if (drag) {
      var w = toWorld(e);
      var nx = Math.round((drag.ox + w.x - drag.sx) * 4) / 4, ny = Math.round((drag.oy + w.y - drag.sy) * 4) / 4;
      nx = Math.min(S.room.length, Math.max(0, nx)); ny = Math.min(S.room.width, Math.max(0, ny));
      if (nx === drag.t.x && ny === drag.t.y) return;
      drag.moved = true;
      drag.t.x = nx; drag.t.y = ny;
      var el = els[drag.id];
      el.g.setAttribute('transform', 'translate(' + nx + ' ' + ny + ') rotate(' + drag.t.rot + ')');
      if (el.zone) {
        var b = boxOf(drag.t);
        el.zone.setAttribute('x', r6(b.x0)); el.zone.setAttribute('y', r6(b.y0));
      }
      refreshStatus();
    } else if (pan) {
      var dx = e.clientX - pan.x, dy = e.clientY - pan.y;
      if (!pan.moved && Math.abs(dx) + Math.abs(dy) < 4) return;
      pan.moved = true;
      view.tx = pan.tx + dx; view.ty = pan.ty + dy;
      userZoomed = true;
      applyView();
    }
  });

  function endPointer() {
    if (drag) {
      if (drag.moved) { S.auto = false; save(); }
      drag = null;
    } else if (pan) {
      if (!pan.moved) select(null);
      pan = null;
    }
  }
  svg.addEventListener('pointerup', endPointer);
  svg.addEventListener('pointercancel', endPointer);

  svg.addEventListener('wheel', function (e) {
    e.preventDefault();
    zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.0015));
  }, { passive: false });

  /* ------------------------------------------------------------------ */
  /* Toast & dialogs                                                     */
  /* ------------------------------------------------------------------ */
  var toastTimer = null;
  function toast(msg) {
    var t = $('toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove('show'); }, 4500);
  }

  function confirmDlg(msg, okLabel, cb) {
    var dlg = $('confirmDlg');
    if (!dlg.showModal) { if (window.confirm(msg)) cb(); return; }
    $('cfMsg').textContent = msg;
    $('cfOk').textContent = okLabel;
    dlg.returnValue = '';
    dlg.onclose = function () { if (dlg.returnValue === 'ok') cb(); };
    dlg.showModal();
  }

  function showCompare() {
    var rows = TYPE_KEYS.map(function (k) {
      var n = packUniform(k, S.chairs, S.room.length, S.room.width, S.wall, S.aisle, Infinity).length;
      return { key: k, tables: n, people: n * S.chairs };
    });
    var best = Math.max.apply(null, rows.map(function (r) { return r.people; }));
    var html = '<tr><th>Table</th><th class="num">Chairs/Table</th><th class="num">Tables Possible</th><th class="num">Participants</th><th>Target ' + fmtN(S.target) + '</th></tr>';
    rows.forEach(function (r) {
      html += '<tr class="' + (r.people === best && best > 0 ? 'best' : '') + '"><td>' + TYPES[r.key].label + '</td><td class="num">' + S.chairs +
        '</td><td class="num">' + r.tables + '</td><td class="num">' + fmtN(r.people) + '</td><td>' +
        (r.people >= S.target ? '<span class="yes">✓ fits</span>' : '<span class="no">✗ short ' + fmtN(S.target - r.people) + '</span>') + '</td></tr>';
    });
    $('cmpTable').innerHTML = html;
    $('cmpIntro').textContent = 'Maximum that fits in ' + fmtN2(S.room.length) + ' × ' + fmtN2(S.room.width) + ' ft with ' + S.chairs +
      ' chairs per table, ' + fmtFt(S.aisle) + ' walking clearance and ' + fmtFt(S.wall) + ' wall clearance.';
    var dlg = $('compareDlg');
    if (dlg.showModal) dlg.showModal();
  }

  /* ------------------------------------------------------------------ */
  /* Export (PNG) & print                                                */
  /* ------------------------------------------------------------------ */
  function exportPng() {
    var L = S.room.length, W = S.room.width, m = 6;
    var ppf = Math.min(30, 3800 / (L + 2 * m), 3800 / (W + 2 * m));
    var cw = Math.round((L + 2 * m) * ppf), ch = Math.round((W + 2 * m) * ppf);
    var clone = svg.cloneNode(true);
    clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    clone.setAttribute('viewBox', -m + ' ' + -m + ' ' + (L + 2 * m) + ' ' + (W + 2 * m));
    clone.setAttribute('width', cw); clone.setAttribute('height', ch);
    clone.querySelectorAll('.sel').forEach(function (n) { n.setAttribute('class', n.getAttribute('class').replace(' sel', '')); });
    var xml = new XMLSerializer().serializeToString(clone);
    var img = new Image();
    img.onload = function () {
      var head = Math.max(90, Math.round(cw * 0.04));
      var canvas = document.createElement('canvas');
      canvas.width = cw; canvas.height = ch + head;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(img, 0, head, cw, ch);
      var ev = lastEval || evaluate(), st = statusInfo(ev);
      var fs = Math.round(head * 0.36);
      ctx.fillStyle = '#1b2433'; ctx.font = '700 ' + fs + 'px sans-serif'; ctx.textBaseline = 'top';
      ctx.fillText('Basecamp Event Floor Planner', 24, head * 0.14);
      ctx.font = '500 ' + Math.round(fs * 0.7) + 'px sans-serif'; ctx.fillStyle = '#4a566b';
      ctx.fillText('Room ' + fmtN2(L) + ' × ' + fmtN2(W) + ' ft (' + fmtN(L * W) + ' sq ft)  ·  ' + ev.total + ' tables  ·  ' + ev.chairs + ' chairs  ·  ' +
        ev.accommodated + ' / ' + S.target + ' participants  ·  ' + st.title.replace(/^[^A-Z]+/, '') + '  ·  aisle ' + fmtFt(S.aisle) + ', wall ' + fmtFt(S.wall),
        24, head * 0.58);
      canvas.toBlob(function (blob) {
        if (!blob) { toast('Export failed in this browser.'); return; }
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'basecamp-floor-plan.png';
        document.body.appendChild(a); a.click(); a.remove();
        setTimeout(function () { URL.revokeObjectURL(a.href); }, 2000);
        toast('Layout exported as PNG.');
      }, 'image/png');
    };
    img.onerror = function () { toast('Export failed in this browser.'); };
    img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  }

  var savedView = null;
  window.addEventListener('beforeprint', function () {
    savedView = { v: { scale: view.scale, tx: view.tx, ty: view.ty }, z: userZoomed };
    var L = S.room.length, W = S.room.width;
    svg.setAttribute('viewBox', '-6 -6 ' + (L + 12) + ' ' + (W + 12));
  });
  window.addEventListener('afterprint', function () {
    if (savedView) { view = savedView.v; userZoomed = savedView.z; savedView = null; }
    applyView();
  });

  /* ------------------------------------------------------------------ */
  /* Wiring                                                              */
  /* ------------------------------------------------------------------ */
  function fillSelect(sel) {
    for (var i = 1; i <= 10; i++) { var o = document.createElement('option'); o.value = i; o.textContent = i; sel.appendChild(o); }
  }
  fillSelect($('selChairs'));
  fillSelect($('selTableChairs'));

  function syncInputs() {
    $('inLength').value = S.room.length;
    $('inWidth').value = S.room.width;
    $('inTarget').value = S.target;
    $('inAisle').value = S.aisle;
    $('inWall').value = S.wall;
    $('selChairs').value = S.chairs;
    document.querySelectorAll('input[name="ttype"]').forEach(function (r) { r.checked = r.value === S.type; });
    $('chkZones').checked = S.showZones;
    $('chkLabels').checked = S.showLabels;
  }

  function bindNumber(id, min, max, apply) {
    var el = $(id);
    el.addEventListener('input', function () {
      var v = parseFloat(el.value);
      if (!isFinite(v) || v < min || v > max) { el.classList.add('invalid'); return; }
      el.classList.remove('invalid');
      apply(v);
      settingsChanged();
    });
    el.addEventListener('change', function () {
      var v = parseFloat(el.value);
      v = isFinite(v) ? Math.min(max, Math.max(min, v)) : min;
      el.classList.remove('invalid');
      el.value = v;
      apply(v);
      settingsChanged();
      syncInputs();
    });
  }
  bindNumber('inLength', 10, 500, function (v) { S.room.length = v; });
  bindNumber('inWidth', 10, 500, function (v) { S.room.width = v; });
  bindNumber('inTarget', 1, 5000, function (v) { S.target = Math.round(v); });
  bindNumber('inAisle', 0, 20, function (v) { S.aisle = v; });
  bindNumber('inWall', 0, 20, function (v) { S.wall = v; });

  document.querySelectorAll('input[name="ttype"]').forEach(function (r) {
    r.addEventListener('change', function () { if (r.checked) { S.type = r.value; settingsChanged(); } });
  });
  $('selChairs').addEventListener('change', function () { S.chairs = Number($('selChairs').value); settingsChanged(); });

  $('chkZones').addEventListener('change', function () { S.showZones = $('chkZones').checked; afterChange(); });
  $('chkLabels').addEventListener('change', function () { S.showLabels = $('chkLabels').checked; afterChange(); });

  function runAuto500() { autoArrangeTarget(false); afterChange(); }
  $('btnAuto500').addEventListener('click', runAuto500);
  $('btnAuto500b').addEventListener('click', runAuto500);
  $('btnAutoArrange').addEventListener('click', function () { autoArrangeExisting(); afterChange(); });
  $('btnAdd').addEventListener('click', addTable);
  $('btnCompare').addEventListener('click', showCompare);
  $('btnExport').addEventListener('click', exportPng);
  $('btnPrint').addEventListener('click', function () { window.print(); });

  $('btnClear').addEventListener('click', function () {
    confirmDlg('Clear all tables and start again?', 'Clear', function () {
      S.tables = []; S.nextId = 1; S.auto = false; selectedId = null;
      afterChange();
    });
  });
  $('btnResetSaved').addEventListener('click', function () {
    confirmDlg('Reset the saved layout? Room, settings and tables return to the defaults.', 'Reset', function () {
      try { localStorage.removeItem(STORAGE_KEY); } catch (e) { /* ignore */ }
      S = defaults(); selectedId = null; userZoomed = false;
      syncInputs();
      render();
      $('saveNote').textContent = 'Saved layout cleared';
    });
  });

  $('btnZoomIn').addEventListener('click', function () { zoomCenter(1.25); });
  $('btnZoomOut').addEventListener('click', function () { zoomCenter(0.8); });
  $('btnFit').addEventListener('click', fitView);
  $('btnReset').addEventListener('click', resetView);

  /* selected table actions */
  function selectedTable() { return S.tables.filter(function (q) { return q.id === selectedId; })[0]; }
  $('selTableChairs').addEventListener('change', function () {
    var t = selectedTable(); if (!t) return;
    t.chairs = Number($('selTableChairs').value);
    S.auto = false;
    afterChange();
  });
  function rotateSelected() {
    var t = selectedTable();
    if (!t || TYPES[t.type].shape === 'round') return;
    t.rot = (t.rot + 90) % 360;
    S.auto = false;
    afterChange();
  }
  function deleteSelected() {
    var t = selectedTable(); if (!t) return;
    S.tables = S.tables.filter(function (q) { return q.id !== t.id; });
    selectedId = null; S.auto = false;
    afterChange();
  }
  $('btnRotate').addEventListener('click', rotateSelected);
  $('btnDelete').addEventListener('click', deleteSelected);

  document.addEventListener('keydown', function (e) {
    var tag = (e.target.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'select' || tag === 'textarea' || e.target.closest('dialog')) return;
    if (e.key === 'Delete' || e.key === 'Backspace') { deleteSelected(); e.preventDefault(); }
    else if (e.key === 'r' || e.key === 'R') rotateSelected();
    else if (e.key === 'Escape') select(null);
  });

  if (window.ResizeObserver) {
    new ResizeObserver(function () { if (!userZoomed) fitView(); else applyView(); }).observe($('planWrap'));
  } else {
    window.addEventListener('resize', function () { if (!userZoomed) fitView(); else applyView(); });
  }

  /* Small read-only hook used for automated checks. */
  window.FloorPlanner = {
    state: function () { return S; },
    evaluate: evaluate,
    packUniform: packUniform,
    chairPolys: function (t) { return chairLayout(t.type, t.chairs).map(function (c) { return chairPoly(c, t.rot).map(function (p) { return [p[0] + t.x, p[1] + t.y]; }); }); },
    TYPES: TYPES
  };

  syncInputs();
  render();
  save();
})();
