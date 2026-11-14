/**
 * EPIK salesmasterbase: lets the EPIK app write sales into this sheet.
 *
 * Paste this whole file in the sheet: Extensions → Apps Script → replace everything → Save.
 * Then Deploy → New deployment → type: Web app → Execute as: Me → Who has access: Anyone → Deploy → Allow.
 * Copy the Web app link (ends in /exec) into Vercel as SALES_SHEET_SCRIPT_URL.
 *
 * The app only reads the header row, finds its own rows and fills them. It never deletes anything.
 * Treat the Web app link like a password: anyone who has it can read and add rows.
 */

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(25000); // one write at a time, so two sales never land on the same row
    var req = JSON.parse(e.postData.contents);
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var out;
    if (req.op === "info") {
      out = { tab: ss.getSheets()[0].getName(), url: ss.getUrl() };
    } else if (req.op === "batchGet") {
      out = {
        values: req.ranges.map(function (r) {
          return ss.getRange(r).getDisplayValues();
        }),
      };
    } else if (req.op === "batchUpdate") {
      req.data.forEach(function (d) {
        ss.getRange(d.range).setValues(d.values);
      });
      out = {};
    } else if (req.op === "append") {
      var sheet = ss.getRange(req.range).getSheet();
      if (req.rows.length) {
        var width = req.rows[0].length;
        sheet.getRange(sheet.getLastRow() + 1, 1, req.rows.length, width).setValues(req.rows);
      }
      out = {};
    } else {
      throw new Error("Unknown request.");
    }
    SpreadsheetApp.flush();
    return reply({ ok: true, result: out });
  } catch (err) {
    return reply({ ok: false, error: String(err && err.message ? err.message : err) });
  } finally {
    lock.releaseLock();
  }
}

/** Opening the link in a browser shows this, so you can check the deployment works. */
function doGet() {
  return reply({ ok: true, sheet: SpreadsheetApp.getActiveSpreadsheet().getName() });
}

function reply(body) {
  return ContentService.createTextOutput(JSON.stringify(body)).setMimeType(ContentService.MimeType.JSON);
}
