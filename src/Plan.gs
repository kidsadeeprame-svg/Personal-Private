/**
 * ===== แผนรายจ่ายล่วงหน้า / คาดการณ์ / แผนผ่อน =====
 *
 * แผนรายเดือน: ค่าตั้งต้นคำนวณอัตโนมัติ แล้ว "ช่องที่แก้เอง" เก็บในแท็บ App_Plan
 *   - รายรับ: เงินเดือน (ขึ้นตาม % ต่อปีในเดือนที่กำหนด) + โบนัส + รายการประจำหมวดอื่น
 *   - รายจ่าย: งบ/เดือนของหมวด (ถ้าไม่ได้ตั้งงบ ใช้ผลรวมรายการประจำ)
 *   - งวดผ่อน: แถวแยกของแต่ละรายการผ่อน (คำนวณจากแผนผ่อน แก้ในตารางไม่ได้) นับรวมในยอดรายจ่าย
 *   - เงินออม: เป้า % ของรายรับตามแผน
 */

function planSettings_() {
  const c = getConfig_();
  return {
    baseSalary: num_(c.BASE_SALARY),
    growth: num_(c.SALARY_GROWTH_PCT) / 100,
    raiseMonth: num_(c.SALARY_RAISE_MONTH) || 5,
    bonusMonths: num_(c.BONUS_MONTHS),
    bonusMonth: num_(c.BONUS_MONTH) || 4,
    inflation: num_(c.INFLATION_PCT) / 100,
    ret: num_(c.RETURN_PCT) / 100,
    birthYear: num_(c.BIRTH_YEAR),
    retireAge: num_(c.RETIRE_AGE) || 60,
    savingPct: num_(c.SAVING_RATE_TARGET) || 20,
    target: num_(c.TARGET_RETIREMENT),
  };
}

function monthRange_(start, count) {
  const out = [];
  for (let i = 0; i < count; i++) out.push(addMonths_(start, i));
  return out;
}

/** เงินเดือนล่าสุดจากรายการรายรับหมวดเงินเดือน */
function latestSalary_(tx) {
  const s = tx.filter(t => t.Type === INCOME && String(t.Category) === SALARY_CATEGORY && num_(t.Amount) > 0)
    .sort((a, b) => fmtDate_(b.Date).localeCompare(fmtDate_(a.Date)))[0];
  return s ? num_(s.Amount) : 0;
}

/** เงินเดือนของเดือน m: ขึ้นทุกครั้งที่ผ่านเดือนขึ้นเงินเดือนหลังเดือนปัจจุบัน */
function salaryAt_(s, base, m) {
  const now = monthStr_(new Date());
  let raises = 0;
  for (let x = addMonths_(now, 1); x <= m; x = addMonths_(x, 1)) {
    if (+x.slice(5, 7) === s.raiseMonth) raises++;
  }
  return base * Math.pow(1 + s.growth, raises);
}

/* ---------- แผนผ่อน ---------- */

function installments_() {
  const tx = readTable_('tx');
  return readTable_('installments').map(r => {
    const id = String(r.ID);
    const months = Math.max(1, num_(r.Months));
    const monthly = num_(r.Monthly) || round2_(num_(r.Total) / months);
    const start = monthStr_(r.StartMonth);
    const paid = tx.filter(t => String(t.Source) === 'installment:' + id);
    const paidMonths = {};
    paid.forEach(t => { paidMonths[monthStr_(t.Date)] = true; });
    const paidAmount = paid.reduce((a, t) => a + num_(t.Amount), 0);
    const end = addMonths_(start, months - 1);
    return {
      ID: id, Name: String(r.Name), Total: num_(r.Total), Months: months, StartMonth: start, EndMonth: end,
      Monthly: monthly, Category: String(r.Category || ''), Account: String(r.Account || ''),
      DayOfMonth: num_(r.DayOfMonth) || 1, Note: String(r.Note || ''),
      paidCount: paid.length, paidAmount: round2_(paidAmount),
      remaining: round2_(Math.max(0, num_(r.Total) - paidAmount)), paidMonths,
      done: paid.length >= months || paidAmount >= num_(r.Total) - 0.01,
    };
  });
}

