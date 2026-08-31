/**
 * 경북여상 업무 허브 — 백엔드 (Google Apps Script)
 *
 * 구글시트 1개를 데이터베이스로 사용하고, GitHub Pages에 올라간
 * 정적 프론트엔드에 JSON API를 제공합니다.
 *
 * 시트는 비공개로 두세요. "웹에 게시"할 필요가 없습니다.
 * 로그인 검증 / 비밀번호 해시 / 부서 권한 확인은 모두 여기(구글 서버)에서 처리됩니다.
 *
 * 설치 방법: apps-script/설치안내.md 참고
 */

var SHEET_LINKS  = 'links';
var SHEET_USERS  = 'users';
var SHEET_CONFIG = 'config';

var DEFAULT_PASSWORD = '2026';
var TOKEN_HOURS = 12;
var HASH_ROUNDS = 600;

var LINK_COLS = ['id','dept','title','url','type','note','deadline','sort','active','updatedBy','updatedAt'];
var USER_COLS = ['name','dept','role','salt','hash','mustChange','updatedAt'];

/* ===================== 진입점 ===================== */

function doGet(e) {
  if (!e || !e.parameter || !e.parameter.action) {
    return json({ ok: true, service: '경북여상 업무 허브 API', version: 1 });
  }
  return handle(e.parameter);
}

function doPost(e) {
  var req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return json({ ok: false, error: '잘못된 요청 형식입니다.' });
  }
  return handle(req);
}

function handle(req) {
  try {
    var action = String(req.action || '');
    switch (action) {
      case 'bootstrap':      return json(actBootstrap(req));
      case 'login':          return json(actLogin(req));
      case 'me':             return json(actMe(req));
      case 'changePassword': return json(actChangePassword(req));
      case 'saveLink':       return json(actSaveLink(req));
      case 'deleteLink':     return json(actDeleteLink(req));
      case 'reorder':        return json(actReorder(req));
      case 'listUsers':      return json(actListUsers(req));
      case 'saveUser':       return json(actSaveUser(req));
      case 'deleteUser':     return json(actDeleteUser(req));
      case 'resetPassword':  return json(actResetPassword(req));
      case 'saveConfig':     return json(actSaveConfig(req));
      default:               return json({ ok: false, error: '알 수 없는 요청: ' + action });
    }
  } catch (err) {
    return json({ ok: false, error: String(err && err.message ? err.message : err) });
  }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* ===================== 액션 ===================== */

function actBootstrap(req) {
  var me = null;
  if (req.token) {
    try { me = publicUser(findUser(verifyToken(req.token).name)); } catch (err) { me = null; }
  }
  var cfg = readConfig();

  // config 시트에서 requireLogin 을 Y 로 두면 로그인해야 링크가 보입니다.
  var locked = String(cfg.requireLogin || '').toUpperCase() === 'Y' && !me;

  return {
    ok: true,
    config: cfg,
    links: locked ? [] : readLinks(),
    depts: deptList(),
    me: me,
    locked: locked
  };
}

function actLogin(req) {
  var name = String(req.name || '').trim();
  var pw   = String(req.password || '');
  if (!name || !pw) throw new Error('이름과 비밀번호를 입력해 주세요.');

  var u = findUser(name);
  if (!u) throw new Error('등록되지 않은 이름입니다. 관리자에게 문의해 주세요.');
  if (hashPassword(pw, u.salt) !== u.hash) throw new Error('비밀번호가 올바르지 않습니다.');

  return { ok: true, token: makeToken(u.name), me: publicUser(u) };
}

function actMe(req) {
  var me = verifyToken(req.token);
  return { ok: true, me: publicUser(findUser(me.name)) };
}

function actChangePassword(req) {
  var me = requireUser(req);
  var current = String(req.current || '');
  var next    = String(req.next || '');
  if (next.length < 4) throw new Error('새 비밀번호는 4자 이상이어야 합니다.');
  if (next === DEFAULT_PASSWORD) throw new Error('초기 비밀번호와 다르게 정해 주세요.');
  if (hashPassword(current, me.salt) !== me.hash) throw new Error('현재 비밀번호가 올바르지 않습니다.');

  var salt = newSalt();
  updateUserRow(me.name, { salt: salt, hash: hashPassword(next, salt), mustChange: '', updatedAt: now() });
  return { ok: true, token: makeToken(me.name), me: publicUser(findUser(me.name)) };
}

function actSaveLink(req) {
  var me = requireUser(req);
  var link = req.link || {};
  var dept = String(link.dept || '').trim();
  if (!dept) throw new Error('부서를 선택해 주세요.');
  assertCanEdit(me, dept);

  var title = String(link.title || '').trim();
  var url   = String(link.url || '').trim();
  if (!title) throw new Error('제목을 입력해 주세요.');
  if (!url)   throw new Error('링크 주소를 입력해 주세요.');
  if (!/^https?:\/\//i.test(url)) throw new Error('링크는 http:// 또는 https:// 로 시작해야 합니다.');

  var sh = sheet(SHEET_LINKS);
  var rows = readSheet(sh, LINK_COLS);
  var id = String(link.id || '').trim();

  var record = {
    id: id || newId(),
    dept: dept,
    title: title,
    url: url,
    type: String(link.type || detectType(url)),
    note: String(link.note || '').trim(),
    deadline: String(link.deadline || '').trim(),
    sort: nextSort(rows, dept),
    active: 'Y',
    updatedBy: me.name,
    updatedAt: now()
  };

  if (id) {
    var found = -1;
    for (var i = 0; i < rows.length; i++) { if (rows[i].id === id) { found = i; break; } }
    if (found < 0) throw new Error('수정할 링크를 찾을 수 없습니다.');
    assertCanEdit(me, rows[found].dept);
    record.sort = Number(rows[found].sort) || record.sort;
    writeRow(sh, found + 2, LINK_COLS, record);
  } else {
    sh.appendRow(LINK_COLS.map(function (c) { return record[c]; }));
  }
  return { ok: true, link: record, links: readLinks() };
}

function actDeleteLink(req) {
  var me = requireUser(req);
  var id = String(req.id || '');
  var sh = sheet(SHEET_LINKS);
  var rows = readSheet(sh, LINK_COLS);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].id === id) {
      assertCanEdit(me, rows[i].dept);
      sh.deleteRow(i + 2);
      return { ok: true, links: readLinks() };
    }
  }
  throw new Error('삭제할 링크를 찾을 수 없습니다.');
}

