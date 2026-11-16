/**
 * KIDS CHORE CHART — Google Apps Script backend
 * ----------------------------------------------------
 * 1. Paste this whole file into a new Apps Script project (script.google.com).
 * 2. Pick "setup" in the function dropdown and click Run (approve permissions).
 * 3. Deploy > New deployment > Web app: Execute as "Me", Access "Anyone".
 * TV:     <web app URL>
 * Phone:  <web app URL>?mode=parent      (default PIN 1234 — change it in Settings)
 */

var SHEETS = {
  Kids:     ['id', 'name', 'age', 'color', 'savingsPct', 'order'],
  Chores:   ['id', 'kidId', 'name', 'icon', 'value', 'days', 'active', 'order'],
  Done:     ['date', 'kidId', 'choreId', 'value', 'paid', 'ts'],
  Ledger:   ['ts', 'kidId', 'type', 'savings', 'spending', 'note'],
  Settings: ['key', 'value']
};
var DAY_CODES = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// ---------- web app ----------
function doGet(e) {
  var mode = (e && e.parameter && e.parameter.mode === 'parent') ? 'parent' : 'tv';
  return HtmlService.createHtmlOutput(APP_HTML.replace('__MODE__', mode))
    .setTitle('Chore Chart')
    .addMetaTag('viewport', 'width=device-width, initial-scale=1, maximum-scale=1')
    .setXFrameOptionsMode(HtmlService.XFrameOptionsMode.ALLOWALL);
}

// JSON API used by the Fire TV app
function doPost(e) {
  var out;
  try {
    var b = JSON.parse(e.postData.contents);
    var fns = { getState: getState, toggleChore: toggleChore, parent: parent };
    if (!fns[b.fn]) throw new Error('Unknown call');
    out = { ok: true, result: fns[b.fn].apply(null, b.args || []) };
  } catch (err) {
    out = { ok: false, error: String(err && err.message ? err.message : err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out)).setMimeType(ContentService.MimeType.JSON);
}

// ---------- one-time setup ----------
function setup() {
  var ss = getSS_();
  Object.keys(SHEETS).forEach(function (n) { sh_(n); });
  if (rows_('Kids').length === 0) seed_();
  if (!getSetting_('pin')) setSetting_('pin', '1234');
  if (!getSetting_('paydayDay')) setSetting_('paydayDay', '0');
  if (!getSetting_('paydayHour')) setSetting_('paydayHour', '19');
  installTrigger_(Number(getSetting_('paydayDay')), Number(getSetting_('paydayHour')));
  Logger.log('Data sheet: ' + ss.getUrl());
}

function seed_() {
  var kids = [
    ['addison', 'Addison', 10, '#8b5cf6', 50, 1],
    ['maximus', 'Maximus', 8, '#0ea5e9', 50, 2],
    ['emery', 'Emery', 4, '#ec4899', 50, 3]
  ];
  kids.forEach(function (k) { sh_('Kids').appendRow(k); });
  var c = [
    ['addison', 'Make bed', '🛏️', 0.25, 'daily'],
    ['addison', 'Brush teeth (AM & PM)', '🪥', 0.25, 'daily'],
    ['addison', 'Dirty clothes in hamper', '🧺', 0.25, 'daily'],
    ['addison', 'Unload dishwasher', '🍽️', 0.50, 'daily'],
    ['addison', 'Take out trash', '🗑️', 0.50, 'daily'],
    ['addison', 'Read 20 minutes', '📚', 0.50, 'daily'],
    ['addison', 'Clean room', '🧹', 1.00, 'Sa'],
    ['maximus', 'Make bed', '🛏️', 0.25, 'daily'],
    ['maximus', 'Brush teeth (AM & PM)', '🪥', 0.25, 'daily'],
    ['maximus', 'Dirty clothes in hamper', '🧺', 0.25, 'daily'],
    ['maximus', 'Set the table', '🍴', 0.25, 'daily'],
    ['maximus', 'Pick up room', '🧸', 0.25, 'daily'],
    ['maximus', 'Read 15 minutes', '📚', 0.50, 'daily'],
    ['emery', 'Help make bed', '🛏️', 0.10, 'daily'],
    ['emery', 'Brush teeth', '🪥', 0.10, 'daily'],
    ['emery', 'Put toys away', '🧸', 0.25, 'daily'],
    ['emery', 'Clothes in hamper', '🧦', 0.10, 'daily'],
    ['emery', 'Plate to the sink', '🍽️', 0.10, 'daily']
  ];
  c.forEach(function (r, i) { sh_('Chores').appendRow([id_(), r[0], r[1], r[2], r[3], r[4], true, i + 1]); });
}

// ---------- state for both screens ----------
function getState() {
  var today = today_();
  var dow = dow_();
  var kids = rows_('Kids').sort(byOrder_);
  var chores = rows_('Chores').sort(byOrder_);
  var done = rows_('Done');
  var ledger = rows_('Ledger');
  var out = kids.map(function (k) {
    var mine = chores.filter(function (c) { return c.kidId === k.id; }).map(function (c) {
      return {
        id: c.id, name: String(c.name), icon: String(c.icon || '⭐'), value: num_(c.value),
        days: String(c.days || 'daily'), active: isTrue_(c.active),
        today: isTrue_(c.active) && runsOn_(c.days, dow),
        done: done.some(function (d) { return d.date === today && d.kidId === k.id && d.choreId === c.id; })
      };
    });
    var pending = sum_(done.filter(function (d) { return d.kidId === k.id && !isTrue_(d.paid); }), 'value');
    var kl = ledger.filter(function (l) { return l.kidId === k.id; });
    return {
      id: k.id, name: String(k.name), age: k.age, color: String(k.color || '#0ea5e9'),
      savingsPct: num_(k.savingsPct), chores: mine, pending: pending,
      savings: sum_(kl, 'savings'), spending: sum_(kl, 'spending')
    };
  });
  var recent = ledger.slice(-60).reverse().map(function (l) {
    return { ts: l.ts, kidId: l.kidId, type: l.type, savings: num_(l.savings), spending: num_(l.spending), note: String(l.note || '') };
  });
  return {
    today: today, dow: dow, kids: out, ledger: recent,
    settings: {
      paydayDay: Number(getSetting_('paydayDay') || 0),
      paydayHour: Number(getSetting_('paydayHour') || 19),
      lastPayday: getSetting_('lastPayday') || ''
    }
  };
}

// Kids check / uncheck from the TV (no PIN needed)
function toggleChore(kidId, choreId) {
  return withLock_(function () { return toggle_(kidId, choreId); });
}
function toggle_(kidId, choreId) {
    var today = today_();
    var ex = rows_('Done').filter(function (d) {
      return d.date === today && d.kidId === kidId && d.choreId === choreId;
    })[0];
    if (ex) {
      if (!isTrue_(ex.paid)) sh_('Done').deleteRow(ex._row);
    } else {
      var ch = rows_('Chores').filter(function (c) { return c.id === choreId; })[0];
      if (!ch) throw new Error('That chore was removed. Refreshing…');
      sh_('Done').appendRow([today, kidId, choreId, num_(ch.value), false, new Date()]);
    }
    return getState();
}

// ---------- parent actions (PIN protected) ----------
function parent(pin, action, a) {
  if (String(pin) !== String(getSetting_('pin') || '1234')) throw new Error('Wrong PIN');
  a = a || {};
  return withLock_(function () {
    switch (action) {
      case 'check': break;
      case 'toggle':
        return toggle_(a.kidId, a.choreId);
      case 'saveChore': {
        var row = [a.id || id_(), a.kidId, a.name, a.icon || '⭐', round_(num_(a.value)), a.days || 'daily',
          a.active !== false, a.order || Date.now()];
        var ex = a.id ? rows_('Chores').filter(function (c) { return c.id === a.id; })[0] : null;
        if (ex) { row[7] = ex.order; sh_('Chores').getRange(ex._row, 1, 1, row.length).setValues([row]); }
        else sh_('Chores').appendRow(row);
        break;
      }
      case 'deleteChore': {
        var d = rows_('Chores').filter(function (c) { return c.id === a.id; })[0];
        if (d) sh_('Chores').deleteRow(d._row);
        break;
      }
      case 'saveKid': {
        var k = rows_('Kids').filter(function (x) { return x.id === a.id; })[0];
        if (!k) throw new Error('Kid not found');
        var pct = Math.max(0, Math.min(100, Math.round(num_(a.savingsPct))));
        sh_('Kids').getRange(k._row, 2).setValue(a.name || k.name);
        sh_('Kids').getRange(k._row, 5).setValue(pct);
        break;
      }
      case 'txn': { // amount signed: negative = spend/remove, positive = add
        var amt = round_(num_(a.amount));
        if (!amt) throw new Error('Enter an amount');
        var sv = a.bucket === 'savings' ? amt : 0, sp = a.bucket === 'savings' ? 0 : amt;
        sh_('Ledger').appendRow([new Date(), a.kidId, a.type || (amt < 0 ? 'spend' : 'add'), sv, sp, a.note || '']);
        break;
      }
      case 'move': { // from savings to spending or back
        var m = round_(Math.abs(num_(a.amount)));
        if (!m) throw new Error('Enter an amount');
        var toSpend = a.to === 'spending';
        sh_('Ledger').appendRow([new Date(), a.kidId, 'move', toSpend ? -m : m, toSpend ? m : -m,
          a.note || (toSpend ? 'Moved savings → spending' : 'Moved spending → savings')]);
        break;
      }
      case 'payday':
        payday_('Pay day (paid early)');
        break;
      case 'setPin':
        if (!/^\d{4,8}$/.test(String(a.newPin))) throw new Error('PIN must be 4–8 digits');
        setSetting_('pin', String(a.newPin));
        break;
      case 'setPayday':
        setSetting_('paydayDay', String(a.day));
        setSetting_('paydayHour', String(a.hour));
        installTrigger_(Number(a.day), Number(a.hour));
        break;
      default:
        throw new Error('Unknown action');
    }
    return getState();
  });
}

// ---------- weekly pay day ----------
function autoPayday() { withLock_(function () { payday_('Weekly pay day'); }); }

function payday_(label) {
  var kids = rows_('Kids');
  var s = sh_('Done');
  var done = rows_('Done');
  kids.forEach(function (k) {
    var unpaid = done.filter(function (d) { return d.kidId === k.id && !isTrue_(d.paid); });
    var total = round_(sum_(unpaid, 'value'));
    if (total <= 0) return;
    var save = round_(total * num_(k.savingsPct) / 100);
    var spend = round_(total - save);
    sh_('Ledger').appendRow([new Date(), k.id, 'payday', save, spend,
      label + ': $' + total.toFixed(2) + ' (' + num_(k.savingsPct) + '% saved)']);
    unpaid.forEach(function (d) { s.getRange(d._row, 5).setValue(true); });
  });
  setSetting_('lastPayday', today_());
}

function installTrigger_(day, hour) {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'autoPayday') ScriptApp.deleteTrigger(t);
  });
  var wd = [ScriptApp.WeekDay.SUNDAY, ScriptApp.WeekDay.MONDAY, ScriptApp.WeekDay.TUESDAY,
    ScriptApp.WeekDay.WEDNESDAY, ScriptApp.WeekDay.THURSDAY, ScriptApp.WeekDay.FRIDAY, ScriptApp.WeekDay.SATURDAY];
  ScriptApp.newTrigger('autoPayday').timeBased().onWeekDay(wd[day]).atHour(hour).create();
}

