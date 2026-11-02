/* Daily Brief – Meals: page UI (theme, tabs, recipes, week planner,
 * shopping list, Špajza).
 * All data goes through window.MealsStore (store.js). The DOM is built with
 * createElement/textContent only (no innerHTML with user text). */
(function () {
  'use strict';

  var Store = window.MealsStore;

  // ================================================================ helpers
  function $(id) { return document.getElementById(id); }

  function el(tag, attrs, children) {
    var n = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v == null || v === false) continue;
      if (k === 'text') n.textContent = v;
      else if (k === 'cls') n.className = v;
      else if (k === 'value') n.value = v;
      else if (k === 'checked' || k === 'disabled' || k === 'selected' || k === 'open') n[k] = !!v;
      else n.setAttribute(k, v === true ? '' : v);
    }
    (children || []).forEach(function (c) {
      if (c != null && c !== false) n.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
    });
    return n;
  }

  var nf1 = new Intl.NumberFormat('sk-SK', { maximumFractionDigits: 1 });
  var nf0 = new Intl.NumberFormat('sk-SK', { maximumFractionDigits: 0 });
  function fmt(n) { return nf1.format(n); }
  function int(n) { return nf0.format(Math.round(n)); }

  // Recipe amounts after scaling: whole grams/ml above 20, else one decimal.
  function fmtAmount(n, unit) {
    if ((unit === 'g' || unit === 'ml') && n >= 20) return int(n);
    return fmt(Math.round(n * 10) / 10);
  }

  // Slovak plural of counted units: 1 / 2-4 (and fractions) / 5+.
  var UNIT_FORMS = {
    'ks': ['ks', 'ks', 'ks'],
    'strúčik': ['strúčik', 'strúčiky', 'strúčikov'],
    'konzerva': ['konzerva', 'konzervy', 'konzerv'],
    'štipka': ['štipka', 'štipky', 'štipiek'],
    'balenie': ['balenie', 'balenia', 'balení'],
    'hrsť': ['hrsť', 'hrste', 'hrstí']
  };
  function unitFor(amount, unit) {
    var f = UNIT_FORMS[unit];
    if (!f) return unit;
    var a = Math.round(amount * 10) / 10;
    if (a === 1) return f[0];
    if (a % 1 !== 0 || (a >= 2 && a <= 4)) return f[1];
    return f[2];
  }
  function amountText(i) {
    if (!i.amount) return i.unit;
    return fmtAmount(i.amount, i.unit) + (i.unit ? ' ' + unitFor(i.amount, i.unit) : '');
  }
  function portions(n) {
    return n + ' ' + (n === 1 ? 'porcia' : (n >= 2 && n <= 4 ? 'porcie' : 'porcií'));
  }
  function fold(s) {
    return String(s).normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  }
  function dm(d) { return d.getDate() + '. ' + (d.getMonth() + 1) + '.'; }

  // ingredients grouped by aisle in shop order -> [aisle block]
  function ingredientGroups(list) {
    return Store.AISLES.map(function (aisle) {
      var items = list.filter(function (i) { return i.aisle === aisle; });
      if (!items.length) return null;
      return el('div', { cls: 'aisle' }, [
        el('h4', { text: aisle }),
        el('ul', { cls: 'ing' }, items.map(function (i) {
          return el('li', { cls: i.isPantry ? 'pantry' : null }, [
            el('span', { cls: 'nm' }, [i.name, i.isPantry ? el('span', { cls: 'tag', text: 'zásoba' }) : null,
              Store.inPantry(i.name) ? el('span', { cls: 'tag home', text: 'doma' }) : null]),
            el('span', { cls: 'amt', text: amountText(i) })
          ]);
        }))
      ]);
    });
  }

  // Re-rendering replaces the DOM; keep keyboard focus on the "same" control.
  function rememberFocus() {
    var a = document.activeElement;
    return a && a.getAttribute ? a.getAttribute('data-focus') : null;
  }
  function restoreFocus(key) {
    if (!key) return;
    var n = document.querySelector('[data-focus="' + key + '"]');
    if (n && !n.disabled) n.focus();
  }

  // ================================================================ dialogs
  var confirmDlg = $('confirmDialog');
  function confirmBox(title, text, okLabel) {
    return new Promise(function (resolve) {
      $('confirmTitle').textContent = title;
      $('confirmText').textContent = text;
      $('confirmOk').textContent = okLabel || 'OK';
      confirmDlg.returnValue = '';
      confirmDlg.addEventListener('close', function done() {
        confirmDlg.removeEventListener('close', done);
        resolve(confirmDlg.returnValue === 'ok');
      });
      confirmDlg.showModal();
      $('confirmOk').focus();
    });
  }

  // ================================================================= theme
  // Same behaviour and key as the brief: follow the OS until the reader picks.
  (function theme() {
    var KEY = 'mb-theme', root = document.documentElement;
    var mq = window.matchMedia('(prefers-color-scheme: dark)');
    function explicit() {
      try { var t = localStorage.getItem(KEY); return (t === 'light' || t === 'dark') ? t : null; }
      catch (e) { return null; }
    }
    function current() { return explicit() || (mq.matches ? 'dark' : 'light'); }
    function apply(t) {
      root.setAttribute('data-theme', t);
      var b = $('themeToggle');
      b.textContent = t === 'dark' ? '☀︎' : '☾︎';
      var label = t === 'dark' ? 'Prepnúť na svetlý režim' : 'Prepnúť na tmavý režim';
      b.setAttribute('aria-label', label);
      b.setAttribute('title', label);
    }
    apply(current());
    $('themeToggle').addEventListener('click', function () {
      var next = current() === 'dark' ? 'light' : 'dark';
      try { localStorage.setItem(KEY, next); } catch (e) {}
      apply(next);
    });
    mq.addEventListener('change', function () { if (!explicit()) apply(current()); });
    window.addEventListener('storage', function (e) { if (e.key === KEY) apply(current()); });
  })();

  // ================================================================== tabs
  var TABS = ['plan', 'recipes', 'shop', 'pantry'];
  function showTab(name) {
    if (TABS.indexOf(name) < 0) name = TABS[0];
    TABS.forEach(function (t) {
      var on = t === name;
      $('tab-' + t).setAttribute('aria-selected', on ? 'true' : 'false');
      $('pane-' + t).hidden = !on;
    });
  }
  function fromHash() {
    var h = location.hash.replace('#', '');
    if (h.indexOf('import=') === 0) { handleImport(h.slice(7)); return; }
    showTab(h);
  }
  window.addEventListener('hashchange', fromHash);
  document.querySelector('.tabs').addEventListener('keydown', function (e) {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    var cur = TABS.indexOf(location.hash.replace('#', ''));
    if (cur < 0) cur = 0;
    var next = TABS[(cur + (e.key === 'ArrowRight' ? 1 : TABS.length - 1)) % TABS.length];
    location.hash = next;
    $('tab-' + next).focus();
    e.preventDefault();
  });

  // ======================================================= recipes & meals
  var query = '';

  function macro(label, value, unit, cls) {
    return el('div', { cls: 'macro' + (cls ? ' ' + cls : '') }, [
      el('div', { cls: 'k', text: label }),
      el('div', { cls: 'v' }, [int(value), el('small', { text: unit })])
    ]);
  }

  function mealCard(m) {
    var n = m.nutrition;
    return el('article', { cls: 'card meal', id: 'meal-' + m.id }, [
      el('div', { cls: 'meal-head' }, [
        el('h3', { cls: 'meal-name', text: m.name }),
        el('span', { cls: 'portions', text: portions(m.defaultServings) })
      ]),
      el('p', { cls: 'meal-sub', text: 'Na 1 porciu (orientačne)' }),
      el('div', { cls: 'macros' }, [
        macro('Energia', n.calories, ' kcal', 'kcal'),
        macro('Bielkoviny', n.protein, ' g'),
        macro('Sacharidy', n.carbs, ' g'),
        macro('Tuky', n.fat, ' g')
      ]),
      m.ingredients.length
        ? el('details', { cls: 'ingr' }, [el('summary', { text: 'Suroviny (' + m.ingredients.length + ')' })].concat(ingredientGroups(m.ingredients)))
        : el('p', { cls: 'empty', text: 'Bez surovín.' }),
      el('div', { cls: 'meal-actions' }, [
        el('button', { type: 'button', cls: 'btn quiet', 'data-edit': m.id, 'data-focus': 'edit:' + m.id, text: 'Upraviť' }),
        el('button', { type: 'button', cls: 'btn quiet danger', 'data-delete': m.id, text: 'Zmazať' })
      ])
    ]);
  }

  function renderMeals() {
    var meals = Store.getMeals();
    var q = fold(query.trim());
    var shown = q ? meals.filter(function (m) { return fold(m.name).indexOf(q) >= 0; }) : meals;
    var box = $('meals');
    box.textContent = '';
    if (!meals.length) {
      box.appendChild(el('div', { cls: 'card empty-card' }, [
        el('p', { text: 'Zatiaľ žiadne jedlá. Pridaj nové alebo obnov vzorové recepty.' })
      ]));
    } else if (!shown.length) {
      box.appendChild(el('div', { cls: 'card empty-card' }, [
        el('p', { text: 'Nič nezodpovedá hľadaniu „' + query.trim() + '“.' })
      ]));
    }
    shown.forEach(function (m) { box.appendChild(mealCard(m)); });
    $('mealCount').textContent = meals.length;
  }

  async function deleteMeal(id) {
    var m = Store.getMeal(id);
    if (!m) return false;
    var uses = Store.planUses(id);
    var text = 'Jedlo „' + m.name + '“ sa natrvalo zmaže.' +
      (uses ? ' Odstráni sa aj z plánu (' + uses + '×).' : '');
    if (!(await confirmBox('Zmazať jedlo?', text, 'Zmazať'))) return false;
    Store.removeMeal(id);
    renderAll();
    return true;
  }

  $('mealSearch').addEventListener('input', function (e) { query = e.target.value; renderMeals(); });
  $('mealNew').addEventListener('click', function () { openMealForm(null); });
  $('mealsRestore').addEventListener('click', async function () {
    var ok = await confirmBox('Obnoviť vzorové recepty?',
      'Vzorové jedlá sa vrátia do pôvodného stavu: zmazané sa pridajú späť a ich úpravy sa zrušia. ' +
      'Tvoje vlastné jedlá a plán týždňa zostanú.', 'Obnoviť');
    if (!ok) return;
    Store.restoreSamples();
    renderAll();
  });
  $('meals').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.edit) openMealForm(Store.getMeal(b.dataset.edit));
    else if (b.dataset.delete) deleteMeal(b.dataset.delete);
  });

  // ---------------------------------------------------------- meal form
  var mealDlg = $('mealDialog'), form = $('mealForm'), editingId = null;

  function ingRow(i) {
    i = i || { name: '', amount: '', unit: 'g', aisle: Store.AISLES[0], isPantry: false };
    return el('div', { cls: 'ing-row' }, [
      el('input', { cls: 'i-name', 'aria-label': 'Surovina', placeholder: 'napr. Cibuľa', value: i.name, maxlength: 80 }),
      el('input', { cls: 'i-amount', type: 'number', min: 0, step: 'any', inputmode: 'decimal', 'aria-label': 'Množstvo', value: i.amount === '' ? '' : String(i.amount) }),
      el('input', { cls: 'i-unit', list: 'units', 'aria-label': 'Jednotka', value: i.unit, maxlength: 20 }),
      el('select', { cls: 'i-aisle', 'aria-label': 'Oddelenie' }, Store.AISLES.map(function (a) {
        return el('option', { value: a, text: a, selected: a === i.aisle });
      })),
      el('label', { cls: 'i-pantry', title: 'Bežne doma (soľ, olej, korenie…)' }, [
        el('input', { type: 'checkbox', checked: i.isPantry }), el('span', { text: 'Zásoba', title: 'Bežná zásoba (soľ, olej, korenie…)' })
      ]),
      el('button', { type: 'button', cls: 'btn icon i-del', 'aria-label': 'Odstrániť surovinu', text: '×' })
    ]);
  }

  function openMealForm(meal) {
    editingId = meal ? meal.id : null;
    $('mealDialogTitle').textContent = meal ? 'Upraviť jedlo' : 'Nové jedlo';
    $('mealDelete').hidden = !meal;
    $('mealFormError').hidden = true;
    var f = form.elements;
    f.name.value = meal ? meal.name : '';
    f.defaultServings.value = meal ? meal.defaultServings : 2;
    ['calories', 'protein', 'carbs', 'fat'].forEach(function (k) {
      f[k].value = meal ? meal.nutrition[k] : '';
    });
    var rows = $('ingRows');
    rows.textContent = '';
    (meal && meal.ingredients.length ? meal.ingredients : [null]).forEach(function (i) { rows.appendChild(ingRow(i)); });
    mealDlg.showModal();
    f.name.focus();
  }

  function formError(msg, field) {
    var e = $('mealFormError');
    e.textContent = msg;
    e.hidden = false;
    if (field) field.focus();
  }

  function readForm() {
    var f = form.elements;
    var name = f.name.value.trim();
    if (!name) return formError('Zadaj názov jedla.', f.name);
    var serv = Number(f.defaultServings.value);
    if (!(serv >= 1 && serv <= Store.MAX_SERVINGS) || serv % 1) {
      return formError('Počet porcií musí byť celé číslo od 1 do ' + Store.MAX_SERVINGS + '.', f.defaultServings);
    }
    var nutrition = {};
    var keys = ['calories', 'protein', 'carbs', 'fat'];
    for (var k = 0; k < keys.length; k++) {
      var raw = f[keys[k]].value.trim().replace(',', '.');
      var v = raw === '' ? 0 : Number(raw);
      if (!(v >= 0)) return formError('Nutričné hodnoty musia byť nezáporné čísla.', f[keys[k]]);
      nutrition[keys[k]] = v;
    }
    var ingredients = [];
    var rows = $('ingRows').querySelectorAll('.ing-row');
    for (var r = 0; r < rows.length; r++) {
      var row = rows[r];
      var iname = row.querySelector('.i-name').value.trim();
      var amountField = row.querySelector('.i-amount');
      if (!iname) continue;                       // empty rows are ignored
      var a = amountField.value.trim() === '' ? 0 : Number(amountField.value);
      if (!(a >= 0)) return formError('Množstvo pri „' + iname + '“ musí byť nezáporné číslo.', amountField);
      ingredients.push({
        name: iname, amount: a,
        unit: row.querySelector('.i-unit').value.trim(),
        aisle: row.querySelector('.i-aisle').value,
        isPantry: row.querySelector('.i-pantry input').checked
      });
    }
    return { id: editingId || Store.newId(), name: name, defaultServings: serv,
             nutrition: nutrition, ingredients: ingredients };
  }

  form.addEventListener('submit', function (e) {
    e.preventDefault();
    var meal = readForm();
    if (!meal) return;
    var saved = Store.upsertMeal(meal);
    mealDlg.close();
    renderAll();
    var card = $('meal-' + saved.id);
    if (card && !$('pane-recipes').hidden) card.scrollIntoView({ block: 'nearest' });
  });
  $('ingAdd').addEventListener('click', function () {
    var row = ingRow(null);
    $('ingRows').appendChild(row);
    row.querySelector('.i-name').focus();
  });
  $('ingRows').addEventListener('click', function (e) {
    var b = e.target.closest('.i-del');
    if (!b) return;
    var rows = $('ingRows');
    b.closest('.ing-row').remove();
    if (!rows.children.length) rows.appendChild(ingRow(null));
  });
  mealDlg.addEventListener('click', function (e) {
    if (e.target.closest('[data-close]')) mealDlg.close();
    else if (e.target === mealDlg) mealDlg.close();       // click on the backdrop
  });
  $('mealDelete').addEventListener('click', async function () {
    var id = editingId;
    mealDlg.close();
    if (!(await deleteMeal(id))) openMealForm(Store.getMeal(id));
  });

  // ================================================================ planner
  var DAY_NAMES = ['Pondelok', 'Utorok', 'Streda', 'Štvrtok', 'Piatok', 'Sobota', 'Nedeľa'];
  var DAY_SHORT = ['Po', 'Ut', 'St', 'Št', 'Pi', 'So', 'Ne'];
  var thisWeek = Store.weekKey();
  var week = thisWeek;
  var openIngredients = {};      // entry id -> true while its ingredient list is expanded

  function macroLine(t) {
    return int(t.calories) + ' kcal · B ' + int(t.protein) + ' · S ' + int(t.carbs) + ' · T ' + int(t.fat) + ' g';
  }

  function entryRow(e) {
    var m = Store.getMeal(e.mealId);
    if (!m) return null;
    // One portion: what one person eats (the servings only scale the
    // ingredients and the shopping list).
    var t = Store.nutritionFor(m, 1);
    return el('div', { cls: 'entry' }, [
      el('div', { cls: 'e-top' }, [
        el('span', { cls: 'e-name', text: m.name }),
        el('button', { type: 'button', cls: 'btn icon x', 'data-remove': e.id,
                       'aria-label': 'Odstrániť ' + m.name + ' z plánu', text: '×' })
      ]),
      el('div', { cls: 'e-mid' }, [
        el('div', { cls: 'stepper', role: 'group', 'aria-label': 'Počet porcií' }, [
          el('button', { type: 'button', 'data-step': '-1', 'data-entry': e.id, 'data-focus': 'dec:' + e.id,
                         'aria-label': 'Ubrať porciu', disabled: e.servings <= 1, text: '−' }),
          el('output', { 'aria-live': 'polite', text: portions(e.servings) }),
          el('button', { type: 'button', 'data-step': '1', 'data-entry': e.id, 'data-focus': 'inc:' + e.id,
                         'aria-label': 'Pridať porciu', disabled: e.servings >= Store.MAX_SERVINGS, text: '+' })
        ]),
        el('span', { cls: 'e-nut', title: 'Na 1 porciu', text: '1 porcia: ' + macroLine(t) })
      ]),
      m.ingredients.length
        ? el('details', { cls: 'e-ing', 'data-entry': e.id, open: !!openIngredients[e.id] },
            [el('summary', { text: 'Suroviny na ' + portions(e.servings) })]
              .concat(ingredientGroups(Store.scaleIngredients(m, e.servings))))
        : null
    ]);
  }

  function addSelect(slot, label) {
    var meals = Store.getMeals().slice().sort(function (a, b) { return a.name.localeCompare(b.name, 'sk'); });
    return el('select', { cls: 'add', 'data-slot': String(slot), 'data-focus': 'add:' + slot, 'aria-label': label },
      [el('option', { value: '', text: meals.length ? '+ Pridať jedlo…' : 'Najprv pridaj jedlá v Receptoch' })]
        .concat(meals.map(function (m) { return el('option', { value: m.id, text: m.name }); })));
  }

  function dayBlock(slot, title, sub, totals, entries, isToday) {
    var picked = slot !== 'pool' && selDay === slot;
    var head = slot === 'pool'
      ? el('div', { cls: 'day-title' }, [el('b', { text: title }), sub ? el('span', { text: sub }) : null])
      // the day's name opens that day in the nutrition panel
      : el('button', { type: 'button', cls: 'day-title day-pick', 'data-pick': String(slot), 'data-focus': 'pick:' + slot,
                       'aria-pressed': picked ? 'true' : 'false', title: 'Výživa za tento deň' },
          [el('b', { text: title }), sub ? el('span', { text: sub }) : null]);
    return el('div', { cls: 'day' + (isToday ? ' today' : '') + (picked ? ' picked' : '') + (slot === 'pool' ? ' pool' : '') }, [
      el('div', { cls: 'day-head' }, [
        head,
        totals.calories ? el('span', { cls: 'day-kcal', text: int(totals.calories) + ' kcal' }) : null
      ]),
      el('div', { cls: 'day-body' }, [
        el('div', { cls: 'entries' }, entries.map(entryRow)),
        addSelect(slot, 'Pridať jedlo: ' + title)
      ])
    ]);
  }

  function weekLabel() {
    var d = Store.parseKey(week);
    var end = new Date(d); end.setDate(d.getDate() + 6);
    $('weekRange').textContent = dm(d) + ' – ' + dm(end) + ' ' + end.getFullYear();
    var diff = Math.round((Store.parseKey(week) - Store.parseKey(thisWeek)) / (7 * 864e5));
    $('weekWhen').textContent = diff === 0 ? 'tento týždeň' : diff === 1 ? 'budúci týždeň'
      : diff === -1 ? 'minulý týždeň'
      : diff > 0 ? 'o ' + diff + (diff <= 4 ? ' týždne' : ' týždňov') : 'pred ' + (-diff) + ' týždňami';
    $('weekToday').hidden = diff === 0;
  }

  // ---- nutrition panel: one portion per meal, WHO ranges, per day or week
  var selDay = defaultDay();      // 0..6 = that day only, null = the whole week

  function defaultDay() { return week === thisWeek ? (new Date().getDay() + 6) % 7 : null; }

  function ring(value, target) {
    // progress circle for the day's energy vs the daily target
    var R = 34, C = 2 * Math.PI * R, p = target ? value / target : 0;
    var shown = Math.min(p, 1), over = p > 1.1;
    var svg = '<svg viewBox="0 0 80 80" width="84" height="84" aria-hidden="true">' +
      '<circle cx="40" cy="40" r="' + R + '" class="ring-bg"/>' +
      '<circle cx="40" cy="40" r="' + R + '" class="ring-fg' + (over ? ' over' : '') + '" stroke-dasharray="' +
      (C * shown).toFixed(1) + ' ' + C.toFixed(1) + '" transform="rotate(-90 40 40)"/></svg>';
    var box = el('div', { cls: 'ring', role: 'img', 'aria-label': int(value) + ' z ' + int(target) + ' kcal (' + Math.round(p * 100) + ' %)' });
    box.innerHTML = svg;
    box.appendChild(el('div', { cls: 'ring-t' }, [el('b', { text: Math.round(p * 100) + ' %' }), el('small', { text: 'z ' + int(target) })]));
    return box;
  }

  function rangeBar(label, value, r) {
    // a bar with the recommended range shaded; the fill is the amount eaten
    var top = r.max * 1.35, pct = function (v) { return Math.max(0, Math.min(100, v / top * 100)); };
    var state = value < r.min ? 'low' : value > r.max ? 'high' : 'ok';
    var word = state === 'low' ? 'pod odporúčaním' : state === 'high' ? 'nad odporúčaním' : 'v odporúčanom rozsahu';
    return el('div', { cls: 'rb ' + state }, [
      el('div', { cls: 'rb-top' }, [
        el('span', { cls: 'rb-k', text: label }),
        el('span', { cls: 'rb-v' }, [el('b', { text: int(value) + ' g' }),
          el('small', { text: ' · ' + int(r.min) + '–' + int(r.max) + ' g' })])
      ]),
      el('div', { cls: 'rb-track', role: 'img', 'aria-label': label + ' ' + int(value) + ' g, ' + word +
                  ' (' + int(r.min) + '–' + int(r.max) + ' g, ' + r.pctMin + '–' + r.pctMax + ' % energie)' }, [
        el('span', { cls: 'rb-band', style: 'left:' + pct(r.min).toFixed(1) + '%;width:' + (pct(r.max) - pct(r.min)).toFixed(1) + '%' }),
        el('span', { cls: 'rb-fill', style: 'width:' + pct(value).toFixed(1) + '%' })
      ])
    ]);
  }

  function renderSummary(s) {
    var mode = Store.getSetting('avgMode');
    var kcal = Store.kcalTarget(Store.getSetting('kcalTarget'));
    var who = Store.whoTargets(kcal);
    var monday = Store.parseKey(week);
    var todayIdx = week === thisWeek ? (new Date().getDay() + 6) % 7 : -1;
    var div = mode === 'planned' && s.plannedDays ? s.plannedDays : 7;
    var avg = { calories: s.total.calories / div, protein: s.total.protein / div,
                carbs: s.total.carbs / div, fat: s.total.fat / div };
    var max = Math.max.apply(null, s.days.map(function (d) { return d.calories; }).concat([kcal, 1]));
    var day = selDay, t = day === null ? avg : s.days[day];

    var box = $('summary');
    box.textContent = '';
    box.appendChild(el('h2', null, ['Výživa', el('span', { cls: 'sub', text: '1 porcia z každého jedla' })]));

    // day picker: the week's bars double as buttons
    box.appendChild(el('div', { cls: 'bars', role: 'group', 'aria-label': 'Vybrať deň' }, [
      el('button', { type: 'button', cls: 'bar wk', 'data-pick': 'week', 'data-focus': 'pick:week',
                     'aria-pressed': day === null ? 'true' : 'false', title: 'Celý týždeň' }, [
        el('div', { cls: 'bar-track' }, [el('div', { cls: 'bar-fill', style: 'height:' + Math.round(avg.calories / max * 100) + '%' })]),
        el('span', { text: 'Ø' })
      ])
    ].concat(s.days.map(function (d, i) {
      var dd = new Date(monday); dd.setDate(monday.getDate() + i);
      return el('button', { type: 'button', cls: 'bar' + (i === todayIdx ? ' today' : ''), 'data-pick': String(i),
                            'data-focus': 'pick:s' + i, 'aria-pressed': day === i ? 'true' : 'false',
                            title: DAY_NAMES[i] + ' ' + dm(dd) + ': ' + int(d.calories) + ' kcal' }, [
        el('div', { cls: 'bar-track' }, [
          el('div', { cls: 'bar-goal', style: 'bottom:' + Math.round(kcal / max * 100) + '%' }),
          el('div', { cls: 'bar-fill', style: 'height:' + Math.round(d.calories / max * 100) + '%' })
        ]),
        el('span', { text: DAY_SHORT[i] })
      ]);
    }))));

    var title;
    if (day === null) {
      title = el('div', { cls: 'sum-label' }, [el('span', { text: 'Denný priemer týždňa' }),
        el('div', { cls: 'seg', role: 'radiogroup', 'aria-label': 'Priemer počítať' }, [
          el('button', { type: 'button', role: 'radio', 'data-avg': 'week', 'data-focus': 'avg:week',
                         'aria-checked': mode !== 'planned' ? 'true' : 'false', text: '÷ 7 dní' }),
          el('button', { type: 'button', role: 'radio', 'data-avg': 'planned', 'data-focus': 'avg:planned',
                         'aria-checked': mode === 'planned' ? 'true' : 'false',
                         text: '÷ ' + s.plannedDays + ' ' + (s.plannedDays === 1 ? 'deň' : s.plannedDays >= 2 && s.plannedDays <= 4 ? 'dni' : 'dní') + ' s plánom' })
        ])]);
    } else {
      var dd = new Date(monday); dd.setDate(monday.getDate() + day);
      title = el('div', { cls: 'sum-label' }, [el('span', { text: DAY_NAMES[day] + ' ' + dm(dd) + (day === todayIdx ? ' · dnes' : '') })]);
    }
    var empty = !t.calories;
    box.appendChild(el('div', { cls: 'sum-block' }, [
      title,
      el('div', { cls: 'sum-day' }, [
        ring(t.calories, kcal),
        el('div', { cls: 'sum-kcal' }, [int(t.calories), el('small', { text: ' kcal' }),
          el('div', { cls: 'sum-sub', text: empty ? (day === null ? 'Tento týždeň nie je nič naplánované.' : 'Na tento deň nie je nič naplánované.')
                                                   : 'cieľ ' + int(kcal) + ' kcal' })])
      ]),
      el('div', { cls: 'sum-macros-rb' }, [
        rangeBar('Bielkoviny', t.protein, who.protein),
        rangeBar('Sacharidy', t.carbs, who.carbs),
        rangeBar('Tuky', t.fat, who.fat)
      ])
    ]));
    if (day === null) {
      box.appendChild(el('p', { cls: 'sum-note', text: 'Spolu za týždeň: ' + macroLine(s.total) +
        (s.pool.calories ? ' (vrátane týždenného výberu ' + int(s.pool.calories) + ' kcal, v dňoch nie je).' : '.') }));
      if (mode === 'planned' && !s.plannedDays) {
        box.appendChild(el('p', { cls: 'sum-note', text: 'Žiadny deň nemá jedlo, priemer je ÷ 7.' }));
      }
    }
    box.appendChild(el('label', { cls: 'sum-target' }, [
      el('span', { text: 'Denný príjem energie' }),
      el('input', { type: 'number', id: 'kcalTarget', min: '1000', max: '5000', step: '50', inputmode: 'numeric',
                    value: String(kcal), 'data-focus': 'kcal' }),
      el('span', { text: 'kcal' })
    ]));
    box.appendChild(el('p', { cls: 'sum-note who', text: 'Odporúčanie WHO/FAO: bielkoviny 10–15 %, sacharidy 55–75 %, ' +
      'tuky 15–30 % dennej energie. Rozsahy v gramoch sú prepočítané na ' + int(kcal) + ' kcal.' }));
  }

  function renderPlanner() {
    var focus = rememberFocus();
    weekLabel();
    var w = Store.getWeek(week);
    var s = Store.weekSummary(week);
    $('weekShare').disabled = !s.entries;
    var monday = Store.parseKey(week);
    var todayKey = Store.weekKey();
    var todayIdx = week === todayKey ? (new Date().getDay() + 6) % 7 : -1;
    var box = $('days');
    box.textContent = '';
    for (var i = 0; i < 7; i++) {
      var d = new Date(monday); d.setDate(monday.getDate() + i);
      box.appendChild(dayBlock(i, DAY_NAMES[i], dm(d) + (i === todayIdx ? ' · dnes' : ''), s.days[i], w.days[i], i === todayIdx));
    }
    box.appendChild(dayBlock('pool', 'Týždenný výber', 'bez konkrétneho dňa', s.pool, w.pool, false));
    $('weekClear').disabled = !s.entries;
    renderSummary(s);
    renderShop();
    restoreFocus(focus);
  }

  function slotOf(v) { return v === 'pool' ? 'pool' : Number(v); }

  $('days').addEventListener('change', function (e) {
    var sel = e.target.closest('select.add');
    if (!sel || !sel.value) return;
    Store.addToPlan(week, slotOf(sel.dataset.slot), sel.value);
    renderPlanner();
  });
  $('days').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.dataset.pick) { pick(b.dataset.pick); return; }
    if (b.dataset.step) {
      var entry = findEntry(b.dataset.entry);
      if (entry) Store.setServings(week, entry.id, entry.servings + Number(b.dataset.step));
      renderPlanner();
    } else if (b.dataset.remove) {
      Store.removeEntry(week, b.dataset.remove);
      delete openIngredients[b.dataset.remove];
      renderPlanner();
    }
  });
  // <details> 'toggle' does not bubble: listen in the capture phase.
  $('days').addEventListener('toggle', function (e) {
    var d = e.target;
    if (d.matches && d.matches('details.e-ing')) {
      if (d.open) openIngredients[d.dataset.entry] = true; else delete openIngredients[d.dataset.entry];
    }
  }, true);
  function pick(v) {
    var d = v === 'week' ? null : Number(v);
    selDay = selDay === d && d !== null ? null : d;   // a second click goes back to the week
    renderPlanner();
  }
  $('summary').addEventListener('click', function (e) {
    var p = e.target.closest('[data-pick]');
    if (p) { pick(p.dataset.pick); return; }
    var b = e.target.closest('[data-avg]');
    if (!b) return;
    Store.setSetting('avgMode', b.dataset.avg);
    renderPlanner();
  });
  $('summary').addEventListener('change', function (e) {
    if (e.target.id !== 'kcalTarget') return;
    Store.setSetting('kcalTarget', Store.kcalTarget(e.target.value));
    renderPlanner();
  });

  function findEntry(id) {
    var w = Store.getWeek(week), hit = null;
    w.days.concat([w.pool]).forEach(function (list) {
      list.forEach(function (e) { if (e.id === id) hit = e; });
    });
    return hit;
  }

  $('weekPrev').addEventListener('click', function () { week = Store.shiftWeek(week, -1); selDay = defaultDay(); renderPlanner(); });
  $('weekNext').addEventListener('click', function () { week = Store.shiftWeek(week, 1); selDay = defaultDay(); renderPlanner(); });
  $('weekToday').addEventListener('click', function () { week = thisWeek; selDay = defaultDay(); renderPlanner(); $('weekNext').focus(); });
  $('weekClear').addEventListener('click', async function () {
    var s = Store.weekSummary(week);
    if (!s.entries) return;
    var ok = await confirmBox('Vyčistiť plán týždňa?',
      'Z týždňa ' + $('weekRange').textContent + ' sa odstráni ' + s.entries + '× jedlo. Recepty zostanú.', 'Vyčistiť');
    if (!ok) return;
    Store.clearWeek(week);
    openIngredients = {};
    renderPlanner();
  });

  // ========================================================= shopping list
  // Follows the week shown in the planner, so ‹ › there also moves this list.
  function itemAmount(i) {
    return i.amount ? amountText(i) : '';
  }

  /** Plain-text checklist for Google Keep (exact format the reader asked for). */
  // Google Keep has no markup for checkboxes: "Show checkboxes" turns every
  // non-empty line of a note into one checklist item, and a "[ ]" prefix
  // would just stay in the item text. So: one item per line, no prefixes,
  // no blank lines; aisles become short upper-case divider items.
  function keepText(list) {
    var lines = [];
    list.groups.forEach(function (g) {
      lines.push('— ' + g.aisle.toUpperCase() + ' —');
      g.items.forEach(function (i) {
        var a = itemAmount(i).replace(/[\u00a0\u202f]/g, ' ');
        lines.push(i.name + (a ? ' - ' + a : ''));
      });
    });
    return lines.join('\n') + '\n';
  }

  function renderShop() {
    var showPantry = Store.getSetting('showPantry') === true;
    var list = Store.shoppingList(week, showPantry);
    $('shopPantry').checked = showPantry;
    $('shopWeek').textContent = $('weekRange').textContent;
    var box = $('shop');
    box.textContent = '';
    if (!list.count) {
      box.appendChild(el('div', { cls: 'shop-empty' }, [
        el('p', { text: Store.weekSummary(week).entries
          ? (list.owned.length ? 'Všetko potrebné už máte v špajzi.' : 'Naplánované jedlá nemajú žiadne suroviny okrem bežných zásob.')
          : 'Na tento týždeň zatiaľ nie je nič naplánované.' }),
        el('a', { href: '#plan', cls: 'btn quiet', text: 'Otvoriť plánovač →' })
      ]));
    }
    list.groups.forEach(function (g) {
      box.appendChild(el('div', { cls: 'box' }, [
        el('h3', null, [g.aisle, el('span', { text: String(g.items.length) })]),
        el('ul', { cls: 'shop-items' }, g.items.map(function (i) {
          var k = Store.foldKey(i.name);
          return el('li', { cls: i.isPantry ? 'pantry' : null }, [
            el('span', { cls: 'nm' }, [
              i.name, i.isPantry ? el('span', { cls: 'tag', text: 'zásoba' }) : null,
              el('small', { text: i.meals.join(', ') })
            ]),
            el('span', { cls: 'amt', text: itemAmount(i) }),
            el('button', { type: 'button', cls: 'btn mini', 'data-have': i.name, 'data-aisle': i.aisle,
              'data-focus': 'have-' + k, title: 'Mám doma – presunúť do špajze',
              'aria-label': i.name + ': mám doma, presunúť do špajze', text: 'Mám doma' })
          ]);
        }))
      ]));
    });
    if (list.owned.length) {
      box.appendChild(el('div', { cls: 'box owned' }, [
        el('h3', null, ['Máte v špajzi', el('span', { text: String(list.owned.length) })]),
        el('ul', { cls: 'shop-items' }, list.owned.map(function (o) {
          return el('li', null, [
            el('span', { cls: 'nm' }, [o.name, el('small', { text: o.meals.join(', ') })]),
            el('button', { type: 'button', cls: 'btn mini', 'data-out': o.key, 'data-name': o.name,
              'data-focus': 'out-' + o.key, title: 'Minulo sa – vrátiť do nákupného zoznamu',
              'aria-label': o.name + ': minulo sa, vrátiť do nákupného zoznamu', text: 'Minulo sa' })
          ]);
        }))
      ]));
    }
    if (list.pantryHidden && !showPantry) {
      box.appendChild(el('p', { cls: 'shop-note', text: 'Skryté bežné zásoby: ' + list.pantryHidden + '.' }));
    }
    renderPantry();
    $('shopText').textContent = list.count ? keepText(list) : '';
    $('shopCopy').disabled = !list.count;
  }

  // "Mám doma" / "Minulo sa" in the list (Keep text never contains the Špajza)
  $('shop').addEventListener('click', function (e) {
    var b = e.target.closest('button');
    if (!b) return;
    if (b.hasAttribute('data-have')) {
      // keep the keyboard on the list: focus the next "Mám doma"
      var all = Array.prototype.slice.call($('shop').querySelectorAll('button[data-have]'));
      var next = all[all.indexOf(b) + 1] || all[all.indexOf(b) - 1];
      var item = Store.addToPantry(b.getAttribute('data-have'), b.getAttribute('data-aisle'));
      pantryChanged(next ? next.getAttribute('data-focus') : null);
      if (item) toast('Do špajze: ' + item.name);
    } else if (b.hasAttribute('data-out')) {
      Store.removeFromPantry(b.getAttribute('data-out'));
      pantryChanged('have-' + b.getAttribute('data-out'));
      toast('Späť v nákupnom zozname: ' + b.getAttribute('data-name'));
    }
  });

  $('shopPantry').addEventListener('change', function (e) {
    Store.setSetting('showPantry', e.target.checked);
    renderShop();
  });

  // --------------------------------------------------------------- copy
  var toastTimer = null;
  function toast(msg, isError) {
    var t = $('toast');
    t.textContent = msg;
    t.className = 'toast' + (isError ? ' error' : '');
    t.hidden = false;
    // restart the CSS transition
    void t.offsetWidth;
    t.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove('show');
      toastTimer = setTimeout(function () { t.hidden = true; }, 250);
    }, 2600);
  }

  // Old-school fallback for browsers/contexts without the async Clipboard API.
  function legacyCopy(text) {
    var ta = el('textarea', { readonly: true, 'aria-hidden': 'true', cls: 'sr' });
    ta.value = text;
    document.body.appendChild(ta);
    ta.select();
    var ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }

  async function copyText(text) {
    if (navigator.clipboard && window.isSecureContext) {
      try { await navigator.clipboard.writeText(text); return true; }
      catch (e) { /* permission denied etc. -> try the fallback */ }
    }
    return legacyCopy(text);
  }

  $('shopCopy').addEventListener('click', async function () {
    var text = keepText(Store.shoppingList(week, Store.getSetting('showPantry') === true));
    if (await copyText(text)) {
      toast('Skopírované do schránky!');
    } else {
      // Let the reader copy by hand: open the preview with the text selected.
      var d = document.querySelector('.preview');
      d.open = true;
      var r = document.createRange();
      r.selectNodeContents($('shopText'));
      var sel = window.getSelection(); sel.removeAllRanges(); sel.addRange(r);
      toast('Kopírovanie zlyhalo – text je označený, stlačte Ctrl+C.', true);
    }
  });

  // ================================================================ Špajza
  // What is at home, by name. Anything here is left off the shopping list
  // until it is removed ("Minulo sa"). Suggestions come from the planner week.
  (function initPantryForm() {
    var sel = $('pantryAisle');
    Store.AISLES.forEach(function (a) { sel.appendChild(el('option', { value: a, text: a })); });
    sel.value = Store.AISLES[3];
  })();

  function pantryChanged(focusKey) {
    var f = focusKey || rememberFocus();
    renderAll();
    restoreFocus(f);
  }

  function renderPantry() {
    var items = Store.getPantry();
    $('pantryCount').textContent = items.length || '';
    $('pantrySub').textContent = items.length ? items.length + ' ' +
      (items.length === 1 ? 'položka' : (items.length <= 4 ? 'položky' : 'položiek')) : '';
    $('pantryWeek').textContent = $('weekRange').textContent;

    // where each pantry item is used this week
    var full = Store.shoppingList(week, true);
    var usedBy = {};
    full.owned.forEach(function (o) { usedBy[o.key] = o.meals; });

    var box = $('pantry');
    box.textContent = '';
    if (!items.length) {
      box.appendChild(el('div', { cls: 'shop-empty' }, [
        el('p', { text: 'Špajza je prázdna. Pridajte surovinu hore, kliknite na ňu v časti „Z plánu“, alebo v nákupnom zozname použite „Mám doma“.' })
      ]));
    }
    Store.AISLES.forEach(function (aisle) {
      var list = items.filter(function (p) { return p.aisle === aisle; });
      if (!list.length) return;
      box.appendChild(el('div', { cls: 'box' }, [
        el('h3', null, [aisle, el('span', { text: String(list.length) })]),
        el('ul', { cls: 'shop-items' }, list.map(function (p) {
          var meta = [];
          if (p.added) meta.push('pridané ' + dm(Store.parseKey(p.added)));
          if (usedBy[p.key]) meta.push('v pláne: ' + usedBy[p.key].join(', '));
          return el('li', null, [
            el('span', { cls: 'nm' }, [p.name, meta.length ? el('small', { text: meta.join(' · ') }) : null]),
            el('button', { type: 'button', cls: 'btn mini', 'data-out': p.key, 'data-name': p.name,
              'data-focus': 'pout-' + p.key, title: 'Minulo sa – odobrať zo špajze',
              'aria-label': p.name + ': minulo sa, odobrať zo špajze', text: 'Minulo sa' })
          ]);
        }))
      ]));
    });

    // quick add: planned ingredients not in the pantry yet (staples included)
    var sug = $('pantrySuggest');
    sug.textContent = '';
    var seen = {};
    full.groups.forEach(function (g) {
      g.items.forEach(function (i) {
        var k = Store.foldKey(i.name);
        if (seen[k]) return;
        seen[k] = true;
        sug.appendChild(el('button', { type: 'button', cls: 'chip', 'data-add': i.name, 'data-aisle': i.aisle,
          'data-focus': 'sug-' + k, 'aria-label': 'Pridať do špajze: ' + i.name }, ['+ ', i.name]));
      });
    });
    if (!sug.childNodes.length) {
      sug.appendChild(el('p', { cls: 'empty', text: Store.weekSummary(week).entries
        ? 'Všetky suroviny z plánu už sú v špajzi.'
        : 'Na tento týždeň zatiaľ nie je nič naplánované.' }));
    }
    $('pantryClear').disabled = !items.length;

    // name suggestions for the add field: every ingredient the recipes know
    var dl = $('ingNames');
    dl.textContent = '';
    Store.knownIngredients().forEach(function (i) {
      if (!Store.inPantry(i.name)) dl.appendChild(el('option', { value: i.name }));
    });
  }

  // typing a known ingredient picks its aisle
  $('pantryName').addEventListener('input', function (e) {
    var k = Store.foldKey(e.target.value);
    var hit = Store.knownIngredients().filter(function (i) { return i.key === k; })[0];
    if (hit) $('pantryAisle').value = hit.aisle;
    $('pantryError').hidden = true;
  });

  $('pantryForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var input = $('pantryName'), err = $('pantryError');
    var name = input.value.trim();
    if (!name) { err.textContent = 'Zadajte názov suroviny.'; err.hidden = false; input.focus(); return; }
    if (Store.inPantry(name)) {
      err.textContent = '„' + name + '“ už v špajzi je.'; err.hidden = false; input.select(); return;
    }
    var item = Store.addToPantry(name, $('pantryAisle').value);
    input.value = '';
    err.hidden = true;
    pantryChanged(null);
    input.focus();
    if (item) toast('Do špajze: ' + item.name);
  });

  $('pantry').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-out]');
    if (!b) return;
    // focus moves to the next "Minulo sa" button (or the add field)
    var all = Array.prototype.slice.call($('pantry').querySelectorAll('button[data-out]'));
    var next = all[all.indexOf(b) + 1] || all[all.indexOf(b) - 1];
    Store.removeFromPantry(b.getAttribute('data-out'));
    pantryChanged(next ? next.getAttribute('data-focus') : null);
    if (!next) $('pantryName').focus();
    toast('Odobrané zo špajze: ' + b.getAttribute('data-name'));
  });

  $('pantrySuggest').addEventListener('click', function (e) {
    var b = e.target.closest('button[data-add]');
    if (!b) return;
    var chips = Array.prototype.slice.call($('pantrySuggest').querySelectorAll('button[data-add]'));
    var next = chips[chips.indexOf(b) + 1] || chips[chips.indexOf(b) - 1];
    var item = Store.addToPantry(b.getAttribute('data-add'), b.getAttribute('data-aisle'));
    pantryChanged(next ? next.getAttribute('data-focus') : null);
    if (item) toast('Do špajze: ' + item.name);
  });

  $('pantryClear').addEventListener('click', async function () {
    var n = Store.getPantry().length;
    if (!n) return;
    var ok = await confirmBox('Vyprázdniť špajzu?',
      (n >= 2 && n <= 4 ? 'Odstránia sa ' : 'Odstráni sa ') + n + ' ' +
      (n === 1 ? 'položka' : (n <= 4 ? 'položky' : 'položiek')) +
      ' a všetky sa znova zobrazia v nákupnom zozname.', 'Vyprázdniť');
    if (!ok) return;
    Store.clearPantry();
    pantryChanged(null);
  });

  // ============================================================ share plan
  // "Poslať plán": the week as a message (share sheet / WhatsApp / e-mail /
  // clipboard) with a link that carries the plan (share.js). Opening the link
  // offers to load it. No server: the plan lives in the link itself.
  var PUBLIC_URL = 'https://stangrand.github.io/morning-brief/meals/';
  var shareDlg = $('shareDialog'), importDlg = $('importDialog');
  var shareState = null, shareSeq = 0, shareTimer = null;

  function isWeb() { return /^https?:$/.test(location.protocol); }
  // A page opened from disk (file://) cannot be opened by anyone else.
  function baseUrl() { return isWeb() ? location.origin + location.pathname : PUBLIC_URL; }
  function rangeOf(key) {
    var d = Store.parseKey(key), end = new Date(d);
    end.setDate(d.getDate() + 6);
    return dm(d) + ' – ' + dm(end) + ' ' + end.getFullYear();
  }
  function whenOf(key) {
    var diff = Math.round((Store.parseKey(key) - Store.parseKey(thisWeek)) / (7 * 864e5));
    return diff === 0 ? 'tento týždeň' : diff === 1 ? 'budúci týždeň' : diff === -1 ? 'minulý týždeň' : '';
  }
  function entryText(e) { return e.name + ' (' + portions(e.servings) + ')'; }
  // [{name, servings}] per day + pool -> "Po – A (2 porcie), B (1 porcia)"
  function planLines(days, pool) {
    var lines = [];
    days.forEach(function (list, i) {
      if (list.length) lines.push(DAY_SHORT[i] + ' – ' + list.map(entryText).join(', '));
    });
    if (pool.length) lines.push('Týždenný výber – ' + pool.map(entryText).join(', '));
    return lines;
  }

  async function buildShare() {
    var from = Store.getSetting('senderName') || '';
    var w = Store.getWeek(week);
    function named(list) {
      return list.map(function (e) {
        var m = Store.getMeal(e.mealId);
        return m ? { name: m.name, servings: e.servings } : null;
      }).filter(Boolean);
    }
    var lines = ['Plán jedál na týždeň ' + rangeOf(week) + (from ? ' – posiela ' + from : ''), '']
      .concat(planLines(w.days.map(named), named(w.pool)));
    if (Store.getSetting('shareShop')) {
      var list = Store.shoppingList(week, Store.getSetting('showPantry') === true);
      if (list.count) lines.push('', 'Nákupný zoznam:', keepText(list).trim());
    }
    var link = baseUrl() + '#import=' + await MealsShare.encode(MealsShare.pack(week, from));
    lines.push('', 'Načítať plán do Jedál (klik na odkaz):', link);
    return { text: lines.join('\n'), link: link, subject: 'Plán jedál ' + rangeOf(week) };
  }
  function mailtoUrl(st) {
    return 'mailto:?subject=' + encodeURIComponent(st.subject) + '&body=' + encodeURIComponent(st.text);
  }

  async function refreshShare() {
    var seq = ++shareSeq;
    var st = await buildShare();
    if (seq !== shareSeq) return;           // a newer refresh is on its way
    shareState = st;
    $('shareText').textContent = st.text;
    var notes = [];
    if (!isWeb()) notes.push('Stránka je otvorená zo súboru v počítači, odkaz preto vedie na web (' + PUBLIC_URL + ').');
    // Desktop mail apps (Outlook, Windows Mail) cut mailto links at ~2000 characters.
    if (mailtoUrl(st).length > 1900) {
      notes.push('Správa je dlhá – ak by sa v e-maile nezobrazila celá, použite „Kopírovať“ a vložte ju do e-mailu ručne (Ctrl+V).');
    }
    $('shareNote').textContent = notes.join(' ');
    $('shareNote').hidden = !notes.length;
  }

  $('weekShare').addEventListener('click', function () {
    if (!Store.weekSummary(week).entries) return;
    $('shareFrom').value = Store.getSetting('senderName') || '';
    $('shareShop').checked = Store.getSetting('shareShop') === true;
    $('shareNative').hidden = typeof navigator.share !== 'function';
    $('shareTitle').textContent = 'Poslať plán · ' + rangeOf(week);
    shareState = null;
    $('shareText').textContent = '…';
    shareDlg.showModal();
    ($('shareFrom').value ? ($('shareNative').hidden ? $('shareWa') : $('shareNative')) : $('shareFrom')).focus();
    refreshShare();
  });
  $('shareFrom').addEventListener('input', function (e) {
    Store.setSetting('senderName', e.target.value.replace(/\s+/g, ' ').trim().slice(0, 40));
    clearTimeout(shareTimer);
    shareTimer = setTimeout(refreshShare, 250);
  });
  $('shareShop').addEventListener('change', function (e) {
    Store.setSetting('shareShop', e.target.checked);
    refreshShare();
  });
  async function ready() {
    clearTimeout(shareTimer);
    if (!shareState || shareTimer) await refreshShare();
    shareTimer = null;
    return shareState;
  }
  $('shareNative').addEventListener('click', async function () {
    var st = await ready();
    try { await navigator.share({ title: st.subject, text: st.text }); }
    catch (e) { if (e && e.name !== 'AbortError') toast('Zdieľanie zlyhalo – skúste „Kopírovať“.', true); }
  });
  $('shareWa').addEventListener('click', async function () {
    var st = await ready();
    window.open('https://wa.me/?text=' + encodeURIComponent(st.text), '_blank', 'noopener');
  });
  $('shareMail').addEventListener('click', async function () {
    var st = await ready();
    var a = el('a', { href: mailtoUrl(st) });
    document.body.appendChild(a); a.click(); a.remove();
  });
  $('shareCopy').addEventListener('click', async function () {
    var st = await ready();
    if (await copyText(st.text)) toast('Správa s odkazom je v schránke.');
    else toast('Kopírovanie zlyhalo – označte text správy a stlačte Ctrl+C.', true);
  });

  // ---- receiving: #import=… ----
  var pendingImport = null;
  function sameName(a, b) { return fold(a).replace(/\s+/g, ' ').trim() === fold(b).replace(/\s+/g, ' ').trim(); }
  // Use the receiver's own recipe when it is the same meal (same id and name,
  // or same name); otherwise the recipe from the link is added.
  function matchMeal(m) {
    var local = Store.getMeal(m.id);
    if (local && sameName(local.name, m.name)) return local;
    return Store.getMeals().filter(function (x) { return sameName(x.name, m.name); })[0] || null;
  }

  async function handleImport(code) {
    // Forget the fragment at once, so a reload does not ask again.
    try { history.replaceState(null, '', location.pathname + location.search + '#plan'); } catch (e) {}
    showTab('plan');
    var p;
    try { code = decodeURIComponent(code); } catch (e) { /* keep as is */ }
    try { p = await MealsShare.decode(code); }
    catch (e) {
      toast(e && e.message === 'nozip'
        ? 'Tento prehliadač nevie odkaz otvoriť – skúste aktuálny Chrome, Edge, Safari alebo Firefox.'
        : 'Odkaz na plán je poškodený alebo neúplný.', true);
      return;
    }
    var count = p.pool.length + p.days.reduce(function (n, l) { return n + l.length; }, 0);
    if (!count) { toast('Odkaz neobsahuje žiadne jedlá.', true); return; }

    var name = function (e) { return { name: p.meals[e.meal].name, servings: e.servings }; };
    var when = whenOf(p.week);
    $('importTitle').textContent = p.from ? 'Plán jedál od: ' + p.from : 'Načítať plán jedál';
    $('importMeta').textContent = 'Týždeň ' + rangeOf(p.week) + (when ? ' (' + when + ')' : '') +
      ' · ' + count + '× jedlo';
    var ul = $('importList');
    ul.textContent = '';
    p.days.forEach(function (list, i) {
      if (list.length) ul.appendChild(el('li', null, [el('b', { text: DAY_NAMES[i] }), el('span', { text: list.map(name).map(entryText).join(', ') })]));
    });
    if (p.pool.length) ul.appendChild(el('li', null, [el('b', { text: 'Týždenný výber' }), el('span', { text: p.pool.map(name).map(entryText).join(', ') })]));
    var fresh = p.meals.filter(function (m) { return !matchMeal(m); }).map(function (m) { return m.name; });
    $('importNew').textContent = fresh.length
      ? 'Do Receptov sa pridá ' + (fresh.length === 1 ? 'nový recept' : 'nové recepty') + ': ' + fresh.join(', ') + '.' : '';
    $('importNew').hidden = !fresh.length;
    var has = Store.weekSummary(p.week).entries > 0;
    $('importMode').hidden = !has;
    importDlg.querySelector('input[name="importMode"][value="replace"]').checked = true;
    pendingImport = p;
    importDlg.returnValue = '';
    if (!importDlg.open) importDlg.showModal();
    $('importOk').focus();
  }

  importDlg.addEventListener('close', function () {
    var p = pendingImport;
    pendingImport = null;
    if (!p || importDlg.returnValue !== 'ok') return;
    var ids = p.meals.map(function (m) {
      var local = matchMeal(m);
      if (local) return local.id;
      var copy = { id: Store.getMeal(m.id) ? Store.newId('m') : m.id, name: m.name, defaultServings: m.defaultServings,
                   nutrition: m.nutrition, ingredients: m.ingredients };
      return Store.upsertMeal(copy).id;
    });
    function conv(list) { return list.map(function (e) { return { mealId: ids[e.meal], servings: e.servings }; }); }
    var mode = $('importMode').hidden ? 'add'
      : (importDlg.querySelector('input[name="importMode"]:checked') || {}).value || 'replace';
    var n = Store.importWeek(p.week, p.days.map(conv), conv(p.pool), mode);
    week = p.week; selDay = defaultDay();
    openIngredients = {};
    renderAll();
    toast('Plán načítaný: ' + n + '× jedlo, týždeň ' + rangeOf(p.week) + '.');
  });

  // ================================================================== boot
  function renderAll() {
    renderMeals();
    renderPlanner();
  }

  Store.load();
  $('storageNotice').hidden = Store.isPersistent();
  renderAll();
  $('foot').textContent = 'Dáta sú uložené len v tomto prehliadači (' + Store.STORAGE_KEY + ').';
  fromHash();
})();
