/**
 * 초기 설치 + Notion 링크 이전
 *
 * 스프레드시트를 열면 상단에 [경북여상 허브] 메뉴가 생깁니다.
 *   - 초기 설치      : links / users / config 시트를 만들고 Notion 링크를 옮겨 담습니다.
 *   - 관리자 계정 추가 : 관리자(전체 부서 편집) 계정을 만듭니다.
 *   - 부서 목록 다시 채우기 : config 시트의 부서 목록을 기본값으로 되돌립니다.
 */

/**
 * 관리자로 등록할 선생님 성함.
 * 여기에 이름을 적어 두면 installHub 를 실행할 때 관리자 계정까지 한 번에 만들어집니다.
 * (초기 비밀번호는 2026)
 */
var ADMIN_NAME = '';

var DEPTS = [
  '교장', '교감',
  '교무부', '연구부', '학생부', '진로창체부', '기본학력방과후부', '복지상담부',
  '특성화교육과정부', '산학협력부', '전문교육부', '인성학부모부',
  '1학년', '2학년', '3학년'
];

/** 더 이상 쓰지 않는 부서. cleanupDepts 로 목록과 업무를 함께 정리합니다. */
var RETIRED_DEPTS = ['수평공동체', '자료실'];

// Notion "🏫 경북여상 공유시트 모음" 페이지에서 옮겨온 초기 데이터입니다.
// [부서, 제목, URL, 마감일(선택), 메모(선택)]
var SEED = [
  ['교무부', '월중행사계획 입력', 'https://docs.google.com/spreadsheets/d/1J-LqCJ-McY4STP5lZS9tsUgMZBUAQsBznDVrEB7gKQU/edit?gid=243294997#gid=243294997', '', ''],
  ['교무부', '생기부 작성시 참고사항 (교무부장)', 'https://app.notion.com/p/36001a6bba2d80e49bbddbb38225be38', '', ''],

  ['연구부', '배꽃라운지/도서관 활용 수업 신청', 'https://docs.google.com/spreadsheets/d/11vcUZi83sotVLj9q4REPoQrvLXOM1Lzc-WxpRGMSzMU/edit#gid=0', '', ''],
  ['연구부', '부서별 연수 링크', 'https://docs.google.com/spreadsheets/d/1TKT2z_HoqNIdjxW4XnPttEKPEULAGyJO1LdDyVe7XRI/edit?gid=0#gid=0', '', ''],
  ['연구부', '평가관련 연수 (정)', 'https://myip.kr/LoUSj', '', ''],
  ['연구부', '직업공통능력 (구. 직기초)', 'https://app.notion.com/p/36001a6bba2d80818d09c1f2bc8b8820', '', ''],
  ['연구부', '활동중심수업 안내 및 활동지 양식', 'https://app.notion.com/p/31d01a6bba2d806c938ac7d34e3b50fe', '', ''],
  ['연구부', '학업성적관리규정 개정 관련', 'https://app.notion.com/p/32301a6bba2d80d49415df7e16862657', '', ''],

  ['학생부', '2026 벌점 입력', 'https://docs.google.com/spreadsheets/d/11NmYQhdSIMKsHAQtktmkQ6LI__btMGIB/edit?usp=sharing&ouid=112198091231824557634&rtpof=true&sd=true', '', ''],

  ['진로창체부', '2026 자율 계획', 'https://docs.google.com/spreadsheets/d/1dMwcw1VfD--3xCYT5yzxYSfGxUwMh4BYdjc51K7udDg/edit?gid=84532186#gid=84532186', '', ''],
  ['진로창체부', '2026학년도 2,3학년 진로(독서) 기록부', 'https://docs.google.com/forms/d/e/1FAIpQLScXXx2lyff2bizBUMVUpuxmAOUseGQBw0OPMEUHQuu_B1si_A/viewform', '', ''],
  ['진로창체부', '1학기 칭찬왕 선발대회 반별 입력', 'https://docs.google.com/spreadsheets/d/1ma4fpb8ORYBDK0Ce99pzORgJgPGCD_7ZSFD2QtVNXfw/edit?usp=sharing', '2026-06-30', ''],
  ['진로창체부', '봉사활동 이수자 명단 입력', 'https://docs.google.com/spreadsheets/d/1l_vHHzHixA3PSA0aXnZtDgq6zcLu15Fn6PFa_msL_iA/edit?usp=sharing', '2026-07-13', ''],

  ['기본학력방과후부', '1학년 기초학력진단검사 학생답안 입력양식', 'https://docs.google.com/spreadsheets/d/14hM9QAKpyKtGu-EHjB3Fw_On54uAB5hbnyKDnufBZyQ/edit?usp=sharing', '', ''],
  ['기본학력방과후부', '기초학력 미도달자 현황 (최근 3년)', 'https://docs.google.com/spreadsheets/d/10tJrxAFZJqOFCpb65BP9yMHLtyqjNGKZUPPM6A1BdkQ/edit?usp=sharing', '', ''],
  ['기본학력방과후부', '2026 방과후학교 (일정/수업)', 'https://docs.google.com/spreadsheets/d/1BNR9Qbo3nyQUVy1oiLscWS2LHnb3N1A7/edit?usp=sharing&ouid=104546077153743322720&rtpof=true&sd=true', '', ''],
  ['기본학력방과후부', '1기 집중채움 출석부 - 1,2학년 자격증반', 'https://docs.google.com/spreadsheets/d/1UaaH4mXvq5RSZRhziAWOrYD7jwMzjFjh_k0_2UT0yWg/edit?usp=sharing', '', ''],
  ['기본학력방과후부', '1기 집중채움 출석부 - 1학년 기초기본반', 'https://docs.google.com/spreadsheets/d/1KWFGvqSqPSYH1oqc17DgvGIuK2gyUZk3v1_mu3QmFdI/edit?usp=sharing', '', ''],
  ['기본학력방과후부', '2기 집중채움 출석부 - 1,2학년 자격증반', 'https://docs.google.com/spreadsheets/d/1ZKQKjhF5RvxqhJXmpHo_76rU0Su1gkytiwq2KBhQNTw/edit?usp=sharing', '', ''],
  ['기본학력방과후부', '3기 집중채움 출석부 - 1,2학년 자격증반', 'https://docs.google.com/spreadsheets/d/1Htp4V-VmF6lmqLiRRctlmwe-jSu6zj_yuaMpgTBNSOA/edit?usp=sharing', '', ''],
  ['기본학력방과후부', '3기 집중채움 출석부 - 1학년 기초반', 'https://docs.google.com/spreadsheets/d/1uHUoLX_kSCZv0bhzNAHQs_lh7JZJGV8ideUg8_9s2nQ/edit?usp=sharing', '', ''],
  ['기본학력방과후부', '문해력 경시대회 (1학기)', 'https://docs.google.com/spreadsheets/d/1Ex-PTnNdTyoXR-2N0dE78-BvCfAMzWtVJ0qpYkKlb1o/edit?usp=sharing', '', ''],
  ['기본학력방과후부', '최성보 예방지도 명단 (전학년)', 'https://docs.google.com/spreadsheets/d/1qIrJNSrA8d7QKDw8UOtiGF-dQCUKwDzjsScB9YUippc/edit?usp=sharing', '', ''],
  ['기본학력방과후부', '[26. 1학기] 최성보 관리', 'https://app.notion.com/p/39601a6bba2d805ca1e8cdd6500ad05d', '', ''],
  ['기본학력방과후부', '기초반 교재', 'https://app.notion.com/p/8a7bc17c919241279df01f2536c2cabb', '', ''],
  ['기본학력방과후부', '예산 정리', 'https://app.notion.com/p/31201a6bba2d808ba4bfc122d497749d', '', ''],
  ['기본학력방과후부', '사업 추진', 'https://app.notion.com/p/31201a6bba2d80f7a4f4e1d845703583', '', ''],
  ['기본학력방과후부', '2학기 해야 할 일', 'https://app.notion.com/p/3c001a6bba2d809292a2c588f52a9fa3', '', ''],

  ['복지상담부', '각 학급 급식현황', 'https://docs.google.com/spreadsheets/d/1-VHR_WuHqqnoQClXfJcaOHkT_FF1wQ9x1wT3EOkOgio/edit?gid=0#gid=0', '', ''],
  ['복지상담부', '교직원 급식 신청', 'https://docs.google.com/spreadsheets/d/1B-P9VT5iw_wE2VOzhpily9mh1ZXbQ-E0aZUD380NBjo/edit?gid=0#gid=0', '', ''],

  ['특성화교육과정부', '2027학년도 3개 학년 능력단위 이수계획', 'https://docs.google.com/spreadsheets/d/1iwgbhGwkWY-6UbzcCfxGCwPxGf4XT4s1usolAsDQvPI/edit?usp=sharing', '', ''],
  ['특성화교육과정부', '학점제 교직원 AI 연수 신청', 'https://docs.google.com/spreadsheets/d/1tBHljxaddjehzVM9T1TTsK8c_gMU6ZupaUzKwE1Z2kY/edit?usp=sharing', '', ''],

  ['산학협력부', '산학협력 공유시트 1', 'https://docs.google.com/spreadsheets/d/1vDcVteMU5n3sdBzs7gd9NsY86_CKOHpTTfSmrXuEXv8/edit?gid=0#gid=0', '', '제목을 알맞게 수정해 주세요'],
  ['산학협력부', '산학협력 공유시트 2', 'https://docs.google.com/spreadsheets/d/1ZdoKU5ww2AnYmBACtEg4eTyvDfLM6bBTJFXS3y5GSZo/edit?gid=0#gid=0', '', '제목을 알맞게 수정해 주세요'],
  ['산학협력부', '산학협력 공유시트 3', 'https://docs.google.com/spreadsheets/d/1NErrG-lmztbTSv9kIngMZAP-2vAsNd0CuLPTAvc-ZJc/edit?gid=0#gid=0', '', '제목을 알맞게 수정해 주세요'],
  ['산학협력부', '산학협력 공유시트 4', 'https://docs.google.com/spreadsheets/d/1iavV8SaQqmIuzf1oMavwM3wTMYHZngi5FTQNY022Wtg/edit?gid=0#gid=0', '', '제목을 알맞게 수정해 주세요'],
  ['산학협력부', '산학협력 공유시트 5', 'https://docs.google.com/spreadsheets/d/16h1sFdfhu2i2G4LT_Cwt2hm5R1HSB2C9v8kI_nGccQc/edit?gid=186001220#gid=186001220', '', '제목을 알맞게 수정해 주세요'],
  ['산학협력부', '부서별 연수', 'https://app.notion.com/p/32801a6bba2d803aa804fa12ce385dc0', '', ''],

  ['전문교육부', '학습지원 소프트웨어 선정', 'https://docs.google.com/spreadsheets/d/1zsl1e90hmajLs76VkH_bzLY-CT1-jyxeFfhUKfcHanE/edit?gid=0#gid=0', '', ''],
  ['전문교육부', '1학기 특색 방과후 출석부', 'https://docs.google.com/spreadsheets/d/1426yu0FtpvlW6Vh3WxSD0AYyM_88FjdnSssjNnoH5Fs/edit?usp=sharing', '', ''],
  ['전문교육부', '전국상업경진대회 출석부', 'https://docs.google.com/spreadsheets/d/1tDtojoSF_zteD8KX1Eql0qYJy-un1Tip2_ffp1RXeUU/edit?usp=sharing', '', ''],

  ['인성학부모부', '인성학부모부 공유시트', 'https://docs.google.com/spreadsheets/d/1rSPbAOVeWuVQaCV0YDg8ycPSkBTmp4c3N6jmLw2X9jk/edit?usp=sharing', '', ''],

  ['수평공동체', '수평 공동체', 'https://app.notion.com/p/32901a6bba2d80cb83dae50078a07d10', '', ''],
  ['수평공동체', '완료 프로젝트', 'https://app.notion.com/p/32901a6bba2d80cf8c21d793d6b1bb85', '', ''],

  ['1학년', '1학년 자습명단 (기말시험)', 'https://docs.google.com/spreadsheets/d/1yj4Obt113CMzCspgyKDD-AluPGAa2NBJWxBFKLlb6Hg/edit?usp=sharing', '', ''],

  ['2학년', '2학년 금융공기업반 출석부 (1기)', 'https://docs.google.com/spreadsheets/d/18z7Bg_VcT6C_ww453ryogPbB6RAicNue9iE84WktHuk/edit?gid=832607897#gid=832607897', '', ''],
  ['2학년', '2학년 금융공기업반 출석부 (2기)', 'https://docs.google.com/spreadsheets/d/1ptxZro-3yaisKAfvgzgodOiKCgCiNb5GytmrPJwDY2E/edit?usp=sharing', '', ''],
  ['2학년', '2학기 금공반 출석부', 'https://docs.google.com/spreadsheets/d/17aDpc_SPccG8VB0J2DLf6jXtHiyaiqWFr3P2YUMVmKs/edit?usp=sharing', '', ''],
  ['2학년', '2학년 자습명단 (기말시험)', 'https://docs.google.com/spreadsheets/d/1VKOHXaHgjODyUadRXcHPs8f1r8g2v307UytYLsOkDE8/edit?hl=ko&gid=0#gid=0', '', ''],
  ['2학년', '전공동아리 (실무회계연구반) 출석부', 'https://docs.google.com/spreadsheets/d/1Sv-hXs20K1I8_cXKGZGdsiTTWIeQUV9adJWqt_PPxXw/edit?usp=sharing', '', ''],

  ['자료실', '2025학년도 자료', 'https://app.notion.com/p/31101a6bba2d803183ebcabacf6a0631', '', ''],
  ['자료실', '2024년도 자료', 'https://app.notion.com/p/24d80e8027934f768079098cf1a90703', '', ''],
  ['자료실', '대구미래역량교육과정 (각론)', 'https://app.notion.com/p/31201a6bba2d808881eed18d1a76a950', '', ''],
  ['자료실', '타임리 로그인', 'https://timelygpt.co.kr/gbgc', '', '']
];

