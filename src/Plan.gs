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

/** key = เดือน|ประเภท|หมวด|รายการย่อย ('' = ทั้งหมวด) */
function planOverrides_() {
  const o = {};
  readTable_('plan').forEach(p => {
    o[monthStr_(p.Month) + '|' + p.Type + '|' + p.Category + '|' + String(p.Item || '')] = { amount: num_(p.Amount), source: String(p.Source || '') };
  });
  return o;
}

function planItems_() {
  return readTable_('planItems').filter(i => isActive_(i.Active)).map(i => ({
    ID: String(i.ID), Type: i.Type, Category: String(i.Category), Name: String(i.Name),
    DefaultAmount: num_(i.DefaultAmount), Order: num_(i.Order),
  })).sort((a, b) => a.Order - b.Order || a.Name.localeCompare(b.Name));
}

/**
 * คำนวณแผนของหลายเดือน
 * คืน { months, savingPct, rows:[{type, category, label?, installment?, item?, sub?, parent?, hasItems?, cells:[{v, def, own, readonly?}]}] }
 * แถว sub = รายการย่อย (ไม่นับซ้ำในยอดรวม — แถวหมวดแม่คือผลรวมของรายการย่อย)
 */
function buildPlan_(months) {
  const s = planSettings_();
  const tx = readTable_('tx');
  const base = s.baseSalary || latestSalary_(tx);
  const cats = readTable_('categories').filter(c => isActive_(c.Active));
  const rec = readTable_('recurring').filter(r => isActive_(r.Active));
  const inst = installments_();
  const ov = planOverrides_();
  const items = planItems_();

  const incomeCats = cats.filter(c => c.Type === INCOME).map(c => String(c.Name));
  const expenseCats = cats.filter(c => c.Type === EXPENSE).map(c => String(c.Name));
  if (base && incomeCats.indexOf(SALARY_CATEGORY) < 0) incomeCats.unshift(SALARY_CATEGORY);
  if (base && s.bonusMonths && incomeCats.indexOf(BONUS_CATEGORY) < 0) incomeCats.splice(1, 0, BONUS_CATEGORY);
  // หมวดที่มีแต่ในแผนที่แก้เอง/นำเข้า หรือมีรายการย่อย
  const addCat = (type, cat) => {
    if (type === INCOME && incomeCats.indexOf(cat) < 0) incomeCats.push(cat);
    if (type === EXPENSE && expenseCats.indexOf(cat) < 0) expenseCats.push(cat);
  };
  Object.keys(ov).forEach(k => { const p = k.split('|'); if (months.indexOf(p[0]) >= 0) addCat(p[1], p[2]); });
  items.forEach(i => addCat(i.Type, i.Category));
  // ดอกเบี้ยรับจากเงินให้ยืม จัดการแยก (คำนวณจากระบบเงินให้ยืม)
  const ii = incomeCats.indexOf(INTEREST_CATEGORY);
  if (ii >= 0) incomeCats.splice(ii, 1);
  const budget = {};
  cats.filter(c => c.Type === EXPENSE).forEach(c => { budget[String(c.Name)] = num_(c.MonthlyBudget); });
  const recSum = (type, cat) => rec.filter(r => r.Type === type && String(r.Category) === cat).reduce((a, r) => a + num_(r.Amount), 0);

  const cell = (m, type, cat, def, item) => {
    const o = ov[m + '|' + type + '|' + cat + '|' + (item || '')];
    return o ? { v: o.amount, def: round2_(def), own: true, src: o.source } : { v: round2_(def), def: round2_(def), own: false };
  };

  /** แถวหมวด + รายการย่อย (ถ้ามี) */
  const catRows = (type, cat, defFn) => {
    const subs = items.filter(i => i.Type === type && i.Category === cat);
    if (!subs.length) return [{ type, category: cat, cells: months.map(m => cell(m, type, cat, defFn(m))) }];
    const subRows = subs.map(i => ({
      type, category: cat, item: i.Name, itemId: i.ID, sub: true,
      cells: months.map(m => cell(m, type, cat, i.DefaultAmount, i.Name)),
    }));
    const parent = {
      type, category: cat, hasItems: true,
      cells: months.map((m, j) => {
        const v = subRows.reduce((a, r) => a + r.cells[j].v, 0), def = subRows.reduce((a, r) => a + r.cells[j].def, 0);
        return { v: round2_(v), def: round2_(def), own: false, readonly: true };
      }),
    };
    return [parent].concat(subRows);
  };
  const flat = arr => arr.reduce((a, x) => a.concat(x), []);

  const incomeRows = flat(incomeCats.map(cat => catRows(INCOME, cat, m => {
    if (cat === SALARY_CATEGORY && base) return salaryAt_(s, base, m);
    if (cat === BONUS_CATEGORY && base) return (+m.slice(5, 7) === s.bonusMonth ? s.bonusMonths * salaryAt_(s, base, m) : 0) + recSum(INCOME, cat);
    return recSum(INCOME, cat);
  })));

  const expenseRows = flat(expenseCats.map(cat => catRows(EXPENSE, cat, () => (budget[cat] > 0 ? budget[cat] : recSum(EXPENSE, cat)))));

  // งวดผ่อน: งวดที่บันทึกจ่ายจริงแล้วยังนับในแผนของเดือนนั้น (เพื่อเทียบแผน vs จริง) จนกว่าจะผ่อนครบ
  const instRows = inst.filter(i => months.some(m => installmentActive_(i, m))).map(i => ({
    type: EXPENSE, category: i.Category, installment: i.ID, label: 'ผ่อน: ' + i.Name,
    cells: months.map(m => {
      const v = installmentActive_(i, m) && (!i.done || i.paidMonths[m]) ? i.Monthly : 0;
      return { v: v, def: v, own: false, readonly: true };
    }),
  }));

  // ดอกเบี้ยรับ (เงินให้ยืม): ค่าตั้งต้น = ดอกที่คาดว่าจะได้จากเงินให้ยืมที่ยังไม่ปิดยอด + แถวย่อยรายผู้ยืม (ดูอย่างเดียว)
  const li = loanInterestPlan_(months);
  const interestOwn = months.some(m => ov[m + '|' + INCOME + '|' + INTEREST_CATEGORY + '|']);
  const interestManualItems = items.some(i => i.Type === INCOME && i.Category === INTEREST_CATEGORY);
  if (interestManualItems) {
    catRows(INCOME, INTEREST_CATEGORY, () => 0).forEach(r => incomeRows.push(r));
  } else if (li.perLoan.length || interestOwn) {
    incomeRows.push({ type: INCOME, category: INTEREST_CATEGORY, loanInterest: true, cells: months.map((m, j) => cell(m, INCOME, INTEREST_CATEGORY, li.total[j])) });
    li.perLoan.forEach(l => incomeRows.push({
      type: INCOME, category: INTEREST_CATEGORY, sub: true, loan: l.id, label: l.label,
      cells: l.cells.map(v => ({ v: v, def: v, own: false, readonly: true })),
    }));
  }

  const incomeTotal = j => incomeRows.filter(r => !r.sub).reduce((a, r) => a + r.cells[j].v, 0);
  const savingRows = catRows(PLAN_SAVING_TYPE, PLAN_SAVING, m => incomeTotal(months.indexOf(m)) * s.savingPct / 100);

  return {
    months, savingPct: s.savingPct,
    rows: incomeRows.concat(expenseRows, instRows, savingRows),
  };
}

