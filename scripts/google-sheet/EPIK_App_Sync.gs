/**
 * EPIK_App_Sync.gs — two-way link between this sheet (EPIK's copy of Inventory Masterbase) and the EPIK app.
 *
 * Every 5 minutes:
 *   1. Original → this copy: new unit rows, and dispatch details typed in the team's original sheet, are copied in.
 *      The original is only READ. Nothing is ever written to it.
 *   2. This copy → app: unit rows dated on or after the sync start date (new stock, dispatches, returns to vendor).
 *   3. App → this copy: the "EPIK App live stock" tab, the app's own dispatches filled into their serial rows,
 *      stock the app took in added as rows, and the "EPIK App sync log" tab (problems + where sheet and app disagree).
 *
 * Only this copy's "Inventory Masterbase" tab and the two "EPIK App …" tabs are written. Columns that hold formulas
 * are never written. Customer names never leave this sheet: the app only receives SKUs, serials, dates and costs.
 *
 * SETUP (once): Project Settings → Script properties: EPIK_APP_URL (https://salesmasterbase.vercel.app) and
 * EPIK_TOKEN (same as SHEET_SYNC_TOKEN in Vercel). Then run epikSetup and click Allow.
 */

var EPIK = {
  ORIGINAL_ID: '1MqWjG8H1CO-wtA4zg_m5JgVhh2__A4vqG2yaRBzne4M',
  MASTER_TAB: 'Inventory Masterbase',
  LIVE_TAB: 'EPIK App live stock',
  LOG_TAB: 'EPIK App sync log',
  MARK: 'EPIK app #',
  TZ: 'Asia/Kolkata',
  COLS: {
    serial: 'Serial No.', sku: 'SKU Code', product: 'Product Name', brand: 'Brand', qty: 'Quantity',
    inward: 'Inward Date', vendor: 'Vendor', invoice: 'Invoice no.', cost: 'Unit Cost', hub: 'Hub',
    receivedBy: 'Receiving Personnel', inSystem: 'In System (Y/N)', dispatch: 'Dispatch Date', price: 'Price',
    customer: 'Customer Name', poc: 'POC', rtv: 'Returned to Vendor (Y/N)'
  },
  // Dispatch details copied from the original when blank here.
  FOLLOW: ['dispatch', 'price', 'customer', 'poc', 'rtv']
};

/** Run once from the editor: adds the 5-minute timer and the EPIK App menu, then syncs. */
function epikSetup() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (['epikSync', 'epikMenu'].indexOf(t.getHandlerFunction()) >= 0) ScriptApp.deleteTrigger(t);
  });
  ScriptApp.newTrigger('epikSync').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('epikMenu').forSpreadsheet(SpreadsheetApp.getActive()).onOpen().create();
  epikSync();
}

function epikMenu() {
  SpreadsheetApp.getUi().createMenu('EPIK App').addItem('Sync now', 'epikSync').addToUi();
}

function epikSync() {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) return;
  var ss = SpreadsheetApp.getActive();
  var report = { at: new Date(), mirrored: 0, filled: 0, error: '' };
  try {
    var props = PropertiesService.getScriptProperties();
    var base = (props.getProperty('EPIK_APP_URL') || '').replace(/\/+$/, '');
    var token = props.getProperty('EPIK_TOKEN') || '';
    if (!base || !token) throw new Error('Set EPIK_APP_URL and EPIK_TOKEN in Project Settings → Script properties.');
    var cfg = epikCall_(base, token, 'get');
    var mb = ss.getSheetByName(EPIK.MASTER_TAB);
    if (!mb) throw new Error('No "' + EPIK.MASTER_TAB + '" tab in this sheet.');

    if (props.getProperty('EPIK_MIRROR') !== 'off') {
      var m = epikMirrorOriginal_(mb, cfg.from);
      report.mirrored = m.added;
      report.filled = m.filled;
    }

    var table = epikTable_(mb);
    var res = epikCall_(base, token, 'post', { rows: epikRowsToSend_(table, cfg.from), counts: epikCounts_(table) });
    epikWriteLive_(ss, res.liveStock);
    report.filled += epikFillDispatches_(mb, table, res.dispatches || []);
    report.mirrored += epikAddAppInwards_(mb, table, res.inwards || []);
    epikWriteLog_(ss, report, res);
  } catch (e) {
    report.error = String(e && e.message ? e.message : e);
    epikWriteLog_(ss, report, null);
  } finally {
    lock.releaseLock();
  }
}

