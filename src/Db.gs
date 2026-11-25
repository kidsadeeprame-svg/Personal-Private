/**
 * ===== ชั้นอ่าน/เขียนข้อมูลในชีต =====
 * ทุกแท็บของแอปเป็นตาราง: แถว 1 = หัวคอลัมน์, แถว 2 เป็นต้นไป = ข้อมูล 1 แถวต่อ 1 รายการ
 */

/**
 * ชีตที่ใช้เก็บข้อมูล เรียงลำดับ:
 * 1) SPREADSHEET_ID ใน Config.gs
 * 2) Script property ชื่อ SPREADSHEET_ID (ตั้งใน Apps Script → Project Settings → Script properties)
 *    แนะนำวิธีนี้ถ้าอัปเดตโค้ดอัตโนมัติด้วย clasp เพราะโค้ดใหม่จะไม่ทับค่า
 * 3) ชีตที่สคริปต์ผูกอยู่ (สร้างจาก ส่วนขยาย → Apps Script)
 */
/* แคชภายในการเรียก 1 ครั้ง (ล้างเองเมื่อจบการทำงาน) — ลดการอ่านชีตซ้ำซึ่งเป็นส่วนที่ช้าที่สุด */
const MEMO_ = { ss: null, sheets: {}, tables: {} };

function ss_() {
  if (MEMO_.ss) return MEMO_.ss;
  const id = SPREADSHEET_ID || PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  if (id) return (MEMO_.ss = SpreadsheetApp.openById(id));
  const active = SpreadsheetApp.getActive();
  if (!active) throw new Error('ไม่รู้ว่าต้องใช้ชีตไหน: ตั้ง Script property ชื่อ SPREADSHEET_ID (Project Settings → Script properties)');
  return (MEMO_.ss = active);
}

function sheet_(key) {
  if (MEMO_.sheets[key]) return MEMO_.sheets[key];
  const def = SHEETS[key];
  if (!def) throw new Error('ไม่รู้จักตาราง ' + key);
  const sh = ss_().getSheetByName(def.name);
  if (!sh) throw new Error('ไม่พบแท็บ "' + def.name + '" กรุณารัน setup ก่อน');
  return (MEMO_.sheets[key] = sh);
}

/** ล้างแคชของตาราง (เรียกหลังเขียนข้อมูล) — ไม่ส่ง key = ล้างทั้งหมด */
function invalidate_(key) {
  if (key) delete MEMO_.tables[key];
  else { MEMO_.tables = {}; MEMO_.sheets = {}; }
}

/** อ่านทั้งตารางเป็น array ของ object (มี _row = เลขแถวในชีต) — ห้ามแก้ object ที่ได้มาโดยตรง */
function readTable_(key) {
  if (MEMO_.tables[key]) return MEMO_.tables[key];
  const out = readTableRaw_(key);
  MEMO_.tables[key] = out;
  return out;
}

function readTableRaw_(key) {
  const sh = sheet_(key);
  const headers = SHEETS[key].headers;
  const last = sh.getLastRow();
  if (last < 2) return [];
  const values = sh.getRange(2, 1, last - 1, headers.length).getValues();
  const out = [];
  values.forEach((r, i) => {
    if (!r.some(v => v !== '' && v !== null)) return;
    const o = { _row: i + 2 };
    headers.forEach((h, j) => { o[h] = r[j]; });
    out.push(o);
  });
  return out;
}

function rowOf_(key, obj) {
  return SHEETS[key].headers.map(h => (obj[h] === undefined || obj[h] === null ? '' : obj[h]));
}

function appendRows_(key, objs) {
  if (!objs.length) return;
  const sh = sheet_(key);
  const rows = objs.map(o => rowOf_(key, o));
  sh.getRange(sh.getLastRow() + 1, 1, rows.length, rows[0].length).setValues(rows);
  invalidate_(key);
}

/** แก้ไขแถวที่ idField = id (merge กับข้อมูลเดิม) */
function updateById_(key, idField, id, patch) {
  const found = readTable_(key).find(r => String(r[idField]) === String(id));
  if (!found) throw new Error('ไม่พบรายการ ' + id);
  const merged = Object.assign({}, found, patch);
  const row = rowOf_(key, merged);
  sheet_(key).getRange(found._row, 1, 1, row.length).setValues([row]);
  invalidate_(key);
  return merged;
}

/** ลบทุกแถวที่ตรงเงื่อนไข (ลบจากล่างขึ้นบน) คืนจำนวนที่ลบ */
function deleteWhere_(key, pred) {
  const sh = sheet_(key);
  const rows = readTable_(key).filter(pred).map(r => r._row).sort((a, b) => b - a);
  // ลบเป็นช่วงแถวติดกันทีเดียว (เร็วกว่าลบทีละแถว)
  for (let i = 0; i < rows.length;) {
    let j = i;
    while (j + 1 < rows.length && rows[j + 1] === rows[j] - 1) j++;
    sh.deleteRows(rows[j], j - i + 1);
    i = j + 1;
  }
  if (rows.length) invalidate_(key);
  return rows.length;
}

