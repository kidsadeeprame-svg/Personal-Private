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

const UPDATE_FILE_LIST = 'apps-script-files.json'; // รายชื่อไฟล์ใน src/ (อยู่ที่ root ของ repo)

function ghToken_() {
  return PropertiesService.getScriptProperties().getProperty('GITHUB_TOKEN') || '';
}

function ghHeaders_(raw) {
  const h = { Accept: raw ? 'application/vnd.github.raw' : 'application/vnd.github+json', 'User-Agent': 'apps-script-updater' };
  const token = ghToken_();
  if (token) h.Authorization = 'Bearer ' + token;
  return h;
}

/** GitHub REST API — ใช้เฉพาะเมื่อมี GITHUB_TOKEN (แบบไม่ล็อกอิน IP ของ Google มักโดนจำกัดจำนวนครั้ง) */
function ghApi_(path) {
  const res = UrlFetchApp.fetch('https://api.github.com/repos/' + UPDATE_REPO + path, { headers: ghHeaders_(false), muteHttpExceptions: true });
  const code = res.getResponseCode();
  if (code === 404) throw new Error('หา repo ไม่เจอ (ตรวจ GITHUB_TOKEN ว่ามีสิทธิ์อ่าน repo นี้)');
  if (code === 401) throw new Error('GITHUB_TOKEN ไม่ถูกต้องหรือหมดอายุ');
  if (code !== 200) throw new Error('GitHub ตอบกลับ ' + code + ': ' + res.getContentText().slice(0, 200));
  return JSON.parse(res.getContentText());
}

function ghRaw_(ref, path) {
  const url = 'https://raw.githubusercontent.com/' + UPDATE_REPO + '/' + ref + '/' + path.split('/').map(encodeURIComponent).join('/');
  const res = UrlFetchApp.fetch(url, { headers: ghHeaders_(true), muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('ดาวน์โหลด ' + path + ' ไม่สำเร็จ (' + res.getResponseCode() + ')');
  return res.getContentText('UTF-8');
}

/** commit ล่าสุดของ branch: { sha, message, date } */
function latestCommit_() {
  if (ghToken_()) {
    const br = ghApi_('/branches/' + UPDATE_BRANCH);
    return { sha: br.commit.sha, message: String(br.commit.commit.message || '').split('\n')[0], date: br.commit.commit.committer ? br.commit.commit.committer.date : '' };
  }
  // repo public: อ่านจาก commit feed (หน้าเว็บปกติ ไม่ใช่ API จึงไม่ติดโควตา)
  const res = UrlFetchApp.fetch('https://github.com/' + UPDATE_REPO + '/commits/' + UPDATE_BRANCH + '.atom',
    { headers: { 'User-Agent': 'apps-script-updater' }, muteHttpExceptions: true });
  if (res.getResponseCode() === 404) throw new Error('หา repo ไม่เจอ (ถ้า repo เป็น private ต้องตั้ง Script property GITHUB_TOKEN)');
  if (res.getResponseCode() !== 200) throw new Error('อ่านเวอร์ชันล่าสุดจาก GitHub ไม่สำเร็จ (' + res.getResponseCode() + ') ลองใหม่ในอีกสักครู่');
  const xml = res.getContentText('UTF-8');
  const entry = xml.slice(xml.indexOf('<entry>'));
  const sha = (entry.match(/Grit::Commit\/([0-9a-f]{40})/) || [])[1];
  if (!sha) throw new Error('อ่านเวอร์ชันล่าสุดจาก GitHub ไม่สำเร็จ (รูปแบบข้อมูลเปลี่ยน)');
  const title = (entry.match(/<title>([\s\S]*?)<\/title>/) || [])[1] || '';
  const date = (entry.match(/<updated>([^<]+)<\/updated>/) || [])[1] || '';
  return { sha, message: title.trim().replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'"), date };
}

/** รายชื่อไฟล์ใน src/ ของ commit นั้น */
function sourceFiles_(sha) {
  if (ghToken_()) {
    return ghApi_('/git/trees/' + sha + '?recursive=1').tree
      .filter(t => t.type === 'blob' && t.path.indexOf(UPDATE_DIR + '/') === 0 && t.path.split('/').length === 2)
      .map(t => t.path.split('/')[1]);
  }
  return JSON.parse(ghRaw_(sha, UPDATE_FILE_LIST)).files;
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
    const c = latestCommit_();
    out.latestSha = c.sha;
    out.latestMessage = c.message;
    out.latestDate = c.date;
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
  const c = latestCommit_();
  const sha = c.sha;
  if (!force && sha === props.getProperty('CODE_SHA')) {
    const r = 'โค้ดเป็นเวอร์ชันล่าสุดแล้ว (' + sha.slice(0, 7) + ')';
    Logger.log(r);
    return { updated: false, message: r, sha };
  }

  // 3) ดาวน์โหลดไฟล์ใน src/ ของ commit นั้น
  const files = [];
  sourceFiles_(sha).forEach(file => {
    let type, name;
    if (file === 'appsscript.json') { type = 'JSON'; name = 'appsscript'; }
    else if (/\.gs$/.test(file)) { type = 'SERVER_JS'; name = file.replace(/\.gs$/, ''); }
    else if (/\.html$/.test(file)) { type = 'HTML'; name = file.replace(/\.html$/, ''); }
    else return;
    let source = ghRaw_(sha, UPDATE_DIR + '/' + file);
    // ฝังเลขเวอร์ชันลงในโค้ด เพื่อให้หน้าเว็บรู้ว่ากำลังรันโค้ดชุดไหน
    if (name === 'Config') source = source.replace(/const CODE_VERSION = '[^']*';/, "const CODE_VERSION = '" + sha.slice(0, 7) + "';");
    files.push({ name, type, source });
  });
  ['appsscript', 'Api', 'Config', 'Updater', 'Index'].forEach(n => {
    if (!files.some(f => f.name === n)) throw new Error('ไฟล์ใน GitHub ไม่ครบ (ไม่พบ ' + n + ') ยกเลิกการอัปเดต');
  });
  const msg = c.message;

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