// ── Talking to the app ──────────────────────────────────────────────────────

function epikCall_(base, token, method, body) {
  var options = { method: method, muteHttpExceptions: true, headers: { Authorization: 'Bearer ' + token }, contentType: 'application/json' };
  if (body) options.payload = JSON.stringify(body);
  var response = UrlFetchApp.fetch(base + '/api/sheet/sync', options);
  var text = response.getContentText();
  var data;
  try { data = JSON.parse(text); } catch (e) { throw new Error('The app answered ' + response.getResponseCode() + ': ' + text.slice(0, 200)); }
  if (response.getResponseCode() !== 200) throw new Error(data.error || ('The app answered ' + response.getResponseCode()));
  return data;
}

// ── Reading the Masterbase tab ──────────────────────────────────────────────

/** Values, header positions and which columns hold formulas (never written). */
function epikTable_(sheet) {
  var range = sheet.getDataRange();
  var values = range.getValues();
  var header = (values[0] || []).map(function (h) { return String(h).trim(); });
  var col = {};
  Object.keys(EPIK.COLS).forEach(function (k) { col[k] = header.indexOf(EPIK.COLS[k]); });
  var width = header.length;
  var formulaCols = {};
  var probe = sheet.getRange(1, 1, Math.min(2, values.length), width).getFormulas();
  for (var c = 0; c < width; c++) if (probe.some(function (r) { return r[c]; })) formulaCols[c] = true;
  return { sheet: sheet, values: values, header: header, col: col, width: width, formulaCols: formulaCols };
}

function epikCell_(t, row, key) {
  var c = t.col[key];
  return c >= 0 ? row[c] : '';
}

function epikDate_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, EPIK.TZ, 'yyyy-MM-dd');
  var s = String(v || '').trim();
  var m = /^(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})$/.exec(s);
  if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2);
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  return '';
}

function epikNumber_(v) {
  if (typeof v === 'number') return v;
  var n = Number(String(v || '').replace(/[₹,\s]/g, ''));
  return String(v || '').trim() !== '' && isFinite(n) ? n : null;
}

/** Serial number when there is one; otherwise SKU + inward date + invoice + how many identical rows came before. */
function epikKeys_(t, rows) {
  var seen = {};
  return rows.map(function (row) {
    var serial = String(epikCell_(t, row, 'serial') || '').trim();
    if (serial) return serial;
    var base = [String(epikCell_(t, row, 'sku')).trim().toLowerCase(), epikDate_(epikCell_(t, row, 'inward')), String(epikCell_(t, row, 'invoice')).trim()].join('|');
    seen[base] = (seen[base] || 0) + 1;
    return base + '|' + seen[base];
  });
}

function epikIsUnitRow_(t, row) {
  var sku = String(epikCell_(t, row, 'sku') || '').trim();
  return sku && sku !== EPIK.COLS.sku;
}

function epikRowsToSend_(t, from) {
  var data = t.values.slice(1);
  var keys = epikKeys_(t, data);
  var out = [];
  data.forEach(function (row, i) {
    if (!epikIsUnitRow_(t, row)) return;
    if (String(epikCell_(t, row, 'receivedBy')).indexOf(EPIK.MARK) === 0) return; // stock the app itself added
    var inward = epikDate_(epikCell_(t, row, 'inward'));
    var dispatch = epikDate_(epikCell_(t, row, 'dispatch'));
    if (!(inward && inward >= from) && !(dispatch && dispatch >= from)) return;
    out.push({
      key: keys[i],
      serial: String(epikCell_(t, row, 'serial') || '').trim(),
      sku: String(epikCell_(t, row, 'sku')).trim(),
      productName: String(epikCell_(t, row, 'product') || '').slice(0, 300),
      qty: epikNumber_(epikCell_(t, row, 'qty')) || 1,
      inwardDate: inward,
      vendor: String(epikCell_(t, row, 'vendor') || ''),
      invoice: String(epikCell_(t, row, 'invoice') || ''),
      unitCost: epikNumber_(epikCell_(t, row, 'cost')),
      dispatchDate: dispatch,
      customer: String(epikCell_(t, row, 'customer') || ''),
      returnedToVendor: String(epikCell_(t, row, 'rtv') || '')
    });
  });
  return out;
}

