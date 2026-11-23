/**
 * ===== นำเข้าข้อมูลจากแท็บเดิม (อ่านอย่างเดียว ไม่แก้แท็บเดิม) =====
 *
 * - Income            → รายรับรายเดือน (ลงวันที่ 1 ของเดือน)
 * - เทมเพลท รายได้/รายจ่าย → เฉพาะเดือนที่ยังไม่มีข้อมูลจาก Income / Expen Life
 * - Expen Life        → รายจ่ายรายเดือน + เงินออม (Save) เข้าหน้าลงทุน
 *                        นำเข้าเฉพาะเดือนที่ไม่เกินเดือนปัจจุบัน (แถวอนาคตเป็นแผน ไม่ใช่ของจริง)
 * - ข้อมูลการยืม + ตารางผ่อน → เงินให้ยืม
 * - Tax               → ค่าลดหย่อน/ภาษีหัก ณ ที่จ่าย ของปีที่ผ่านมาและปีปัจจุบัน
 *
 * ทุกรายการที่นำเข้ามี Source ขึ้นต้นด้วย "import:" จึงลบทิ้งแล้วนำเข้าใหม่ได้
 * ถ้าโครงสร้างคอลัมน์ในแท็บเดิมเปลี่ยน ให้แก้ตาราง map ด้านล่าง
 */

const LEGACY = {
  income: {
    sheet: 'Income',
    account: 'Kbank',
    columns: {
      D: 'เงินเดือน', E: 'โบนัส', F: 'รายได้เสริม', G: 'รายได้เสริม',
      H: 'เงินปันผล', I: 'เงินปันผล', J: 'เงินคืนประกัน',
    },
  },
  expenLife: {
    sheet: 'Expen Life',
    nameRow: 7,     // แถวชื่อรายการ
    altNameRow: 6,  // ถ้าแถวชื่อว่าง ใช้ชื่อจากแถวนี้
    // คอลัมน์: [หมวด, บัญชี]
    expense: {
      E: ['บิลโทรศัพท์/เน็ต', 'Kbank'], F: ['บิลโทรศัพท์/เน็ต', 'Kbank'],
      G: ['บิลโทรศัพท์/เน็ต', 'Kbank'], H: ['บิลโทรศัพท์/เน็ต', 'Kbank'],
      I: ['Subscription', 'Kbank'], J: ['Subscription', 'Kbank'], K: ['Subscription', 'Kbank'],
      L: ['Subscription', 'Kbank'], M: ['Subscription', 'Kbank'],
      N: ['อาหาร/ชีวิตประจำวัน', 'Kbank'], O: ['อาหาร/ชีวิตประจำวัน', 'Kbank'], P: ['อาหาร/ชีวิตประจำวัน', 'Kbank'],
      S: ['เดินทาง', 'K-next'], T: ['เดินทาง', 'K-next'], U: ['เดินทาง', 'K-next'], V: ['เดินทาง', 'K-next'],
      Y: ['ประกัน/สุขภาพ', 'หักเงินเดือน'], Z: ['ประกัน/สุขภาพ', 'K-next'], AA: ['ประกัน/สุขภาพ', 'K-next'],
      AD: ['หนี้สิน/ผ่อน', 'K-next'], AE: ['หนี้สิน/ผ่อน', 'K-next'], AF: ['หนี้สิน/ผ่อน', 'K-next'],
      AG: ['หนี้สิน/ผ่อน', 'หักเงินเดือน'], AH: ['หนี้สิน/ผ่อน', 'KTC'], AI: ['หนี้สิน/ผ่อน', 'Card x'],
      AR: ['สันทนาการ/อื่นๆ', 'Make'], AS: ['สันทนาการ/อื่นๆ', 'Make'], AT: ['สันทนาการ/อื่นๆ', 'Make'],
      AU: ['สันทนาการ/อื่นๆ', 'Shopee PayLater'],
      AX: ['ภาษี', 'หักเงินเดือน'],
    },
    // คอลัมน์เงินออม: [กอง, บัญชี]
    saving: {
      AL: ['พอร์ตลงทุน/เกษียณ', 'Dime'], AM: ['เงินสำรองฉุกเฉิน', 'Dime'],
      AN: ['ประกันออมทรัพย์ FWD', 'Card x'], AO: ['ออมอื่นๆ', 'Dime'],
    },
  },
  incomeTemplatePrefix: 'เทมเพลท รายได้',
  expenseTemplatePrefix: 'เทมเพลท รายจ่าย',
  templateIncomeCategory: { 'ประจำ': 'เงินเดือน', 'เพิ่มเติม': 'รายได้เสริม' },
  loans: 'ข้อมูลการยืม',
  loanPayments: 'ตารางผ่อน',
  tax: 'Tax',
};

