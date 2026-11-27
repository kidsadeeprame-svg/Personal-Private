/**
 * ===== เว็บแอป + API ที่หน้าเว็บเรียกใช้ =====
 * หน้าเว็บเรียกผ่านฟังก์ชันเดียว api(name, argsJson) แล้วรับผลเป็น JSON
 * (ฟังก์ชันที่ลงท้ายด้วย _ เรียกจากหน้าเว็บตรงๆ ไม่ได้)
 */

function doGet() {
  guard_();
  return HtmlService.createTemplateFromFile('Index').evaluate()
    .setTitle(APP_TITLE)
    .addMetaTag('viewport', 'width=device-width, initial-scale=1');
}

function include(name) {
  return HtmlService.createHtmlOutputFromFile(name).getContent();
}

/** ให้ใช้ได้เฉพาะเจ้าของสคริปต์ */
function guard_() {
  const owner = Session.getEffectiveUser().getEmail();
  const active = Session.getActiveUser().getEmail();
  if (owner && active && owner !== active) throw new Error('ไม่มีสิทธิ์เข้าถึง');
}

const API_ = {
  bootstrap: apiBootstrap_,
  init: apiInit_,
  dashboard: apiDashboard_,
  transactions: apiTransactions_,
  saveTransaction: apiSaveTransaction_,
  deleteTransaction: apiDeleteTransaction_,
  yearSummary: apiYearSummary_,
  recurring: apiRecurring_,
  saveRecurring: apiSaveRecurring_,
  deleteRecurring: apiDeleteRecurring_,
  postRecurring: apiPostRecurring_,
  invest: apiInvest_,
  saveContribution: apiSaveContribution_,
  deleteContributionBatch: apiDeleteContributionBatch_,
  saveSnapshots: apiSaveSnapshots_,
  deleteSnapshot: apiDeleteSnapshot_,
  resetInvest: apiResetInvest_,
  withdraw: apiWithdraw_,
  quote: apiQuote_,
  receiveDividend: apiReceiveDividend_,
  loans: apiLoans_,
  saveLoan: apiSaveLoan_,
  deleteLoan: apiDeleteLoan_,
  savePayment: apiSavePayment_,
  deletePayment: apiDeletePayment_,
  tax: apiTax_,
  saveTax: apiSaveTax_,
  health: apiHealth_,
  saveVisit: apiSaveVisit_,
  deleteVisit: apiDeleteVisit_,
  getTable: apiGetTable_,
  saveTable: apiSaveTable_,
  upload: apiUpload_,
  plan: apiPlan_,
  savePlanCell: apiSavePlanCell_,
  resetPlanMonth: apiResetPlanMonth_,
  copyPlanMonth: apiCopyPlanMonth_,
  planVsActual: apiPlanVsActual_,
  projection: apiProjection_,
  importPlan: importLegacyPlan,
  installments: apiInstallments_,
  saveInstallment: apiSaveInstallment_,
  deleteInstallment: apiDeleteInstallment_,
  postInstallments: apiPostInstallments_,
  savePlanItem: apiSavePlanItem_,
  updateInfo: apiUpdateInfo_,
  updateCode: apiUpdateCode_,
  setAutoUpdate: apiSetAutoUpdate_,
  deletePlanItem: apiDeletePlanItem_,
};

const WRITE_APIS_ = ['saveTransaction', 'deleteTransaction', 'saveRecurring', 'deleteRecurring', 'postRecurring',
  'saveContribution', 'deleteContributionBatch', 'saveSnapshots', 'deleteSnapshot', 'resetInvest', 'withdraw', 'receiveDividend', 'saveLoan', 'deleteLoan',
  'savePayment', 'deletePayment', 'saveTax', 'saveVisit', 'deleteVisit', 'saveTable',
  'savePlanCell', 'resetPlanMonth', 'copyPlanMonth', 'saveInstallment', 'deleteInstallment', 'postInstallments',
  'savePlanItem', 'deletePlanItem'];

function api(name, argsJson) {
  const t0 = Date.now();
  guard_();
  const fn = API_[name];
  if (!fn) throw new Error('ไม่รู้จักคำสั่ง ' + name);
  const args = JSON.parse(argsJson || '[]');
  const run = () => fn.apply(null, args);
  const result = WRITE_APIS_.indexOf(name) >= 0 ? withLock_(run) : run();
  // ส่งเวลาประมวลผลฝั่งเซิร์ฟเวอร์กลับไปด้วย (แสดงที่มุมซ้ายล่างของเว็บ)
  return JSON.stringify({ r: result === undefined ? null : result, ms: Date.now() - t0 }, function (key, val) {
    const raw = this[key];
    if (raw instanceof Date) return fmtDate_(raw);
    if (key === '_row') return undefined;
    return val;
  });
}

/* ============ ทั่วไป ============ */

function apiBootstrap_() {
  ensureReady_();
  return {
    title: APP_TITLE,
    today: fmtDate_(new Date()),
    config: getConfig_(),
    categories: readTable_('categories').map(c => ({ Type: c.Type, Name: String(c.Name), MonthlyBudget: optNum_(c.MonthlyBudget), Active: isActive_(c.Active), NoTax: isTrue_(c.NoTax) })),
    accounts: readTable_('accounts').map(a => ({ Name: String(a.Name), Active: isActive_(a.Active) })),
    funds: readTable_('funds').map(f => ({ Name: String(f.Name), Currency: f.Currency || 'THB', Goal: f.Goal, Active: isActive_(f.Active), Kind: fundKind_(f), NAV: num_(f.NAV), Ticker: cleanTicker_(f.Ticker) })),
    fundKinds: FUND_KINDS,
    healthItems: healthItems_(),
    planItems: planItems_().map(i => ({ Type: i.Type, Category: i.Category, Name: i.Name })),
    usdRate: usdRate_(),
    interestCategory: INTEREST_CATEGORY,
    codeVersion: (PropertiesService.getScriptProperties().getProperty('CODE_SHA') || '').slice(0, 7), // โค้ดล่าสุดในโปรเจกต์
    runningVersion: CODE_VERSION,                                                                       // โค้ดที่หน้าเว็บนี้รันอยู่
    cycleMonth: cycleMonth_(new Date()),
    cycleStart: cycleStart_(),
    goals: (() => {
      const n = goals_().map(g => g.Name);
      readTable_('funds').forEach(x => { if (x.Goal && n.indexOf(String(x.Goal)) < 0) n.push(String(x.Goal)); });
      return n.length ? n : [GOAL_EMERGENCY, GOAL_RETIREMENT, GOAL_OTHER];
    })(),
  };
}

/** โหลดครั้งแรก: ข้อมูลพื้นฐาน + หน้าภาพรวม ในการเรียกครั้งเดียว */
function apiInit_(month) {
  return { boot: apiBootstrap_(), dashboard: apiDashboard_(month) };
}

function usdRate_() {
  const cfg = getConfig_();
  const live = num_(cfg.USD_THB);
  return live > 0 ? live : (num_(cfg.USD_THB_FALLBACK) || 33);
}

/* ============ รายรับ-รายจ่าย ============ */

function txOut_(t) {
  return {
    ID: String(t.ID), Date: fmtDate_(t.Date), Type: t.Type, Category: String(t.Category), Amount: num_(t.Amount),
    Account: String(t.Account || ''), Note: String(t.Note || ''), ReceiptUrl: String(t.ReceiptUrl || ''), Source: String(t.Source || ''),
    Item: String(t.Item || ''),
  };
}

function apiTransactions_(year) {
  const y = String(year);
  return readTable_('tx')
    .map(txOut_)
    .filter(t => t.Date.slice(0, 4) === y)
    .sort((a, b) => (b.Date + b.ID).localeCompare(a.Date + a.ID));
}