function onOpen() {
  SpreadsheetApp.getUi()
    .createMenu('경북여상 허브')
    .addItem('1. 초기 설치 (시트 생성 + 링크 이전)', 'installHubFromMenu')
    .addItem('2. 관리자 계정 추가', 'addAdminAccountFromMenu')
    .addItem('설치 상태 확인', 'checkSetupFromMenu')
    .addSeparator()
    .addItem('마감 알림 미리보기', 'previewReminders')
    .addItem('마감 알림 자동 발송 켜기', 'enableReminderTrigger')
    .addItem('마감 알림 자동 발송 끄기', 'disableReminderTrigger')
    .addSeparator()
    .addItem('시트 열 최신화', 'migrateColumnsFromMenu')
    .addItem('없앨 부서 미리보기', 'previewDeptCleanup')
    .addItem('없앨 부서 정리 (업무도 삭제)', 'cleanupDeptsFromMenu')
    .addItem('부서 목록 기본값으로 되돌리기', 'resetDepts')
    .addToUi();
}

/**
 * 없앨 부서를 정리합니다 — 무엇이 지워지는지 먼저 보여 줍니다.
 *
 * 지우기 전에 반드시 이 함수를 먼저 실행해 실행 기록을 확인해 주세요.
 * 실제 삭제는 cleanupDepts 입니다.
 */
