/* Daily Brief – Meals: data model + localStorage store.
 *
 * RECIPES are read-only here: they come from meals/data/jedla.xlsx, which
 * services/meals_db.py turns into meals/recipes.js (window.MEALS_RECIPES) on
 * every run of the brief. On load that list replaces data.meals (kept in
 * localStorage so the brief's Agenda line and file:// use still have names);
 * without recipes.js the last stored list is used.
 *
 * Everything lives under ONE localStorage key, 'dailybrief_meals_data':
 *
 *   {
 *     version: 1,
 *     meals: [Meal, ...],
 *     plan:  { 'YYYY-MM-DD' (Monday): Week },   // see normPlan below
 *     settings: { avgMode: 'week' | 'planned', showPantry: boolean,
 *                 senderName: string, shareShop: boolean,     // these three: "Poslať plán"
 *                 sharePantry: boolean,
 *                 kcalTarget: number },                       // daily energy for the WHO ranges
 *     pantry: [{ key, name, aisle, added: 'YYYY-MM-DD' }]   // "Špajza"
 *   }
 *
 * Meal = {
 *   id: string,
 *   name: string,
 *   kind: 'meal' | 'soup',                           // soup = "Polievka" (own picker per day)
 *   defaultServings: number,
 *   nutrition: { calories, protein, carbs, fat },   // per ONE serving (kcal, g)
 *   ingredients: [
 *     { name, amount, unit, aisle, isPantry }        // amounts for defaultServings
 *   ]
 * }
 *
 * aisle is one of AISLES (the order is also the shop-walk order of the
 * shopping list). isPantry marks staples you normally have at home (salt,
 * oil, pepper...), so the shopping list can leave them out or tuck them away.
 *
 * pantry ("Špajza") is what is at home right now, by ingredient NAME only
 * (key = case/diacritics-folded name, no amounts). Anything in it is left
 * off the shopping list, whatever the unit, until it is removed again.
 *
 * Classic script (no ES modules), so meals/index.html also works when opened
 * straight from disk (file://). Exposes window.MealsStore.
 */
