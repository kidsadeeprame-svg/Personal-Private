/**
 * ===== ค่าตั้งต้นของแอป =====
 * แก้ไขได้ตามต้องการ (ส่วนใหญ่ตั้งค่าได้จากหน้า "ตั้งค่า" ในเว็บ หรือแท็บ App_Config)
 */
const APP_TITLE = 'การเงินและสุขภาพ';

// ถ้าวางสคริปต์ใน "ส่วนขยาย > Apps Script" ของชีตโดยตรง ปล่อยว่างไว้ได้
// ถ้าสร้างเป็นโปรเจกต์แยก ให้ใส่ ID ของชีต (ส่วนที่อยู่ระหว่าง /d/ กับ /edit ใน URL)
const SPREADSHEET_ID = '';

const TZ = 'Asia/Bangkok';

// เพิ่มเลขนี้เมื่อเปลี่ยนโครงสร้างแท็บ เพื่อให้หัวคอลัมน์ถูกอัปเดตอัตโนมัติ
const SCHEMA_VERSION = 3;

const INCOME = 'รายรับ';
const EXPENSE = 'รายจ่าย';
const INTEREST_CATEGORY = 'ดอกเบี้ยรับ (เงินให้ยืม)';

const GOAL_EMERGENCY = 'ฉุกเฉิน';
const GOAL_RETIREMENT = 'เกษียณ';
const GOAL_OTHER = 'อื่นๆ';

const LOAN_OPEN = 'ค้างชำระ';
const LOAN_OVERDUE = 'เกินกำหนด';
const LOAN_CLOSED = 'ปิดยอด';

const PLAN_SAVING_TYPE = 'ออม';
const PLAN_SAVING = 'เงินออม/ลงทุน';
const SALARY_CATEGORY = 'เงินเดือน';
const BONUS_CATEGORY = 'โบนัส';

/**
 * โครงสร้างแท็บที่เว็บใช้ (สร้างให้อัตโนมัติเมื่อรัน setup)
 * text: คอลัมน์ที่บังคับให้เป็นข้อความ (กันชีตแปลง "2026-11" เป็นวันที่)
 */
const SHEETS = {
  config:        { name: 'App_Config',        headers: ['Key', 'Value', 'Description'] },
  categories:    { name: 'App_Categories',    headers: ['Type', 'Name', 'MonthlyBudget', 'Active'] },
  accounts:      { name: 'App_Accounts',      headers: ['Name', 'Active'] },
  tx:            { name: 'App_Transactions',  headers: ['ID', 'Date', 'Type', 'Category', 'Amount', 'Account', 'Note', 'ReceiptUrl', 'Source', 'CreatedAt', 'Item'] },
  recurring:     { name: 'App_Recurring',     headers: ['ID', 'Name', 'Type', 'Category', 'Amount', 'Account', 'DayOfMonth', 'Active', 'LastPostedMonth', 'Item'], text: ['LastPostedMonth'] },
  funds:         { name: 'App_Funds',         headers: ['Name', 'Currency', 'Goal', 'Active'] },
  contributions: { name: 'App_Contributions', headers: ['ID', 'BatchID', 'Date', 'Fund', 'Currency', 'AmountFX', 'Rate', 'AmountTHB', 'Account', 'Note', 'Source'] },
  snapshots:     { name: 'App_FundSnapshots', headers: ['ID', 'Month', 'Fund', 'Currency', 'ValueFX', 'Rate', 'ValueTHB'], text: ['Month'] },
  loans:         { name: 'App_Loans',         headers: ['LoanID', 'Borrower', 'Date', 'Principal', 'SourceAccount', 'InterestType', 'InterestRate', 'InterestNote', 'DueDate', 'PayAccountNo', 'Bank', 'Note', 'Closed'], text: ['PayAccountNo'] },
  loanPayments:  { name: 'App_LoanPayments',  headers: ['ID', 'LoanID', 'Date', 'Total', 'Interest', 'Principal', 'Note'] },
  tax:           { name: 'App_Tax',           headers: ['Year', 'IncomeOverride', 'Withheld', 'Ded_Expense', 'Ded_Personal', 'Ded_Family', 'Ded_Insurance', 'Ded_SocialSecurity', 'Ded_Fund', 'Ded_Property', 'Ded_Other', 'TaxOverride', 'Note'] },
  taxBrackets:   { name: 'App_TaxBrackets',   headers: ['Min', 'Max', 'Rate'] },
  healthItems:   { name: 'App_HealthItems',   headers: ['Name', 'Unit', 'Min', 'Max', 'Group', 'Order', 'Active'] },
  healthVisits:  { name: 'App_HealthVisits',  headers: ['VisitID', 'Date', 'Hospital', 'FileUrl', 'Note'] },
  healthResults: { name: 'App_HealthResults', headers: ['VisitID', 'Item', 'Value'] },
  plan:          { name: 'App_Plan',          headers: ['Month', 'Type', 'Category', 'Amount', 'Source', 'Item'], text: ['Month'] },
  planItems:     { name: 'App_PlanItems',     headers: ['ID', 'Type', 'Category', 'Name', 'DefaultAmount', 'Order', 'Active'] },
  installments:  { name: 'App_Installments',  headers: ['ID', 'Name', 'Total', 'Months', 'StartMonth', 'Monthly', 'Category', 'Account', 'DayOfMonth', 'Note'], text: ['StartMonth'] },
};