function installmentActive_(i, m) {
  return m >= i.StartMonth && m <= i.EndMonth;
}

function apiInstallments_(month) {
  month = month || monthStr_(new Date());
  return installments_().map(i => Object.assign({}, i, {
    dueThisMonth: installmentActive_(i, month) && !i.paidMonths[month] && !i.done,
    paidMonths: Object.keys(i.paidMonths).sort(),
  }));
}

function apiSaveInstallment_(r) {
  if (!r.Name) throw new Error('กรุณาใส่ชื่อรายการ');
  const months = Math.round(num_(r.Months));
  if (months < 1) throw new Error('จำนวนงวดต้องมากกว่า 0');
  if (!monthStr_(r.StartMonth)) throw new Error('กรุณาเลือกเดือนเริ่มผ่อน');
  if (!r.Category) throw new Error('กรุณาเลือกหมวด');
  const total = num_(r.Total);
  const row = {
    Name: r.Name, Total: total, Months: months, StartMonth: monthStr_(r.StartMonth),
    Monthly: num_(r.Monthly) || round2_(total / months), Category: r.Category, Account: r.Account || '',
    DayOfMonth: Math.min(31, Math.max(1, num_(r.DayOfMonth) || 1)), Note: r.Note || '',
  };
  if (r.ID) return updateById_('installments', 'ID', r.ID, row);
  row.ID = newId_('I');
  appendRows_('installments', [row]);
  return row;
}

function apiDeleteInstallment_(id) {
  return deleteWhere_('installments', r => String(r.ID) === String(id));
}

/** บันทึกงวดผ่อนของเดือนเป็นรายจ่ายจริง (ข้ามงวดที่บันทึกเดือนนั้นแล้ว) */
function apiPostInstallments_(ids, month, amounts) {
  month = month || monthStr_(new Date());
  amounts = amounts || {};
  const now = new Date();
  const tx = [];
  installments_().filter(i => ids.indexOf(i.ID) >= 0).forEach(i => {
    if (i.done || i.paidMonths[month] || !installmentActive_(i, month)) return;
    const amount = amounts[i.ID] !== undefined ? num_(amounts[i.ID]) : Math.min(i.Monthly, i.remaining || i.Monthly);
    if (!amount) return;
    const day = Math.min(i.DayOfMonth, daysInMonth_(month));
    tx.push({
      ID: newId_('T'), Date: toDate_(month + '-' + ('0' + day).slice(-2)), Type: EXPENSE, Category: i.Category,
      Amount: amount, Account: i.Account, Note: i.Name + ' (งวด ' + (i.paidCount + 1) + '/' + i.Months + ')',
      ReceiptUrl: '', Source: 'installment:' + i.ID, CreatedAt: now,
    });
  });
  appendRows_('tx', tx);
  return tx.length;
}

/* ---------- แผนรายเดือน ---------- */

function planOverrides_() {
  const o = {};
  readTable_('plan').forEach(p => {
    o[monthStr_(p.Month) + '|' + p.Type + '|' + p.Category] = { amount: num_(p.Amount), source: String(p.Source || '') };
  });
  return o;
}

/**
 * คำนวณแผนของหลายเดือน
 * คืน { months, savingPct, rows:[{type, category, label?, installment?, cells:[{v, def, own, readonly?}]}] }
 */
