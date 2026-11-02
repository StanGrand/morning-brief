/* Daily Brief – Meals: data model + localStorage store.
 *
 * Everything lives under ONE localStorage key, 'dailybrief_meals_data':
 *
 *   {
 *     version: 1,
 *     meals: [Meal, ...],
 *     plan:  { 'YYYY-MM-DD' (Monday): Week },   // see normPlan below
 *     settings: { avgMode: 'week' | 'planned', showPantry: boolean,
 *                 senderName: string, shareShop: boolean },   // last two: "Poslať plán"
 *     pantry: [{ key, name, aisle, added: 'YYYY-MM-DD' }]   // "Špajza"
 *   }
 *
 * Meal = {
 *   id: string,
 *   name: string,
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
  var VERSION = 1;

  var AISLES = [
    'Ovocie a zelenina',
    'Mäso a ryby',
    'Mliečne a chladené',
    'Trvanlivé potraviny',
    'Korenie a dochucovadlá'
  ];

  // ---- seed: 5 Slovak everyday meals, nutrition is per serving (approx.) ----
  function ing(name, amount, unit, aisle, isPantry) {
    return { name: name, amount: amount, unit: unit, aisle: AISLES[aisle], isPantry: !!isPantry };
  }
  var OVZ = 0, MAS = 1, MLI = 2, TRV = 3, KOR = 4;

  function seedMeals() {
    return [
      {
        id: 'seed-kuracie-prsia-ryza',
        name: 'Kuracie prsia s ryžou a brokolicou',
        defaultServings: 2,
        nutrition: { calories: 620, protein: 56, carbs: 74, fat: 11 },
        ingredients: [
          ing('Kuracie prsia', 400, 'g', MAS),
          ing('Ryža basmati', 150, 'g', TRV),
          ing('Brokolica', 300, 'g', OVZ),
          ing('Mrkva', 150, 'g', OVZ),
          ing('Cesnak', 2, 'strúčik', OVZ),
          ing('Olej', 1, 'PL', TRV, true),
          ing('Sladká paprika mletá', 1, 'ČL', KOR),
          ing('Soľ', 1, 'štipka', KOR, true),
          ing('Čierne korenie', 1, 'štipka', KOR, true)
        ]
      },
      {
        id: 'seed-tuniakove-cestoviny',
        name: 'Tuniakové cestoviny s paradajkami',
        defaultServings: 2,
        nutrition: { calories: 640, protein: 44, carbs: 90, fat: 10 },
        ingredients: [
          ing('Cestoviny penne', 200, 'g', TRV),
          ing('Tuniak vo vlastnej šťave', 2, 'konzerva', MAS),
          ing('Paradajková passata', 400, 'g', TRV),
          ing('Cibuľa', 1, 'ks', OVZ),
          ing('Cesnak', 2, 'strúčik', OVZ),
          ing('Olivový olej', 1, 'PL', TRV, true),
          ing('Oregano', 1, 'ČL', KOR, true),
          ing('Soľ', 1, 'štipka', KOR, true),
          ing('Čierne korenie', 1, 'štipka', KOR, true)
        ]
      },
      {
        id: 'seed-sosovicovy-privarok',
        name: 'Šošovicový prívarok s vajíčkom',
        defaultServings: 4,
        nutrition: { calories: 400, protein: 26, carbs: 51, fat: 10 },
        ingredients: [
          ing('Hnedá šošovica', 300, 'g', TRV),
          ing('Cibuľa', 1, 'ks', OVZ),
          ing('Vajcia', 4, 'ks', MLI),
          ing('Hladká múka', 2, 'PL', TRV, true),
          ing('Olej', 2, 'PL', TRV, true),
          ing('Ocot', 2, 'PL', KOR, true),
          ing('Cukor', 1, 'ČL', TRV, true),
          ing('Bobkový list', 2, 'ks', KOR, true),
          ing('Soľ', 1, 'ČL', KOR, true)
        ]
      },
      {
        id: 'seed-ovsena-kasa',
        name: 'Ovsená kaša s banánom a čučoriedkami',
        defaultServings: 1,
        nutrition: { calories: 510, protein: 17, carbs: 92, fat: 8 },
        ingredients: [
          ing('Ovsené vločky', 60, 'g', TRV),
          ing('Mlieko polotučné', 250, 'ml', MLI),
          ing('Banán', 1, 'ks', OVZ),
          ing('Čučoriedky', 80, 'g', OVZ),
          ing('Med', 1, 'ČL', TRV),
          ing('Škorica', 1, 'štipka', KOR, true)
        ]
      },
      {
        id: 'seed-hovadzie-chilli',
        name: 'Hovädzie chilli s fazuľou',
        defaultServings: 4,
        nutrition: { calories: 520, protein: 34, carbs: 40, fat: 24 },
        ingredients: [
          ing('Mleté hovädzie mäso', 500, 'g', MAS),
          ing('Červená fazuľa (konzerva)', 2, 'konzerva', TRV),
          ing('Drvené paradajky (konzerva)', 400, 'g', TRV),
          ing('Kukurica (konzerva)', 1, 'konzerva', TRV),
          ing('Cibuľa', 1, 'ks', OVZ),
          ing('Červená paprika', 1, 'ks', OVZ),
          ing('Cesnak', 3, 'strúčik', OVZ),
          ing('Chilli korenie', 2, 'ČL', KOR),
          ing('Údená paprika', 1, 'ČL', KOR),
          ing('Rasca mletá', 1, 'ČL', KOR),
          ing('Olej', 1, 'PL', TRV, true),
          ing('Soľ', 1, 'ČL', KOR, true)
        ]
      }
    ];
  }

  function freshData() {
    return { version: VERSION, meals: seedMeals(), plan: {}, settings: defaultSettings(), pantry: [] };
  }
  // avgMode: 'week' = ÷7, 'planned' = ÷ planned days; showPantry: list staples on the shopping list
  function defaultSettings() { return { avgMode: 'week', showPantry: false, senderName: '', shareShop: false }; }

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
    var aisle = AISLES.indexOf(raw.aisle) >= 0 ? raw.aisle : AISLES[TRV];
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
        shareShop: s.shareShop === true
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
    save();          // first visit / corrupt: seed; otherwise store the normalised form
    return data;
  }

  function get() { return data || load(); }

  // ---- meals ----
  function getMeals() { return get().meals.slice(); }

  function getMeal(id) {
    var m = get().meals;
    for (var i = 0; i < m.length; i++) if (m[i].id === id) return m[i];
    return null;
  }

  function upsertMeal(meal) {
    var clean = normMeal(meal);
    var meals = get().meals;
    for (var i = 0; i < meals.length; i++) {
      if (meals[i].id === clean.id) { meals[i] = clean; save(); return clean; }
    }
    meals.push(clean);
    save();
    return clean;
  }

  /** How many plan entries (any week) use this meal. */
  function planUses(mealId) {
    var n = 0, plan = get().plan;
    Object.keys(plan).forEach(function (k) {
      eachEntry(plan[k], function (e) { if (e.mealId === mealId) n++; });
    });
    return n;
  }

  /** Delete a meal and every plan entry that uses it. Returns true if it existed. */
  function removeMeal(id) {
    var d = get();
    var before = d.meals.length;
    d.meals = d.meals.filter(function (m) { return m.id !== id; });
    if (d.meals.length === before) return false;
    d.plan = normPlan(d.plan, d.meals);
    save();
    return true;
  }

  /** Put the 5 sample meals back as shipped (re-adds deleted ones, reverts
   *  edits to them). The reader's own meals and the plan are kept. */
  function restoreSamples() {
    var d = get();
    seedMeals().forEach(function (seed) {
      var i = d.meals.findIndex(function (m) { return m.id === seed.id; });
      if (i >= 0) d.meals[i] = seed; else d.meals.push(seed);
    });
    save();
    return d.meals.length;
  }

  /** Throw away everything (meals AND plan) and start from the samples. */
  function reset() {
    data = freshData();
    save();
    return data;
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

  /** slot: 0..6 (Mon..Sun) or 'pool'. Returns the new entry. */
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
   *  needed for the daily average. */
  function weekSummary(key) {
    var w = getWeek(key);
    var days = [], total = zero(), pool = zero(), entries = 0, servings = 0;
    w.days.forEach(function (list) {
      var t = zero();
      list.forEach(function (e) {
        var m = getMeal(e.mealId);
        if (!m) return;
        addTo(t, m.nutrition, e.servings);
        entries++; servings += e.servings;
      });
      days.push(t);
      addTo(total, t, 1);
    });
    w.pool.forEach(function (e) {
      var m = getMeal(e.mealId);
      if (!m) return;
      addTo(pool, m.nutrition, e.servings);
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

  function getSetting(name) { return get().settings[name]; }
  function setSetting(name, value) { get().settings[name] = value; save(); }

  global.MealsStore = {
    STORAGE_KEY: STORAGE_KEY,
    VERSION: VERSION,
    AISLES: AISLES.slice(),
    MAX_SERVINGS: MAX_SERVINGS,
    load: load, save: save, get: get, reset: reset,
    getMeals: getMeals, getMeal: getMeal, upsertMeal: upsertMeal,
    removeMeal: removeMeal, planUses: planUses, restoreSamples: restoreSamples,
    newId: newId,
    weekKey: weekKey, shiftWeek: shiftWeek, parseKey: parseKey,
    getWeek: getWeek, addToPlan: addToPlan, setServings: setServings,
    removeEntry: removeEntry, clearWeek: clearWeek, importWeek: importWeek,
    nutritionFor: nutritionFor, scaleIngredients: scaleIngredients, weekSummary: weekSummary,
    shoppingList: shoppingList, foldKey: foldKey,
    getPantry: getPantry, inPantry: inPantry, addToPantry: addToPantry,
    removeFromPantry: removeFromPantry, clearPantry: clearPantry,
    knownIngredients: knownIngredients,
    getSetting: getSetting, setSetting: setSetting,
    isPersistent: function () { return persistent; }
  };
})(window);