// ---------- helpers ----------
function getSS_() {
  var p = PropertiesService.getScriptProperties();
  var id = p.getProperty('SS_ID');
  if (id) { try { return SpreadsheetApp.openById(id); } catch (e) { /* recreate below */ } }
  var ss = SpreadsheetApp.create('Chore Chart Data');
  p.setProperty('SS_ID', ss.getId());
  return ss;
}
function sh_(name) {
  var ss = getSS_();
  var s = ss.getSheetByName(name);
  if (!s) {
    s = ss.insertSheet(name);
    s.getRange(1, 1, 1, SHEETS[name].length).setValues([SHEETS[name]]).setFontWeight('bold');
    s.setFrozenRows(1);
    if (name === 'Done') s.getRange('A:A').setNumberFormat('@');
    if (name === 'Chores') s.getRange('F:F').setNumberFormat('@');
    if (name === 'Settings') s.getRange('B:B').setNumberFormat('@');
    var def = ss.getSheetByName('Sheet1');
    if (def && ss.getSheets().length > 1) ss.deleteSheet(def);
  }
  return s;
}
function rows_(name) {
  var v = sh_(name).getDataRange().getValues();
  var h = v.shift();
  var tz = Session.getScriptTimeZone();
  return v.map(function (r, i) {
    var o = { _row: i + 2 };
    h.forEach(function (k, j) {
      var x = r[j];
      if (x instanceof Date) x = (k === 'date') ? Utilities.formatDate(x, tz, 'yyyy-MM-dd') : x.toISOString();
      o[k] = x;
    });
    return o;
  }).filter(function (o) { return o[h[0]] !== '' && o[h[0]] !== null; });
}
function getSetting_(k) {
  var r = rows_('Settings').filter(function (x) { return x.key === k; })[0];
  return r ? String(r.value) : '';
}
function setSetting_(k, v) {
  var r = rows_('Settings').filter(function (x) { return x.key === k; })[0];
  if (r) sh_('Settings').getRange(r._row, 2).setValue(String(v));
  else sh_('Settings').appendRow([k, String(v)]);
}
function withLock_(fn) {
  var l = LockService.getScriptLock();
  l.waitLock(20000);
  try { return fn(); } finally { l.releaseLock(); }
}
function today_() { return Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'yyyy-MM-dd'); }
function dow_() { return Number(Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'u')) % 7; }
function runsOn_(days, dow) {
  days = String(days || 'daily').trim();
  if (!days || days.toLowerCase() === 'daily') return true;
  return days.split(/[\s,]+/).indexOf(DAY_CODES[dow]) >= 0;
}
function isTrue_(v) { return v === true || String(v).toUpperCase() === 'TRUE'; }
function num_(v) { var n = Number(v); return isFinite(n) ? n : 0; }
function round_(n) { return Math.round(n * 100) / 100; }
function sum_(arr, k) { return round_(arr.reduce(function (s, x) { return s + num_(x[k]); }, 0)); }
function byOrder_(a, b) { return num_(a.order) - num_(b.order); }
function id_() { return Utilities.getUuid().slice(0, 8); }