/**
 * ดอกเบี้ยที่คาดว่าจะได้ต่อเดือนจากเงินให้ยืมแบบ % ต่อเดือน
 * - เริ่มเดือนถัดจากเดือนที่ให้ยืม
 * - คิดจากเงินต้นคงเหลือ ณ ต้นเดือนนั้น (หักเงินต้นที่รับคืนก่อนเดือนนั้น)
 * - คิดต่อจนกว่าจะปิดยอด (เกินกำหนดชำระก็ยังคิด)
 */
function loanInterestPlan_(months) {
  const perLoan = [];
  loansComputed_().forEach(l => {
    if (l.InterestType !== 'percent' || !num_(l.InterestRate)) return;
    const startM = monthStr_(l.Date) || (l.payments[0] ? monthStr_(l.payments[0].Date) : '');
    if (!startM) return;
    const lastPay = l.payments.length ? monthStr_(l.payments[l.payments.length - 1].Date) : startM;
    const cells = months.map(m => {
      if (m <= startM) return 0;
      if (l.Closed && m > lastPay) return 0;
      const paidBefore = l.payments.filter(p => monthStr_(p.Date) < m).reduce((a, p) => a + p.Principal, 0);
      const rem = l.Principal - paidBefore;
      return rem > 0 ? round2_(rem * num_(l.InterestRate) / 100) : 0;
    });
    if (cells.some(v => v)) perLoan.push({ id: l.LoanID, label: l.Borrower + ' (' + l.LoanID + ') ' + l.InterestRate + '%', cells });
  });
  const total = months.map((m, j) => round2_(perLoan.reduce((a, l) => a + l.cells[j], 0)));
  return { perLoan, total };
}

