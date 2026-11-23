/**
 * ===== ติดตั้งครั้งแรก + เมนูในชีต =====
 */

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('💰 แอปการเงิน')
    .addItem('1) ติดตั้ง / สร้างแท็บของแอป', 'setup')
    .addItem('2) นำเข้าข้อมูลเก่า', 'importLegacyMenu')
    .addItem('3) นำเข้าแผนล่วงหน้าจาก Expen Life', 'importPlanMenu')
    .addSeparator()
    .addItem('ลบข้อมูลที่นำเข้า (เพื่อนำเข้าใหม่)', 'removeImportedMenu')
    .addItem('เปิดเว็บแอป', 'showWebAppLink')
    .addToUi();
}

/** สร้างแท็บที่ขาด + ใส่ค่าเริ่มต้นในแท็บที่ยังว่าง (รันซ้ำได้ ไม่ทับข้อมูลเดิม) */
function setup() {
  const created = ensureSheets_();
  const seeded = seedDefaults_();
  const msg = 'ติดตั้งเสร็จ\n' +
    (created.length ? 'สร้างแท็บใหม่: ' + created.join(', ') + '\n' : 'แท็บครบอยู่แล้ว\n') +
    (seeded.length ? 'ใส่ค่าเริ่มต้นใน: ' + seeded.join(', ') : '');
  notify_(msg);
  return msg;
}

function ensureSheets_() {
  const ss = ss_();
  const created = [];
  Object.keys(SHEETS).forEach(key => {
    const def = SHEETS[key];
    let sh = ss.getSheetByName(def.name);
    if (!sh) {
      sh = ss.insertSheet(def.name);
      created.push(def.name);
    }
    const head = sh.getRange(1, 1, 1, def.headers.length);
    head.setValues([def.headers]).setFontWeight('bold').setBackground('#e8f0fe');
    sh.setFrozenRows(1);
    (def.text || []).forEach(col => {
      const c = def.headers.indexOf(col) + 1;
      sh.getRange(2, c, sh.getMaxRows() - 1, 1).setNumberFormat('@');
    });
  });
  return created;
}

function seedDefaults_() {
  const seeded = [];
  ['config', 'categories', 'accounts', 'funds', 'taxBrackets', 'healthItems'].forEach(key => {
    if (key === 'config') {
      const have = readTable_('config').map(r => r.Key);
      const missing = DEFAULTS.config.filter(r => have.indexOf(r.Key) < 0);
      if (missing.length) { appendRows_('config', missing); seeded.push(SHEETS.config.name); }
      return;
    }
    if (readTable_(key).length === 0) {
      appendRows_(key, DEFAULTS[key]);
      seeded.push(SHEETS[key].name);
    }
  });
  return seeded;
}

function importLegacyMenu() {
  notify_(importLegacy());
}

function importPlanMenu() {
  notify_(importLegacyPlan());
}

function removeImportedMenu() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert('ลบข้อมูลที่นำเข้าจากแท็บเดิมทั้งหมด?',
    'จะลบเฉพาะรายการที่มาจากการนำเข้า (Source ขึ้นต้นด้วย import) รายการที่บันทึกเองไม่ถูกลบ',
    ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  notify_(removeImported());
}

function showWebAppLink() {
  let url = '';
  try { url = ScriptApp.getService().getUrl(); } catch (e) { /* ยังไม่ได้ deploy */ }
  const html = url
    ? '<p style="font-family:sans-serif">เปิดเว็บแอป: <a href="' + url + '" target="_blank">' + url + '</a></p>'
    : '<p style="font-family:sans-serif">ยังไม่ได้ Deploy เป็นเว็บแอป ดูขั้นตอนใน README</p>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(480).setHeight(120), 'เว็บแอป');
}

function notify_(msg) {
  Logger.log(msg);
  try { SpreadsheetApp.getUi().alert(msg); } catch (e) { /* รันจาก editor/trigger ไม่มี UI */ }
}

/** หาโฟลเดอร์เก็บไฟล์แนบ (สร้างถ้ายังไม่มี) */
function filesFolder_(kind) {
  const cfg = getConfig_();
  let root = null;
  if (cfg.DRIVE_FOLDER_ID) {
    try { root = DriveApp.getFolderById(cfg.DRIVE_FOLDER_ID); } catch (e) { root = null; }
  }
  if (!root) {
    root = DriveApp.createFolder('แอปการเงิน - ไฟล์แนบ');
    setConfig_('DRIVE_FOLDER_ID', root.getId());
  }
  const name = kind === 'health' ? 'ผลตรวจสุขภาพ' : 'ใบเสร็จ';
  const it = root.getFoldersByName(name);
  return it.hasNext() ? it.next() : root.createFolder(name);
}

function getConfig_() {
  const out = {};
  // ค่าเริ่มต้นสำหรับคีย์ที่ยังไม่มีในแท็บ (เช่น หลังอัปเดตโค้ดเวอร์ชันใหม่)
  DEFAULTS.config.forEach(d => { if (String(d.Value).charAt(0) !== '=') out[d.Key] = d.Value; });
  readTable_('config').forEach(r => { out[r.Key] = r.Value; });
  return out;
}

/** สร้างแท็บ/ค่าตั้งค่าที่ขาดอัตโนมัติ (หลังอัปเดตโค้ดไม่ต้องรัน setup เอง) */
function ensureReady_() {
  const ss = ss_();
  const missing = Object.keys(SHEETS).some(k => !ss.getSheetByName(SHEETS[k].name));
  if (missing) ensureSheets_();
  if (!ss.getSheetByName(SHEETS.config.name)) return;
  const have = readTable_('config').map(r => r.Key);
  const add = DEFAULTS.config.filter(r => have.indexOf(r.Key) < 0);
  if (add.length) appendRows_('config', add);
}

function setConfig_(key, value) {
  const found = readTable_('config').find(r => r.Key === key);
  if (found) updateById_('config', 'Key', key, { Value: value });
  else appendRows_('config', [{ Key: key, Value: value, Description: '' }]);
}