function previewDeptCleanup() {
  var rows = readSheet(sheet(SHEET_LINKS), LINK_COLS);
  var doomed = rows.filter(function (r) {
    return RETIRED_DEPTS.indexOf(String(r.dept).trim()) >= 0;
  });

  var text = '없앨 부서: ' + RETIRED_DEPTS.join(', ') + '\n' +
             '함께 지워질 업무: ' + doomed.length + '건\n\n' +
             doomed.map(function (r) { return '  · [' + r.dept + '] ' + r.title; }).join('\n') +
             '\n\n새 부서 목록: ' + DEPTS.join(', ');
  Logger.log(text);
  return text;
}

/**
 * 실제로 지웁니다. 되돌리려면 구글시트의 [파일 > 버전 기록] 을 쓰세요.
 * previewDeptCleanup 으로 먼저 확인하신 뒤 실행해 주세요.
 */
function cleanupDepts() {
  var sh = sheet(SHEET_LINKS);
  var rows = readSheet(sh, LINK_COLS);

  // 아래에서 위로 지워야 행 번호가 밀리지 않습니다.
  var removed = 0;
  for (var i = rows.length - 1; i >= 0; i--) {
    if (RETIRED_DEPTS.indexOf(String(rows[i].dept).trim()) >= 0) {
      sh.deleteRow(i + 2);          // 1행은 머리글
      removed++;
    }
  }

  // config 의 부서 목록을 새 목록으로 맞춥니다.
  setConfigValue('depts', DEPTS.join(', '));

  var text = '업무 ' + removed + '건을 지우고, 부서 목록을 ' + DEPTS.length + '개로 맞췄습니다.\n' +
             DEPTS.join(', ');
  say('정리 완료', text);
  return text;
}