/** Units in stock per SKU, as this sheet sees it (no dispatch date, not returned to vendor). */
function epikCounts_(t) {
  var counts = {};
  t.values.slice(1).forEach(function (row) {
    if (!epikIsUnitRow_(t, row)) return;
    if (epikDate_(epikCell_(t, row, 'dispatch'))) return;
    if (/^y(es)?$/i.test(String(epikCell_(t, row, 'rtv')).trim())) return;
    var sku = String(epikCell_(t, row, 'sku')).trim().toLowerCase();
    counts[sku] = (counts[sku] || 0) + (epikNumber_(epikCell_(t, row, 'qty')) || 1);
  });
  return counts;
}

// ── Writing (this copy only) ────────────────────────────────────────────────

function epikSet_(t, rowIndex, key, value) {
  var c = t.col[key];
  if (c < 0 || t.formulaCols[c]) return false;
  t.sheet.getRange(rowIndex + 1, c + 1).setValue(value);
  t.values[rowIndex][c] = value;
  return true;
}

function epikAppendRows_(t, rows) {
  if (!rows.length) return 0;
  // Formula columns are left empty so array formulas keep working.
  rows.forEach(function (r) { for (var c in t.formulaCols) r[c] = ''; });
  var start = t.sheet.getLastRow() + 1;
  t.sheet.getRange(start, 1, rows.length, t.width).setValues(rows);
  rows.forEach(function (r) { t.values.push(r); });
  return rows.length;
}

/** Original → this copy. Reads the team's original; writes only here. */
function epikMirrorOriginal_(mb, from) {
  var orig = SpreadsheetApp.openById(EPIK.ORIGINAL_ID).getSheetByName(EPIK.MASTER_TAB);
  if (!orig) throw new Error('The original sheet has no "' + EPIK.MASTER_TAB + '" tab.');
  var o = { values: orig.getDataRange().getValues() };
  o.header = o.values[0].map(function (h) { return String(h).trim(); });
  o.col = {};
  Object.keys(EPIK.COLS).forEach(function (k) { o.col[k] = o.header.indexOf(EPIK.COLS[k]); });
  var t = epikTable_(mb);
  var mine = {};
  epikKeys_(t, t.values.slice(1)).forEach(function (k, i) { mine[k] = i + 1; });
  var theirs = o.values.slice(1);
  var theirKeys = epikKeys_(o, theirs);
  var add = [];
  var filled = 0;
  theirs.forEach(function (row, i) {
    if (!epikIsUnitRow_(o, row)) return;
    var at = mine[theirKeys[i]];
    if (at == null) {
      var inward = epikDate_(epikCell_(o, row, 'inward'));
      var dispatch = epikDate_(epikCell_(o, row, 'dispatch'));
      if (!(inward && inward >= from) && !(dispatch && dispatch >= from)) return; // older rows were already here when the copy was made
      var out = new Array(t.width).fill('');
      t.header.forEach(function (h, c) { var oc = o.header.indexOf(h); if (oc >= 0) out[c] = row[oc]; });
      add.push(out);
      return;
    }
    EPIK.FOLLOW.forEach(function (key) {
      var theirValue = epikCell_(o, row, key);
      if (theirValue === '' || theirValue == null) return;
      if (String(epikCell_(t, t.values[at], key)).trim() !== '') return;
      if (epikSet_(t, at, key, theirValue)) filled++;
    });
  });
  return { added: epikAppendRows_(t, add), filled: filled };
}

/** App → this copy: the app's own dispatches go into their serial rows (only blank cells). */
function epikFillDispatches_(mb, t, dispatches) {
  var bySerial = {};
  t.values.forEach(function (row, i) { var s = String(epikCell_(t, row, 'serial') || '').trim(); if (s && i > 0) bySerial[s] = i; });
  var filled = 0;
  dispatches.forEach(function (d) {
    var at = bySerial[d.serial];
    if (at == null) return;
    var row = t.values[at];
    var date = d.date.split('-');
    if (!epikDate_(epikCell_(t, row, 'dispatch')) && epikSet_(t, at, 'dispatch', new Date(Number(date[0]), Number(date[1]) - 1, Number(date[2])))) filled++;
    if (String(epikCell_(t, row, 'customer')).trim() === '') epikSet_(t, at, 'customer', d.customer);
    if (String(epikCell_(t, row, 'poc')).trim() === '') epikSet_(t, at, 'poc', d.poc);
    if (String(epikCell_(t, row, 'price')).trim() === '' && d.priceRupees != null) epikSet_(t, at, 'price', d.priceRupees);
  });
  return filled;
}