function actReorder(req) {
  var me = requireUser(req);
  var dept = String(req.dept || '');
  assertCanEdit(me, dept);
  var ids = req.ids || [];
  var sh = sheet(SHEET_LINKS);
  var rows = readSheet(sh, LINK_COLS);
  var sortCol = LINK_COLS.indexOf('sort') + 1;
  for (var i = 0; i < rows.length; i++) {
    var pos = ids.indexOf(rows[i].id);
    if (pos >= 0) sh.getRange(i + 2, sortCol).setValue((pos + 1) * 10);
  }
  return { ok: true, links: readLinks() };
}

function actListUsers(req) {
  requireAdmin(req);
  return { ok: true, users: readSheet(sheet(SHEET_USERS), USER_COLS).map(publicUser) };
}

function actSaveUser(req) {
  requireAdmin(req);
  var u = req.user || {};
  var name = String(u.name || '').trim();
  var dept = String(u.dept || '').trim();
  var role = u.role === 'admin' ? 'admin' : 'teacher';
  if (!name) throw new Error('이름을 입력해 주세요.');
  if (role !== 'admin' && !dept) throw new Error('부서를 선택해 주세요.');

  if (findUser(name)) {
    updateUserRow(name, { dept: dept, role: role, updatedAt: now() });
  } else {
    var salt = newSalt();
    sheet(SHEET_USERS).appendRow([name, dept, role, salt, hashPassword(DEFAULT_PASSWORD, salt), 'Y', now()]);
  }
  return { ok: true, users: readSheet(sheet(SHEET_USERS), USER_COLS).map(publicUser) };
}