function importLegacy() {
  return withLock_(() => {
    ensureSheets_();
    seedDefaults_();
    const cfg = getConfig_();
    if (cfg.IMPORT_DONE) {
      return 'นำเข้าไปแล้วเมื่อ ' + cfg.IMPORT_DONE + '\nถ้าต้องการนำเข้าใหม่ ให้เลือกเมนู "ลบข้อมูลที่นำเข้า" ก่อน';
    }
    const ss = ss_();
    const lastMonth = monthStr_(new Date());
    const report = [];
    const tx = [];
    const contrib = [];

    const incomeMonths = importIncome_(ss, lastMonth, tx, report);
    const expenseMonths = importExpenLife_(ss, lastMonth, tx, contrib, report);
    importTemplates_(ss, lastMonth, incomeMonths, expenseMonths, tx, report);

    const now = new Date();
    tx.forEach(t => { t.ID = newId_('T'); t.CreatedAt = now; });
    appendRows_('tx', tx);
    appendRows_('contributions', contrib);
    ensureCategories_(tx);

    importLoans_(ss, report);
    importTax_(ss, report);

    setConfig_('IMPORT_DONE', Utilities.formatDate(now, TZ, 'yyyy-MM-dd HH:mm'));
    return 'นำเข้าข้อมูลเก่าเสร็จ\n' + report.join('\n');
  });
}

function removeImported() {
  return withLock_(() => {
    ensureReady_();
    const isImp = r => String(r.Source || '').indexOf('import') === 0;
    const a = deleteWhere_('tx', isImp);
    const b = deleteWhere_('contributions', isImp);
    const c = deleteWhere_('loans', r => String(r.Note || '').indexOf('[import]') >= 0);
    const loanIds = readTable_('loans').map(r => String(r.LoanID));
    const d = deleteWhere_('loanPayments', r => String(r.Note || '').indexOf('[import]') >= 0 || loanIds.indexOf(String(r.LoanID)) < 0);
    const e = deleteWhere_('tax', r => String(r.Note || '').indexOf('[import]') >= 0);
    const f = deleteWhere_('plan', r => String(r.Source || '') === 'import');
    setConfig_('IMPORT_DONE', '');
    setConfig_('PLAN_IMPORT_DONE', '');
    return 'ลบข้อมูลที่นำเข้าแล้ว: รายรับ-รายจ่าย ' + a + ', เงินออม ' + b + ', เงินให้ยืม ' + c +
      ', งวดผ่อน ' + d + ', ภาษี ' + e + ', แผน ' + f + ' ช่อง';
  });
}

/* ---------- ตัวช่วย ---------- */

function colIndex_(letters) {
  let n = 0;
  for (let i = 0; i < letters.length; i++) n = n * 26 + (letters.charCodeAt(i) - 64);
  return n - 1;
}

function legacySheet_(ss, name) {
  const sh = ss.getSheetByName(name);
  return sh ? sh.getDataRange().getValues() : null;
}

/** หาแถวหัวตาราง: แถวแรกที่คอลัมน์ col มีข้อความ text */
function findRow_(values, col, text, maxRow) {
  for (let r = 0; r < Math.min(values.length, maxRow || 30); r++) {
    if (String(values[r][col]).trim() === text) return r;
  }
  return -1;
}

function firstOfMonth_(d) {
  return new Date(d.getFullYear(), d.getMonth(), 1, 12);
}

function isMoney_(v) {
  return typeof v === 'number' && isFinite(v) && v !== 0;
}

function ensureCategories_(tx) {
  const have = {};
  readTable_('categories').forEach(c => { have[c.Type + '|' + c.Name] = true; });
  const add = [];
  tx.forEach(t => {
    const k = t.Type + '|' + t.Category;
    if (!have[k]) { have[k] = true; add.push({ Type: t.Type, Name: t.Category, MonthlyBudget: '', Active: true }); }
  });
  appendRows_('categories', add);
}

/* ---------- แต่ละแท็บ ---------- */