/** ค่าเริ่มต้นที่ใส่ให้ตอน setup (ใส่เฉพาะเมื่อแท็บยังว่าง) */
const DEFAULTS = {
  config: [
    { Key: 'SAVING_RATE_TARGET', Value: 20, Description: 'เป้าเงินออม/ลงทุน (% ของรายรับต่อเดือน)' },
    { Key: 'TARGET_EMERGENCY', Value: 99800, Description: 'เป้าเงินสำรองฉุกเฉิน (บาท)' },
    { Key: 'TARGET_RETIREMENT', Value: 4800000, Description: 'เป้าเงินเกษียณ (บาท)' },
    { Key: 'USD_THB', Value: '=GOOGLEFINANCE("CURRENCY:USDTHB")', Description: 'อัตรา USD→THB ปัจจุบัน (ดึงอัตโนมัติ ห้ามแก้)' },
    { Key: 'USD_THB_FALLBACK', Value: 33, Description: 'อัตรา USD→THB สำรอง เมื่อดึงอัตโนมัติไม่ได้' },
    { Key: 'DRIVE_FOLDER_ID', Value: '', Description: 'โฟลเดอร์ Drive เก็บไฟล์แนบ (สร้างอัตโนมัติ)' },
    { Key: 'IMPORT_DONE', Value: '', Description: 'วันที่นำเข้าข้อมูลเก่า (ระบบใช้ กันนำเข้าซ้ำ)' },
    { Key: 'BASE_SALARY', Value: '', Description: 'เงินเดือนปัจจุบันสำหรับคาดการณ์ (เว้นว่าง = ใช้รายการเงินเดือนล่าสุด)' },
    { Key: 'SALARY_GROWTH_PCT', Value: 3, Description: 'เงินเดือนขึ้นต่อปี (%)' },
    { Key: 'SALARY_RAISE_MONTH', Value: 5, Description: 'เดือนที่เงินเดือนขึ้น (1-12)' },
    { Key: 'BONUS_MONTHS', Value: 2.5, Description: 'โบนัสกี่เท่าของเงินเดือน (0 = ไม่มี)' },
    { Key: 'BONUS_MONTH', Value: 4, Description: 'เดือนที่ได้โบนัส (1-12)' },
    { Key: 'INFLATION_PCT', Value: 3, Description: 'เงินเฟ้อ: รายจ่ายเพิ่มต่อปี (%) สำหรับคาดการณ์ระยะยาว' },
    { Key: 'RETURN_PCT', Value: 4, Description: 'ผลตอบแทนเงินออม/ลงทุนต่อปี (%) สำหรับคาดการณ์ระยะยาว' },
    { Key: 'BIRTH_YEAR', Value: 1998, Description: 'ปีเกิด (ค.ศ.)' },
    { Key: 'RETIRE_AGE', Value: 60, Description: 'อายุที่จะเกษียณ' },
    { Key: 'PLAN_IMPORT_DONE', Value: '', Description: 'วันที่นำเข้าแผนจาก Expen Life (ระบบใช้)' },
  ],
  categories: [
    [INCOME, 'เงินเดือน', ''], [INCOME, 'โบนัส', ''], [INCOME, 'รายได้เสริม', ''],
    [INCOME, 'เงินปันผล', ''], [INCOME, 'เงินคืนประกัน', ''], [INCOME, 'อื่นๆ', ''],
    [EXPENSE, 'บิลโทรศัพท์/เน็ต', 1300], [EXPENSE, 'Subscription', 400],
    [EXPENSE, 'อาหาร/ชีวิตประจำวัน', 5600], [EXPENSE, 'เดินทาง', 3500],
    [EXPENSE, 'ประกัน/สุขภาพ', 750], [EXPENSE, 'หนี้สิน/ผ่อน', 6200],
    [EXPENSE, 'สันทนาการ/อื่นๆ', 3000], [EXPENSE, 'ช้อปปิ้ง', ''],
    [EXPENSE, 'ภาษี', ''], [EXPENSE, 'อื่นๆ', ''],
  ].map(r => ({ Type: r[0], Name: r[1], MonthlyBudget: r[2], Active: true })),
  accounts: ['Kbank', 'K-next', 'SCB', 'Dime', 'Make', 'KTC', 'Card x', 'Shopee PayLater', 'หักเงินเดือน', 'เงินสด']
    .map(n => ({ Name: n, Active: true })),
  funds: [
    ['เงินสำรองฉุกเฉิน', 'THB', GOAL_EMERGENCY],
    ['เงินสำรองฉุกเฉิน USD', 'USD', GOAL_EMERGENCY],
    ['พอร์ตลงทุน/เกษียณ', 'THB', GOAL_RETIREMENT],
    ['ประกันออมทรัพย์ FWD', 'THB', GOAL_RETIREMENT],
    ['ออมอื่นๆ', 'THB', GOAL_OTHER],
  ].map(r => ({ Name: r[0], Currency: r[1], Goal: r[2], Active: true })),
  // ขั้นภาษีเงินได้บุคคลธรรมดา (เงินได้สุทธิ)
  taxBrackets: [
    [0, 150000, 0], [150000, 300000, 5], [300000, 500000, 10], [500000, 750000, 15],
    [750000, 1000000, 20], [1000000, 2000000, 25], [2000000, 5000000, 30], [5000000, '', 35],
  ].map(r => ({ Min: r[0], Max: r[1], Rate: r[2] })),
  healthItems: [
    ['น้ำหนัก', 'kg', '', '', 'ร่างกาย'],
    ['BMI', 'kg/m²', 18.5, 22.9, 'ร่างกาย'],
    ['รอบเอว', 'cm', '', 90, 'ร่างกาย'],
    ['ความดันตัวบน (Systolic)', 'mmHg', 90, 120, 'ร่างกาย'],
    ['ความดันตัวล่าง (Diastolic)', 'mmHg', 60, 80, 'ร่างกาย'],
    ['น้ำตาลในเลือด (FBS)', 'mg/dL', 70, 100, 'น้ำตาล'],
    ['HbA1c', '%', '', 5.7, 'น้ำตาล'],
    ['คอเลสเตอรอลรวม', 'mg/dL', '', 200, 'ไขมัน'],
    ['ไตรกลีเซอไรด์', 'mg/dL', '', 150, 'ไขมัน'],
    ['HDL', 'mg/dL', 40, '', 'ไขมัน'],
    ['LDL', 'mg/dL', '', 130, 'ไขมัน'],
    ['SGOT (AST)', 'U/L', '', 40, 'ตับ'],
    ['SGPT (ALT)', 'U/L', '', 41, 'ตับ'],
    ['ครีเอตินิน', 'mg/dL', 0.7, 1.3, 'ไต'],
    ['eGFR', 'mL/min', 90, '', 'ไต'],
    ['กรดยูริก', 'mg/dL', 3.5, 7.2, 'ไต'],
    ['ฮีโมโกลบิน (Hb)', 'g/dL', 13, 17, 'เลือด'],
  ].map((r, i) => ({ Name: r[0], Unit: r[1], Min: r[2], Max: r[3], Group: r[4], Order: i + 1, Active: true })),
};