function apiSaveTransaction_(t) {
  if (t.Type !== INCOME && t.Type !== EXPENSE) throw new Error('ประเภทไม่ถูกต้อง');
  if (!t.Category) throw new Error('กรุณาเลือกหมวด');
  const amount = num_(t.Amount);
  if (!amount) throw new Error('กรุณากรอกจำนวนเงิน');
  const row = {
    Date: toDate_(t.Date), Type: t.Type, Category: t.Category, Amount: amount,
    Account: t.Account || '', Note: t.Note || '', ReceiptUrl: t.ReceiptUrl || '', Item: t.Item || '',
  };
  if (t.ID) {
    return txOut_(updateById_('tx', 'ID', t.ID, row));
  }
  row.ID = newId_('T');
  row.Source = t.Source || 'manual';
  row.CreatedAt = new Date();
  appendRows_('tx', [row]);
  return txOut_(row);
}

function apiDeleteTransaction_(id) {
  return deleteWhere_('tx', r => String(r.ID) === String(id));
}

function emptyAgg_() {
  return { income: 0, expense: 0, saving: 0, deposit: 0, withdraw: 0, interest: 0, byCat: {}, byItem: {}, itemName: {} };
}

/** รวมยอดรายเดือน: รายรับ (รวมดอกเบี้ยเงินให้ยืม), รายจ่าย, เงินออม */
function aggregateByMonth_() {
  const agg = {};
  const get = m => (agg[m] = agg[m] || emptyAgg_());
  readTable_('tx').forEach(t => {
    const m = cycleMonth_(t.Date);
    if (!m) return;
    const a = get(m), amt = num_(t.Amount);
    if (t.Type === INCOME) a.income += amt; else a.expense += amt;
    const k = t.Type + '|' + t.Category;
    a.byCat[k] = (a.byCat[k] || 0) + amt;
    if (normItem_(t.Item)) {
      const ki = k + '|' + normItem_(t.Item);
      a.byItem[ki] = (a.byItem[ki] || 0) + amt;
      a.itemName[ki] = String(t.Item).trim();
    }
  });
  readTable_('contributions').forEach(c => {
    const m = cycleMonth_(c.Date);
    if (!m || String(c.Source) === 'opening' || String(c.Source) === 'transfer') return; // ยอดตั้งต้น/ย้ายระหว่างกอง ไม่ใช่เงินออมใหม่
    const a = get(m), cash = contribCash_(c);
    a.saving += cash;                       // เงินออมสุทธิ = ลงเงิน − ดึงออก
    if (cash >= 0) a.deposit += cash; else a.withdraw += -cash;
  });
  readTable_('loanPayments').forEach(p => {
    const m = cycleMonth_(p.Date), i = num_(p.Interest);
    if (!m || !i) return;
    const a = get(m);
    a.income += i;
    a.interest += i;
    const k = INCOME + '|' + INTEREST_CATEGORY;
    a.byCat[k] = (a.byCat[k] || 0) + i;
  });
  return agg;
}

function apiYearSummary_(year) {
  const agg = aggregateByMonth_();
  const months = [];
  for (let i = 1; i <= 12; i++) months.push(year + '-' + ('0' + i).slice(-2));
  const cats = { [INCOME]: {}, [EXPENSE]: {} };
  months.forEach((m, i) => {
    const a = agg[m];
    if (!a) return;
    Object.keys(a.byCat).forEach(k => {
      const [type, cat] = k.split('|');
      cats[type][cat] = cats[type][cat] || new Array(12).fill(0);
      cats[type][cat][i] += a.byCat[k];
    });
  });
  const rows = type => Object.keys(cats[type]).map(c => ({ category: c, values: cats[type][c], total: cats[type][c].reduce((s, x) => s + x, 0) }))
    .sort((a, b) => b.total - a.total);
  const col = f => months.map(m => (agg[m] ? f(agg[m]) : 0));
  return {
    months,
    income: rows(INCOME),
    expense: rows(EXPENSE),
    totals: {
      income: col(a => a.income),
      expense: col(a => a.expense),
      saving: col(a => a.saving),
      remaining: col(a => a.income - a.expense - a.saving),
    },
  };
}

/* ============ รายการประจำเดือน ============ */

function apiRecurring_(month) {
  month = month || cycleMonth_(new Date());
  return readTable_('recurring').map(r => ({
    ID: String(r.ID), Name: String(r.Name), Type: r.Type, Category: r.Category, Amount: num_(r.Amount),
    Account: r.Account, DayOfMonth: num_(r.DayOfMonth) || 1, Active: isActive_(r.Active),
    LastPostedMonth: monthStr_(r.LastPostedMonth), Posted: monthStr_(r.LastPostedMonth) >= month, Item: String(r.Item || ''),
  }));
}

function apiSaveRecurring_(r) {
  if (!r.Name) throw new Error('กรุณาใส่ชื่อรายการ');
  if (r.Type !== INCOME && r.Type !== EXPENSE) throw new Error('ประเภทไม่ถูกต้อง');
  const row = {
    Name: r.Name, Type: r.Type, Category: r.Category, Amount: num_(r.Amount), Account: r.Account || '',
    DayOfMonth: Math.min(31, Math.max(1, num_(r.DayOfMonth) || 1)), Active: r.Active !== false, Item: r.Item || '',
  };
  if (r.ID) return updateById_('recurring', 'ID', r.ID, row);
  row.ID = newId_('R');
  row.LastPostedMonth = '';
  appendRows_('recurring', [row]);
  return row;
}

function apiDeleteRecurring_(id) {
  return deleteWhere_('recurring', r => String(r.ID) === String(id));
}

/** บันทึกรายการประจำของเดือนที่ระบุ (ข้ามรายการที่บันทึกเดือนนั้นไปแล้ว) */
function apiPostRecurring_(ids, month, amounts) {
  month = month || cycleMonth_(new Date());
  amounts = amounts || {};
  const list = readTable_('recurring').filter(r => ids.indexOf(String(r.ID)) >= 0 && isActive_(r.Active));
  const now = new Date();
  const tx = [];
  list.forEach(r => {
    if (monthStr_(r.LastPostedMonth) >= month) return;
    const day = num_(r.DayOfMonth) || 1;
    const amount = amounts[r.ID] !== undefined ? num_(amounts[r.ID]) : num_(r.Amount);
    if (!amount) return;
    tx.push({
      ID: newId_('T'), Date: cycleDate_(month, day), Type: r.Type, Category: r.Category,
      Amount: amount, Account: r.Account, Note: r.Name, ReceiptUrl: '', Source: 'recurring:' + r.ID, CreatedAt: now, Item: r.Item || '',
    });
    updateById_('recurring', 'ID', r.ID, { LastPostedMonth: month });
  });
  appendRows_('tx', tx);
  return tx.length;
}

/* ============ เงินออม / ลงทุน ============ */

function fundKind_(f) {
  if (f.Kind && FUND_KINDS.indexOf(String(f.Kind)) >= 0) return String(f.Kind);
  return (f.Currency || 'THB') === 'USD' ? KIND_USD : KIND_CASH;
}

/** รายการลงเงิน/ดึงเงินนี้เกิดหลังยอดที่บันทึกไว้หรือไม่ (ใช้เวลาที่บันทึกถ้ามี ไม่งั้นเทียบเดือน) */
function afterSnapshot_(c, snap) {
  if (snap.SavedAt instanceof Date && c.CreatedAt instanceof Date) return c.CreatedAt.getTime() > snap.SavedAt.getTime();
  if (snap.SavedAt instanceof Date) return fmtDate_(c.Date) > fmtDate_(snap.SavedAt);
  return monthStr_(c.Date) > monthStr_(snap.Month);
}