function cleanupDeptsFromMenu() {
  var ui = uiOrNull();
  if (!ui) return cleanupDepts();

  var res = ui.alert('부서 정리',
    previewDeptCleanup() + '\n\n정말 지울까요? (되돌리려면 파일 > 버전 기록)',
    ui.ButtonSet.YES_NO);
  if (res !== ui.Button.YES) return;
  ui.alert('정리 완료', cleanupDepts(), ui.ButtonSet.OK);
}

/** config 시트의 값 한 칸을 고칩니다. 없으면 새로 넣습니다. */
function setConfigValue(key, value) {
  var sh = sheet(SHEET_CONFIG);
  var rows = sh.getDataRange().getValues();
  for (var i = 1; i < rows.length; i++) {
    if (String(rows[i][0]).trim() === key) {
      sh.getRange(i + 1, 2).setValue(value);
      return;
    }
  }
  sh.appendRow([key, value]);
}

/** 새 기능으로 늘어난 열(track/target/email)을 기존 시트에 덧붙입니다. */
function migrateColumns() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  ensureSheet(book, SHEET_LINKS, LINK_COLS);
  ensureSheet(book, SHEET_USERS, USER_COLS);
  ensureSheet(book, SHEET_TEACHERS, TEACHER_COLS);
  say('완료', '시트 열을 최신 상태로 맞췄습니다.');
}