function buildPlan_(months) {
  const s = planSettings_();
  const tx = readTable_('tx');
  const base = s.baseSalary || latestSalary_(tx);
  const cats = readTable_('categories').filter(c => isActive_(c.Active));
  const rec = readTable_('recurring').filter(r => isActive_(r.Active));
  const inst = installments_();
  const ov = planOverrides_();

  const incomeCats = cats.filter(c => c.Type === INCOME).map(c => String(c.Name));
  const expenseCats = cats.filter(c => c.Type === EXPENSE).map(c => String(c.Name));
  if (base && incomeCats.indexOf(SALARY_CATEGORY) < 0) incomeCats.unshift(SALARY_CATEGORY);
  if (base && s.bonusMonths && incomeCats.indexOf(BONUS_CATEGORY) < 0) incomeCats.splice(1, 0, BONUS_CATEGORY);
  // หมวดที่มีแต่ในแผนที่แก้เอง/นำเข้า
  Object.keys(ov).forEach(k => {
    const parts = k.split('|');
    if (months.indexOf(parts[0]) < 0) return;
    if (parts[1] === INCOME && incomeCats.indexOf(parts[2]) < 0) incomeCats.push(parts[2]);
    if (parts[1] === EXPENSE && expenseCats.indexOf(parts[2]) < 0) expenseCats.push(parts[2]);
  });
  const budget = {};
  cats.filter(c => c.Type === EXPENSE).forEach(c => { budget[String(c.Name)] = num_(c.MonthlyBudget); });
  const recSum = (type, cat) => rec.filter(r => r.Type === type && String(r.Category) === cat).reduce((a, r) => a + num_(r.Amount), 0);

  const cell = (m, type, cat, def) => {
    const o = ov[m + '|' + type + '|' + cat];
    return o ? { v: o.amount, def: round2_(def), own: true, src: o.source } : { v: round2_(def), def: round2_(def), own: false };
  };

  const incomeRows = incomeCats.map(cat => ({
    type: INCOME, category: cat,
    cells: months.map(m => {
      let def;
      if (cat === SALARY_CATEGORY && base) def = salaryAt_(s, base, m);
      else if (cat === BONUS_CATEGORY && base) def = (+m.slice(5, 7) === s.bonusMonth ? s.bonusMonths * salaryAt_(s, base, m) : 0) + recSum(INCOME, cat);
      else def = recSum(INCOME, cat);
      return cell(m, INCOME, cat, def);
    }),
  }));

  const expenseRows = expenseCats.map(cat => ({
    type: EXPENSE, category: cat,
    cells: months.map(m => cell(m, EXPENSE, cat, budget[cat] > 0 ? budget[cat] : recSum(EXPENSE, cat))),
  }));

  // งวดผ่อน: งวดที่บันทึกจ่ายจริงแล้วยังนับในแผนของเดือนนั้น (เพื่อเทียบแผน vs จริง) จนกว่าจะผ่อนครบ
  const instRows = inst.filter(i => months.some(m => installmentActive_(i, m))).map(i => ({
    type: EXPENSE, category: i.Category, installment: i.ID, label: 'ผ่อน: ' + i.Name,
    cells: months.map(m => {
      const v = installmentActive_(i, m) && (!i.done || i.paidMonths[m]) ? i.Monthly : 0;
      return { v: v, def: v, own: false, readonly: true };
    }),
  }));

  const savingRow = {
    type: PLAN_SAVING_TYPE, category: PLAN_SAVING,
    cells: months.map((m, i) => {
      const inc = incomeRows.reduce((a, r) => a + r.cells[i].v, 0);
      return cell(m, PLAN_SAVING_TYPE, PLAN_SAVING, inc * s.savingPct / 100);
    }),
  };

  return {
    months, savingPct: s.savingPct,
    rows: incomeRows.concat(expenseRows, instRows, [savingRow]),
  };
}

function planTotals_(plan) {
  return plan.months.map((m, i) => {
    const sum = type => plan.rows.filter(r => r.type === type).reduce((a, r) => a + r.cells[i].v, 0);
    const income = sum(INCOME), expense = sum(EXPENSE), saving = sum(PLAN_SAVING_TYPE);
    return { month: m, income: round2_(income), expense: round2_(expense), saving: round2_(saving), remaining: round2_(income - expense - saving) };
  });
}

function apiPlan_(start, count) {
  start = monthStr_(start) || monthStr_(new Date());
  count = Math.min(36, Math.max(1, num_(count) || 12));
  const plan = buildPlan_(monthRange_(start, count));
  plan.totals = planTotals_(plan);
  plan.planImportDone = !!getConfig_().PLAN_IMPORT_DONE;
  return plan;
}