/** เงินสดที่เข้า/ออกจริงของรายการ (ลงเงิน = บวก, ดึงออก = ลบ) */
function contribCash_(c) {
  return c.Cash === '' || c.Cash === null || c.Cash === undefined ? num_(c.AmountTHB) : num_(c.Cash);
}

/** ยอดที่ต้องเติมคืนของแต่ละกอง: ดึงออกแบบ "ต้องเติมคืน" แล้วลดลงเมื่อมีการลงเงินกองนั้นภายหลัง */
function refillStatus_() {
  const by = {};
  readTable_('contributions').slice().sort((a, b) => (fmtDate_(a.Date) + (a.CreatedAt instanceof Date ? a.CreatedAt.getTime() : 0))
    .localeCompare(fmtDate_(b.Date) + (b.CreatedAt instanceof Date ? b.CreatedAt.getTime() : 0))).forEach(c => {
    const fund = String(c.Fund);
    const cash = contribCash_(c);
    const st = by[fund] = by[fund] || { fund: fund, owed: 0, since: '' };
    if (String(c.Source) === 'withdraw') {
      if (isTrue_(c.Refill)) { if (!st.owed) st.since = fmtDate_(c.Date); st.owed += -cash; }
    } else if (cash > 0 && String(c.Source) !== 'opening' && st.owed > 0) {
      st.owed = Math.max(0, st.owed - cash);
    }
  });
  return Object.keys(by).map(k => by[k]).filter(s => s.owed > 0.005).map(s => Object.assign(s, { owed: round2_(s.owed) }));
}

/** กองที่คิดมูลค่าแบบ จำนวนหน่วย × ราคา */
function isUnitKind_(kind) {
  return kind === KIND_FUND || kind === KIND_STOCK;
}

function cleanTicker_(t) {
  return String(t || '').trim().toUpperCase().replace(/[^A-Z0-9:.\-]/g, '');
}

/** ราคาหุ้นจาก GOOGLEFINANCE (เก็บสูตรไว้ในแท็บ App_Prices) → { TICKER: {price, currency} } */
function livePrices_() {
  const out = {};
  readTable_('prices').forEach(r => {
    const p = num_(r.Price);
    if (p > 0) out[cleanTicker_(r.Ticker)] = { price: p, currency: String(r.Currency || '').toUpperCase() };
  });
  return out;
}

/** ให้แท็บ App_Prices มีสูตรของทุกชื่อย่อที่ใช้ */
function syncTickers_(tickers) {
  const have = readTable_('prices').map(r => cleanTicker_(r.Ticker));
  const add = tickers.map(cleanTicker_).filter((t, i, a) => t && a.indexOf(t) === i && have.indexOf(t) < 0);
  if (!add.length) return false;
  appendRows_('prices', add.map(t => ({
    Ticker: t, Price: '=IFERROR(GOOGLEFINANCE("' + t + '","price"),"")', Currency: '=IFERROR(GOOGLEFINANCE("' + t + '","currency"),"")',
  })));
  return true;
}

/** ราคาล่าสุดของหุ้น 1 ตัว (เป็นบาท) — ใช้ตอนกรอกชื่อย่อ */
function apiQuote_(ticker) {
  const t = cleanTicker_(ticker);
  if (!t) throw new Error('กรุณาใส่ชื่อย่อหุ้น');
  if (syncTickers_([t])) { SpreadsheetApp.flush(); Utilities.sleep(1500); }
  let q = livePrices_()[t];
  if (!q) { SpreadsheetApp.flush(); Utilities.sleep(2000); invalidate_('prices'); q = livePrices_()[t]; }
  if (!q) throw new Error('ดึงราคา ' + t + ' ไม่ได้ ตรวจชื่อย่อ (เช่น BKK:PTT, NASDAQ:AAPL) หรือกรอกราคาเอง');
  const rate = q.currency === 'USD' ? usdRate_() : 1;
  return { ticker: t, price: q.price, currency: q.currency || 'THB', priceTHB: round2_(q.price * rate) };
}

function fundsValuation_() {
  const rate = usdRate_();
  const funds = readTable_('funds');
  const contrib = readTable_('contributions');
  const snaps = readTable_('snapshots');
  const prices = livePrices_();
  return funds.map(f => {
    const name = String(f.Name), kind = fundKind_(f);
    const cur = kind === KIND_USD ? 'USD' : 'THB';
    const cs = contrib.filter(c => String(c.Fund) === name);
    const cost = cs.reduce((s, c) => s + num_(c.AmountTHB), 0);
    if (isUnitKind_(kind)) {
      // กองทุนรวม/หุ้น: มูลค่า = จำนวนหน่วยรวม × ราคาล่าสุด (หุ้นที่มีชื่อย่อใช้ราคาจาก GOOGLEFINANCE)
      const units = cs.reduce((s, c) => s + num_(c.Units), 0);
      const ticker = cleanTicker_(f.Ticker);
      const q = ticker ? prices[ticker] : null;
      const live = q ? round2_(q.price * (q.currency === 'USD' ? rate : 1)) : 0;
      const nav = live || num_(f.NAV);
      const value = nav > 0 ? units * nav : cost;
      return {
        Name: name, Currency: 'THB', Goal: f.Goal, Active: isActive_(f.Active), Kind: kind,
        ticker: ticker, livePrice: !!live, priceCurrency: q ? q.currency : '', priceFX: q ? q.price : '',
        units: Math.round(units * 10000) / 10000, nav: nav, navDate: live ? fmtDate_(new Date()) : fmtDate_(f.NavDate),
        cost: round2_(cost), valueFX: round2_(value), valueTHB: round2_(value),
        gain: round2_(value - cost), lastSnapshot: fmtDate_(f.NavDate).slice(0, 7),
      };
    }
    const fs = snaps.filter(s => String(s.Fund) === name).sort((a, b) => monthStr_(a.Month).localeCompare(monthStr_(b.Month)));
    const snap = fs[fs.length - 1];
    let valueFX;
    if (snap) {
      valueFX = num_(snap.ValueFX) + cs.filter(c => afterSnapshot_(c, snap)).reduce((s, c) => s + num_(c.AmountFX), 0);
    } else {
      valueFX = cs.reduce((s, c) => s + num_(c.AmountFX), 0);
    }
    const valueTHB = cur === 'USD' ? valueFX * rate : valueFX;
    return {
      Name: name, Currency: cur, Goal: f.Goal, Active: isActive_(f.Active), Kind: kind,
      cost: round2_(cost), valueFX: round2_(valueFX), valueTHB: round2_(valueTHB),
      gain: round2_(valueTHB - cost), lastSnapshot: snap ? monthStr_(snap.Month) : '',
    };
  });
}

/** เป้าหมายการออมที่ใช้งาน */
function goals_() {
  const rows = readTable_('goals').filter(g => isActive_(g.Active) && String(g.Name).trim());
  return rows.map(g => ({ Name: String(g.Name).trim(), Target: num_(g.Target), TargetDate: monthStr_(g.TargetDate) || String(g.TargetDate || '').slice(0, 7) }));
}

/** ความคืบหน้าแต่ละเป้าหมาย + ต้องออมเดือนละเท่าไรถึงจะทันวันที่ตั้งไว้ */
function goalsStatus_(funds) {
  funds = funds || fundsValuation_();
  const now = cycleMonth_(new Date());
  const list = goals_();
  const names = list.map(g => g.Name);
  funds.forEach(f => { if (f.Goal && names.indexOf(String(f.Goal)) < 0) { names.push(String(f.Goal)); list.push({ Name: String(f.Goal), Target: 0, TargetDate: '' }); } });
  return list.map(g => {
    const value = round2_(funds.filter(f => String(f.Goal) === g.Name).reduce((s, f) => s + f.valueTHB, 0));
    let monthsLeft = 0, monthlyNeeded = 0;
    if (g.TargetDate && g.Target) {
      for (let m = now; m <= g.TargetDate && monthsLeft < 600; m = addMonths_(m, 1)) monthsLeft++;
      monthlyNeeded = monthsLeft ? round2_(Math.max(0, g.Target - value) / monthsLeft) : round2_(Math.max(0, g.Target - value));
    }
    return { goal: g.Name, target: g.Target, value: value, date: g.TargetDate, monthsLeft: monthsLeft, monthlyNeeded: monthlyNeeded };
  }).filter(g => g.target || g.value);
}