function checkSetupFromMenu() {
  var text = checkSetup();
  var ui = uiOrNull();
  if (ui) ui.alert('설치 상태', text, ui.ButtonSet.OK);
}

function uiOrNull() {
  try { return SpreadsheetApp.getUi(); } catch (err) { return null; }
}

/**
 * 알림창은 "메뉴에서 실행했을 때만" 띄웁니다.
 *
 * 편집기에서 실행할 때 ui.alert() 를 부르면 대화상자가 스프레드시트 탭에 뜨고,
 * 편집기는 그 창을 누를 때까지 계속 "실행 중"으로 멈춰 버립니다.
 * 그래서 아래 설치 함수들은 UI를 전혀 건드리지 않고 로그만 남깁니다.
 */
function say(title, message) {
  Logger.log('[' + title + '] ' + message);
}

/** 메뉴에서 부르는 입구 — 여기서만 알림창을 띄웁니다. */
function installHubFromMenu() {
  var summary = installHub();
  var ui = uiOrNull();
  if (ui) ui.alert('설치 완료', summary, ui.ButtonSet.OK);
}

function migrateColumnsFromMenu() {
  migrateColumns();
  var ui = uiOrNull();
  if (ui) ui.alert('완료', '시트 열을 최신 상태로 맞췄습니다.', ui.ButtonSet.OK);
}

