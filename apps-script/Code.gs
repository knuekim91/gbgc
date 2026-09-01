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

var SHEET_LINKS    = 'links';
var SHEET_USERS    = 'users';
var SHEET_CONFIG   = 'config';
var SHEET_TEACHERS = 'teachers';   // 로그인 허용 명단 (교직원 비상연락망에서 가져옴)

var DEFAULT_PASSWORD = '2026';
var TOKEN_HOURS = 12;
var HASH_ROUNDS = 600;

// 첨부파일은 내 드라이브 / gbgc / <부서> 아래에 쌓입니다.
// 파일이 Apps Script 를 거쳐 가므로 크기를 키우면 업로드가 눈에 띄게 느려집니다.
// 큰 파일은 드라이브에 직접 올리고 '링크 주소' 칸을 쓰시는 편이 낫습니다.
var DRIVE_FOLDER = 'gbgc';
var MAX_FILE_MB = 5;
var MAX_FILES = 3;        // 업무 하나에 붙일 수 있는 첨부 개수

// track / target / email 은 뒤에 덧붙였습니다. 기존 시트를 쓰던 중이라면
// 메뉴 [경북여상 허브 > 시트 열 최신화] 를 한 번 실행해 주세요.
var LINK_COLS = ['id','dept','title','url','type','note','deadline','sort','active','updatedBy','updatedAt','track','target','desc','fileId','fileName','fileUrl','files'];
var USER_COLS = ['name','dept','role','salt','hash','mustChange','updatedAt','email','lastLogin'];
var TEACHER_COLS = ['name','dept','title','group'];

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
      case 'progress':       return json(actProgress(req));
      case 'login':          return json(actLogin(req));
      case 'me':             return json(actMe(req));
      case 'changePassword': return json(actChangePassword(req));
      case 'saveMyEmail':    return json(actSaveMyEmail(req));
      case 'saveMyDepts':    return json(actSaveMyDepts(req));
      case 'requestReset':   return json(actRequestReset(req));
      case 'confirmReset':   return json(actConfirmReset(req));
      case 'uploadFile':     return json(actUploadFile(req));
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

/**
 * 수합 현황 — track 이 Y 인 링크의 대상 구글시트를 열어 입력된 줄 수를 셉니다.
 * 시트를 여는 데 시간이 걸리므로 10분간 캐시하고, 화면은 이 요청을 따로(나중에) 부릅니다.
 */
function actProgress(req) {
  var cache = CacheService.getScriptCache();
  var links = readLinks().filter(function (l) { return String(l.track).toUpperCase() === 'Y'; });
  var out = {};

  links.forEach(function (l) {
    var key = 'p_' + l.id;
    var hit = cache.get(key);
    if (hit) { out[l.id] = JSON.parse(hit); return; }

    var result = countRows(l.url);
    result.target = Number(l.target) || 0;
    out[l.id] = result;
    cache.put(key, JSON.stringify(result), 600);
  });

  return { ok: true, progress: out };
}