/** แผนออมของรอบ: ยอดจากแผนรายเดือน เทียบกับที่ลงเงินจริง (แยกรายกองถ้าแบ่งแผนออมเป็นรายการย่อยชื่อเดียวกับกอง) */
function savingsPlan_(month) {
  month = month || cycleMonth_(new Date());
  const plan = buildPlan_([month]);
  const rows = plan.rows.filter(r => r.type === PLAN_SAVING_TYPE);
  const parent = rows.find(r => !r.sub);
  const subs = rows.filter(r => r.sub);
  const funds = readTable_('funds').map(f => String(f.Name));
  const done = {};
  let doneTotal = 0, withdrawn = 0;
  readTable_('contributions').forEach(c => {
    if (cycleMonth_(c.Date) !== month) return;
    const src = String(c.Source);
    if (src === 'opening' || src === 'transfer') return;
    const cash = contribCash_(c);
    if (cash > 0) { done[String(c.Fund)] = (done[String(c.Fund)] || 0) + cash; doneTotal += cash; } else withdrawn += -cash;
  });
  const items = [];
  const used = {};
  subs.forEach(r => {
    const fund = funds.find(n => normItem_(n) === normItem_(r.item)) || '';
    if (fund) used[fund] = true;
    items.push({ name: r.item, fund: fund, plan: round2_(r.cells[0].v), done: round2_(fund ? done[fund] || 0 : 0) });
  });
  Object.keys(done).forEach(n => { if (!used[n]) items.push({ name: n, fund: n, plan: 0, done: round2_(done[n]) }); });
  items.forEach(i => { i.remaining = round2_(Math.max(0, i.plan - i.done)); });
  const total = parent ? round2_(parent.cells[0].v) : 0;
  return { month: month, plan: total, done: round2_(doneTotal), withdrawn: round2_(withdrawn), remaining: round2_(Math.max(0, total - doneTotal)), items: items, split: subs.length > 0 };
}

function apiInvest_() {
  const cfg = getConfig_();
  syncTickers_(readTable_('funds').filter(x => fundKind_(x) === KIND_STOCK).map(x => x.Ticker));
  return {
    usdRate: usdRate_(),
    funds: fundsValuation_(),
    goals: goalsStatus_(),
    savingsPlan: savingsPlan_(),
    contributions: readTable_('contributions').map(c => ({
      ID: String(c.ID), BatchID: String(c.BatchID), Date: fmtDate_(c.Date), Fund: String(c.Fund), Currency: c.Currency,
      AmountFX: num_(c.AmountFX), Rate: num_(c.Rate), AmountTHB: num_(c.AmountTHB), Account: String(c.Account || ''),
      Note: String(c.Note || ''), Source: String(c.Source || ''), Units: num_(c.Units),
      Cash: contribCash_(c), Refill: isTrue_(c.Refill),
    })).sort((a, b) => b.Date.localeCompare(a.Date)),
    refill: refillStatus_(),
    dividends: dividendSummary_(),
    kinds: FUND_KINDS,
    snapshots: readTable_('snapshots').map(s => ({
      ID: String(s.ID), Month: monthStr_(s.Month), Fund: String(s.Fund), Currency: s.Currency,
      ValueFX: num_(s.ValueFX), Rate: num_(s.Rate), ValueTHB: num_(s.ValueTHB),
    })).sort((a, b) => a.Month.localeCompare(b.Month)),
  };
}

/** ลงเงิน 1 ครั้ง แบ่งได้หลายกอง: {date, account, note, lines:[{fund, amountTHB, rate, nav}]} */
function apiSaveContribution_(b) {
  const funds = {};
  readTable_('funds').forEach(f => { funds[String(f.Name)] = f; });
  const lines = (b.lines || []).filter(l => l.fund && num_(l.amountTHB));
  if (!lines.length) throw new Error('กรุณาใส่จำนวนเงินอย่างน้อย 1 กอง');
  const batch = b.BatchID || newId_('B');
  let createdAt = new Date();
  if (b.BatchID) {
    const old = readTable_('contributions').filter(r => String(r.BatchID) === String(b.BatchID));
    if (old.some(r => String(r.Source) === 'withdraw' || String(r.Source) === 'transfer')) throw new Error('รายการดึงเงิน/ย้ายเงินแก้ไขไม่ได้ ให้ลบแล้วบันทึกใหม่');
    const firstOld = old.map(r => r.CreatedAt).filter(d => d instanceof Date).sort((x, y) => x - y)[0];
    if (firstOld) createdAt = firstOld;
    deleteWhere_('contributions', r => String(r.BatchID) === String(b.BatchID));
  }
  const date = toDate_(b.date);
  const navUpdates = [];
  const rows = lines.map(l => {
    const f = funds[l.fund];
    if (!f) throw new Error('ไม่พบกอง ' + l.fund);
    const kind = fundKind_(f);
    const cur = kind === KIND_USD ? 'USD' : 'THB';
    const thb = num_(l.amountTHB);
    const rate = cur === 'USD' ? num_(l.rate) : 1;
    if (cur === 'USD' && !rate) throw new Error('กรุณาใส่อัตราแลกเปลี่ยนของ ' + l.fund);
    let units = '';
    if (isUnitKind_(kind)) {
      const nav = num_(l.nav) || num_(f.NAV);
      if (!nav) throw new Error('กรุณาใส่ราคา/NAV ที่ซื้อของ ' + l.fund);
      units = Math.round(thb / nav * 10000) / 10000;
      if (!f.NavDate || fmtDate_(date) >= fmtDate_(f.NavDate)) navUpdates.push({ name: l.fund, nav: nav });
    }
    return {
      ID: newId_('C'), BatchID: batch, Date: date, Fund: l.fund, Currency: cur,
      AmountFX: cur === 'USD' ? round2_(thb / rate) : thb, Rate: rate, AmountTHB: thb,
      Account: b.account || '', Note: b.note || '', Source: b.sourceFund ? 'transfer' : 'manual', Units: units, CreatedAt: createdAt,
    };
  });
  if (b.sourceFund) rows.push(transferOut_(b.sourceFund, rows.reduce((s, r) => s + num_(r.AmountTHB), 0), batch, date, b.note, createdAt, lines.map(l => l.fund), b.sourceNav));
  appendRows_('contributions', rows);
  navUpdates.forEach(u => updateById_('funds', 'Name', u.name, { NAV: u.nav, NavDate: date }));
  return rows.length;
}