/**
 * 설치 상태를 로그로 보여 줍니다. 알림창을 띄우지 않으므로
 * 편집기에서 실행해도 멈추지 않습니다. (실행 기록에서 결과 확인)
 */
function checkSetup() {
  var book = SpreadsheetApp.getActiveSpreadsheet();
  var out = [];
  [SHEET_LINKS, SHEET_USERS, SHEET_CONFIG, SHEET_TEACHERS].forEach(function (n) {
    var sh = book.getSheetByName(n);
    out.push(n + ' 시트: ' + (sh ? (sh.getLastRow() - 1) + '행' : '없음'));
  });
  var users = book.getSheetByName(SHEET_USERS)
    ? readSheet(sheet(SHEET_USERS), USER_COLS).map(function (u) {
        return u.name + '(' + (u.role === 'admin' ? '관리자' : (u.dept || '부서없음')) + ')';
      })
    : [];
  out.push('등록된 사용자: ' + (users.length ? users.join(', ') : '없음'));
  out.push('ADMIN_NAME 설정값: ' + (String(ADMIN_NAME || '').trim() || '(비어 있음)'));

  var text = out.join('\n');
  Logger.log(text);
  return text;
}

/** 설치 본체 — 알림창을 띄우지 않습니다. 결과는 문자열로 돌려줍니다. */
function installHub() {
  var book = SpreadsheetApp.getActiveSpreadsheet();

  ensureSheet(book, SHEET_LINKS, LINK_COLS);
  ensureSheet(book, SHEET_USERS, USER_COLS);
  ensureSheet(book, SHEET_CONFIG, ['key', 'value']);
  ensureSheet(book, SHEET_TEACHERS, TEACHER_COLS);

  var cfg = book.getSheetByName(SHEET_CONFIG);
  if (cfg.getLastRow() < 2) {
    cfg.getRange(2, 1, 6, 2).setValues([
      ['siteTitle', '경북여상 교무실 업무 허브'],
      ['year', '2026학년도'],
      ['notice', '구글시트는 [공유 > 링크가 있는 모든 사용자 > 편집자]로 설정한 뒤 등록해 주세요.'],
      ['depts', DEPTS.join(', ')],
      ['siteUrl', 'https://knuekim91.github.io/gbgc/'],
      ['requireLogin', '']
    ]);
  }

  var moved = 0;
  var links = book.getSheetByName(SHEET_LINKS);
  if (links.getLastRow() < 2) {
    var counter = {};
    var rows = SEED.map(function (s) {
      counter[s[0]] = (counter[s[0]] || 0) + 10;
      return [
        newId(), s[0], s[1], s[2], detectType(s[2]),
        s[4] || '', s[3] || '', counter[s[0]], 'Y', '(초기이전)', now(), '', '', '', '', '', ''
      ];
    });
    links.getRange(2, 1, rows.length, LINK_COLS.length).setValues(rows);
    moved = rows.length;
  }

  book.setSpreadsheetTimeZone('Asia/Seoul');

  // ADMIN_NAME 을 적어 두었다면 관리자 계정까지 여기서 만듭니다.
  var adminNote = '';
  var name = String(ADMIN_NAME || '').trim();
  if (name) {
    registerAdmin(name);
    adminNote = '\n관리자 계정: ' + name + ' (초기 비밀번호 ' + DEFAULT_PASSWORD + ')';
  } else {
    adminNote = '\n\n다음으로 [경북여상 허브 > 2. 관리자 계정 추가] 를 실행하거나,\n' +
                'Setup 파일 맨 위 ADMIN_NAME 에 성함을 적고 installHub 를 다시 실행해 주세요.';
  }

  var summary = (moved > 0 ? 'Notion에서 링크 ' + moved + '건을 옮겨 담았습니다.'
                           : 'links 시트에 이미 데이터가 있어 초기 링크는 넣지 않았습니다.') + adminNote;
  say('설치 완료', summary);
  return summary;
}