/** 구글시트 주소에서 "머리글을 뺀, 내용이 있는 줄 수"를 셉니다. */
function countRows(url) {
  var idMatch = /\/spreadsheets\/d\/([a-zA-Z0-9_-]+)/.exec(String(url));
  if (!idMatch) return { error: '구글시트 링크만 셀 수 있습니다' };

  try {
    var book = SpreadsheetApp.openById(idMatch[1]);
    var gid = /[?&#]gid=(\d+)/.exec(String(url));
    var target = null;

    if (gid) {
      var all = book.getSheets();
      for (var i = 0; i < all.length; i++) {
        if (String(all[i].getSheetId()) === gid[1]) { target = all[i]; break; }
      }
    }
    if (!target) target = book.getSheets()[0];

    var values = target.getDataRange().getValues();
    var n = 0;
    for (var r = 1; r < values.length; r++) {          // 1행은 머리글로 봅니다
      for (var c = 0; c < values[r].length; c++) {
        if (String(values[r][c]).trim() !== '') { n++; break; }
      }
    }
    return { count: n, sheet: target.getName() };
  } catch (err) {
    return { error: '시트를 열 수 없습니다 (공유 권한 확인)' };
  }
}

function actLogin(req) {
  var name = String(req.name || '').trim();
  var pw   = String(req.password || '');
  if (!name || !pw) throw new Error('이름과 비밀번호를 입력해 주세요.');

  var u = findUser(name);

  // 계정이 아직 없으면 teachers 명단을 봅니다.
  // 명단에 있는 분이 초기 비밀번호로 들어오면 그 자리에서 계정을 만들어 드립니다.
  if (!u) {
    var t = findTeacher(name);
    if (!t) {
      throw new Error('교직원 명단에 없는 이름입니다.\n띄어쓰기 없이 정확히 입력했는지 확인해 주세요.');
    }
    if (pw !== DEFAULT_PASSWORD) {
      throw new Error('처음 로그인하실 때는 초기 비밀번호 ' + DEFAULT_PASSWORD + ' 을 입력해 주세요.');
    }
    var salt = newSalt();
    sheet(SHEET_USERS).appendRow([
      String(t.name).trim(), String(t.dept || '').trim(), 'teacher',
      salt, hashPassword(DEFAULT_PASSWORD, salt), 'Y', now(), '', ''
    ]);
    u = findUser(name);
  }

  if (hashPassword(pw, u.salt) !== u.hash) throw new Error('비밀번호가 올바르지 않습니다.');

  // 최고관리자인데 시트의 role 이 teacher 로 남아 있으면 여기서 바로잡습니다.
  var patch = { lastLogin: now() };
  if (isSuperAdmin(u.name) && u.role !== 'admin') patch.role = 'admin';
  updateUserRow(u.name, patch);
  u = findUser(u.name);

  // Apps Script 왕복 한 번이 1초 넘게 걸리므로, 화면이 바로 필요로 하는
  // 목록·부서·설정을 로그인 응답에 함께 실어 보냅니다. (요청 2번 → 1번)
  return {
    ok: true,
    token: makeToken(u.name),
    me: publicUser(u),
    config: readConfig(),
    links: readLinks(),
    depts: deptList(),
    locked: false
  };
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

/** 본인 이메일 등록 — 비밀번호 재설정과 마감 알림에 씁니다. */
function actSaveMyEmail(req) {
  var me = requireUser(req);
  var email = String(req.email || '').trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new Error('이메일 형식이 올바르지 않습니다.');
  }
  updateUserRow(me.name, { email: email, updatedAt: now() });
  return { ok: true, me: publicUser(findUser(me.name)) };
}

/** 본인이 맡은 부서를 직접 고릅니다. 그 부서의 업무만 편집할 수 있게 됩니다. */
function actSaveMyDepts(req) {
  var me = requireUser(req);
  var all = deptList();
  var picked = (req.depts || [])
    .map(function (d) { return String(d).trim(); })
    .filter(function (d) { return all.indexOf(d) >= 0; });

  updateUserRow(me.name, { dept: picked.join(', '), updatedAt: now() });
  return { ok: true, me: publicUser(findUser(me.name)) };
}

/**
 * 비밀번호 재설정 1단계 — 등록된 이메일로 6자리 코드를 보냅니다.
 *
 * 코드를 확인하기 전까지 기존 비밀번호는 그대로 살아 있습니다.
 * 그래서 남이 함부로 요청해도 계정이 잠기지 않습니다.
 */
function actRequestReset(req) {
  var name = String(req.name || '').trim();
  var u = findUser(name);
  if (!u) throw new Error('등록되지 않은 이름입니다.');

  var email = String(u.email || '').trim();
  if (!email) {
    throw new Error('등록된 이메일이 없습니다.\n관리자 선생님께 비밀번호 초기화를 요청해 주세요.');
  }

  var cache = CacheService.getScriptCache();
  if (cache.get('rt_' + name)) {
    throw new Error('조금 전에 코드를 보냈습니다. 메일함을 확인해 주세요.');
  }

  var code = String(Math.floor(100000 + Math.random() * 900000));
  cache.put('rc_' + name, code, 900);    // 15분
  cache.put('rt_' + name, '1', 60);      // 1분 안에 재요청 방지

  var title = String(readConfig().siteTitle || '경북여상 교무실 업무 허브');
  MailApp.sendEmail({
    to: email,
    subject: '[' + title + '] 비밀번호 재설정 코드',
    htmlBody:
      '<div style="font-family:sans-serif;font-size:14px;line-height:1.7;color:#16191d">' +
        '<p>' + name + ' 선생님, 비밀번호 재설정 코드입니다.</p>' +
        '<p style="font-size:30px;font-weight:700;letter-spacing:6px;margin:18px 0">' + code + '</p>' +
        '<p>15분 안에 입력해 주세요.</p>' +
        '<p style="color:#8b95a3;font-size:12px;margin-top:22px">' +
          '요청하지 않으셨다면 이 메일을 무시하셔도 됩니다. ' +
          '코드를 넣기 전까지 기존 비밀번호는 그대로 쓸 수 있습니다.</p>' +
      '</div>'
  });

  return { ok: true, sentTo: maskEmail(email) };
}

/** 비밀번호 재설정 2단계 — 코드를 확인하고 새 비밀번호를 저장합니다. */
function actConfirmReset(req) {
  var name = String(req.name || '').trim();
  var code = String(req.code || '').trim();
  var next = String(req.next || '');

  var u = findUser(name);
  if (!u) throw new Error('등록되지 않은 이름입니다.');
  if (next.length < 4) throw new Error('새 비밀번호는 4자 이상이어야 합니다.');
  if (next === DEFAULT_PASSWORD) throw new Error('초기 비밀번호와 다르게 정해 주세요.');

  var cache = CacheService.getScriptCache();
  var saved = cache.get('rc_' + name);
  if (!saved) throw new Error('코드가 만료되었습니다. 다시 요청해 주세요.');
  if (saved !== code) throw new Error('코드가 맞지 않습니다.');

  var salt = newSalt();
  updateUserRow(name, { salt: salt, hash: hashPassword(next, salt), mustChange: '', updatedAt: now() });
  cache.remove('rc_' + name);
  cache.remove('rt_' + name);

  var fresh = findUser(name);
  return {
    ok: true,
    token: makeToken(fresh.name),
    me: publicUser(fresh),
    config: readConfig(),
    links: readLinks(),
    depts: deptList(),
    locked: false
  };
}

function maskEmail(email) {
  var at = email.indexOf('@');
  if (at < 2) return '***' + email.slice(at);
  return email.slice(0, 2) + '***' + email.slice(at);
}

/**
 * 첨부파일을 내 드라이브 / gbgc / <부서> 에 저장합니다.
 *
 * 파일은 이 스크립트 주인 계정 소유가 되고, 그 계정의 드라이브 용량을 씁니다.
 * 선생님들이 열 수 있어야 하므로 '링크가 있는 모든 사용자 · 뷰어' 로 공유합니다.
 * 따라서 개인정보가 담긴 파일은 올리지 않는 편이 좋습니다.
 */
function actUploadFile(req) {
  var me = requireUser(req);
  assertHasEmail(me);

  var dept = String(req.dept || '').trim();
  assertCanEdit(me, dept);

  var name = String(req.name || '첨부파일').trim();
  var mime = String(req.mimeType || '').trim() || 'application/octet-stream';
  var b64  = String(req.data || '');
  if (!b64) throw new Error('파일 내용을 읽지 못했습니다.');

  var bytes = Utilities.base64Decode(b64);
  var mb = bytes.length / 1048576;
  if (mb > MAX_FILE_MB) {
    throw new Error('첨부파일은 ' + MAX_FILE_MB + 'MB 이하만 올릴 수 있습니다. (지금 ' + mb.toFixed(1) + 'MB)\n' +
                    '큰 파일은 구글 드라이브에 올리고 [링크 주소] 칸에 주소를 넣어 주세요.');
  }

  var folder = deptFolder(dept);
  var file = folder.createFile(Utilities.newBlob(bytes, mime, name));
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  return { ok: true, file: { id: file.getId(), name: file.getName(), url: file.getUrl() } };
}

/**
 * 첨부 목록을 꺼냅니다.
 *
 * files 칸에 [{id,name,url}, ...] 을 JSON 으로 담습니다.
 * 첨부가 한 개만 되던 시절에 저장된 행은 fileId/fileName/fileUrl 을 읽어
 * 같은 모양으로 맞춰 줍니다. 그래서 예전 데이터도 그대로 보입니다.
 */
/** 화면에서 온 첨부 목록을 믿을 수 있는 모양으로 다듬습니다. */
function cleanFiles(list) {
  if (Object.prototype.toString.call(list) !== '[object Array]') return [];
  return list
    .filter(function (f) { return f && String(f.id || '').trim(); })
    .slice(0, MAX_FILES)
    .map(function (f) {
      return {
        id: String(f.id).trim(),
        name: String(f.name || '첨부파일').trim(),
        url: String(f.url || '').trim()
      };
    });
}

function parseFiles(row) {
  var raw = String(row.files || '').trim();
  if (raw) {
    try {
      var list = JSON.parse(raw);
      if (Object.prototype.toString.call(list) === '[object Array]') return list;
    } catch (err) { /* 깨진 값이면 아래로 */ }
  }
  var id = String(row.fileId || '').trim();
  if (!id) return [];
  return [{ id: id, name: String(row.fileName || '첨부파일'), url: String(row.fileUrl || '') }];
}

function deptFolder(dept) {
  var root = childFolder(DriveApp.getRootFolder(), DRIVE_FOLDER);
  return dept ? childFolder(root, dept) : root;
}

/** 이름이 같은 폴더가 있으면 쓰고, 없으면 만듭니다. */
function childFolder(parent, name) {
  var found = parent.getFoldersByName(name);
  return found.hasNext() ? found.next() : parent.createFolder(name);
}

/** 첨부파일을 휴지통으로 보냅니다. 실패해도 업무 삭제는 계속 진행합니다. */
function trashFile(fileId) {
  if (!fileId) return;
  try { DriveApp.getFileById(fileId).setTrashed(true); } catch (err) { /* 이미 없는 파일 */ }
}

function actSaveLink(req) {
  var me = requireUser(req);
  var link = req.link || {};
  var dept = String(link.dept || '').trim();
  if (!dept) throw new Error('부서를 선택해 주세요.');
  assertHasEmail(me);
  assertCanEdit(me, dept);

  var title = String(link.title || '').trim();
  var url   = String(link.url || '').trim();
  if (!title) throw new Error('제목을 입력해 주세요.');
  // 링크 주소는 선택입니다. 적었다면 형식만 확인합니다.
  if (url && !/^https?:\/\//i.test(url)) {
    throw new Error('링크는 http:// 또는 https:// 로 시작해야 합니다.');
  }

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
    updatedAt: now(),
    track: link.track ? 'Y' : '',
    target: Number(link.target) || '',
    desc: String(link.desc || '').trim(),
    fileId: '', fileName: '', fileUrl: '',   // 예전 한 개짜리 칸은 더 쓰지 않습니다
    files: JSON.stringify(cleanFiles(link.files))
  };

  if (id) {
    var found = -1;
    for (var i = 0; i < rows.length; i++) { if (rows[i].id === id) { found = i; break; } }
    if (found < 0) throw new Error('수정할 링크를 찾을 수 없습니다.');
    assertCanEdit(me, rows[found].dept);
    record.sort = Number(rows[found].sort) || record.sort;
    // 목록에서 빠진 첨부만 휴지통으로 보냅니다.
    var keep = cleanFiles(link.files).map(function (f) { return f.id; });
    parseFiles(rows[found]).forEach(function (f) {
      if (keep.indexOf(f.id) < 0) trashFile(f.id);
    });
    writeRow(sh, found + 2, LINK_COLS, record);
  } else {
    sh.appendRow(LINK_COLS.map(function (c) { return record[c]; }));
  }
  CacheService.getScriptCache().remove('p_' + record.id);   // 수합 현황 캐시 무효화
  return { ok: true, link: record, links: readLinks() };
}