/** ดึงเงินออกจากกองต้นทางเพื่อย้ายไปกองอื่น (ไม่นับเป็นการดึงเงินมาใช้ และไม่นับเป็นเงินออมใหม่) */
function transferOut_(srcName, thb, batch, date, note, createdAt, destNames, navOverride) {
  if (destNames.indexOf(srcName) >= 0) throw new Error('กองต้นทางกับกองที่ลงเงินต้องไม่ใช่กองเดียวกัน');
  const f = readTable_('funds').find(x => String(x.Name) === String(srcName));
  if (!f) throw new Error('ไม่พบกอง ' + srcName);
  const v = fundsValuation_().find(x => x.Name === String(f.Name));
  if (!v || thb > v.valueTHB + 0.005) throw new Error('ยอดใน ' + srcName + ' ไม่พอ (มี ' + (v ? v.valueTHB.toLocaleString() : 0) + ' บาท)');
  const kind = fundKind_(f);
  const costOut = round2_(v.cost * (v.valueTHB ? thb / v.valueTHB : 1));
  let amountFX = -thb, units = '', rate = 1, cur = 'THB';
  if (kind === KIND_USD) { cur = 'USD'; rate = usdRate_(); amountFX = -round2_(thb / rate); }
  else if (isUnitKind_(kind)) { units = -Math.round(thb / (num_(navOverride) || v.nav) * 10000) / 10000; amountFX = -costOut; }
  return {
    ID: newId_('C'), BatchID: batch, Date: date, Fund: String(f.Name), Currency: cur, AmountFX: amountFX, Rate: rate,
    AmountTHB: -costOut, Account: '', Note: note || ('ย้ายไป ' + destNames.join(', ')), Source: 'transfer', Units: units, Cash: -thb, CreatedAt: createdAt,
  };
}

/**
 * รับเงินปันผล: บันทึกเป็นรายรับ แล้ว (ถ้าเลือก) ซื้อหุ้นตัวนั้นเพิ่ม หรือเก็บเข้ากองเงินสด
 * {date, fund, amountTHB?, amountUSD?, rate?, mode: 'reinvest'|'cash'|'none', price?, cashFund?, account?, note?}
 */
function apiReceiveDividend_(d) {
  const f = readTable_('funds').find(x => String(x.Name) === String(d.fund));
  if (!f) throw new Error('ไม่พบหุ้น/กอง ' + d.fund);
  const v = fundsValuation_().find(x => x.Name === String(f.Name)) || {};
  const rate = num_(d.rate) || usdRate_();
  const thb = round2_(num_(d.amountTHB) || num_(d.amountUSD) * rate);
  if (thb <= 0) throw new Error('กรุณาใส่ยอดเงินปันผล');
  const foreign = v.priceCurrency === 'USD' || (cleanTicker_(f.Ticker) && cleanTicker_(f.Ticker).indexOf('BKK:') !== 0);
  const category = foreign ? DIV_FOREIGN_CATEGORY : DIV_CATEGORY;
  if (!readTable_('categories').some(c => c.Type === INCOME && String(c.Name) === category)) {
    appendRows_('categories', [{ Type: INCOME, Name: category, MonthlyBudget: '', Active: true, NoTax: foreign }]);
  }
  const usdTxt = num_(d.amountUSD) ? ' $' + num_(d.amountUSD) + ' @' + rate : '';
  const note = d.note || ('ปันผล ' + f.Name + usdTxt);
  apiSaveTransaction_({
    Date: d.date, Type: INCOME, Category: category, Amount: thb, Account: d.account || '', Note: note, Item: String(f.Name), Source: 'dividend',
  });
  if (d.mode === 'reinvest') {
    apiSaveContribution_({ date: d.date, account: d.account || '', note: 'ปันผลซื้อเพิ่ม ' + f.Name, lines: [{ fund: String(f.Name), amountTHB: thb, nav: num_(d.price) }] });
  } else if (d.mode === 'cash') {
    if (!d.cashFund) throw new Error('กรุณาเลือกกองที่เก็บเงินปันผล');
    apiSaveContribution_({ date: d.date, account: d.account || '', note: 'ปันผล ' + f.Name, lines: [{ fund: d.cashFund, amountTHB: thb, rate: rate }] });
  }
  return { amountTHB: thb, category: category };
}

/** สรุปเงินปันผลรายหุ้น: ปีนี้ / ทั้งหมด */
function dividendSummary_() {
  const y = String(new Date().getFullYear());
  const by = {};
  readTable_('tx').filter(t => t.Type === INCOME && (String(t.Category) === DIV_CATEGORY || String(t.Category) === DIV_FOREIGN_CATEGORY)).forEach(t => {
    const k = String(t.Item || '') || 'ไม่ระบุหุ้น';
    const s = by[k] = by[k] || { name: k, year: 0, total: 0, count: 0, last: '' };
    s.total += num_(t.Amount); s.count++;
    if (fmtDate_(t.Date).slice(0, 4) === y) s.year += num_(t.Amount);
    if (fmtDate_(t.Date) > s.last) s.last = fmtDate_(t.Date);
  });
  return Object.keys(by).map(k => by[k]).map(s => Object.assign(s, { year: round2_(s.year), total: round2_(s.total) })).sort((a, b) => b.total - a.total);
}

function apiDeleteContributionBatch_(batchId) {
  return deleteWhere_('contributions', r => String(r.BatchID) === String(batchId));
}

/** บันทึกยอดสิ้นเดือน: {month, items:[{fund, valueFX, rate} | {fund, nav}]} แทนที่ของเดือนเดียวกัน */
function apiSaveSnapshots_(b) {
  const month = monthStr_(b.month);
  if (!month) throw new Error('กรุณาเลือกเดือน');
  const funds = {};
  readTable_('funds').forEach(f => { funds[String(f.Name)] = f; });
  const has = v => v !== '' && v !== null && v !== undefined;
  const items = (b.items || []).filter(i => i.fund && (has(i.valueFX) || has(i.nav)));
  const names = items.map(i => i.fund);
  deleteWhere_('snapshots', r => monthStr_(r.Month) === month && names.indexOf(String(r.Fund)) >= 0);
  const val = {};
  fundsValuation_().forEach(v => { val[v.Name] = v; });
  const today = new Date();
  const rows = items.map(i => {
    const f = funds[i.fund] || {};
    const kind = fundKind_(f);
    if (isUnitKind_(kind) && has(i.nav)) {
      // กองทุนรวม: อัปเดต NAV แล้วเก็บมูลค่า (หน่วย × NAV) ไว้เป็นประวัติ
      const nav = num_(i.nav);
      updateById_('funds', 'Name', i.fund, { NAV: nav, NavDate: today });
      const value = round2_((val[i.fund] ? val[i.fund].units : 0) * nav);
      return { ID: newId_('S'), Month: month, Fund: i.fund, Currency: 'THB', ValueFX: value, Rate: 1, ValueTHB: value, SavedAt: today };
    }
    const cur = kind === KIND_USD ? 'USD' : 'THB';
    const rate = cur === 'USD' ? (num_(i.rate) || usdRate_()) : 1;
    const fx = num_(i.valueFX);
    return { ID: newId_('S'), Month: month, Fund: i.fund, Currency: cur, ValueFX: fx, Rate: rate, ValueTHB: round2_(fx * rate), SavedAt: today };
  });
  appendRows_('snapshots', rows);
  return rows.length;
}

/**
 * เริ่มหน้าลงทุนใหม่: สำรองข้อมูลเดิม → ล้าง → สร้างกองและยอดตั้งต้น
 * rows: [{Name, Kind, Goal, Units, NAV, Value, Cost}]
 *   กองทุนรวม: Units + NAV (มูลค่า = Units × NAV) · เงิน USD: Value = ยอด USD · อื่นๆ: Value = บาท
 *   Cost = ต้นทุนเป็นบาท (ว่าง = เท่ากับมูลค่าปัจจุบัน)
 */