function importIncome_(ss, lastMonth, tx, report) {
  const months = {};
  const v = legacySheet_(ss, LEGACY.income.sheet);
  if (!v) { report.push('- ไม่พบแท็บ ' + LEGACY.income.sheet); return months; }
  const head = findRow_(v, 2, 'เดือน-ปี');
  if (head < 0) { report.push('- แท็บ Income: ไม่พบหัวตาราง "เดือน-ปี"'); return months; }
  let n = 0;
  for (let r = head + 1; r < v.length; r++) {
    const d = v[r][2];
    if (!(d instanceof Date) || monthStr_(d) > lastMonth) continue;
    Object.keys(LEGACY.income.columns).forEach(col => {
      const val = v[r][colIndex_(col)];
      if (!isMoney_(val)) return;
      const name = String(v[head][colIndex_(col)] || '').trim();
      tx.push({
        Date: firstOfMonth_(d), Type: INCOME, Category: LEGACY.income.columns[col], Amount: round2_(val),
        Account: LEGACY.income.account, Note: name, Source: 'import:Income',
      });
      months[monthStr_(d)] = true;
      n++;
    });
  }
  report.push('- รายรับจาก Income: ' + n + ' รายการ');
  return months;
}

function importExpenLife_(ss, lastMonth, tx, contrib, report) {
  const months = {};
  const cfg = LEGACY.expenLife;
  const v = legacySheet_(ss, cfg.sheet);
  if (!v) { report.push('- ไม่พบแท็บ ' + cfg.sheet); return months; }
  const nameRow = v[cfg.nameRow - 1] || [];
  const altRow = v[cfg.altNameRow - 1] || [];
  const nameOf = c => String(nameRow[c] || altRow[c] || '').trim();
  const funds = {};
  readTable_('funds').forEach(f => { funds[f.Name] = f; });
  let nTx = 0, nSave = 0;
  for (let r = cfg.nameRow; r < v.length; r++) {
    const d = v[r][2];
    if (!(d instanceof Date) || monthStr_(d) > lastMonth) continue;
    const date = firstOfMonth_(d);
    Object.keys(cfg.expense).forEach(col => {
      const c = colIndex_(col);
      const val = v[r][c];
      if (!isMoney_(val)) return;
      tx.push({
        Date: date, Type: EXPENSE, Category: cfg.expense[col][0], Amount: round2_(val),
        Account: cfg.expense[col][1], Note: nameOf(c) || 'อื่นๆ', Source: 'import:ExpenLife',
      });
      months[monthStr_(d)] = true;
      nTx++;
    });
    const batch = 'B-import-' + monthStr_(d);
    Object.keys(cfg.saving).forEach(col => {
      const c = colIndex_(col);
      const val = v[r][c];
      if (!isMoney_(val)) return;
      const fund = cfg.saving[col][0];
      const cur = (funds[fund] && funds[fund].Currency) || 'THB';
      contrib.push({
        ID: newId_('C'), BatchID: batch, Date: date, Fund: fund, Currency: cur,
        AmountFX: round2_(val), Rate: 1, AmountTHB: round2_(val), Account: cfg.saving[col][1],
        Note: nameOf(c), Source: 'import:ExpenLife',
      });
      nSave++;
    });
  }
  report.push('- รายจ่ายจาก Expen Life: ' + nTx + ' รายการ, เงินออม: ' + nSave + ' รายการ');
  return months;
}

function importTemplates_(ss, lastMonth, incomeMonths, expenseMonths, tx, report) {
  ss.getSheets().forEach(sh => {
    const name = sh.getName();
    const isIncome = name.indexOf(LEGACY.incomeTemplatePrefix) === 0;
    const isExpense = name.indexOf(LEGACY.expenseTemplatePrefix) === 0;
    if (!isIncome && !isExpense) return;
    const v = sh.getDataRange().getValues();
    const head = findRow_(v, 0, 'หมวด');
    if (head < 0) return;
    const skip = isIncome ? incomeMonths : expenseMonths;
    let n = 0;
    for (let r = head + 1; r < v.length; r++) {
      const group = String(v[r][0] || '').trim();
      if (group === 'รวม') break;
      for (let c = 3; c < v[head].length; c++) {
        const d = v[head][c];
        if (!(d instanceof Date)) continue;
        const m = monthStr_(d);
        if (m > lastMonth || skip[m]) continue;
        const val = v[r][c];
        if (!isMoney_(val)) continue;
        const category = isIncome ? (LEGACY.templateIncomeCategory[group] || 'อื่นๆ') : (group || 'อื่นๆ');
        tx.push({
          Date: firstOfMonth_(d), Type: isIncome ? INCOME : EXPENSE, Category: category,
          Amount: round2_(val), Account: String(v[r][2] || '').trim(),
          Note: String(v[r][1] || group).trim(), Source: 'import:' + name,
        });
        n++;
      }
    }
    report.push('- ' + name + ': ' + n + ' รายการ');
  });
}