function actDeleteUser(req) {
  var me = requireAdmin(req);
  var name = String(req.name || '');
  if (name === me.name) throw new Error('본인 계정은 삭제할 수 없습니다.');
  var sh = sheet(SHEET_USERS);
  var rows = readSheet(sh, USER_COLS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].name).trim() === name) {
      sh.deleteRow(i + 2);
      return { ok: true, users: readSheet(sh, USER_COLS).map(publicUser) };
    }
  }
  throw new Error('해당 사용자를 찾을 수 없습니다.');
}

function actResetPassword(req) {
  requireAdmin(req);
  var name = String(req.name || '');
  if (!findUser(name)) throw new Error('해당 사용자를 찾을 수 없습니다.');
  var salt = newSalt();
  updateUserRow(name, { salt: salt, hash: hashPassword(DEFAULT_PASSWORD, salt), mustChange: 'Y', updatedAt: now() });
  return { ok: true, password: DEFAULT_PASSWORD };
}

function actSaveConfig(req) {
  requireAdmin(req);
  var sh = sheet(SHEET_CONFIG);
  var patch = req.config || {};
  var rows = sh.getDataRange().getValues();
  Object.keys(patch).forEach(function (k) {
    for (var i = 1; i < rows.length; i++) {
      if (String(rows[i][0]) === k) { sh.getRange(i + 1, 2).setValue(patch[k]); return; }
    }
    sh.appendRow([k, patch[k]]);
  });
  return { ok: true, config: readConfig() };
}

/* ===================== 권한 ===================== */

function requireUser(req) {
  var payload = verifyToken(req.token);
  var u = findUser(payload.name);
  if (!u) throw new Error('사용자 정보를 찾을 수 없습니다. 다시 로그인해 주세요.');
  return u;
}

function requireAdmin(req) {
  var u = requireUser(req);
  if (u.role !== 'admin') throw new Error('관리자만 사용할 수 있는 기능입니다.');
  return u;
}

function assertCanEdit(user, dept) {
  if (user.role === 'admin') return;
  var mine = String(user.dept || '').split(',').map(function (s) { return s.trim(); });
  if (mine.indexOf(String(dept).trim()) < 0) {
    throw new Error('"' + dept + '" 부서는 수정 권한이 없습니다. (내 부서: ' + user.dept + ')');
  }
}

/* ===================== 토큰 / 해시 ===================== */

function secret() {
  var props = PropertiesService.getScriptProperties();
  var s = props.getProperty('TOKEN_SECRET');
  if (!s) {
    s = Utilities.getUuid() + Utilities.getUuid();
    props.setProperty('TOKEN_SECRET', s);
  }
  return s;
}

function makeToken(name) {
  var body = name + '|' + (Date.now() + TOKEN_HOURS * 3600 * 1000);
  return Utilities.base64EncodeWebSafe(body) + '.' + sign(body);
}

function verifyToken(token) {
  if (!token) throw new Error('로그인이 필요합니다.');
  var parts = String(token).split('.');
  if (parts.length !== 2) throw new Error('로그인 정보가 올바르지 않습니다.');
  var body = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0])).getDataAsString();
  if (sign(body) !== parts[1]) throw new Error('로그인 정보가 올바르지 않습니다.');
  var bits = body.split('|');
  if (Number(bits[1]) < Date.now()) throw new Error('로그인이 만료되었습니다. 다시 로그인해 주세요.');
  return { name: bits[0] };
}

function sign(text) {
  return toHex(Utilities.computeHmacSha256Signature(text, secret()));
}

function newSalt() { return Utilities.getUuid().replace(/-/g, ''); }

function hashPassword(password, salt) {
  var v = salt + ' ' + password;
  for (var i = 0; i < HASH_ROUNDS; i++) {
    v = toHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, v + salt));
  }
  return v;
}