function apiResetInvest_(rows) {
  rows = (rows || []).filter(r => String(r.Name || '').trim());
  if (!rows.length) throw new Error('กรุณาใส่อย่างน้อย 1 รายการ');
  const names = {};
  rows.forEach(r => {
    const n = String(r.Name).trim();
    if (names[n]) throw new Error('ชื่อซ้ำ: ' + n);
    names[n] = true;
    if (FUND_KINDS.indexOf(r.Kind) < 0) throw new Error('ประเภทไม่ถูกต้อง: ' + n);
    if (isUnitKind_(r.Kind) && num_(r.Units) < 0) throw new Error('"' + n + '" จำนวนหน่วยติดลบไม่ได้');
    if (r.Kind === KIND_FUND && !num_(r.NAV)) throw new Error('กองทุนรวม "' + n + '" ต้องมีจำนวนหน่วยและ NAV');
    if (r.Kind === KIND_STOCK && !num_(r.NAV) && !cleanTicker_(r.Ticker)) throw new Error('หุ้น "' + n + '" ต้องมีราคาหรือชื่อย่อหุ้น');
  });

  // 1) สำรองแท็บเดิมไว้ในชีต
  const stamp = Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmm');
  const ss = ss_();
  ['funds', 'contributions', 'snapshots'].forEach(k => {
    const copy = sheet_(k).copyTo(ss);
    copy.setName(SHEETS[k].name.replace('App_', 'Backup_') + '_' + stamp);
  });

  // 2) ล้างแล้วสร้างใหม่
  const rate = usdRate_();
  const today = new Date();
  const month = monthStr_(today);
  const batch = 'B-opening-' + stamp;
  const funds = [], contrib = [], snaps = [];
  rows.forEach(r => {
    const name = String(r.Name).trim(), kind = r.Kind;
    const goal = r.Goal || GOAL_OTHER;
    const cur = kind === KIND_USD ? 'USD' : 'THB';
    const fund = { Name: name, Currency: cur, Goal: goal, Active: true, Kind: kind, NAV: '', NavDate: '', Ticker: kind === KIND_STOCK ? cleanTicker_(r.Ticker) : '' };
    let valueFX, valueTHB, units = '';
    if (isUnitKind_(kind)) {
      units = num_(r.Units);
      fund.NAV = num_(r.NAV);
      if (!fund.NAV && fund.Ticker) fund.NAV = apiQuote_(fund.Ticker).priceTHB;
      fund.NavDate = today;
      valueFX = valueTHB = round2_(units * fund.NAV);
    } else if (kind === KIND_USD) {
      valueFX = num_(r.Value);
      valueTHB = round2_(valueFX * rate);
    } else {
      valueFX = valueTHB = num_(r.Value);
    }
    const cost = r.Cost === '' || r.Cost === null || r.Cost === undefined ? valueTHB : num_(r.Cost);
    funds.push(fund);
    if (cost || valueFX || units) {
      contrib.push({
        ID: newId_('C'), BatchID: batch, Date: today, Fund: name, Currency: cur,
        AmountFX: kind === KIND_USD ? valueFX : cost, Rate: kind === KIND_USD && valueFX ? round2_(cost / valueFX) : 1,
        AmountTHB: cost, Account: '', Note: 'ยอดตั้งต้น', Source: 'opening', Units: units, CreatedAt: today,
      });
    }
    if (!isUnitKind_(kind)) {
      snaps.push({ ID: newId_('S'), Month: month, Fund: name, Currency: cur, ValueFX: valueFX, Rate: kind === KIND_USD ? rate : 1, ValueTHB: valueTHB, SavedAt: new Date(today.getTime() + 1) });
    }
  });
  replaceTable_('funds', funds);
  syncTickers_(funds.map(x => x.Ticker).filter(Boolean));
  replaceTable_('contributions', contrib);
  replaceTable_('snapshots', snaps);
  return { funds: funds.length, backup: 'Backup_*_' + stamp };
}

/**
 * ดึงเงินออกจากกองมาใช้: {date, fund, amountTHB, rate?, nav?, account, note, refill}
 * ต้นทุนของกองลดลงตามสัดส่วน (ต้นทุนเฉลี่ย) · ในสรุปรายเดือนหักออกจากเงินออม
 */
function apiWithdraw_(w) {
  const f = readTable_('funds').find(x => String(x.Name) === String(w.fund));
  if (!f) throw new Error('ไม่พบกอง ' + w.fund);
  const thb = num_(w.amountTHB);
  if (thb <= 0) throw new Error('กรุณาใส่จำนวนเงินที่ดึง');
  const v = fundsValuation_().find(x => x.Name === String(f.Name));
  if (v && thb > v.valueTHB + 0.005) throw new Error('ดึงได้ไม่เกินยอดในกอง (' + v.valueTHB.toLocaleString() + ' บาท)');
  const kind = fundKind_(f);
  const ratioOfValue = v && v.valueTHB ? thb / v.valueTHB : 1;
  const costOut = v ? round2_(v.cost * ratioOfValue) : thb;
  let amountFX = -thb, units = '', rate = 1, cur = 'THB';
  if (kind === KIND_USD) {
    cur = 'USD';
    rate = num_(w.rate) || usdRate_();
    amountFX = -round2_(thb / rate);
  } else if (isUnitKind_(kind)) {
    const nav = num_(w.nav) || (v && v.nav) || num_(f.NAV);
    if (!nav) throw new Error('กรุณาใส่ราคา/NAV ที่ขาย');
    units = -Math.round(thb / nav * 10000) / 10000;
    amountFX = -costOut;
  }
  const row = {
    ID: newId_('C'), BatchID: newId_('W'), Date: toDate_(w.date), Fund: String(f.Name), Currency: cur,
    AmountFX: amountFX, Rate: rate, AmountTHB: -costOut, Account: w.account || '', Note: w.note || 'ดึงเงินมาใช้',
    Source: 'withdraw', Units: units, Cash: -thb, Refill: !!w.refill, CreatedAt: new Date(),
  };
  appendRows_('contributions', [row]);
  return true;
}

function apiDeleteSnapshot_(id) {
  return deleteWhere_('snapshots', r => String(r.ID) === String(id));
}

/* ============ เงินให้ยืม ============ */

function loansComputed_() {
  const today = fmtDate_(new Date());
  const pays = readTable_('loanPayments').map(p => ({
    ID: String(p.ID), LoanID: String(p.LoanID), Date: fmtDate_(p.Date), Total: num_(p.Total),
    Interest: num_(p.Interest), Principal: num_(p.Principal), Note: String(p.Note || ''),
  }));
  return readTable_('loans').map(l => {
    const id = String(l.LoanID);
    const ps = pays.filter(p => p.LoanID === id).sort((a, b) => a.Date.localeCompare(b.Date));
    const paidPrincipal = ps.reduce((s, p) => s + p.Principal, 0);
    const paidInterest = ps.reduce((s, p) => s + p.Interest, 0);
    const remaining = Math.max(0, round2_(num_(l.Principal) - paidPrincipal));
    const closed = isTrue_(l.Closed) || remaining <= 0;
    const due = fmtDate_(l.DueDate);
    const status = closed ? LOAN_CLOSED : (due && due < today ? LOAN_OVERDUE : LOAN_OPEN);
    const rate = num_(l.InterestRate);
    return {
      LoanID: id, Borrower: String(l.Borrower), Date: fmtDate_(l.Date), Principal: num_(l.Principal),
      SourceAccount: String(l.SourceAccount || ''), InterestType: l.InterestType || 'none', InterestRate: optNum_(l.InterestRate),
      InterestNote: String(l.InterestNote || ''), DueDate: due, PayAccountNo: String(l.PayAccountNo || ''),
      Bank: String(l.Bank || ''), Note: String(l.Note || ''), Closed: isTrue_(l.Closed),
      paidPrincipal: round2_(paidPrincipal), paidInterest: round2_(paidInterest), remaining: closed ? 0 : remaining,
      monthlyInterest: !closed && l.InterestType === 'percent' ? round2_(remaining * rate / 100) : 0,
      status, payments: ps,
    };
  });
}

function isTrue_(v) {
  return v === true || String(v).toUpperCase() === 'TRUE';
}