// ---------- app screens (TV + parent) ----------
var APP_HTML = "<!DOCTYPE html>\n<html>\n<head>\n<meta charset=\"utf-8\">\n<meta name=\"viewport\" content=\"width=device-width, initial-scale=1, maximum-scale=1\">\n<style>\n*{box-sizing:border-box;margin:0;padding:0}\nbody{font-family:\"Trebuchet MS\",\"Segoe UI\",Roboto,Arial,sans-serif;background:#0f172a;color:#f1f5f9;-webkit-tap-highlight-color:transparent}\nbutton{font:inherit;color:inherit;border:0;background:none;cursor:pointer}\n.hidden{display:none!important}\n.money{font-variant-numeric:tabular-nums}\n\n/* ================= TV ================= */\n#tv{height:100vh;display:flex;flex-direction:column;padding:1.6vw 2vw;gap:1.2vw;overflow:hidden;\n  background:radial-gradient(circle at 20% 0%,#1e293b 0,#0f172a 60%)}\n#tv header{display:flex;align-items:baseline;justify-content:space-between}\n#tv h1{font-size:2.6vw;letter-spacing:.02em}\n#tv .date{font-size:1.6vw;color:#94a3b8}\n#tv .hint{font-size:1.1vw;color:#64748b}\n.cols{flex:1;display:flex;gap:1.6vw;min-height:0}\n.col{flex:1;display:flex;flex-direction:column;background:#1e293b;border-radius:1.4vw;overflow:hidden;\n  border-top:.6vw solid var(--c);min-height:0}\n.col-head{padding:1vw 1.2vw .6vw;display:flex;justify-content:space-between;align-items:center}\n.col-head h2{font-size:2.3vw}\n.stars{font-size:1.5vw;letter-spacing:.1vw;text-align:right;line-height:1.2}\n.progress{font-size:1.1vw;color:#94a3b8;text-align:right}\n.list{flex:1;overflow:hidden;padding:.4vw 1vw;display:flex;flex-direction:column;gap:.7vw}\n.chore{display:flex;align-items:center;gap:1vw;padding:.8vw 1vw;border-radius:1vw;background:#334155;\n  border:.25vw solid transparent;transition:transform .12s,background .2s,border-color .12s;text-align:left;width:100%}\n.chore .ic{font-size:2.4vw;width:3vw;text-align:center}\n.chore .nm{flex:1;font-size:1.55vw;font-weight:bold;line-height:1.15}\n.chore .val{font-size:1.3vw;background:#0f172a;border-radius:2vw;padding:.25vw .8vw;color:#fde68a}\n.chore .ck{width:2.6vw;height:2.6vw;border-radius:50%;border:.25vw solid #94a3b8;display:flex;align-items:center;\n  justify-content:center;font-size:1.6vw;font-weight:bold}\n.chore.done{background:#14532d}\n.chore.done .nm{color:#bbf7d0}\n.chore.done .ck{background:#22c55e;border-color:#22c55e;color:#fff}\n.chore.focus{border-color:#fff;transform:scale(1.04);box-shadow:0 0 0 .3vw var(--c),0 .6vw 1.6vw rgba(0,0,0,.5);background:#475569}\n.chore.done.focus{background:#166534}\n.alldone{margin:0 1vw;padding:.7vw;border-radius:1vw;text-align:center;font-size:1.5vw;font-weight:bold;\n  background:linear-gradient(90deg,#f59e0b,#fde047,#f59e0b);color:#422006}\n.bank{display:grid;grid-template-columns:1fr 1fr 1fr;gap:.6vw;padding:1vw}\n.bank div{background:#0f172a;border-radius:.8vw;padding:.6vw .4vw;text-align:center}\n.bank small{display:block;font-size:.95vw;color:#94a3b8}\n.bank b{font-size:1.6vw}\n.bank .sv b{color:#86efac}.bank .sp b{color:#7dd3fc}.bank .wk b{color:#fde68a}\n.empty{color:#64748b;font-size:1.3vw;text-align:center;padding:2vw}\n\n/* celebration */\n#party{position:fixed;inset:0;background:rgba(15,23,42,.88);display:flex;align-items:center;justify-content:center;\n  flex-direction:column;z-index:50;overflow:hidden}\n#party h3{font-size:5vw;color:#fde047;text-shadow:0 .3vw 0 #a16207;text-align:center;animation:pop .6s ease-out}\n#party p{font-size:2.2vw;margin-top:1vw;text-align:center}\n#party .big{font-size:9vw;animation:spin 2.4s ease-in-out infinite}\n.fall{position:absolute;top:-10vh;animation:fall linear forwards;pointer-events:none}\n@keyframes fall{to{transform:translateY(120vh) rotate(540deg)}}\n@keyframes pop{0%{transform:scale(.3)}70%{transform:scale(1.15)}100%{transform:scale(1)}}\n@keyframes spin{0%,100%{transform:rotate(-12deg) scale(1)}50%{transform:rotate(12deg) scale(1.15)}}\n\n/* toast */\n#toast{position:fixed;left:50%;bottom:3vh;transform:translateX(-50%);background:#dc2626;color:#fff;padding:12px 20px;\n  border-radius:10px;font-size:16px;z-index:99;max-width:90vw;text-align:center}\n#toast.ok{background:#16a34a}\n\n/* ================= PARENT (phone) ================= */\n#parent{max-width:640px;margin:0 auto;padding:16px 14px 80px;font-size:16px}\n#parent h1{font-size:22px;margin-bottom:4px}\n.sub{color:#94a3b8;font-size:14px}\n.tabs{display:flex;gap:6px;margin:14px 0;position:sticky;top:0;background:#0f172a;padding:6px 0;z-index:5}\n.tabs button{flex:1;padding:10px 4px;border-radius:10px;background:#1e293b;font-weight:bold;font-size:14px}\n.tabs button.on{background:#0ea5e9;color:#fff}\n.card{background:#1e293b;border-radius:14px;padding:14px;margin-bottom:12px;border-left:6px solid var(--c,#0ea5e9)}\n.card h2{font-size:19px;display:flex;justify-content:space-between;align-items:center}\n.row3{display:grid;grid-template-columns:1fr 1fr 1fr;gap:8px;margin:12px 0}\n.row3 div{background:#0f172a;border-radius:10px;padding:8px;text-align:center}\n.row3 small{display:block;color:#94a3b8;font-size:12px}\n.row3 b{font-size:18px}\n.btns{display:flex;gap:8px;flex-wrap:wrap}\n.btn{padding:10px 14px;border-radius:10px;background:#334155;font-weight:bold;font-size:14px}\n.btn.pri{background:#0ea5e9;color:#fff}.btn.grn{background:#16a34a;color:#fff}.btn.red{background:#b91c1c;color:#fff}\n.btn.full{width:100%;padding:14px}\n.li{display:flex;align-items:center;gap:10px;padding:10px 4px;border-bottom:1px solid #334155}\n.li:last-child{border-bottom:0}\n.li .ic{font-size:22px;width:28px;text-align:center}\n.li .nm{flex:1}\n.li .nm small{display:block;color:#94a3b8;font-size:12px}\n.tog{width:30px;height:30px;border-radius:50%;border:2px solid #94a3b8;font-weight:bold}\n.tog.on{background:#22c55e;border-color:#22c55e;color:#fff}\n.off{opacity:.45}\n.hist{font-size:14px}\n.hist .amt{text-align:right;white-space:nowrap}\n.pos{color:#86efac}.neg{color:#fca5a5}\nlabel{display:block;font-size:13px;color:#94a3b8;margin:10px 0 4px}\ninput,select{width:100%;padding:12px;border-radius:10px;border:1px solid #475569;background:#0f172a;color:#f1f5f9;font-size:16px}\n.chips{display:flex;gap:6px;flex-wrap:wrap}\n.chips button{padding:8px 10px;border-radius:8px;background:#334155;font-size:14px;font-weight:bold}\n.chips button.on{background:#0ea5e9;color:#fff}\n#modal{position:fixed;inset:0;background:rgba(0,0,0,.6);display:flex;align-items:flex-end;justify-content:center;z-index:40}\n#modal .sheet{background:#1e293b;width:100%;max-width:640px;border-radius:18px 18px 0 0;padding:18px 16px 26px;max-height:90vh;overflow:auto}\n#modal h3{font-size:19px;margin-bottom:4px}\n.pinbox{max-width:320px;margin:15vh auto;text-align:center}\n.pinbox input{text-align:center;font-size:28px;letter-spacing:10px;margin:16px 0}\n.seg{display:flex;gap:6px}.seg button{flex:1;padding:10px;border-radius:10px;background:#334155;font-weight:bold}\n.seg button.on{background:#0ea5e9;color:#fff}\n.loading{text-align:center;color:#94a3b8;padding:30vh 0;font-size:20px}\n</style>\n</head>\n<body>\n<div id=\"loading\" class=\"loading\">Loading chores…</div>\n<div id=\"tv\" class=\"hidden\"></div>\n<div id=\"parent\" class=\"hidden\"></div>\n<div id=\"party\" class=\"hidden\"></div>\n<div id=\"modal\" class=\"hidden\"></div>\n<div id=\"toast\" class=\"hidden\"></div>\n\n<script>\nvar MODE = '__MODE__';\n// Inside the Fire TV app there is no google.script.run, so route calls through the app's native bridge\nif (typeof google === 'undefined' && window.Native) {\n  var __cbs = {}, __n = 0;\n  window.__nativeCb = function (id, r) {\n    var c = __cbs[id]; delete __cbs[id]; if (!c) return;\n    if (r && r.ok) c.s(r.result); else c.f(new Error((r && r.error) || 'Network error'));\n  };\n  window.google = {script: {get run() {\n    var s = function () {}, f = function () {};\n    var o = {withSuccessHandler: function (x) { s = x; return o; }, withFailureHandler: function (x) { f = x; return o; }};\n    ['getState', 'toggleChore', 'parent'].forEach(function (n) {\n      o[n] = function () { var id = 'c' + (++__n); __cbs[id] = {s: s, f: f}; Native.call(id, n, JSON.stringify(Array.prototype.slice.call(arguments))); };\n    });\n    return o;\n  }}};\n}\nvar S = null;                 // state from server\nvar focus = {c: 0, r: 0};     // TV focus\nvar busy = false;\nvar DAYS = ['Su','Mo','Tu','We','Th','Fr','Sa'];\nvar DAY_NAMES = ['Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday'];\n\n// ---------- server bridge ----------\nfunction call(fn) {\n  var args = Array.prototype.slice.call(arguments, 1);\n  return new Promise(function (res, rej) {\n    var r = google.script.run.withSuccessHandler(res).withFailureHandler(function (e) { rej(e); });\n    r[fn].apply(r, args);\n  });\n}\nfunction money(n) { n = Number(n) || 0; return (n < 0 ? '-$' : '$') + Math.abs(n).toFixed(2); }\nfunction esc(s) { return String(s == null ? '' : s).replace(/[&<>\"']/g, function (c) { return {'&':'&amp;','<':'&lt;','>':'&gt;','\"':'&quot;',\"'\":'&#39;'}[c]; }); }\nfunction toast(msg, ok) {\n  var t = document.getElementById('toast');\n  t.textContent = msg; t.className = ok ? 'ok' : '';\n  clearTimeout(toast._t); toast._t = setTimeout(function () { t.className = 'hidden'; }, 3200);\n}\nfunction errMsg(e) { return (e && e.message ? e.message : String(e)).replace(/^Exception:\\s*/, ''); }\nfunction todayChores(k) { return k.chores.filter(function (c) { return c.today; }); }\nfunction allDone(k) { var t = todayChores(k); return t.length > 0 && t.every(function (c) { return c.done; }); }\nfunction earnedToday(k) { return todayChores(k).filter(function (c) { return c.done; }).reduce(function (s, c) { return s + c.value; }, 0); }\n\n// ======================================================\n// TV\n// ======================================================\nfunction renderTV() {\n  var el = document.getElementById('tv');\n  var d = new Date();\n  var html = '<header><div><h1>⭐ Today\\'s Chores</h1><div class=\"hint\">Use ◀ ▶ ▲ ▼ to move · press OK to check off</div></div>' +\n    '<div class=\"date\">' + DAY_NAMES[d.getDay()] + ', ' + d.toLocaleDateString(undefined, {month: 'long', day: 'numeric'}) + '</div></header><div class=\"cols\">';\n  S.kids.forEach(function (k, ci) {\n    var list = todayChores(k);\n    var n = list.filter(function (c) { return c.done; }).length;\n    var stars = list.map(function (c) { return c.done ? '⭐' : '☆'; }).join('');\n    html += '<section class=\"col\" style=\"--c:' + esc(k.color) + '\"><div class=\"col-head\"><h2>' + esc(k.name) + '</h2>' +\n      '<div><div class=\"stars\">' + stars + '</div><div class=\"progress\">' + n + ' of ' + list.length + ' done</div></div></div>';\n    if (allDone(k)) html += '<div class=\"alldone\">🎉 Done for the day! 🎉</div>';\n    html += '<div class=\"list\">';\n    if (!list.length) html += '<div class=\"empty\">No chores today 😎</div>';\n    list.forEach(function (c, ri) {\n      var f = (focus.c === ci && focus.r === ri) ? ' focus' : '';\n      html += '<button class=\"chore' + (c.done ? ' done' : '') + f + '\" data-c=\"' + ci + '\" data-r=\"' + ri + '\">' +\n        '<span class=\"ic\">' + esc(c.icon) + '</span><span class=\"nm\">' + esc(c.name) + '</span>' +\n        '<span class=\"val money\">' + money(c.value) + '</span><span class=\"ck\">' + (c.done ? '✓' : '') + '</span></button>';\n    });\n    html += '</div><div class=\"bank\">' +\n      '<div class=\"wk\"><small>This week</small><b class=\"money\">' + money(k.pending) + '</b></div>' +\n      '<div class=\"sv\"><small>💰 Savings</small><b class=\"money\">' + money(k.savings) + '</b></div>' +\n      '<div class=\"sp\"><small>🛍️ Spending</small><b class=\"money\">' + money(k.spending) + '</b></div></div></section>';\n  });\n  el.innerHTML = html + '</div>';\n  var f = el.querySelector('.chore.focus');\n  if (f && f.scrollIntoView) f.scrollIntoView({block: 'nearest'});\n}\n\nfunction clampFocus() {\n  if (!S.kids.length) return;\n  focus.c = Math.max(0, Math.min(focus.c, S.kids.length - 1));\n  var len = todayChores(S.kids[focus.c]).length;\n  focus.r = len ? Math.max(0, Math.min(focus.r, len - 1)) : 0;\n}\n\nfunction moveFocus(dc, dr) {\n  if (dc) {\n    var c = focus.c;\n    for (var i = 0; i < S.kids.length; i++) {          // skip kids with no chores today\n      c = (c + dc + S.kids.length) % S.kids.length;\n      if (todayChores(S.kids[c]).length) break;\n    }\n    focus.c = c;\n  }\n  if (dr) focus.r += dr;\n  clampFocus();\n  renderTV();\n}\n\nfunction tvToggle(ci, ri) {\n  var k = S.kids[ci]; if (!k) return;\n  var c = todayChores(k)[ri]; if (!c) return;\n  var wasAll = allDone(k);\n  c.done = !c.done;                                   // optimistic\n  k.pending = Math.round((k.pending + (c.done ? c.value : -c.value)) * 100) / 100;\n  renderTV();\n  if (!wasAll && allDone(k)) celebrate(k);\n  call('toggleChore', k.id, c.id).then(function (st) { S = st; clampFocus(); renderTV(); })\n    .catch(function (e) { toast(errMsg(e)); refresh(); });\n}\n\nfunction celebrate(k) {\n  var p = document.getElementById('party');\n  p.innerHTML = '<div class=\"big\">🏆</div><h3>Way to go, ' + esc(k.name) + '!</h3>' +\n    '<p>All your chores are done for today ⭐ You earned ' + money(earnedToday(k)) + '</p>';\n  p.className = '';\n  var emojis = ['⭐', '🌟', '✨', '⭐', '💫'];\n  for (var i = 0; i < 45; i++) {\n    var s = document.createElement('div');\n    s.className = 'fall';\n    s.textContent = emojis[i % emojis.length];\n    s.style.left = (Math.random() * 100) + 'vw';\n    s.style.fontSize = (2 + Math.random() * 4) + 'vw';\n    s.style.animationDuration = (2.5 + Math.random() * 3) + 's';\n    s.style.animationDelay = (Math.random() * 2.5) + 's';\n    p.appendChild(s);\n  }\n  clearTimeout(celebrate._t);\n  celebrate._t = setTimeout(closeParty, 9000);\n}\nfunction closeParty() { document.getElementById('party').className = 'hidden'; }\n\nfunction tvKeys(e) {\n  var k = e.key, code = e.keyCode;\n  var partyOpen = document.getElementById('party').className !== 'hidden';\n  if (partyOpen) { closeParty(); e.preventDefault(); return; }\n  if (k === 'ArrowRight' || code === 39) { moveFocus(1, 0); }\n  else if (k === 'ArrowLeft' || code === 37) { moveFocus(-1, 0); }\n  else if (k === 'ArrowDown' || code === 40) { moveFocus(0, 1); }\n  else if (k === 'ArrowUp' || code === 38) { moveFocus(0, -1); }\n  else if (k === 'Enter' || k === ' ' || code === 13 || code === 23 || code === 32) { tvToggle(focus.c, focus.r); }\n  else return;\n  e.preventDefault();\n}\n\nfunction startTV() {\n  document.getElementById('tv').className = '';\n  document.body.style.overflow = 'hidden';\n  // start on the first kid that has chores\n  for (var i = 0; i < S.kids.length; i++) if (todayChores(S.kids[i]).length) { focus.c = i; break; }\n  renderTV();\n  document.addEventListener('keydown', tvKeys);\n  document.getElementById('tv').addEventListener('click', function (e) {\n    var b = e.target.closest ? e.target.closest('.chore') : null;\n    if (!b) return;\n    focus.c = +b.dataset.c; focus.r = +b.dataset.r;\n    tvToggle(focus.c, focus.r);\n  });\n  document.getElementById('party').addEventListener('click', closeParty);\n  try { window.focus(); } catch (e) {}\n  // pick up changes made from phones, and roll over at midnight\n  setInterval(refresh, 30000);\n}\n\nfunction refresh() {\n  if (busy) return;\n  call('getState').then(function (st) {\n    S = st;\n    if (MODE === 'tv') { clampFocus(); renderTV(); } else renderParent();\n  }).catch(function () {});\n}\n\n// ======================================================\n// PARENT (phone)\n// ======================================================\nvar PIN = null, tab = 'kids';\nfunction lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }\nfunction lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) {} }\n\nfunction startParent() {\n  document.getElementById('parent').className = '';\n  var saved = lsGet('chorePin');\n  if (saved) {\n    call('parent', saved, 'check').then(function (st) { PIN = saved; S = st; renderParent(); })\n      .catch(function () { showPin(); });\n  } else showPin();\n  setInterval(function () { if (PIN && document.getElementById('modal').className === 'hidden') refresh(); }, 30000);\n}\n\nfunction showPin(msg) {\n  document.getElementById('parent').innerHTML = '<div class=\"pinbox\"><h1>👨‍👩‍👧‍👦 Parent Mode</h1>' +\n    '<div class=\"sub\">' + (msg || 'Enter your PIN') + '</div>' +\n    '<input id=\"pin\" type=\"password\" inputmode=\"numeric\" maxlength=\"8\" autocomplete=\"off\">' +\n    '<button class=\"btn pri full\" id=\"pinGo\">Unlock</button></div>';\n  var go = function () {\n    var v = document.getElementById('pin').value;\n    call('parent', v, 'check').then(function (st) { PIN = v; lsSet('chorePin', v); S = st; renderParent(); })\n      .catch(function (e) { showPin(errMsg(e)); });\n  };\n  document.getElementById('pinGo').onclick = go;\n  document.getElementById('pin').onkeydown = function (e) { if (e.key === 'Enter') go(); };\n}\n\nfunction act(action, args, okMsg) {\n  busy = true;\n  return call('parent', PIN, action, args || {}).then(function (st) {\n    S = st; busy = false; closeModal(); renderParent(); if (okMsg) toast(okMsg, true);\n  }).catch(function (e) { busy = false; toast(errMsg(e)); if (/PIN/.test(errMsg(e))) { lsSet('chorePin', ''); showPin(); } });\n}\n\nfunction kidById(id) { return S.kids.filter(function (k) { return k.id === id; })[0]; }\n\nfunction renderParent() {\n  var el = document.getElementById('parent');\n  var st = S.settings;\n  var h = '<h1>⭐ Chore Chart</h1><div class=\"sub\">Pay day: ' + DAY_NAMES[st.paydayDay] + 's at ' + fmtHour(st.paydayHour) +\n    (st.lastPayday ? ' · last paid ' + st.lastPayday : '') + '</div>' +\n    '<div class=\"tabs\">' + ['kids:Kids', 'chores:Chores', 'history:History', 'settings:Settings'].map(function (t) {\n      var p = t.split(':'); return '<button data-tab=\"' + p[0] + '\" class=\"' + (tab === p[0] ? 'on' : '') + '\">' + p[1] + '</button>';\n    }).join('') + '</div>';\n  if (tab === 'kids') h += viewKids();\n  if (tab === 'chores') h += viewChores();\n  if (tab === 'history') h += viewHistory();\n  if (tab === 'settings') h += viewSettings();\n  el.innerHTML = h;\n}\n\nfunction viewKids() {\n  var h = '';\n  S.kids.forEach(function (k) {\n    var t = todayChores(k), n = t.filter(function (c) { return c.done; }).length;\n    h += '<div class=\"card\" style=\"--c:' + esc(k.color) + '\"><h2>' + esc(k.name) + (allDone(k) ? ' <span>🎉 ⭐</span>' : '') +\n      '<span class=\"sub\">' + n + '/' + t.length + ' today</span></h2>' +\n      '<div class=\"row3\"><div><small>This week</small><b class=\"money\" style=\"color:#fde68a\">' + money(k.pending) + '</b></div>' +\n      '<div><small>💰 Savings</small><b class=\"money\" style=\"color:#86efac\">' + money(k.savings) + '</b></div>' +\n      '<div><small>🛍️ Spending</small><b class=\"money\" style=\"color:#7dd3fc\">' + money(k.spending) + '</b></div></div>' +\n      '<div class=\"btns\"><button class=\"btn red\" data-act=\"spend\" data-kid=\"' + k.id + '\">Spend</button>' +\n      '<button class=\"btn grn\" data-act=\"add\" data-kid=\"' + k.id + '\">Add / bonus</button>' +\n      '<button class=\"btn\" data-act=\"move\" data-kid=\"' + k.id + '\">Move</button>' +\n      '<button class=\"btn\" data-act=\"today\" data-kid=\"' + k.id + '\">Today’s chores</button></div></div>';\n  });\n  var pend = S.kids.reduce(function (s, k) { return s + k.pending; }, 0);\n  h += '<button class=\"btn pri full\" data-act=\"payday\">Pay out this week now (' + money(pend) + ')</button>' +\n    '<div class=\"sub\" style=\"margin-top:8px\">“This week” is what they’ve earned since the last pay day. On pay day it splits into Savings and Spending by each kid’s savings %.</div>';\n  return h;\n}\n\nfunction viewChores() {\n  var h = '';\n  S.kids.forEach(function (k) {\n    h += '<div class=\"card\" style=\"--c:' + esc(k.color) + '\"><h2>' + esc(k.name) +\n      '<button class=\"btn pri\" data-act=\"newChore\" data-kid=\"' + k.id + '\">+ Add</button></h2>';\n    if (!k.chores.length) h += '<div class=\"sub\" style=\"padding:10px 0\">No chores yet</div>';\n    k.chores.forEach(function (c) {\n      h += '<div class=\"li' + (c.active ? '' : ' off') + '\"><span class=\"ic\">' + esc(c.icon) + '</span><span class=\"nm\">' + esc(c.name) +\n        '<small>' + money(c.value) + ' · ' + daysLabel(c.days) + (c.active ? '' : ' · paused') + '</small></span>' +\n        '<button class=\"btn\" data-act=\"editChore\" data-kid=\"' + k.id + '\" data-id=\"' + c.id + '\">Edit</button></div>';\n    });\n    h += '</div>';\n  });\n  return h;\n}\n\nfunction viewHistory() {\n  if (!S.ledger.length) return '<div class=\"card\"><div class=\"sub\">No money activity yet. Pay days, spending, and bonuses show up here.</div></div>';\n  var h = '<div class=\"card hist\">';\n  S.ledger.forEach(function (l) {\n    var k = kidById(l.kidId) || {name: l.kidId};\n    var d = new Date(l.ts);\n    var parts = [];\n    if (l.savings) parts.push('<span class=\"' + (l.savings < 0 ? 'neg' : 'pos') + '\">💰 ' + money(l.savings) + '</span>');\n    if (l.spending) parts.push('<span class=\"' + (l.spending < 0 ? 'neg' : 'pos') + '\">🛍️ ' + money(l.spending) + '</span>');\n    h += '<div class=\"li\"><span class=\"nm\"><b>' + esc(k.name) + '</b> — ' + esc(l.note || l.type) +\n      '<small>' + (isNaN(d) ? '' : d.toLocaleDateString(undefined, {month: 'short', day: 'numeric'})) + '</small></span>' +\n      '<span class=\"amt\">' + parts.join('<br>') + '</span></div>';\n  });\n  return h + '</div>';\n}\n\nfunction viewSettings() {\n  var st = S.settings;\n  var h = '<div class=\"card\"><h2>Savings split</h2><div class=\"sub\">Share of each pay day that goes to Savings. The rest goes to Spending.</div>';\n  S.kids.forEach(function (k) {\n    h += '<label>' + esc(k.name) + ' — saves <b id=\"pv_' + k.id + '\">' + k.savingsPct + '</b>%</label>' +\n      '<input type=\"range\" min=\"0\" max=\"100\" step=\"5\" value=\"' + k.savingsPct + '\" data-pct=\"' + k.id + '\">';\n  });\n  h += '<button class=\"btn pri full\" style=\"margin-top:12px\" data-act=\"savePct\">Save split</button></div>';\n  h += '<div class=\"card\"><h2>Pay day</h2><label>Day</label><select id=\"pdDay\">' + DAY_NAMES.map(function (n, i) {\n      return '<option value=\"' + i + '\"' + (i === st.paydayDay ? ' selected' : '') + '>' + n + '</option>';\n    }).join('') + '</select><label>Time</label><select id=\"pdHour\">';\n  for (var hr = 6; hr <= 22; hr++) h += '<option value=\"' + hr + '\"' + (hr === st.paydayHour ? ' selected' : '') + '>' + fmtHour(hr) + '</option>';\n  h += '</select><button class=\"btn pri full\" style=\"margin-top:12px\" data-act=\"savePayday\">Save pay day</button></div>';\n  h += '<div class=\"card\"><h2>Parent PIN</h2><label>New PIN (4–8 digits)</label><input id=\"newPin\" type=\"password\" inputmode=\"numeric\" maxlength=\"8\">' +\n    '<button class=\"btn pri full\" style=\"margin-top:12px\" data-act=\"savePin\">Change PIN</button></div>' +\n    '<button class=\"btn full\" data-act=\"lock\">Lock parent mode on this phone</button>';\n  return h;\n}\n\nfunction fmtHour(h) { h = Number(h); return (h % 12 || 12) + (h < 12 ? ' AM' : ' PM'); }\nfunction daysLabel(d) {\n  d = String(d || 'daily');\n  if (d.toLowerCase() === 'daily') return 'every day';\n  var a = d.split(/[\\s,]+/).filter(Boolean);\n  if (a.length === 5 && ['Mo','Tu','We','Th','Fr'].every(function (x) { return a.indexOf(x) >= 0; })) return 'weekdays';\n  if (a.length === 2 && a.indexOf('Sa') >= 0 && a.indexOf('Su') >= 0) return 'weekends';\n  return a.join(', ');\n}\n\n// ---------- modals ----------\nfunction openModal(html) { var m = document.getElementById('modal'); m.innerHTML = '<div class=\"sheet\">' + html + '</div>'; m.className = ''; }\nfunction closeModal() { document.getElementById('modal').className = 'hidden'; }\n\nfunction moneyModal(kind, kidId) {\n  var k = kidById(kidId);\n  var title = {spend: 'Spend money', add: 'Add money / bonus', move: 'Move money'}[kind];\n  var h = '<h3>' + title + ' — ' + esc(k.name) + '</h3><div class=\"sub\">Savings ' + money(k.savings) + ' · Spending ' + money(k.spending) + '</div>';\n  if (kind === 'move') {\n    h += '<label>Direction</label><div class=\"seg\" id=\"seg\"><button class=\"on\" data-v=\"spending\">Savings → Spending</button><button data-v=\"savings\">Spending → Savings</button></div>';\n  } else {\n    h += '<label>' + (kind === 'spend' ? 'Take it from' : 'Put it in') + '</label><div class=\"seg\" id=\"seg\">' +\n      '<button class=\"' + (kind === 'spend' ? 'on' : '') + '\" data-v=\"spending\">🛍️ Spending</button><button class=\"' + (kind === 'add' ? 'on' : '') + '\" data-v=\"savings\">💰 Savings</button></div>';\n  }\n  h += '<label>Amount</label><input id=\"mAmt\" type=\"number\" inputmode=\"decimal\" step=\"0.01\" min=\"0\" placeholder=\"0.00\">' +\n    '<label>Note (optional)</label><input id=\"mNote\" placeholder=\"' + (kind === 'spend' ? 'e.g. Toy at Walmart' : kind === 'add' ? 'e.g. Helped stack wood' : '') + '\">' +\n    '<div class=\"btns\" style=\"margin-top:16px\"><button class=\"btn\" data-act=\"close\" style=\"flex:1\">Cancel</button>' +\n    '<button class=\"btn pri\" style=\"flex:2\" data-act=\"doMoney\" data-kind=\"' + kind + '\" data-kid=\"' + kidId + '\">Save</button></div>';\n  openModal(h);\n}\n\nfunction doMoney(kind, kidId) {\n  var amt = Math.abs(parseFloat(document.getElementById('mAmt').value) || 0);\n  var note = document.getElementById('mNote').value;\n  var bucket = document.querySelector('#seg button.on').dataset.v;\n  if (!amt) { toast('Enter an amount'); return; }\n  var k = kidById(kidId);\n  if (kind === 'move') return act('move', {kidId: kidId, to: bucket, amount: amt, note: note}, 'Moved ' + money(amt));\n  if (kind === 'spend' && amt > k[bucket] + 0.001 && !confirm(k.name + ' only has ' + money(k[bucket]) + ' in ' + bucket + '. Go negative anyway?')) return;\n  act('txn', {kidId: kidId, bucket: bucket, amount: kind === 'spend' ? -amt : amt, note: note || (kind === 'spend' ? 'Spent' : 'Bonus'), type: kind}, 'Saved');\n}\n\nfunction todayModal(kidId) {\n  var k = kidById(kidId);\n  var t = todayChores(k);\n  var h = '<h3>' + esc(k.name) + ' — today</h3><div class=\"sub\">Tap to check or uncheck</div>';\n  if (!t.length) h += '<div class=\"sub\" style=\"padding:12px 0\">No chores today</div>';\n  t.forEach(function (c) {\n    h += '<div class=\"li\"><span class=\"ic\">' + esc(c.icon) + '</span><span class=\"nm\">' + esc(c.name) + '<small>' + money(c.value) + '</small></span>' +\n      '<button class=\"tog' + (c.done ? ' on' : '') + '\" data-act=\"ptoggle\" data-kid=\"' + kidId + '\" data-id=\"' + c.id + '\">' + (c.done ? '✓' : '') + '</button></div>';\n  });\n  h += '<button class=\"btn full\" style=\"margin-top:14px\" data-act=\"close\">Close</button>';\n  openModal(h);\n}\n\nvar editDays = [];\nfunction choreModal(kidId, choreId) {\n  var k = kidById(kidId);\n  var c = choreId ? k.chores.filter(function (x) { return x.id === choreId; })[0] : {name: '', icon: '⭐', value: 0.25, days: 'daily', active: true};\n  var d = String(c.days || 'daily');\n  editDays = d.toLowerCase() === 'daily' ? DAYS.slice() : d.split(/[\\s,]+/).filter(Boolean);\n  var h = '<h3>' + (choreId ? 'Edit chore' : 'New chore') + ' — ' + esc(k.name) + '</h3>' +\n    '<label>Chore</label><input id=\"cName\" value=\"' + esc(c.name) + '\" placeholder=\"e.g. Feed the dog\">' +\n    '<label>Emoji</label><input id=\"cIcon\" value=\"' + esc(c.icon) + '\" maxlength=\"4\">' +\n    '<div class=\"chips\" style=\"margin-top:6px\">' + ['🛏️','🪥','🧺','🧦','🧸','🍽️','🍴','🗑️','📚','🧹','🐶','🐱','🐔','🌱','🚗','🪵','🧼','👕','🎒','✏️'].map(function (e) {\n      return '<button data-act=\"pickIcon\" data-v=\"' + e + '\">' + e + '</button>'; }).join('') + '</div>' +\n    '<label>Pays ($)</label><input id=\"cVal\" type=\"number\" inputmode=\"decimal\" step=\"0.05\" min=\"0\" value=\"' + Number(c.value).toFixed(2) + '\">' +\n    '<label>Which days</label><div class=\"chips\" id=\"dayChips\">' + DAYS.map(function (x) {\n      return '<button data-act=\"day\" data-v=\"' + x + '\" class=\"' + (editDays.indexOf(x) >= 0 ? 'on' : '') + '\">' + x + '</button>'; }).join('') + '</div>' +\n    '<label><input type=\"checkbox\" id=\"cAct\" style=\"width:auto\"' + (c.active ? ' checked' : '') + '> Active (uncheck to pause)</label>' +\n    '<div class=\"btns\" style=\"margin-top:16px\">' + (choreId ? '<button class=\"btn red\" data-act=\"delChore\" data-id=\"' + choreId + '\">Delete</button>' : '') +\n    '<button class=\"btn\" data-act=\"close\" style=\"flex:1\">Cancel</button>' +\n    '<button class=\"btn pri\" style=\"flex:2\" data-act=\"saveChore\" data-kid=\"' + kidId + '\" data-id=\"' + (choreId || '') + '\">Save</button></div>';\n  openModal(h);\n}\n\n// ---------- parent click router ----------\ndocument.addEventListener('click', function (e) {\n  if (MODE !== 'parent') return;\n  var t = e.target.closest ? e.target.closest('[data-act],[data-tab],#seg button') : null;\n  if (!t) { if (e.target.id === 'modal') closeModal(); return; }\n  if (t.dataset.tab) { tab = t.dataset.tab; renderParent(); return; }\n  if (t.parentNode && t.parentNode.id === 'seg') {\n    Array.prototype.forEach.call(t.parentNode.children, function (b) { b.className = ''; });\n    t.className = 'on'; return;\n  }\n  var a = t.dataset.act, kid = t.dataset.kid, id = t.dataset.id;\n  switch (a) {\n    case 'spend': case 'add': case 'move': moneyModal(a, kid); break;\n    case 'doMoney': doMoney(t.dataset.kind, kid); break;\n    case 'today': todayModal(kid); break;\n    case 'ptoggle':\n      busy = true;\n      call('parent', PIN, 'toggle', {kidId: kid, choreId: id}).then(function (st) { S = st; busy = false; renderParent(); todayModal(kid); })\n        .catch(function (err) { busy = false; toast(errMsg(err)); });\n      break;\n    case 'payday':\n      if (confirm('Pay out everything earned this week now? It will split into Savings and Spending.')) act('payday', {}, 'Paid out!');\n      break;\n    case 'newChore': choreModal(kid); break;\n    case 'editChore': choreModal(kid, id); break;\n    case 'pickIcon': document.getElementById('cIcon').value = t.dataset.v; break;\n    case 'day':\n      var i = editDays.indexOf(t.dataset.v);\n      if (i >= 0) editDays.splice(i, 1); else editDays.push(t.dataset.v);\n      t.className = i >= 0 ? '' : 'on'; break;\n    case 'saveChore':\n      var name = document.getElementById('cName').value.trim();\n      if (!name) { toast('Give the chore a name'); return; }\n      if (!editDays.length) { toast('Pick at least one day'); return; }\n      var days = editDays.length === 7 ? 'daily' : DAYS.filter(function (x) { return editDays.indexOf(x) >= 0; }).join(',');\n      act('saveChore', {id: id || '', kidId: kid, name: name, icon: document.getElementById('cIcon').value.trim() || '⭐',\n        value: parseFloat(document.getElementById('cVal').value) || 0, days: days, active: document.getElementById('cAct').checked}, 'Chore saved');\n      break;\n    case 'delChore':\n      if (confirm('Delete this chore? (Money already earned stays.)')) act('deleteChore', {id: id}, 'Deleted');\n      break;\n    case 'savePct':\n      var inputs = document.querySelectorAll('[data-pct]');\n      var chain = Promise.resolve();\n      busy = true;\n      Array.prototype.forEach.call(inputs, function (inp) {\n        chain = chain.then(function () { return call('parent', PIN, 'saveKid', {id: inp.dataset.pct, savingsPct: inp.value}); })\n          .then(function (st) { S = st; });\n      });\n      chain.then(function () { busy = false; renderParent(); toast('Savings split saved', true); })\n        .catch(function (err) { busy = false; toast(errMsg(err)); });\n      break;\n    case 'savePayday':\n      act('setPayday', {day: +document.getElementById('pdDay').value, hour: +document.getElementById('pdHour').value}, 'Pay day saved');\n      break;\n    case 'savePin':\n      var np = document.getElementById('newPin').value;\n      call('parent', PIN, 'setPin', {newPin: np}).then(function (st) { PIN = np; lsSet('chorePin', np); S = st; renderParent(); toast('PIN changed', true); })\n        .catch(function (err) { toast(errMsg(err)); });\n      break;\n    case 'lock': PIN = null; lsSet('chorePin', ''); showPin(); break;\n    case 'close': closeModal(); break;\n  }\n});\ndocument.addEventListener('input', function (e) {\n  if (e.target.dataset && e.target.dataset.pct) document.getElementById('pv_' + e.target.dataset.pct).textContent = e.target.value;\n});\n\n// ---------- boot ----------\nif (MODE === 'parent') {\n  document.getElementById('loading').className = 'hidden';\n  startParent();\n} else {\n  call('getState').then(function (st) {\n    S = st;\n    document.getElementById('loading').className = 'hidden';\n    startTV();\n  }).catch(function (e) {\n    document.getElementById('loading').textContent = 'Could not load chores: ' + errMsg(e);\n    setTimeout(function () { location.reload(); }, 15000);\n  });\n}\n</script>\n</body>\n</html>\n";
