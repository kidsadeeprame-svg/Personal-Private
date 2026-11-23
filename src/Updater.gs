/**
 * ===== อัปเดตโค้ดจาก GitHub (ไม่ต้องใช้ Node.js / clasp) =====
 *
 * ดึงไฟล์ล่าสุดในโฟลเดอร์ src/ ของ repo มาเขียนทับโค้ดในโปรเจกต์ Apps Script นี้
 * (อัปเดต "โค้ดล่าสุด" เท่านั้น — เว็บแอปจะใช้โค้ดใหม่เมื่อกด Deploy → New version
 *  ส่วนลิงก์ทดสอบ /dev ใช้โค้ดล่าสุดทันที)
 *
 * ต้องเปิด Google Apps Script API ครั้งเดียวที่ https://script.google.com/home/usersettings
 * ถ้า repo เป็น private: ตั้ง Script property ชื่อ GITHUB_TOKEN (fine-grained token สิทธิ์อ่าน Contents ของ repo นี้)
 */
const UPDATE_REPO = 'kidsadeeprame-svg/Personal-Private';
const UPDATE_BRANCH = 'main';
const UPDATE_DIR = 'src';

function ghHeaders_(raw) {
  const h = { Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json', 'User-Agent': 'apps-script-updater' };
  const token = PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN');
  if (token) h.Authorization = 'Bearer ' + token;
  return h;
}

function ghApi_(path) {
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + UPDATE_REPO + path, { headers: ghHeaders_(false), muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code === 404) throw new Error('หา repo ไม่เจอ (ถ้า repo เป็น private ต้องตั้ง Script property GITHUB_TOKEN)');
  if (code === 403 || code === 429) throw new Error('GitHub จำกัดจำนวนครั้งชั่วคราว ลองใหม่ในอีกสักครู่');
  if (code !== 200) throw new Error('GitHub ตอบกลับ ' + code + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

function ghRaw_(sha, path) {
  const url = 'https://raw.githubusercontent.com/' + UPDATE_REPO + '/' + sha + '/' + path.split('/').map(encodeURIComponent).join('/');
  const res = UrlFetchApp.fetch(url, { headers: ghHeaders_(true), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('ดาวน์โหลด ' + path + ' ไม่สำเร็จ (' + res.getResponseCode() + ')');
  return res.getContentText('UTF-8');
}

/** ข้อมูลเวอร์ชันปัจจุบัน/ล่าสุด */
function updateInfo_(checkLatest) {
  const props = PropertiesService.getScriptProperties();
  const out = {
    repo: UPDATE_REPO, branch: UPDATE_BRANCH,
    currentSha: props.getProperty('CODE_SHA') || '', updatedAt: props.getProperty('CODE_UPDATED_AT') || '',
    autoUpdate: ScriptApp.getProjectTriggers().some(t => t.getHandlerFunction() === 'updateFromGitHub'),
  };
  if (checkLatest) {
    const br = ghApi_('/branches/' + UPDATE_BRANCH);
    out.latestSha = br.commit.sha;
    out.latestMessage = String(br.commit.commit.message || '').split('\n')[0];
    out.latestDate = br.commit.commit.committer ? br.commit.commit.committer.date : '';
    out.upToDate = out.latestSha === out.currentSha;
  }
  return out;
}

/**
 * อัปเดตโค้ดจาก GitHub — รันจากหน้า Apps Script (เลือกฟังก์ชันนี้ → เรียกใช้) หรือปุ่มในหน้า ตั้งค่า ของเว็บ
 * force = true: อัปเดตแม้ว่าเวอร์ชันจะตรงกันแล้ว
 */
function updateFromGitHub(force) {
  const props = PropertiesService.getScriptProperties();
  force = force === true;

  // 1) จำ ID ชีตไว้ใน Script property ก่อน เพราะ Config.gs จาก GitHub ไม่มี ID ชีต
  if (!props.getProperty('SPREADSHEET_ID')) props.setProperty('SPREADSHEET_ID', ss_().getId());

  // 2) หาเวอร์ชันล่าสุด
  const br = ghApi_('/branches/' + UPDATE_BRANCH);
  const sha = br.commit.sha;
  const msg = String(br.commit.commit.message || '').split('\n')[0];
  if (!force && sha === props.getProperty('CODE_SHA')) {
    const r = 'โค้ดเป็นเวอร์ชันล่าสุดแล้ว (' + sha.slice(0, 7) + ')';
    Logger.log(r);
    return { updated: false, message: r, sha };
  }

  // 3) ดาวน์โหลดไฟล์ใน src/
  const tree = ghApi_('/git/trees/' + sha + '?recursive=1').tree
    .filter(t => t.type === 'blob' && t.path.indexOf(UPDATE_DIR + '/') === 0 && t.path.split('/').length === 2);
  const files = [];
  tree.forEach(t => {
    const file = t.path.split('/')[1];
    let type, name;
    if (file === 'appsscript.json') { type = 'JSON'; name = 'appsscript'; }
    else if (/\.gs$/.test(file)) { type = 'SERVER_JS'; name = file.replace(/\.gs$/, ''); }
    else if (/\.html$/.test(file)) { type = 'HTML'; name = file.replace(/\.html$/, ''); }
    else return;
    files.push({ name, type, source: ghRaw_(sha, t.path) });
  });
  ['appsscript', 'Api', 'Config', 'Updater', 'Index'].forEach(n => {
    if (!files.some(f => f.name === n)) throw new Error('ไฟล์ใน GitHub ไม่ครบ (ไม่พบ ' + n + ') ยกเลิกการอัปเดต');
  });

  // 4) เขียนทับโค้ดในโปรเจกต์นี้ผ่าน Apps Script API
  const res = UrlFetchApp.fetch('https://script.googleapis.com/v1/projects/' + ScriptApp.getScriptId() + '/content', {
    method: 'put', contentType: 'application/json', payload: JSON.stringify({ files }),
    headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true,
  });
  const code = res.getResponseCode();
  if (code !== 200) {
    const text = res.getContentText();
    let detail = text;
    try { detail = JSON.parse(text).error.message || text; } catch (e) { /* ไม่ใช่ JSON */ }
    Logger.log('Apps Script API error ' + code + ': ' + text);
    const link = (String(detail).match(/https:\/\/console\.(?:developers|cloud)\.google\.com\/\S+/) || [])[0];
    if (link) {
      // API ยังไม่เปิดในโปรเจกต์ Google Cloud ที่ผูกกับสคริปต์ (คนละที่กับสวิตช์ในหน้าตั้งค่าผู้ใช้)
      throw new Error('ต้องเปิด Apps Script API ในโปรเจกต์ Google Cloud ของสคริปต์: เปิดลิงก์นี้แล้วกด "เปิดใช้" (Enable) รอ 1–2 นาทีแล้วรันใหม่ → ' + link.replace(/[.,)]+$/, ''));
    }
    if (/User has not enabled the Apps Script API/i.test(detail)) {
      throw new Error('สวิตช์ Google Apps Script API ในหน้า https://script.google.com/home/usersettings ยังไม่มีผล (ถ้าเพิ่งเปิด รอ 5–10 นาทีแล้วรันใหม่)');
    }
    throw new Error('อัปเดตโค้ดไม่สำเร็จ (' + code + '): ' + String(detail).slice(0, 400));
  }
  props.setProperty('CODE_SHA', sha);
  props.setProperty('CODE_UPDATED_AT', Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd HH:mm'));
  const r = 'อัปเดตโค้ดเป็นเวอร์ชัน ' + sha.slice(0, 7) + ' แล้ว (' + files.length + ' ไฟล์): ' + msg +
    '\nขั้นต่อไป: การทำให้ใช้งานได้ → จัดการการทำให้ใช้งานได้ → ✏️ → เวอร์ชันใหม่ → ทำให้ใช้งานได้';
  Logger.log(r);
  return { updated: true, message: r, sha };
}

/** เปิด/ปิดการอัปเดตโค้ดอัตโนมัติทุกวัน (ตี 3) */
function setAutoUpdate_(on) {
  ScriptApp.getProjectTriggers().filter(t => t.getHandlerFunction() === 'updateFromGitHub').forEach(t => ScriptApp.deleteTrigger(t));
  if (on) ScriptApp.newTrigger('updateFromGitHub').timeBased().everyDays(1).atHour(3).create();
  return on;
}

function apiUpdateInfo_() { return updateInfo_(true); }
function apiUpdateCode_() { return updateFromGitHub(false); }
function apiSetAutoUpdate_(on) { return setAutoUpdate_(!!on); }