function actDeleteLink(req) {
  var me = requireUser(req);
  assertHasEmail(me);
  var id = String(req.id || '');
  var sh = sheet(SHEET_LINKS);
  var rows = readSheet(sh, LINK_COLS);
  for (var i = 0; i < rows.length; i++) {
    if (rows[i].id === id) {
      assertCanEdit(me, rows[i].dept);
      parseFiles(rows[i]).forEach(function (f) { trashFile(f.id); });
      sh.deleteRow(i + 2);
      return { ok: true, links: readLinks() };
    }
  }
  throw new Error('삭제할 링크를 찾을 수 없습니다.');
}

function actReorder(req) {
  var me = requireUser(req);
  var dept = String(req.dept || '');
  assertHasEmail(me);
  assertCanEdit(me, dept);
  // ids 는 화면에 보이는 순서(위에서 아래로) 그대로 옵니다.
  // 화면은 sort 가 큰 것부터 보여 주므로, 맨 위가 가장 큰 값을 받도록 거꾸로 매깁니다.
  var ids = req.ids || [];
  var sh = sheet(SHEET_LINKS);
  var rows = readSheet(sh, LINK_COLS);
  var sortCol = LINK_COLS.indexOf('sort') + 1;
  for (var i = 0; i < rows.length; i++) {
    var pos = ids.indexOf(rows[i].id);
    if (pos >= 0) sh.getRange(i + 2, sortCol).setValue((ids.length - pos) * 10);
  }
  return { ok: true, links: readLinks() };
}