(function (global) {
  'use strict';

  var STORAGE_KEY = 'dailybrief_meals_data';
  var VERSION = 3;          // 2: Meal.kind; 3 (2026-11-05): recipes from recipes.js

  var AISLES = [
    'Ovocie a zelenina',
    'Mäso a ryby',
    'Mliečne a chladené',
    'Trvanlivé potraviny',
    'Korenie a dochucovadlá'
  ];

  var KINDS = ['meal', 'soup'];   // main dish | soup ("Polievka")

  function freshData() {
    return { version: VERSION, meals: [], plan: {}, settings: defaultSettings(), pantry: [] };
  }
  // avgMode: 'week' = ÷7, 'planned' = ÷ planned days; showPantry: list staples on the shopping list
  var KCAL_DEFAULT = 2000;
  function defaultSettings() { return { avgMode: 'week', showPantry: false, senderName: '', shareShop: false, sharePantry: false, kcalTarget: KCAL_DEFAULT }; }
  function kcalTarget(v) {
    var n = Math.round(Number(v));
    return n >= 1000 && n <= 5000 ? n : KCAL_DEFAULT;
  }

  // ---- validation / normalisation (never trust what is in storage) ----
  function num(v, dflt) {
    var n = Number(v);
    return isFinite(n) ? n : dflt;
  }
  function str(v) { return typeof v === 'string' ? v : (v == null ? '' : String(v)); }

  var MAX_SERVINGS = 99;
  function clampServings(v) {
    var n = Math.round(num(v, 1));
    return Math.min(MAX_SERVINGS, Math.max(1, n));
  }

  function normIngredient(raw) {
    raw = raw || {};
    var aisle = AISLES.indexOf(raw.aisle) >= 0 ? raw.aisle : AISLES[3];
    return {
      name: str(raw.name).trim(),
      amount: Math.max(0, num(raw.amount, 0)),
      unit: str(raw.unit).trim(),
      aisle: aisle,
      isPantry: raw.isPantry === true
    };
  }

  function normMeal(raw) {
    raw = raw || {};
    var n = raw.nutrition || {};
    return {
      id: str(raw.id) || newId(),
      name: str(raw.name).trim() || 'Bez názvu',
      kind: raw.kind === 'soup' ? 'soup' : 'meal',
      defaultServings: clampServings(raw.defaultServings),
      nutrition: {
        calories: Math.max(0, num(n.calories, 0)),
        protein: Math.max(0, num(n.protein, 0)),
        carbs: Math.max(0, num(n.carbs, 0)),
        fat: Math.max(0, num(n.fat, 0))
      },
      ingredients: Array.isArray(raw.ingredients)
        ? raw.ingredients.map(normIngredient).filter(function (i) { return i.name; })
        : []
    };
  }

  /* plan = { 'YYYY-MM-DD' (Monday of the week): Week }
   * Week = { days: [Entry[] x7] (Mon..Sun), pool: Entry[] }   pool = the week's
   *        meals not tied to a day ("týždenný výber")
   * Entry = { id, mealId, servings }   servings = whole portions, 1..99
   * Entries whose meal no longer exists are dropped; empty weeks are not kept. */
  var WEEK_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;

  function normEntry(raw, mealIds) {
    if (!raw || !mealIds[raw.mealId]) return null;
    return { id: str(raw.id) || newId('e'), mealId: raw.mealId, servings: clampServings(raw.servings) };
  }
  function normEntries(list, mealIds) {
    return (Array.isArray(list) ? list : [])
      .map(function (e) { return normEntry(e, mealIds); })
      .filter(Boolean);
  }
  function weekIsEmpty(w) {
    return !w.pool.length && w.days.every(function (d) { return !d.length; });
  }
  function normPlan(raw, meals) {
    var ids = {};
    meals.forEach(function (m) { ids[m.id] = true; });
    var out = {};
    if (!raw || typeof raw !== 'object') return out;
    Object.keys(raw).forEach(function (key) {
      if (!WEEK_KEY_RE.test(key)) return;
      var w = raw[key] || {};
      var days = [];
      for (var i = 0; i < 7; i++) days.push(normEntries(Array.isArray(w.days) ? w.days[i] : null, ids));
      var week = { days: days, pool: normEntries(w.pool, ids) };
      if (!weekIsEmpty(week)) out[key] = week;
    });
    return out;
  }

  function normPantry(raw) {
    var seen = {}, out = [];
    (Array.isArray(raw) ? raw : []).forEach(function (p) {
      if (!p || typeof p !== 'object') return;
      var name = str(p.name).replace(/\s+/g, ' ').trim().slice(0, 120);
      var key = foldKey(name);
      if (!key || seen[key]) return;
      seen[key] = true;
      out.push({
        key: key, name: name,
        aisle: AISLES.indexOf(p.aisle) >= 0 ? p.aisle : AISLES[3],
        added: /^\d{4}-\d\d-\d\d$/.test(str(p.added)) ? p.added : ''
      });
    });
    return out;
  }

  function normData(raw) {
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.meals)) return null;
    // Future schema changes migrate here, keyed on raw.version.
    var meals = raw.meals.map(normMeal);
    var s = raw.settings || {};
    return {
      version: VERSION,
      meals: meals,
      plan: normPlan(raw.plan, meals),
      settings: {
        avgMode: s.avgMode === 'planned' ? 'planned' : 'week',
        showPantry: s.showPantry === true,
        senderName: str(s.senderName).replace(/\s+/g, ' ').trim().slice(0, 40),
        shareShop: s.shareShop === true,
        sharePantry: s.sharePantry === true,
        kcalTarget: kcalTarget(s.kcalTarget)
      },
      pantry: normPantry(raw.pantry)
    };
  }

  function newId(prefix) {
    return (prefix || 'm') + '-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 7);
  }

  // ---- storage (localStorage can be missing or throw: private mode etc.) ----
  var data = null;
  var persistent = true;   // false = running from memory only this session

  function readRaw() {
    try { return global.localStorage.getItem(STORAGE_KEY); }
    catch (e) { persistent = false; return null; }
  }

  function save() {
    if (!data) return false;
    try {
      global.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
      persistent = true;
      return true;
    } catch (e) {
      persistent = false;
      return false;
    }
  }

  function load() {
    var raw = readRaw();
    var parsed = null;
    if (raw) {
      try { parsed = normData(JSON.parse(raw)); } catch (e) { parsed = null; }
      if (!parsed) {
        // Unreadable data: keep a copy instead of silently losing it.
        try { global.localStorage.setItem(STORAGE_KEY + '_corrupt', raw); } catch (e) {}
      }
    }
    data = parsed || freshData();
    applyRecipes();
    save();          // store the normalised form (and the current recipe list)
    return data;
  }

  function get() { return data || load(); }

  // ---- recipes from meals/recipes.js (generated from jedla.xlsx) ----
  var recipesInfo = { fromFile: false, generated: '', source: '', warnings: [] };
  function applyRecipes() {
    var rec = global.MEALS_RECIPES;
    if (!rec || !Array.isArray(rec.meals)) return;      // keep the stored list
    data.meals = rec.meals.map(normMeal);
    data.plan = normPlan(data.plan, data.meals);         // drops entries of removed recipes
    recipesInfo = {
      fromFile: true,
      generated: str(rec.generated),
      source: str(rec.source) || 'jedla.xlsx',
      warnings: Array.isArray(rec.warnings) ? rec.warnings.map(str) : []
    };
  }
  function getRecipesInfo() { return recipesInfo; }

  // ---- meals ----
  function getMeals() { return get().meals.slice(); }
  function isSoup(meal) { return !!meal && meal.kind === 'soup'; }

  function getMeal(id) {
    var m = get().meals;
    for (var i = 0; i < m.length; i++) if (m[i].id === id) return m[i];
    return null;
  }

  /** How many plan entries (any week) use this meal. */
  function planUses(mealId) {
    var n = 0, plan = get().plan;
    Object.keys(plan).forEach(function (k) {
      eachEntry(plan[k], function (e) { if (e.mealId === mealId) n++; });
    });
    return n;
  }

  // ---- week keys (local dates; never toISOString, that is UTC) ----
  function pad(n) { return (n < 10 ? '0' : '') + n; }
  function isoDate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function parseKey(key) { var p = key.split('-'); return new Date(+p[0], +p[1] - 1, +p[2]); }
  function weekKey(date) {
    var d = date ? new Date(date.getFullYear(), date.getMonth(), date.getDate()) : new Date();
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    return isoDate(d);
  }
  function shiftWeek(key, weeks) {
    var d = parseKey(key);
    d.setDate(d.getDate() + 7 * weeks);
    return isoDate(d);
  }

  // ---- plan ----
  function emptyWeek() { return { days: [[], [], [], [], [], [], []], pool: [] }; }
  function eachEntry(week, fn) {
    week.days.forEach(function (list, day) { list.forEach(function (e) { fn(e, list, day); }); });
    week.pool.forEach(function (e) { fn(e, week.pool, 'pool'); });
  }

  /** The week's plan (a fresh empty one if nothing is planned; not stored). */
  function getWeek(key) { return get().plan[key] || emptyWeek(); }

  function weekForWrite(key) {
    var plan = get().plan;
    if (!plan[key]) plan[key] = emptyWeek();
    return plan[key];
  }
  function tidy(key) {
    var plan = get().plan;
    if (plan[key] && weekIsEmpty(plan[key])) delete plan[key];
  }

  /** slot: 0..6 (Mon..Sun) or 'pool'. Soups and dishes share the slot's
   *  list (the planner shows soups first). Returns the new entry. */
  function addToPlan(key, slot, mealId, servings) {
    var meal = getMeal(mealId);
    if (!meal) return null;
    var w = weekForWrite(key);
    var list = slot === 'pool' ? w.pool : w.days[slot];
    if (!list) return null;
    var entry = { id: newId('e'), mealId: mealId, servings: clampServings(servings == null ? meal.defaultServings : servings) };
    list.push(entry);
    save();
    return entry;
  }

  function findEntry(key, entryId) {
    var hit = null;
    eachEntry(getWeek(key), function (e, list) { if (e.id === entryId) hit = { entry: e, list: list }; });
    return hit;
  }

  function setServings(key, entryId, servings) {
    var hit = findEntry(key, entryId);
    if (!hit) return null;
    hit.entry.servings = clampServings(servings);
    save();
    return hit.entry;
  }

  function removeEntry(key, entryId) {
    var hit = findEntry(key, entryId);
    if (!hit) return false;
    hit.list.splice(hit.list.indexOf(hit.entry), 1);
    tidy(key);
    save();
    return true;
  }

  /* Puts a received week into the plan in one save. entries per slot are
   * [{mealId, servings}] (meals must already exist); mode 'replace' drops
   * what the week had, 'add' appends. Returns the number of entries added. */
  function importWeek(key, days, pool, mode) {
    if (mode === 'replace') delete get().plan[key];
    var w = weekForWrite(key), n = 0;
    function put(list, items) {
      (items || []).forEach(function (it) {
        if (!getMeal(it.mealId)) return;
        list.push({ id: newId('e'), mealId: it.mealId, servings: clampServings(it.servings) });
        n++;
      });
    }
    for (var i = 0; i < 7; i++) put(w.days[i], days && days[i]);
    put(w.pool, pool);
    tidy(key);
    save();
    return n;
  }

  function clearWeek(key) {
    var had = !!get().plan[key];
    delete get().plan[key];
    save();
    return had;
  }

  // ---- maths ----
  function zero() { return { calories: 0, protein: 0, carbs: 0, fat: 0 }; }
  function addTo(t, n, k) {
    t.calories += n.calories * k; t.protein += n.protein * k;
    t.carbs += n.carbs * k; t.fat += n.fat * k;
    return t;
  }
  /** Nutrition of `servings` portions of a meal. */
  function nutritionFor(meal, servings) { return addTo(zero(), meal.nutrition, servings); }

  /** WHO/FAO population intake goals (Technical Report Series 916, 2003) as
   *  grams per day for a daily energy intake of `kcal`: protein 10-15 %,
   *  carbohydrates 55-75 %, fat 15-30 % of energy (4 / 4 / 9 kcal per g). */
  var WHO_SHARES = { protein: [0.10, 0.15, 4], carbs: [0.55, 0.75, 4], fat: [0.15, 0.30, 9] };
  function whoTargets(kcal) {
    kcal = kcalTarget(kcal);
    var out = { calories: kcal };
    Object.keys(WHO_SHARES).forEach(function (k) {
      var r = WHO_SHARES[k];
      out[k] = { min: kcal * r[0] / r[2], max: kcal * r[1] / r[2], pctMin: r[0] * 100, pctMax: r[1] * 100 };
    });
    return out;
  }

  /** Ingredient amounts for `servings` portions (recipe is for defaultServings). */
  function scaleIngredients(meal, servings) {
    var k = servings / meal.defaultServings;
    return meal.ingredients.map(function (i) {
      var c = {}; for (var p in i) c[p] = i[p];
      c.amount = i.amount * k;
      return c;
    });
  }

  /** Totals for a week: per day, the pool, the whole week, and the counts
   *  needed for the daily average.
   *
   *  Nutrition is what ONE person eats: one portion of every planned meal,
   *  however many portions are cooked (the servings only scale the
   *  ingredients and the shopping list). */
  function weekSummary(key) {
    var w = getWeek(key);
    var days = [], total = zero(), pool = zero(), entries = 0, servings = 0;
    w.days.forEach(function (list) {
      var t = zero();
      list.forEach(function (e) {
        var m = getMeal(e.mealId);
        if (!m) return;
        addTo(t, m.nutrition, 1);
        entries++; servings += e.servings;
      });
      days.push(t);
      addTo(total, t, 1);
    });
    w.pool.forEach(function (e) {
      var m = getMeal(e.mealId);
      if (!m) return;
      addTo(pool, m.nutrition, 1);
      entries++; servings += e.servings;
    });
    addTo(total, pool, 1);
    var plannedDays = w.days.filter(function (l) { return l.length; }).length;
    return { total: total, days: days, pool: pool, plannedDays: plannedDays,
             entries: entries, servings: servings };
  }

  /* Shopping list for a week: every planned entry's ingredients scaled to its
   * servings, summed when name AND unit match (case/diacritics-insensitive
   * name, case-insensitive unit), grouped by aisle in AISLES order.
   * Pantry staples are left out unless includePantry; anything whose name is
   * in the Špajza is always left out. Returns
   * { groups: [{aisle, items: [{name, amount, unit, isPantry, meals: [names]}]}],
   *   count, pantryHidden,            // staples left out (distinct name+unit)
   *   owned: [{key, name, meals}] }   // planned but already in the Špajza */
  function foldKey(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/\s+/g, ' ').trim();
  }
  function shoppingList(key, includePantry) {
    var w = getWeek(key);
    var byKey = {}, order = [], pantryHidden = {}, owned = {}, ownedOrder = [];
    var have = pantrySet();
    function addEntry(e) {
      var meal = getMeal(e.mealId);
      if (!meal) return;
      scaleIngredients(meal, e.servings).forEach(function (i) {
        var nk = foldKey(i.name);
        if (have[nk]) {
          var o = owned[nk];
          if (!o) { o = owned[nk] = { key: nk, name: have[nk].name, meals: [] }; ownedOrder.push(nk); }
          if (o.meals.indexOf(meal.name) < 0) o.meals.push(meal.name);
          return;
        }
        var k = nk + '|' + i.unit.toLowerCase().trim();
        if (i.isPantry && !includePantry) { pantryHidden[k] = true; return; }
        var item = byKey[k];
        if (!item) {
          item = byKey[k] = { name: i.name, amount: 0, unit: i.unit, aisle: i.aisle,
                              isPantry: i.isPantry, meals: [] };
          order.push(k);
        }
        item.amount += i.amount;
        if (item.meals.indexOf(meal.name) < 0) item.meals.push(meal.name);
      });
    }
    w.days.forEach(function (list) { list.forEach(addEntry); });
    w.pool.forEach(addEntry);
    var groups = AISLES.map(function (aisle) {
      var items = order.map(function (k) { return byKey[k]; })
        .filter(function (i) { return i.aisle === aisle; })
        .sort(function (a, b) { return a.name.localeCompare(b.name, 'sk'); });
      return { aisle: aisle, items: items };
    }).filter(function (g) { return g.items.length; });
    var ownedList = ownedOrder.map(function (k) { return owned[k]; })
      .sort(function (a, b) { return a.name.localeCompare(b.name, 'sk'); });
    return { groups: groups, count: order.length, pantryHidden: Object.keys(pantryHidden).length,
             owned: ownedList };
  }

  // ---- Špajza (what is at home) ----
  function pantrySet() {
    var set = {};
    get().pantry.forEach(function (p) { set[p.key] = p; });
    return set;
  }
  function getPantry() {
    return get().pantry.slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'sk'); });
  }
  function inPantry(name) { return !!pantrySet()[foldKey(name)]; }
  /* Every distinct ingredient name used by the recipes, with the aisle it is
   * filed under (first recipe wins): [{key, name, aisle, isPantry}] */
  function knownIngredients() {
    var seen = {}, out = [];
    get().meals.forEach(function (m) {
      m.ingredients.forEach(function (i) {
        var k = foldKey(i.name);
        if (!k || seen[k]) return;
        seen[k] = true;
        out.push({ key: k, name: i.name, aisle: i.aisle, isPantry: i.isPantry });
      });
    });
    return out.sort(function (a, b) { return a.name.localeCompare(b.name, 'sk'); });
  }
  /* Adds a name to the Špajza. aisle defaults to the recipes' aisle for that
   * ingredient. Returns the stored item, or null for an empty name / one that
   * is already there. */
  function addToPantry(name, aisle) {
    name = str(name).replace(/\s+/g, ' ').trim().slice(0, 120);
    var key = foldKey(name);
    if (!key || pantrySet()[key]) return null;
    if (AISLES.indexOf(aisle) < 0) {
      var known = knownIngredients().filter(function (i) { return i.key === key; })[0];
      aisle = known ? known.aisle : AISLES[3];
    }
    var item = { key: key, name: name, aisle: aisle, added: isoDate(new Date()) };
    get().pantry.push(item);
    save();
    return item;
  }
  function removeFromPantry(key) {
    var d = get(), before = d.pantry.length;
    d.pantry = d.pantry.filter(function (p) { return p.key !== key; });
    if (d.pantry.length !== before) save();
    return d.pantry.length !== before;
  }
  function clearPantry() { get().pantry = []; save(); }
  /* A Špajza received with a shared plan: items [{name, aisle}]; mode 'add'
   * keeps what is here and adds the rest, 'replace' starts from the list.
   * One save. Returns the number of items added. */
  function importPantry(items, mode) {
    var d = get();
    if (mode === 'replace') d.pantry = [];
    var have = pantrySet(), n = 0, today = isoDate(new Date());
    (items || []).forEach(function (it) {
      var name = str(it && it.name).replace(/\s+/g, ' ').trim().slice(0, 120), key = foldKey(name);
      if (!key || have[key]) return;
      var item = { key: key, name: name, aisle: AISLES.indexOf(it.aisle) >= 0 ? it.aisle : AISLES[3], added: today };
      d.pantry.push(item); have[key] = item; n++;
    });
    save();
    return n;
  }

  function getSetting(name) { return get().settings[name]; }
  function setSetting(name, value) { get().settings[name] = value; save(); }

  global.MealsStore = {
    STORAGE_KEY: STORAGE_KEY,
    VERSION: VERSION,
    AISLES: AISLES.slice(),
    KINDS: KINDS.slice(), isSoup: isSoup,
    MAX_SERVINGS: MAX_SERVINGS,
    load: load, save: save, get: get,
    getMeals: getMeals, getMeal: getMeal, planUses: planUses, getRecipesInfo: getRecipesInfo,
    newId: newId,
    weekKey: weekKey, shiftWeek: shiftWeek, parseKey: parseKey,
    getWeek: getWeek, addToPlan: addToPlan, setServings: setServings,
    removeEntry: removeEntry, clearWeek: clearWeek, importWeek: importWeek,
    nutritionFor: nutritionFor, scaleIngredients: scaleIngredients, weekSummary: weekSummary,
    whoTargets: whoTargets, kcalTarget: kcalTarget,
    shoppingList: shoppingList, foldKey: foldKey,
    getPantry: getPantry, inPantry: inPantry, addToPantry: addToPantry,
    removeFromPantry: removeFromPantry, clearPantry: clearPantry, importPantry: importPantry,
    knownIngredients: knownIngredients,
    getSetting: getSetting, setSetting: setSetting,
    isPersistent: function () { return persistent; }
  };
})(window);