/** เขียนทับข้อมูลทั้งตาราง (ใช้กับหน้าตั้งค่า) */
function replaceTable_(key, objs) {
  const sh = sheet_(key);
  const n = SHEETS[key].headers.length;
  const last = sh.getLastRow();
  if (last >= 2) sh.getRange(2, 1, last - 1, n).clearContent();
  if (objs.length) {
    const rows = objs.map(o => rowOf_(key, o));
    sh.getRange(2, 1, rows.length, n).setValues(rows);
  }
  invalidate_(key);
}

function withLock_(fn) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ---------- ตัวช่วยแปลงค่า ---------- */

function num_(v) {
  if (typeof v === 'number') return isFinite(v) ? v : 0;
  if (v === null || v === undefined || v === '' || v === '-') return 0;
  const n = parseFloat(String(v).replace(/[,฿\s]/g, ''));
  return isFinite(n) ? n : 0;
}

/** ช่องว่าง = '' (ใช้กับค่าที่ "ไม่กรอก" ต่างจาก 0) */
/** ชื่อรายการย่อยแบบปกติ (ตัดเว้นวรรคทั้งหมด ไม่สนตัวพิมพ์) ใช้จับคู่แผนกับรายการจริง */
function normItem_(s) {
  return String(s || '').replace(/\s+/g, '').toLowerCase();
}

function optNum_(v) {
  if (v === null || v === undefined || v === '' || v === '-') return '';
  const n = num_(v);
  return n;
}

function isActive_(v) {
  return !(v === false || String(v).toUpperCase() === 'FALSE' || v === 0 || v === '0');
}

function newId_(prefix) {
  return prefix + Utilities.formatDate(new Date(), TZ, 'yyMMdd') + '-' + Utilities.getUuid().replace(/-/g, '').slice(0, 12);
}

/** Date → 'yyyy-MM-dd' */
function fmtDate_(d) {
  if (d instanceof Date && !isNaN(d)) return Utilities.formatDate(d, TZ, 'yyyy-MM-dd');
  if (typeof d === 'string' && /^\d{4}-\d{2}-\d{2}/.test(d)) return d.slice(0, 10);
  return '';
}

/** 'yyyy-MM-dd' → Date (เวลาเที่ยงวัน กันปัญหาโซนเวลา) */
function toDate_(s) {
  if (s instanceof Date) return s;
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(s || ''));
  if (!m) throw new Error('รูปแบบวันที่ไม่ถูกต้อง: ' + s);
  return new Date(+m[1], +m[2] - 1, +m[3], 12, 0, 0);
}

function optDate_(s) {
  return s ? toDate_(s) : '';
}

/** ค่าใดๆ → 'yyyy-MM' */
function monthStr_(v) {
  if (v instanceof Date && !isNaN(v)) return Utilities.formatDate(v, TZ, 'yyyy-MM');
  const s = String(v || '');
  const m = /^(\d{4})-(\d{2})/.exec(s);
  return m ? m[1] + '-' + m[2] : '';
}

/* ---------- รอบเดือน (ตามวันเงินเดือนออก) ----------
 * รอบตั้งชื่อตามเดือนที่รอบสิ้นสุด เช่น เริ่มวันที่ 27: 27 พ.ย. – 26 ธ.ค. = รอบ "ธ.ค."
 * ใช้กับภาพรวม งบ แผน แผน vs จริง · ภาษีใช้ปีปฏิทินตามวันที่ได้รับเงินจริงเสมอ */
function cycleStart_() {
  const d = Math.round(num_(getConfig_().CYCLE_START_DAY));
  return d >= 2 && d <= 28 ? d : 1;
}

/** วันที่ → รอบเดือน 'yyyy-MM' */
function cycleMonth_(v) {
  if (!(v instanceof Date)) return monthStr_(v);
  const m = monthStr_(v), s = cycleStart_();
  if (s <= 1) return m;
  return parseInt(Utilities.formatDate(v, TZ, 'dd'), 10) >= s ? addMonths_(m, 1) : m;
}

/** รอบเดือน + วันที่ของเดือน → วันที่จริง (เช่น รอบ ธ.ค. วันที่ 27 = 27 พ.ย.) */
function cycleDate_(month, day) {
  const s = cycleStart_();
  const m = s > 1 && day >= s ? addMonths_(month, -1) : month;
  const d = Math.min(Math.max(1, day), daysInMonth_(m));
  return toDate_(m + '-' + ('0' + d).slice(-2));
}

function addMonths_(month, delta) {
  const y = +month.slice(0, 4), m = +month.slice(5, 7) - 1 + delta;
  const d = new Date(y, m, 1, 12);
  return Utilities.formatDate(d, TZ, 'yyyy-MM');
}

function daysInMonth_(month) {
  return new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate();
}

function round2_(n) {
  return Math.round(n * 100) / 100;
}