/**
 * 교직원 명단 전체를 돌려줍니다.
 *
 * teachers 시트를 기준으로 세우고, 계정이 있으면 그 정보를 붙입니다.
 * 아직 한 번도 로그인하지 않은 분은 joined=false 로 표시해
 * "누가 아직 안 들어왔는지" 가 한눈에 보이게 합니다.
 */
function actListUsers(req) {
  requireAdmin(req);

  var accounts = readSheet(sheet(SHEET_USERS), USER_COLS);
  var byName = {};
  accounts.forEach(function (u) {
    var key = String(u.name || '').replace(/\s+/g, '');
    if (key) byName[key] = u;
  });

  var out = [];
  var rosterSheet = ss().getSheetByName(SHEET_TEACHERS);
  var roster = rosterSheet ? readSheet(rosterSheet, TEACHER_COLS) : [];

  roster.forEach(function (t) {
    var key = String(t.name || '').replace(/\s+/g, '');
    if (!key) return;

    if (byName[key]) {
      out.push(publicUser(byName[key]));
      delete byName[key];
      return;
    }
    out.push({
      name: String(t.name).trim(),
      dept: String(t.dept || '').trim(),
      role: 'teacher', top: false, email: '',
      lastLogin: '', mustChange: false, joined: false
    });
  });

  // 명단에는 없는데 계정만 있는 경우도 빠뜨리지 않습니다.
  Object.keys(byName).forEach(function (k) { out.push(publicUser(byName[k])); });

  return { ok: true, users: out };
}