/** 이름 하나를 관리자로 등록합니다. (이미 있으면 관리자 권한만 부여) */
function registerAdmin(name) {
  name = String(name || '').trim();
  if (!name) throw new Error('이름이 비어 있습니다.');

  if (findUser(name)) {
    updateUserRow(name, { role: 'admin', dept: '', updatedAt: now() });
  } else {
    var salt = newSalt();
    sheet(SHEET_USERS).appendRow([name, '', 'admin', salt, hashPassword(DEFAULT_PASSWORD, salt), 'Y', now(), '']);
  }
  return name;
}

/** 편집기에서 실행하는 용도 — 입력창을 띄우지 않고 ADMIN_NAME 을 씁니다. */
function addAdminAccount() {
  var preset = String(ADMIN_NAME || '').trim();
  if (!preset) throw new Error('Setup 파일 맨 위 ADMIN_NAME 에 성함을 적고 다시 실행해 주세요.');
  registerAdmin(preset);
  var msg = preset + ' 님을 관리자로 등록했습니다. 초기 비밀번호: ' + DEFAULT_PASSWORD;
  say('완료', msg);
  return msg;
}

/** 메뉴에서 부르는 입구 — 이름을 물어봅니다. */
function addAdminAccountFromMenu() {
  var ui = uiOrNull();
  if (!ui) return addAdminAccount();

  var res = ui.prompt('관리자 계정 추가',
    '관리자로 등록할 선생님 이름을 입력해 주세요.\n(초기 비밀번호는 ' + DEFAULT_PASSWORD + ' 입니다)',
    ui.ButtonSet.OK_CANCEL);
  if (res.getSelectedButton() !== ui.Button.OK) return;

  var name = res.getResponseText().trim();
  if (!name) return;

  registerAdmin(name);
  var msg = name + ' 님을 관리자로 등록했습니다.\n초기 비밀번호: ' + DEFAULT_PASSWORD +
            '\n\n첫 로그인 후 비밀번호를 꼭 변경해 주세요.';
  say('완료', msg);
  ui.alert('완료', msg, ui.ButtonSet.OK);
}

function resetDepts() {
  var sh = sheet(SHEET_CONFIG);
  var values = sh.getDataRange().getValues();
  for (var i = 1; i < values.length; i++) {
    if (String(values[i][0]) === 'depts') { sh.getRange(i + 1, 2).setValue(DEPTS.join(', ')); return; }
  }
  sh.appendRow(['depts', DEPTS.join(', ')]);
}

function ensureSheet(book, name, headers) {
  var sh = book.getSheetByName(name);
  if (!sh) sh = book.insertSheet(name);
  if (sh.getMaxColumns() < headers.length) {
    sh.insertColumnsAfter(sh.getMaxColumns(), headers.length - sh.getMaxColumns());
  }
  // 열은 뒤에만 덧붙이므로 머리글을 항상 덮어써도 기존 데이터는 그대로입니다.
  sh.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#f1f3f4');
  sh.setFrozenRows(1);
  return sh;
}