function apiLoans_() {
  return loansComputed_().sort((a, b) => (b.Date || '').localeCompare(a.Date || ''));
}

function apiSaveLoan_(l) {
  if (!l.Borrower) throw new Error('กรุณาใส่ชื่อผู้ยืม');
  if (!num_(l.Principal)) throw new Error('กรุณาใส่จำนวนเงิน');
  const row = {
    Borrower: l.Borrower, Date: optDate_(l.Date), Principal: num_(l.Principal), SourceAccount: l.SourceAccount || '',
    InterestType: l.InterestType || 'none', InterestRate: l.InterestType === 'percent' ? num_(l.InterestRate) : '',
    InterestNote: l.InterestNote || '', DueDate: optDate_(l.DueDate), PayAccountNo: l.PayAccountNo || '',
    Bank: l.Bank || '', Note: l.Note || '', Closed: !!l.Closed,
  };
  if (l.LoanID && readTable_('loans').some(r => String(r.LoanID) === String(l.LoanID))) {
    return updateById_('loans', 'LoanID', l.LoanID, row);
  }
  const max = readTable_('loans').reduce((m, r) => {
    const n = parseInt(String(r.LoanID).replace(/\D/g, ''), 10);
    return isFinite(n) && n > m ? n : m;
  }, 0);
  row.LoanID = 'Dept-' + ('00' + (max + 1)).slice(-3);
  appendRows_('loans', [row]);
  return row;
}

function apiDeleteLoan_(id) {
  deleteWhere_('loanPayments', r => String(r.LoanID) === String(id));
  return deleteWhere_('loans', r => String(r.LoanID) === String(id));
}

function apiSavePayment_(p) {
  if (!p.LoanID) throw new Error('ไม่พบรหัสการกู้');
  const interest = num_(p.Interest), principal = num_(p.Principal);
  if (!interest && !principal) throw new Error('กรุณาใส่ดอกเบี้ยหรือเงินต้น');
  const row = { LoanID: p.LoanID, Date: toDate_(p.Date), Interest: interest, Principal: principal, Total: interest + principal, Note: p.Note || '' };
  if (p.ID) return updateById_('loanPayments', 'ID', p.ID, row);
  row.ID = newId_('P');
  appendRows_('loanPayments', [row]);
  return row;
}

function apiDeletePayment_(id) {
  return deleteWhere_('loanPayments', r => String(r.ID) === String(id));
}

/* ============ ภาษี ============ */

const TAX_FIELDS_ = ['IncomeOverride', 'Withheld', 'Ded_Expense', 'Ded_Personal', 'Ded_Family', 'Ded_Insurance',
  'Ded_SocialSecurity', 'Ded_Fund', 'Ded_Property', 'Ded_Other', 'TaxOverride'];

function apiTax_(year) {
  year = Number(year) || new Date().getFullYear();
  const rows = readTable_('tax');
  let row = rows.find(r => Number(r.Year) === year);
  const out = { Year: year, Note: '' };
  if (row) {
    TAX_FIELDS_.forEach(f => { out[f] = optNum_(row[f]); });
    out.Note = String(row.Note || '');
    out.saved = true;
  } else {
    // ปีใหม่: ใช้ค่าลดหย่อนของปีล่าสุดก่อนหน้าเป็นค่าเริ่มต้น
    const prev = rows.filter(r => Number(r.Year) < year).sort((a, b) => b.Year - a.Year)[0];
    TAX_FIELDS_.forEach(f => { out[f] = ''; });
    if (prev) ['Ded_Personal', 'Ded_Family', 'Ded_Insurance', 'Ded_SocialSecurity', 'Ded_Fund', 'Ded_Property', 'Ded_Other']
      .forEach(f => { out[f] = optNum_(prev[f]); });
    out.saved = false;
  }
  const noTax = {};
  readTable_('categories').forEach(c => { if (c.Type === INCOME && isTrue_(c.NoTax)) noTax[String(c.Name)] = true; });
  const excluded = {};
  let autoIncome = 0;
  readTable_('tx').filter(t => t.Type === INCOME && monthStr_(t.Date).slice(0, 4) === String(year)).forEach(t => {
    const cat = String(t.Category);
    if (noTax[cat]) excluded[cat] = round2_((excluded[cat] || 0) + num_(t.Amount));
    else autoIncome += num_(t.Amount);
  });
  const years = rows.map(r => Number(r.Year));
  readTable_('tx').forEach(t => { const y = Number(monthStr_(t.Date).slice(0, 4)); if (y) years.push(y); });
  years.push(new Date().getFullYear());
  return {
    row: out,
    autoIncome: round2_(autoIncome),
    excluded: excluded,
    brackets: readTable_('taxBrackets').map(b => ({ Min: num_(b.Min), Max: optNum_(b.Max), Rate: num_(b.Rate) })).sort((a, b) => a.Min - b.Min),
    years: Array.from(new Set(years)).sort((a, b) => b - a),
  };
}

function apiSaveTax_(t) {
  const year = Number(t.Year);
  if (!year) throw new Error('ปีไม่ถูกต้อง');
  const row = { Year: year, Note: String(t.Note || '').replace('[import]', '').trim() };
  TAX_FIELDS_.forEach(f => { row[f] = optNum_(t[f]); });
  if (readTable_('tax').some(r => Number(r.Year) === year)) updateById_('tax', 'Year', year, row);
  else appendRows_('tax', [row]);
  return true;
}

/* ============ สุขภาพ ============ */

function healthItems_() {
  return readTable_('healthItems').map(i => ({
    Name: String(i.Name), Unit: String(i.Unit || ''), Min: optNum_(i.Min), Max: optNum_(i.Max),
    Group: String(i.Group || ''), Order: num_(i.Order), Active: isActive_(i.Active),
  })).sort((a, b) => a.Order - b.Order);
}

function apiHealth_() {
  const results = readTable_('healthResults');
  const visits = readTable_('healthVisits').map(v => {
    const id = String(v.VisitID);
    const values = {};
    results.filter(r => String(r.VisitID) === id).forEach(r => { values[String(r.Item)] = r.Value; });
    return { VisitID: id, Date: fmtDate_(v.Date), Hospital: String(v.Hospital || ''), FileUrl: String(v.FileUrl || ''), Note: String(v.Note || ''), values };
  }).sort((a, b) => b.Date.localeCompare(a.Date));
  return { items: healthItems_(), visits };
}

/** {VisitID?, Date, Hospital, FileUrl, Note, values:{item: value}} */
function apiSaveVisit_(v) {
  const row = { Date: toDate_(v.Date), Hospital: v.Hospital || '', FileUrl: v.FileUrl || '', Note: v.Note || '' };
  let id = v.VisitID;
  if (id) {
    updateById_('healthVisits', 'VisitID', id, row);
    deleteWhere_('healthResults', r => String(r.VisitID) === String(id));
  } else {
    id = newId_('H');
    row.VisitID = id;
    appendRows_('healthVisits', [row]);
  }
  const res = Object.keys(v.values || {})
    .filter(k => v.values[k] !== '' && v.values[k] !== null && v.values[k] !== undefined)
    .map(k => {
      const raw = v.values[k];
      const n = parseFloat(raw);
      return { VisitID: id, Item: k, Value: isFinite(n) && String(n) === String(raw).trim() ? n : String(raw) };
    });
  appendRows_('healthResults', res);
  return id;
}

function apiDeleteVisit_(id) {
  deleteWhere_('healthResults', r => String(r.VisitID) === String(id));
  return deleteWhere_('healthVisits', r => String(r.VisitID) === String(id));
}

/* ============ ตั้งค่า ============ */