function actSaveUser(req) {
  requireAdmin(req);
  var u = req.user || {};
  var name = String(u.name || '').trim();
  var dept = String(u.dept || '').trim();
  var role = u.role === 'admin' ? 'admin' : 'teacher';
  if (!name) throw new Error('이름을 입력해 주세요.');
  if (isSuperAdmin(name)) role = 'admin';    // 최고관리자는 늘 관리자입니다
  if (role !== 'admin' && !dept) throw new Error('부서를 선택해 주세요.');

  var email = String(u.email || '').trim();
  if (email && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new Error('이메일 형식이 올바르지 않습니다.');

  if (findUser(name)) {
    updateUserRow(name, { dept: dept, role: role, email: email, updatedAt: now() });
  } else {
    var salt = newSalt();
    sheet(SHEET_USERS).appendRow([name, dept, role, salt, hashPassword(DEFAULT_PASSWORD, salt), 'Y', now(), email, '']);
  }
  return { ok: true, users: readSheet(sheet(SHEET_USERS), USER_COLS).map(publicUser) };
}

function actDeleteUser(req) {
  var me = requireAdmin(req);
  var name = String(req.name || '');
  if (name === me.name) throw new Error('본인 계정은 삭제할 수 없습니다.');
  if (isSuperAdmin(name)) throw new Error('최고관리자 계정은 삭제할 수 없습니다.');
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

/* ===================== 마감 알림 메일 ===================== */

/**
 * 마감 1~2일 전인 링크를 담당 부서 선생님께 메일로 알립니다.
 *
 * 자동 발송을 원하시면 메뉴 [경북여상 허브 > 마감 알림 자동 발송 켜기] 를 실행하세요.
 * 켜기 전에 [마감 알림 미리보기] 로 누구에게 무엇이 가는지 먼저 확인하실 수 있습니다.
 * users 시트의 email 칸이 비어 있는 선생님께는 보내지 않습니다.
 */
function buildReminders() {
  var links = readLinks();
  var users = readSheet(sheet(SHEET_USERS), USER_COLS);
  var today = new Date();
  today = new Date(today.getFullYear(), today.getMonth(), today.getDate());

  var due = links.filter(function (l) {
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(l.deadline || ''));
    if (!m) return false;
    var d = Math.round((new Date(+m[1], +m[2] - 1, +m[3]) - today) / 86400000);
    l._dday = d;
    return d === 1 || d === 2;
  });

  var byPerson = [];
  users.forEach(function (u) {
    var email = String(u.email || '').trim();
    if (!email) return;

    var mine = due.filter(function (l) {
      if (u.role === 'admin') return false;   // 관리자에게 전체 알림을 보내지는 않습니다
      return String(u.dept || '').split(',').map(function (s) { return s.trim(); }).indexOf(l.dept) >= 0;
    });
    if (mine.length) byPerson.push({ name: String(u.name).trim(), email: email, links: mine });
  });

  return byPerson;
}

function previewReminders() {
  var ui = uiOrNull();
  if (!ui) throw new Error('이 기능은 스프레드시트 메뉴에서 실행해 주세요.');
  var list = buildReminders();
  if (!list.length) {
    ui.alert('마감 알림 미리보기', '내일·모레 마감인 항목이 없거나,\nusers 시트에 이메일이 입력된 선생님이 없습니다.', ui.ButtonSet.OK);
    return;
  }
  var text = list.map(function (p) {
    return '• ' + p.name + ' <' + p.email + '>\n    ' +
      p.links.map(function (l) { return 'D-' + l._dday + ' ' + l.title; }).join('\n    ');
  }).join('\n\n');
  ui.alert('지금 보내면 이렇게 갑니다', text, ui.ButtonSet.OK);
}

function sendDeadlineReminders() {
  var cfg = readConfig();
  var siteUrl = String(cfg.siteUrl || '');
  var title = String(cfg.siteTitle || '경북여상 교무실 업무 허브');

  buildReminders().forEach(function (p) {
    var rows = p.links.map(function (l) {
      return '<tr>' +
        '<td style="padding:6px 12px 6px 0;white-space:nowrap;color:#b3271f;font-weight:600">D-' + l._dday + '</td>' +
        '<td style="padding:6px 0"><a href="' + l.url + '">' + l.title + '</a>' +
          '<div style="color:#6b7280;font-size:12px">' + l.dept + ' · ' + l.deadline + ' 마감</div></td>' +
      '</tr>';
    }).join('');

    MailApp.sendEmail({
      to: p.email,
      subject: '[' + title + '] 마감이 다가온 업무 ' + p.links.length + '건',
      htmlBody:
        '<div style="font-family:sans-serif;font-size:14px;line-height:1.6;color:#16191d">' +
          '<p>' + p.name + ' 선생님, 마감이 다가온 업무를 알려 드립니다.</p>' +
          '<table style="border-collapse:collapse">' + rows + '</table>' +
          (siteUrl ? '<p style="margin-top:18px"><a href="' + siteUrl + '">' + title + ' 열기</a></p>' : '') +
          '<p style="color:#8b95a3;font-size:12px;margin-top:20px">이 메일은 업무 허브에서 자동 발송되었습니다.</p>' +
        '</div>'
    });
  });
}

function enableReminderTrigger() {
  var ui = uiOrNull();
  if (!ui) throw new Error('이 기능은 스프레드시트 메뉴에서 실행해 주세요.');
  var res = ui.alert('마감 알림 자동 발송',
    '매일 오전 7시에 마감 1~2일 전 업무를 담당 선생님께 메일로 보냅니다.\n\n' +
    'users 시트의 email 칸이 채워진 분에게만 발송됩니다.\n켤까요?', ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;

  disableReminderTrigger();
  ScriptApp.newTrigger('sendDeadlineReminders').timeBased().atHour(7).everyDays(1).create();
  ui.alert('완료', '매일 오전 7시에 발송하도록 설정했습니다.', ui.ButtonSet.OK);
}

function disableReminderTrigger() {
  ScriptApp.getProjectTriggers().forEach(function (t) {
    if (t.getHandlerFunction() === 'sendDeadlineReminders') ScriptApp.deleteTrigger(t);
  });
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
  // 시트의 role 칸이 무엇이든 최고관리자는 통과시킵니다.
  // 명단으로 자동 생성된 계정은 role 이 teacher 로 적히기 때문입니다.
  if (u.role !== 'admin' && !isSuperAdmin(u.name)) {
    throw new Error('관리자만 사용할 수 있는 기능입니다.');
  }
  return u;
}

/**
 * 업무를 고치려면 복구용 이메일이 있어야 합니다.
 * 비밀번호를 잊었을 때 되찾을 길이 없는 계정을 남기지 않으려는 것입니다.
 */
function assertHasEmail(user) {
  if (!String(user.email || '').trim()) {
    throw new Error('먼저 복구용 이메일을 등록해 주세요.\n' +
                    '오른쪽 위 이름 → [비밀번호 복구용 이메일] 에 주소를 넣고 저장하시면 됩니다.');
  }
}

function assertCanEdit(user, dept) {
  if (user.role === 'admin' || isSuperAdmin(user.name)) return;
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

// 한글 이름이 들어가므로 반드시 UTF-8 을 지정해야 합니다.
// 지정하지 않으면 Apps Script 가 한글을 '???' 로 바꿔 버려 토큰이 무용지물이 됩니다.
function makeToken(name) {
  var body = name + '|' + (Date.now() + TOKEN_HOURS * 3600 * 1000);
  return Utilities.base64EncodeWebSafe(body, Utilities.Charset.UTF_8) + '.' + sign(body);
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
  return toHex(Utilities.computeHmacSha256Signature(text, secret(), Utilities.Charset.UTF_8));
}

function newSalt() { return Utilities.getUuid().replace(/-/g, ''); }

function hashPassword(password, salt) {
  var v = salt + ' ' + password;
  for (var i = 0; i < HASH_ROUNDS; i++) {
    v = toHex(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, v + salt, Utilities.Charset.UTF_8));
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
      l.files = parseFiles(l);
      return l;
    })
    .sort(function (a, b) { return a.sort - b.sort; });
}

function asDateText(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz(), 'yyyy-MM-dd');
  return String(v == null ? '' : v);
}