function toHex(bytes) {
  var s = '';
  for (var i = 0; i < bytes.length; i++) {
    var b = (bytes[i] + 256) % 256;
    s += (b < 16 ? '0' : '') + b.toString(16);
  }
  return s;
}

/* ===================== 시트 유틸 ===================== */

function ss() { return SpreadsheetApp.getActiveSpreadsheet(); }

function sheet(name) {
  var s = ss().getSheetByName(name);
  if (!s) throw new Error('"' + name + '" 시트가 없습니다. 메뉴 [경북여상 허브 > 초기 설치]를 먼저 실행해 주세요.');
  return s;
}

function readSheet(sh, cols) {
  var values = sh.getDataRange().getValues();
  var out = [];
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]).trim() === '') continue;
    var o = {};
    for (var c = 0; c < cols.length; c++) o[cols[c]] = values[r][c] === null ? '' : values[r][c];
    out.push(o);
  }
  return out;
}

function writeRow(sh, rowIndex, cols, obj) {
  sh.getRange(rowIndex, 1, 1, cols.length).setValues([cols.map(function (c) { return obj[c]; })]);
}

function readLinks() {
  return readSheet(sheet(SHEET_LINKS), LINK_COLS)
    .filter(function (l) { return String(l.active).toUpperCase() !== 'N'; })
    .map(function (l) {
      l.sort = Number(l.sort) || 0;
      l.deadline = asDateText(l.deadline);
      l.updatedAt = asDateText(l.updatedAt);
      return l;
    })
    .sort(function (a, b) { return a.sort - b.sort; });
}

function asDateText(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz(), 'yyyy-MM-dd');
  return String(v == null ? '' : v);
}

function readConfig() {
  var values = sheet(SHEET_CONFIG).getDataRange().getValues();
  var o = {};
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][0]).trim()) o[String(values[r][0]).trim()] = values[r][1];
  }
  return o;
}

function deptList() {
  return String(readConfig().depts || '')
    .split(',').map(function (s) { return s.trim(); }).filter(Boolean);
}

function findUser(name) {
  var rows = readSheet(sheet(SHEET_USERS), USER_COLS);
  var key = String(name || '').trim();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].name).trim() === key) return rows[i];
  }
  return null;
}

function updateUserRow(name, patch) {
  var sh = sheet(SHEET_USERS);
  var rows = readSheet(sh, USER_COLS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].name).trim() === String(name).trim()) {
      var merged = rows[i];
      Object.keys(patch).forEach(function (k) { merged[k] = patch[k]; });
      writeRow(sh, i + 2, USER_COLS, merged);
      return merged;
    }
  }
  throw new Error('사용자를 찾을 수 없습니다: ' + name);
}

function publicUser(u) {
  if (!u) return null;
  return {
    name: String(u.name).trim(),
    dept: String(u.dept || ''),
    role: u.role === 'admin' ? 'admin' : 'teacher',
    mustChange: String(u.mustChange || '').toUpperCase() === 'Y'
  };
}

function tz() { return ss().getSpreadsheetTimeZone() || 'Asia/Seoul'; }
function now() { return Utilities.formatDate(new Date(), tz(), 'yyyy-MM-dd HH:mm'); }
function newId() { return 'L' + Date.now().toString(36) + Math.floor(Math.random() * 1e4).toString(36); }

function nextSort(rows, dept) {
  var max = 0;
  rows.forEach(function (r) { if (r.dept === dept) max = Math.max(max, Number(r.sort) || 0); });
  return max + 10;
}

function detectType(url) {
  if (/docs\.google\.com\/spreadsheets/i.test(url)) return 'sheet';
  if (/docs\.google\.com\/forms|forms\.gle/i.test(url)) return 'form';
  if (/docs\.google\.com\/document/i.test(url)) return 'doc';
  if (/docs\.google\.com\/presentation/i.test(url)) return 'slide';
  if (/drive\.google\.com/i.test(url)) return 'drive';
  if (/notion\.(so|com)|notion\.site/i.test(url)) return 'notion';
  return 'link';
}