/** แก้ช่องแผน 1 ช่อง: amount = '' คือกลับไปใช้ค่าตั้งต้น */
function apiSavePlanCell_(month, type, category, amount) {
  month = monthStr_(month);
  if (!month || !category) throw new Error('ข้อมูลไม่ครบ');
  if ([INCOME, EXPENSE, PLAN_SAVING_TYPE].indexOf(type) < 0) throw new Error('ประเภทไม่ถูกต้อง');
  deleteWhere_('plan', r => monthStr_(r.Month) === month && r.Type === type && String(r.Category) === category);
  if (amount !== '' && amount !== null && amount !== undefined) {
    appendRows_('plan', [{ Month: month, Type: type, Category: category, Amount: num_(amount), Source: 'manual' }]);
  }
  return true;
}

/** ล้างค่าที่แก้เองของทั้งเดือน (กลับไปใช้ค่าตั้งต้น) */
function apiResetPlanMonth_(month) {
  month = monthStr_(month);
  return deleteWhere_('plan', r => monthStr_(r.Month) === month);
}

/* ---------- แผน vs จริง ---------- */

/** period: 'yyyy-MM' (รายเดือน) หรือ 'yyyy' (ทั้งปี ถึงเดือนปัจจุบัน) */
function apiPlanVsActual_(period) {
  period = String(period || monthStr_(new Date()));
  const now = monthStr_(new Date());
  const months = period.length === 4
    ? monthRange_(period + '-01', 12).filter(m => m <= now)
    : [monthStr_(period)];
  const plan = buildPlan_(months);
  const agg = aggregateByMonth_();
  const rows = {};
  const key = (t, c) => t + '|' + c;
  plan.rows.forEach(r => {
    const k = key(r.type, r.category);
    rows[k] = rows[k] || { type: r.type, category: r.category, plan: 0, actual: 0 };
    rows[k].plan += r.cells.reduce((a, c) => a + c.v, 0);
  });
  months.forEach(m => {
    const a = agg[m];
    if (!a) return;
    Object.keys(a.byCat).forEach(k => {
      const [t, c] = k.split('|');
      rows[k] = rows[k] || { type: t, category: c, plan: 0, actual: 0 };
      rows[k].actual += a.byCat[k];
    });
    const sk = key(PLAN_SAVING_TYPE, PLAN_SAVING);
    rows[sk] = rows[sk] || { type: PLAN_SAVING_TYPE, category: PLAN_SAVING, plan: 0, actual: 0 };
    rows[sk].actual += a.saving;
  });
  const list = Object.keys(rows).map(k => rows[k])
    .filter(r => r.plan || r.actual)
    .map(r => Object.assign(r, { plan: round2_(r.plan), actual: round2_(r.actual), diff: round2_(r.actual - r.plan) }));
  const order = { [INCOME]: 0, [EXPENSE]: 1, [PLAN_SAVING_TYPE]: 2 };
  list.sort((a, b) => order[a.type] - order[b.type] || b.plan - a.plan);
  return { period, months, rows: list };
}

/* ---------- คาดการณ์ระยะยาวถึงเกษียณ ---------- */

function apiProjection_() {
  const s = planSettings_();
  const start = monthStr_(new Date());
  const thisYear = +start.slice(0, 4);
  const age = s.birthYear ? thisYear - s.birthYear : 0;
  const years = s.birthYear ? Math.max(1, Math.min(50, s.retireAge - age + 1)) : 30;
  const months = monthRange_(start, 12 * years);
  const plan = buildPlan_(months.slice(0, 12));
  const totals = planTotals_(plan);
  const inst = installments_().filter(i => !i.done);
  const instIn = (from, to) => inst.reduce((a, i) => {
    let n = 0;
    for (let m = from; m <= to; m = addMonths_(m, 1)) if (installmentActive_(i, m)) n++;
    return a + n * i.Monthly;
  }, 0);

  const income0 = totals.reduce((a, t) => a + t.income, 0);
  const saving0 = totals.reduce((a, t) => a + t.saving, 0);
  const inst0 = instIn(months[0], months[11]);
  const expenseBase0 = totals.reduce((a, t) => a + t.expense, 0) - inst0;
  let balance = fundsValuation_().reduce((a, f) => a + f.valueTHB, 0);
  const startBalance = balance;

  const rows = [];
  let reach = null;
  for (let y = 0; y < years; y++) {
    const from = months[y * 12], to = months[y * 12 + 11];
    const income = income0 * Math.pow(1 + s.growth, y);
    const expense = expenseBase0 * Math.pow(1 + s.inflation, y) + (y === 0 ? inst0 : instIn(from, to));
    const saving = saving0 * Math.pow(1 + s.growth, y);
    balance = balance * (1 + s.ret) + saving;
    if (!reach && s.target && balance >= s.target) reach = { index: y, year: thisYear + y, age: age ? age + y : null };
    rows.push({
      from, to, year: thisYear + y, age: age ? age + y : null,
      income: round2_(income), expense: round2_(expense), saving: round2_(saving),
      remaining: round2_(income - expense - saving), balance: round2_(balance),
    });
  }
  return {
    settings: s, startBalance: round2_(startBalance), rows, reach,
    note: 'ปีแรก = 12 เดือนข้างหน้าตามแผน ปีต่อไปปรับด้วยเงินเดือนขึ้น/เงินเฟ้อ ยอดเงินออมเริ่มจากมูลค่าปัจจุบันทุกกอง',
  };
}