/** App → this copy: stock the app took in (Stock in, PO receipts) becomes rows, once each. */
function epikAddAppInwards_(mb, t, inwards) {
  var have = {};
  t.values.forEach(function (row) { var r = String(epikCell_(t, row, 'receivedBy') || ''); if (r.indexOf(EPIK.MARK) === 0) have[r.split(' ')[2]] = true; });
  var rows = [];
  inwards.forEach(function (m) {
    if (have['#' + m.id] || have[m.id] || m.qty <= 0) return;
    var out = new Array(t.width).fill('');
    var put = function (key, v) { var c = t.col[key]; if (c >= 0) out[c] = v; };
    var date = m.date.split('-');
    put('serial', m.serial); put('sku', m.sku); put('product', m.product); put('brand', m.brand); put('qty', m.qty);
    put('inward', new Date(Number(date[0]), Number(date[1]) - 1, Number(date[2])));
    put('vendor', m.note); put('cost', m.unitCostRupees == null ? '' : m.unitCostRupees);
    put('receivedBy', EPIK.MARK + m.id + ' (' + m.by + ')'); put('inSystem', 'Yes'); put('rtv', 'No');
    rows.push(out);
  });
  return epikAppendRows_(t, rows);
}

function epikTab_(ss, name) {
  return ss.getSheetByName(name) || ss.insertSheet(name, ss.getNumSheets());
}

function epikWriteLive_(ss, rows) {
  if (!rows || !rows.length) return;
  var sheet = epikTab_(ss, EPIK.LIVE_TAB);
  var width = rows.reduce(function (w, r) { return Math.max(w, r.length); }, 1);
  var grid = rows.map(function (r) { var out = r.slice(); while (out.length < width) out.push(''); return out; });
  sheet.clearContents();
  sheet.getRange(1, 1, grid.length, width).setValues(grid);
  sheet.setFrozenRows(4);
  sheet.getRange(1, 1, 1, width).setFontWeight('bold');
  sheet.getRange(4, 1, 1, width).setFontWeight('bold').setBackground('#e8eefc');
}

function epikWriteLog_(ss, report, res) {
  var sheet = epikTab_(ss, EPIK.LOG_TAB);
  var when = Utilities.formatDate(report.at, EPIK.TZ, 'dd MMM yyyy, hh:mm a');
  var rows = [['EPIK App sync log. Written every 5 minutes. Do not type here.', '', '', '', ''],
    ['Last sync (IST)', when, report.error ? 'FAILED' : 'OK', report.error, '']];
  if (res) {
    var a = res.applied || { inward: 0, dispatched: 0, returned: 0, problems: [] };
    rows.push(['Sync start date', res.from, 'Rows sent', res.received, '']);
    rows.push(['Into the app', a.inward + ' new stock, ' + a.dispatched + ' dispatched, ' + a.returned + ' returned to vendor', 'Into this sheet', report.mirrored + ' rows added, ' + report.filled + ' cells filled', '']);
    rows.push(['', '', '', '', '']);
    rows.push(['NEEDS A LOOK (' + a.problems.length + ')', 'SKU', 'Product', 'Row', 'What to do']);
    a.problems.slice(0, 300).forEach(function (p) { rows.push(['', p.sku, p.product, p.key, p.message]); });
    rows.push(['', '', '', '', '']);
    rows.push(['SHEET vs APP (' + (res.check || []).length + ' SKUs differ)', 'SKU', 'Product', 'In the app', 'In this sheet']);
    (res.check || []).forEach(function (c) { rows.push(['', c.sku, c.product, c.app, c.sheet]); });
  }
  sheet.clearContents();
  sheet.getRange(1, 1, rows.length, 5).setValues(rows);
  sheet.getRange(1, 1, 1, 5).setFontWeight('bold');
}