const EDITABLE_TABLES_ = ['categories', 'accounts', 'funds', 'goals', 'healthItems', 'taxBrackets', 'config'];
const HIDDEN_CONFIG_ = ['USD_THB', 'DRIVE_FOLDER_ID', 'IMPORT_DONE', 'PLAN_IMPORT_DONE', 'SCHEMA_VERSION', 'TARGET_EMERGENCY', 'TARGET_RETIREMENT'];

function apiGetTable_(key) {
  if (EDITABLE_TABLES_.indexOf(key) < 0) throw new Error('แก้ไขตารางนี้ไม่ได้');
  let rows = readTable_(key);
  if (key === 'config') rows = rows.filter(r => HIDDEN_CONFIG_.indexOf(r.Key) < 0);
  return { headers: SHEETS[key].headers, rows };
}

function apiSaveTable_(key, rows) {
  if (EDITABLE_TABLES_.indexOf(key) < 0) throw new Error('แก้ไขตารางนี้ไม่ได้');
  const headers = SHEETS[key].headers;
  const required = headers[key === 'taxBrackets' ? 2 : (key === 'config' ? 0 : (key === 'categories' ? 1 : 0))];
  // คอลัมน์ที่หน้าตั้งค่าไม่ได้ส่งมา (เช่น NAV ของกอง) ให้คงค่าเดิมไว้
  const idOf = r => (key === 'categories' ? r.Type + '|' + r.Name : String(r[headers[0]]));
  const old = {};
  if (key !== 'taxBrackets') readTable_(key).forEach(r => { old[idOf(r)] = r; });
  let clean = (rows || []).filter(r => String(r[required] === undefined ? '' : r[required]).trim() !== '').map(r => {
    const o = {};
    const prev = old[idOf(r)] || {};
    headers.forEach(h => {
      let v = r[h] === undefined ? prev[h] : r[h];
      v = v === undefined || v === null ? '' : v;
      if (typeof v === 'string' && r[h] !== undefined) {
        v = v.trim();
        if (v.charAt(0) === '=') v = "'" + v; // กันสูตรจากหน้าเว็บ
      }
      o[h] = v;
    });
    return o;
  });
  if (key === 'config') {
    const keep = readTable_('config').filter(r => HIDDEN_CONFIG_.indexOf(r.Key) >= 0).map(r => {
      const d = DEFAULTS.config.find(x => x.Key === r.Key);
      return r.Key === 'USD_THB' ? d : { Key: r.Key, Value: r.Value, Description: r.Description };
    });
    clean = clean.filter(r => HIDDEN_CONFIG_.indexOf(r.Key) < 0).concat(keep);
  }
  if (key === 'funds') {
    clean.forEach(r => { r.Ticker = cleanTicker_(r.Ticker); });
    syncTickers_(clean.map(r => r.Ticker));
  }
  replaceTable_(key, clean);
  return clean.length;
}

/* ============ ไฟล์แนบ ============ */

/** {name, mimeType, base64, kind: 'receipt' | 'health'} → {url, id} */
function apiUpload_(f) {
  if (!f || !f.base64) throw new Error('ไม่มีไฟล์');
  if (f.base64.length > 20 * 1024 * 1024) throw new Error('ไฟล์ใหญ่เกิน 15MB');
  const ok = /^(image\/|application\/pdf$)/.test(f.mimeType || '');
  if (!ok) throw new Error('รองรับเฉพาะรูปภาพหรือ PDF');
  const blob = Utilities.newBlob(Utilities.base64Decode(f.base64), f.mimeType,
    Utilities.formatDate(new Date(), TZ, 'yyyyMMdd-HHmmss') + '_' + String(f.name || 'file').replace(/[\\/:*?"<>|]/g, '_'));
  const file = filesFolder_(f.kind).createFile(blob);
  return { url: file.getUrl(), id: file.getId() };
}

/* ============ Dashboard ============ */

function apiDashboard_(month) {
  month = monthStr_(month) || cycleMonth_(new Date());
  const cfg = getConfig_();
  const agg = aggregateByMonth_();
  const cur = agg[month] || emptyAgg_();
  const savingTarget = num_(cfg.SAVING_RATE_TARGET) || 20;

  const categories = readTable_('categories');
  const budgets = categories
    .filter(c => c.Type === EXPENSE && isActive_(c.Active) && num_(c.MonthlyBudget) > 0)
    .map(c => ({ category: String(c.Name), budget: num_(c.MonthlyBudget), spent: round2_(cur.byCat[EXPENSE + '|' + c.Name] || 0) }));

  const expenseByCat = Object.keys(cur.byCat).filter(k => k.indexOf(EXPENSE + '|') === 0)
    .map(k => ({ category: k.split('|')[1], amount: round2_(cur.byCat[k]) })).sort((a, b) => b.amount - a.amount);

  const trend = [];
  for (let i = 11; i >= 0; i--) {
    const m = addMonths_(month, -i);
    const a = agg[m] || emptyAgg_();
    trend.push({ month: m, income: round2_(a.income), expense: round2_(a.expense), saving: round2_(a.saving), remaining: round2_(a.income - a.expense - a.saving) });
  }

  const goals = goalsStatus_();

  const openLoans = loansComputed_().filter(l => l.status !== LOAN_CLOSED)
    .sort((a, b) => (a.DueDate || '9999').localeCompare(b.DueDate || '9999'))
    .map(l => ({ LoanID: l.LoanID, Borrower: l.Borrower, remaining: l.remaining, DueDate: l.DueDate, status: l.status, monthlyInterest: l.monthlyInterest }));

  const recurringPending = apiRecurring_(month).filter(r => r.Active && !r.Posted);

  // รายการที่ต้องจ่ายตามแผนรอบนี้ (ระดับรายการย่อยถ้ามี) พร้อมยอดที่จ่ายแล้ว
  const checklist = [];
  apiPlanVsActual_(month).rows.filter(r => r.type === EXPENSE).forEach(r => {
    const subs = (r.items || []).filter(i => !i.unassigned && i.plan > 0);
    if (subs.length) subs.forEach(i => checklist.push({ category: r.category, item: i.item, plan: i.plan, paid: i.actual }));
    else if (r.plan > 0) checklist.push({ category: r.category, item: '', plan: r.plan, paid: r.actual });
  });
  checklist.forEach(c => { c.remaining = round2_(Math.max(0, c.plan - c.paid)); });
  checklist.sort((a, b) => (b.remaining > 0) - (a.remaining > 0) || b.remaining - a.remaining);
  const installmentsPending = apiInstallments_(month).filter(i => i.dueThisMonth)
    .map(i => ({ ID: i.ID, Name: i.Name, Category: i.Category, Amount: Math.min(i.Monthly, i.remaining || i.Monthly), Type: EXPENSE, paid: i.paidCount, months: i.Months }));

  // แผนเดือนนี้ + เดือนข้างหน้าที่คาดว่าเงินไม่พอ
  const now = cycleMonth_(new Date());
  const plan = buildPlan_(monthRange_(month, 1));
  const planNow = planTotals_(plan)[0];
  const future = planTotals_(buildPlan_(monthRange_(now, 12)));
  const planAlerts = future.filter(t => t.remaining < 0);

  return {
    month,
    cards: {
      income: round2_(cur.income), expense: round2_(cur.expense), saving: round2_(cur.saving),
      remaining: round2_(cur.income - cur.expense - cur.saving), interest: round2_(cur.interest), withdraw: round2_(cur.withdraw),
      savingRate: cur.income > 0 ? round2_(cur.saving / cur.income * 100) : 0, savingTarget,
    },
    budgets, expenseByCat, trend, goals,
    loans: { total: round2_(openLoans.reduce((s, l) => s + l.remaining, 0)), list: openLoans },
    recurringPending, installmentsPending, planNow, planAlerts, refill: refillStatus_(), checklist, savingsPlan: savingsPlan_(month),
  };
}