/* ---------- นำเข้าแผนจาก Expen Life / Income (12 เดือนข้างหน้า) ---------- */

function importLegacyPlan() {
  return withLock_(() => {
    ensureReady_();
    const cfg = getConfig_();
    if (cfg.PLAN_IMPORT_DONE) return 'นำเข้าแผนไปแล้วเมื่อ ' + cfg.PLAN_IMPORT_DONE;
    const ss = ss_();
    const now = monthStr_(new Date());
    const first = addMonths_(now, 1), last = addMonths_(now, 12);
    const sums = {};
    const add = (m, type, cat, v) => { const k = m + '|' + type + '|' + cat; sums[k] = (sums[k] || 0) + v; };

    const el = LEGACY.expenLife;
    const v = legacySheet_(ss, el.sheet);
    if (v) {
      for (let r = el.nameRow; r < v.length; r++) {
        const d = v[r][2];
        if (!(d instanceof Date)) continue;
        const m = monthStr_(d);
        if (m < first || m > last) continue;
        Object.keys(el.expense).forEach(col => { const x = v[r][colIndex_(col)]; if (isMoney_(x)) add(m, EXPENSE, el.expense[col][0], x); });
        Object.keys(el.saving).forEach(col => { const x = v[r][colIndex_(col)]; if (isMoney_(x)) add(m, PLAN_SAVING_TYPE, PLAN_SAVING, x); });
      }
    }
    const inc = legacySheet_(ss, LEGACY.income.sheet);
    if (inc) {
      const head = findRow_(inc, 2, 'เดือน-ปี');
      for (let r = head + 1; head >= 0 && r < inc.length; r++) {
        const d = inc[r][2];
        if (!(d instanceof Date)) continue;
        const m = monthStr_(d);
        if (m < first || m > last) continue;
        Object.keys(LEGACY.income.columns).forEach(col => { const x = inc[r][colIndex_(col)]; if (isMoney_(x)) add(m, INCOME, LEGACY.income.columns[col], x); });
      }
    }
    const existing = planOverrides_();
    const rows = Object.keys(sums).filter(k => !existing[k]).map(k => {
      const p = k.split('|');
      return { Month: p[0], Type: p[1], Category: p[2], Amount: round2_(sums[k]), Source: 'import' };
    });
    appendRows_('plan', rows);
    setConfig_('PLAN_IMPORT_DONE', Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'));
    return 'นำเข้าแผน ' + monthLabelTh_(first) + ' – ' + monthLabelTh_(last) + ' แล้ว: ' + rows.length + ' ช่อง';
  });
}

function monthLabelTh_(m) {
  const th = ['ม.ค.', 'ก.พ.', 'มี.ค.', 'เม.ย.', 'พ.ค.', 'มิ.ย.', 'ก.ค.', 'ส.ค.', 'ก.ย.', 'ต.ค.', 'พ.ย.', 'ธ.ค.'];
  return th[+m.slice(5, 7) - 1] + ' ' + (+m.slice(0, 4) + 543);
}