function importLoans_(ss, report) {
  const v = legacySheet_(ss, LEGACY.loans);
  if (!v) { report.push('- ไม่พบแท็บ ' + LEGACY.loans); return; }
  const have = {};
  readTable_('loans').forEach(l => { have[String(l.LoanID)] = true; });
  const loans = [];
  for (let r = 1; r < v.length; r++) {
    const id = String(v[r][1] || '').trim();
    if (!id || have[id]) continue;
    const rate = v[r][5];
    let type = 'none', ratePct = '', note = '';
    if (typeof rate === 'number') {
      if (rate > 0) { type = 'percent'; ratePct = rate <= 1 ? round2_(rate * 100) : rate; }
    } else if (String(rate).trim()) {
      type = 'other'; note = String(rate).trim();
    }
    const oldStatus = String(v[r][9] || '').trim();
    const extra = oldStatus && oldStatus !== 'ผ่อนชำระ' && oldStatus !== LOAN_CLOSED ? ' (สถานะเดิม: ' + oldStatus + ')' : '';
    loans.push({
      LoanID: id, Borrower: String(v[r][0] || '').trim(), Date: v[r][2] instanceof Date ? v[r][2] : '',
      Principal: num_(v[r][3]), SourceAccount: String(v[r][4] || '').trim(),
      InterestType: type, InterestRate: ratePct, InterestNote: note,
      DueDate: v[r][7] instanceof Date ? v[r][7] : '',
      PayAccountNo: v[r][10] === '-' ? '' : String(v[r][10] || ''), Bank: String(v[r][11] || '').trim(),
      Note: (String(v[r][12] || '').trim() + extra + ' [import]').trim(),
      Closed: oldStatus === LOAN_CLOSED,
    });
    have[id] = true;
  }
  appendRows_('loans', loans);

  const p = legacySheet_(ss, LEGACY.loanPayments);
  const pays = [];
  if (p) {
    for (let r = 1; r < p.length; r++) {
      const id = String(p[r][1] || '').trim();
      if (!id || !(p[r][2] instanceof Date)) continue;
      pays.push({
        ID: newId_('P'), LoanID: id, Date: p[r][2], Total: num_(p[r][3]), Interest: num_(p[r][4]),
        Principal: num_(p[r][5]), Note: (String(p[r][8] || '').trim() + ' [import]').trim(),
      });
    }
    appendRows_('loanPayments', pays);
  }
  report.push('- เงินให้ยืม: ' + loans.length + ' รายการ, งวดรับชำระ: ' + pays.length + ' รายการ');
}

function importTax_(ss, report) {
  const v = legacySheet_(ss, LEGACY.tax);
  if (!v) { report.push('- ไม่พบแท็บ ' + LEGACY.tax); return; }
  const head = findRow_(v, 0, 'Year');
  if (head < 0) return;
  const thisYear = new Date().getFullYear();
  const have = {};
  readTable_('tax').forEach(t => { have[String(t.Year)] = true; });
  const rows = [];
  for (let r = head + 1; r < v.length; r++) {
    const y = v[r][0];
    if (typeof y !== 'number' || y > thisYear || have[String(y)]) continue;
    rows.push({
      Year: y,
      // ปีที่ผ่านไปแล้ว: เก็บรายได้ทั้งปีตามตารางเดิมไว้เป็นค่าแก้เอง (ข้อมูลรายการรายวันไม่ครบทั้งปี)
      IncomeOverride: y < thisYear ? optNum_(v[r][1]) : '',
      Withheld: optNum_(v[r][2]),
      Ded_Expense: optNum_(v[r][3]), Ded_Personal: optNum_(v[r][4]), Ded_Family: optNum_(v[r][5]),
      Ded_Insurance: optNum_(v[r][6]), Ded_SocialSecurity: optNum_(v[r][7]), Ded_Fund: optNum_(v[r][8]),
      Ded_Other: optNum_(v[r][9]), Ded_Property: optNum_(v[r][10]), TaxOverride: '', Note: '[import]',
    });
  }
  appendRows_('tax', rows);
  report.push('- ภาษี: ' + rows.length + ' ปี');
}
