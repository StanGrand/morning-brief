/* Daily Brief – Meals: share a week's plan as a link (no server).
 *
 * The plan travels in the URL fragment (#import=…), which browsers never send
 * to the web server: meals/index.html#import=z1.<base64url(deflate(JSON))>.
 * The payload carries every recipe the week uses, so the receiver can load
 * it even if their recipe list differs. Pantry and settings never travel.
 *
 * Payload v1 (compact on purpose, links get long):
 *   { v: 1, w: 'YYYY-MM-DD' (Monday), f: sender name,
 *     m: [[id, name, defaultServings, [kcal, protein, carbs, fat],
 *          [[name, amount, unit, aisleIndex, isPantry 0|1], ...]], ...],
 *     d: [[[mealIndex, servings], ...] x7],   // Mon..Sun
 *     p: [[mealIndex, servings], ...] }       // "Týždenný výber"
 *
 * Prefix 'z1.' = deflate-compressed (CompressionStream), 'j1.' = plain JSON
 * (fallback for browsers without CompressionStream). Exposes window.MealsShare.
 */
(function (global) {
  'use strict';

  var Store = global.MealsStore;
  var MAX_LINK = 60000;          // refuse absurd fragments before decoding

  // ---- base64url <-> bytes ----
  function toB64url(bytes) {
    var s = '';
    for (var i = 0; i < bytes.length; i += 0x8000) {
      s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }
  function fromB64url(str) {
    var b = str.replace(/-/g, '+').replace(/_/g, '/');
    while (b.length % 4) b += '=';
    var bin = atob(b), out = new Uint8Array(bin.length);
    for (var i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
    return out;
  }

  function canZip() {
    return typeof global.CompressionStream === 'function' && typeof global.DecompressionStream === 'function';
  }
  async function through(bytes, stream) {
    var res = new Response(new Blob([bytes]).stream().pipeThrough(stream));
    return new Uint8Array(await res.arrayBuffer());
  }

  function round3(n) { return Math.round(n * 1000) / 1000; }

  // ---- pack: the week as shown in the planner -> payload object ----
  function pack(key, from) {
    var w = Store.getWeek(key);
    var idx = {}, meals = [];
    function ref(e) {
      var meal = Store.getMeal(e.mealId);
      if (!meal) return null;
      if (!(meal.id in idx)) {
        idx[meal.id] = meals.length;
        var n = meal.nutrition;
        meals.push([meal.id, meal.name, meal.defaultServings,
          [round3(n.calories), round3(n.protein), round3(n.carbs), round3(n.fat)],
          meal.ingredients.map(function (i) {
            return [i.name, round3(i.amount), i.unit, Math.max(0, Store.AISLES.indexOf(i.aisle)), i.isPantry ? 1 : 0];
          })]);
      }
      return [idx[meal.id], e.servings];
    }
    function list(entries) { return entries.map(ref).filter(Boolean); }
    var out = { v: 1, w: key, m: meals, d: w.days.map(list), p: list(w.pool) };
    if (from) out.f = from;
    return out;
  }

  // ---- unpack: untrusted payload -> {week, from, meals[], days[7][], pool[]} ----
  function bad(msg) { var e = new Error(msg); e.shareError = true; return e; }

  function unpack(o) {
    if (!o || typeof o !== 'object' || o.v !== 1) throw bad('version');
    var key = String(o.w || '');
    if (!/^\d{4}-\d\d-\d\d$/.test(key) || Store.weekKey(Store.parseKey(key)) !== key) throw bad('week');
    if (!Array.isArray(o.m) || o.m.length > 200) throw bad('meals');
    var meals = o.m.map(function (r) {
      if (!Array.isArray(r)) throw bad('meal');
      var n = Array.isArray(r[3]) ? r[3] : [];
      return {
        id: String(r[0] || '').slice(0, 80),
        name: String(r[1] || '').replace(/\s+/g, ' ').trim().slice(0, 120) || 'Bez názvu',
        defaultServings: r[2],
        nutrition: { calories: n[0], protein: n[1], carbs: n[2], fat: n[3] },
        ingredients: (Array.isArray(r[4]) ? r[4] : []).slice(0, 100).map(function (i) {
          i = Array.isArray(i) ? i : [];
          return { name: String(i[0] || '').slice(0, 120), amount: i[1], unit: String(i[2] || '').slice(0, 20),
                   aisle: Store.AISLES[i[3]] || Store.AISLES[3], isPantry: i[4] === 1 };
        })
      };
    });
    function list(raw) {
      return (Array.isArray(raw) ? raw : []).slice(0, 50).map(function (r) {
        if (!Array.isArray(r) || !meals[r[0]]) return null;
        var s = Math.round(Number(r[1]));
        return { meal: r[0], servings: s >= 1 ? Math.min(s, Store.MAX_SERVINGS) : 1 };
      }).filter(Boolean);
    }
    var days = [];
    for (var i = 0; i < 7; i++) days.push(list(Array.isArray(o.d) ? o.d[i] : null));
    var from = String(o.f || '').replace(/\s+/g, ' ').trim().slice(0, 40);
    return { week: key, from: from, meals: meals, days: days, pool: list(o.p) };
  }

  // ---- string codec ----
  async function encode(obj) {
    var bytes = new TextEncoder().encode(JSON.stringify(obj));
    if (canZip()) {
      try { return 'z1.' + toB64url(await through(bytes, new CompressionStream('deflate'))); }
      catch (e) { /* fall through to plain */ }
    }
    return 'j1.' + toB64url(bytes);
  }

  async function decode(str) {
    str = String(str || '');
    if (str.length > MAX_LINK) throw bad('too long');
    var kind = str.slice(0, 3), body = str.slice(3);
    var bytes;
    try { bytes = fromB64url(body); } catch (e) { throw bad('base64'); }
    if (kind === 'z1.') {
      if (!canZip()) throw bad('nozip');
      try { bytes = await through(bytes, new DecompressionStream('deflate')); }
      catch (e) { throw bad('inflate'); }
    } else if (kind !== 'j1.') {
      throw bad('prefix');
    }
    var obj;
    try { obj = JSON.parse(new TextDecoder().decode(bytes)); } catch (e) { throw bad('json'); }
    return unpack(obj);
  }

  global.MealsShare = { pack: pack, unpack: unpack, encode: encode, decode: decode, canZip: canZip };
})(window);