function planTotals_(plan) {
  return plan.months.map((m, i) => {
    const sum = type => plan.rows.filter(r => r.type === type && !r.sub).reduce((a, r) => a + r.cells[i].v, 0);
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

/** แก้ช่องแผน 1 ช่อง: amount = '' คือกลับไปใช้ค่าตั้งต้น · item = ชื่อรายการย่อย ('' = ทั้งหมวด) */
function apiSavePlanCell_(month, type, category, amount, item) {
  month = monthStr_(month);
  item = String(item || '');
  if (!month || !category) throw new Error('ข้อมูลไม่ครบ');
  if ([INCOME, EXPENSE, PLAN_SAVING_TYPE].indexOf(type) < 0) throw new Error('ประเภทไม่ถูกต้อง');
  deleteWhere_('plan', r => monthStr_(r.Month) === month && r.Type === type && String(r.Category) === category && String(r.Item || '') === item);
  if (amount !== '' && amount !== null && amount !== undefined) {
    appendRows_('plan', [{ Month: month, Type: type, Category: category, Amount: num_(amount), Source: 'manual', Item: item }]);
  }
  return true;
}

/* ---------- รายการย่อยในแผน ---------- */

/** {ID?, Type, Category, Name, DefaultAmount} */
function apiSavePlanItem_(i) {
  const name = String(i.Name || '').trim();
  if (!name) throw new Error('กรุณาใส่ชื่อรายการย่อย');
  if ([INCOME, EXPENSE, PLAN_SAVING_TYPE].indexOf(i.Type) < 0 || !i.Category) throw new Error('ข้อมูลไม่ครบ');
  const all = readTable_('planItems');
  const dup = all.find(r => r.Type === i.Type && String(r.Category) === i.Category && String(r.Name) === name && String(r.ID) !== String(i.ID || ''));
  if (dup) throw new Error('มีรายการย่อยชื่อนี้ในหมวดนี้แล้ว');
  const row = { Type: i.Type, Category: i.Category, Name: name, DefaultAmount: num_(i.DefaultAmount), Active: true };
  if (i.ID) {
    const old = all.find(r => String(r.ID) === String(i.ID));
    if (!old) throw new Error('ไม่พบรายการย่อย');
    if (String(old.Name) !== name) {
      // เปลี่ยนชื่อ: ย้ายตัวเลขที่แก้เองไว้ไปชื่อใหม่
      const sh = sheet_('plan');
      const col = SHEETS.plan.headers.indexOf('Item') + 1;
      readTable_('plan').filter(r => r.Type === old.Type && String(r.Category) === String(old.Category) && String(r.Item || '') === String(old.Name))
        .forEach(r => sh.getRange(r._row, col).setValue(name));
      invalidate_('plan');
      // รายการจริงและรายการประจำที่เลือกรายการย่อยนี้ไว้ เปลี่ยนชื่อตาม
      ['tx', 'recurring'].forEach(key => {
        const tsh = sheet_(key);
        const tcol = SHEETS[key].headers.indexOf('Item') + 1;
        readTable_(key).filter(r => r.Type === old.Type && String(r.Category) === String(old.Category) && String(r.Item || '') === String(old.Name))
          .forEach(r => tsh.getRange(r._row, tcol).setValue(name));
        invalidate_(key);
      });
    }
    return updateById_('planItems', 'ID', i.ID, row);
  }
  row.ID = newId_('PI');
  row.Order = all.filter(r => r.Type === i.Type && String(r.Category) === i.Category).length + 1;
  appendRows_('planItems', [row]);
  return row;
}

function apiDeletePlanItem_(id) {
  const it = readTable_('planItems').find(r => String(r.ID) === String(id));
  if (!it) return 0;
  deleteWhere_('plan', r => r.Type === it.Type && String(r.Category) === String(it.Category) && String(r.Item || '') === String(it.Name));
  return deleteWhere_('planItems', r => String(r.ID) === String(id));
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
  plan.rows.filter(r => !r.sub).forEach(r => {
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
  // รายการย่อย: แผนจากแถวย่อยในแผน, จริงจากรายการที่เลือกรายการย่อยไว้
  const items = {};
  plan.rows.filter(r => r.sub && r.item).forEach(r => {
    const k = key(r.type, r.category) + '|' + r.item;
    items[k] = items[k] || { item: r.item, plan: 0, actual: 0 };
    items[k].plan += r.cells.reduce((a, c) => a + c.v, 0);
  });
  months.forEach(m => {
    const a = agg[m];
    if (!a) return;
    Object.keys(a.byItem).forEach(k => {
      items[k] = items[k] || { item: k.split('|')[2], plan: 0, actual: 0 };
      items[k].actual += a.byItem[k];
    });
  });
  Object.keys(items).forEach(k => {
    const ck = k.split('|').slice(0, 2).join('|');
    if (!rows[ck]) return;
    (rows[ck].items = rows[ck].items || []).push(items[k]);
  });
  Object.keys(rows).forEach(k => {
    const r = rows[k];
    if (!r.items) return;
    const rest = r.actual - r.items.reduce((a, i) => a + i.actual, 0);
    if (Math.abs(rest) > 0.005) r.items.push({ item: '', unassigned: true, plan: 0, actual: rest });
    r.items = r.items.filter(i => i.plan || i.actual)
      .map(i => Object.assign(i, { plan: round2_(i.plan), actual: round2_(i.actual), diff: round2_(i.actual - i.plan) }));
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
    const rows = Object.keys(sums).filter(k => !existing[k + '|']).map(k => {
      const p = k.split('|');
      return { Month: p[0], Type: p[1], Category: p[2], Amount: round2_(sums[k]), Source: 'import', Item: '' };
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