function asDateTimeText(v) {
  if (v instanceof Date) return Utilities.formatDate(v, tz(), 'yyyy-MM-dd HH:mm');
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

/**
 * 최고관리자.
 *
 * 이름은 config 시트의 superAdmin 칸에서 읽습니다.
 * 저장소가 공개라 코드에 실명을 넣지 않으려는 것입니다.
 *
 * 이 사람은 users 시트에 무엇이 적혀 있든 늘 관리자이고,
 * 다른 관리자가 지우거나 권한을 낮출 수 없습니다.
 */
function superAdminName() {
  return String(readConfig().superAdmin || '').trim();
}

function isSuperAdmin(name) {
  var top = superAdminName();
  return !!top && String(name || '').trim() === top;
}

function findUser(name) {
  var rows = readSheet(sheet(SHEET_USERS), USER_COLS);
  var key = String(name || '').trim();
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].name).trim() === key) return rows[i];
  }
  return null;
}

/** 로그인 허용 명단에서 찾습니다. 띄어쓰기는 무시합니다. */
function findTeacher(name) {
  var book = ss();
  var sh = book.getSheetByName(SHEET_TEACHERS);
  if (!sh) return null;                       // 명단 시트가 없으면 이 기능은 꺼진 셈입니다

  var key = String(name || '').replace(/\s+/g, '');
  var rows = readSheet(sh, TEACHER_COLS);
  for (var i = 0; i < rows.length; i++) {
    if (String(rows[i].name).replace(/\s+/g, '') === key) return rows[i];
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
    role: (isSuperAdmin(u.name) || u.role === 'admin') ? 'admin' : 'teacher',
    top: isSuperAdmin(u.name),
    email: String(u.email || '').trim(),
    lastLogin: asDateTimeText(u.lastLogin),
    joined: true,
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
  if (!String(url || '').trim()) return 'task';   // 링크 없는 업무
  if (/docs\.google\.com\/spreadsheets/i.test(url)) return 'sheet';
  if (/docs\.google\.com\/forms|forms\.gle/i.test(url)) return 'form';
  if (/docs\.google\.com\/document/i.test(url)) return 'doc';
  if (/docs\.google\.com\/presentation/i.test(url)) return 'slide';
  if (/drive\.google\.com/i.test(url)) return 'drive';
  if (/notion\.(so|com)|notion\.site/i.test(url)) return 'notion';
  return 'link';
}
