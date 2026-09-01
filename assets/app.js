/* 경북여상 업무 허브 — 프론트엔드 */
(function () {
  'use strict';

  var API = (window.HUB_CONFIG && window.HUB_CONFIG.apiUrl || '').trim();
  var LS = { token: 'gbgc.token', fav: 'gbgc.fav', theme: 'gbgc.theme' };

  var state = {
    links: [], depts: [], config: {}, me: null, users: [],
    progress: {}, open: [], filter: 'all', q: ''
  };

  var $  = function (s, r) { return (r || document).querySelector(s); };
  var $$ = function (s, r) { return Array.prototype.slice.call((r || document).querySelectorAll(s)); };

  /* ── 저장소 ───────────────────────── */

  function store(key, val) {
    try {
      if (val === undefined) return localStorage.getItem(key);
      if (val === null) localStorage.removeItem(key); else localStorage.setItem(key, val);
    } catch (e) { /* 시크릿 모드 등 */ }
    return null;
  }

  function favs() {
    try { return JSON.parse(store(LS.fav) || '[]'); } catch (e) { return []; }
  }
  function toggleFav(id) {
    var list = favs();
    var i = list.indexOf(id);
    if (i < 0) list.push(id); else list.splice(i, 1);
    store(LS.fav, JSON.stringify(list));
    return i < 0;
  }

  /* ── API ───────────────────────── */

  function api(action, payload) {
    if (!API) return Promise.reject(new Error('SETUP'));
    var body = Object.assign({ action: action, token: store(LS.token) || '' }, payload || {});
    return fetch(API, {
      method: 'POST',
      // text/plain 으로 보내야 CORS 사전요청(preflight) 없이 Apps Script에 도달합니다.
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify(body),
      redirect: 'follow'
    })
      .then(function (r) { return r.text(); })
      .then(function (t) {
        var data;
        try { data = JSON.parse(t); }
        catch (e) { throw new Error('서버 응답을 읽지 못했습니다. 웹앱 배포 설정을 확인해 주세요.'); }
        if (!data.ok) throw new Error(data.error || '알 수 없는 오류');
        return data;
      });
  }

  /* ── 표시 도우미 ───────────────────────── */

  var DEPT_HUE = {
    '교장': 240, '교감': 165,
    '교무부': 25, '연구부': 35, '학생부': 45, '진로창체부': 330, '기본학력방과후부': 270,
    '복지상담부': 300, '특성화교육과정부': 210, '산학협력부': 195, '전문교육부': 145,
    '인성학부모부': 15, '1학년': 55, '2학년': 85, '3학년': 110
  };

  function deptColor(name) {
    var hue = DEPT_HUE[name];
    if (hue === undefined) {
      hue = 0;
      for (var i = 0; i < name.length; i++) hue = (hue * 31 + name.charCodeAt(i)) % 360;
    }
    return 'hsl(' + hue + ' 62% 48%)';
  }

  var TYPE_ICON = {
    sheet: '📊', form: '📝', doc: '📄', slide: '📽️',
    drive: '📁', notion: '🗂️', link: '🔗', task: '📌'
  };

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

  var TYPE_LABEL = {
    sheet: '구글시트', form: '구글폼', doc: '구글문서', slide: '구글슬라이드',
    drive: '드라이브', notion: '노션 페이지', link: '웹 페이지', task: '링크 없는 업무'
  };

  // 시각이 아니라 날짜(자정 기준)로 비교해야 "오늘 마감"이 D-1 로 보이지 않습니다.
  function daysLeft(dateStr) {
    if (!dateStr) return null;
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(dateStr));
    if (!m) return null;
    var due = new Date(+m[1], +m[2] - 1, +m[3]);
    var today = new Date();
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    return Math.round((due - today) / 86400000);
  }

  function deadlineTag(dateStr) {
    var n = daysLeft(dateStr);
    if (n === null) return '';
    var md = dateStr.slice(5).replace('-', '/');
    if (n < 0)   return '<span class="tag past">' + md + ' 마감</span>';
    if (n === 0) return '<span class="tag urgent">오늘 마감</span>';
    if (n <= 7)  return '<span class="tag urgent">' + md + ' · D-' + n + '</span>';
    return '<span class="tag due">' + md + ' 마감</span>';
  }

  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function toast(msg, bad) {
    var el = $('#toast');
    el.textContent = msg;
    el.classList.toggle('bad', !!bad);
    el.hidden = false;
    clearTimeout(toast._t);
    toast._t = setTimeout(function () { el.hidden = true; }, bad ? 4200 : 2400);
  }

  /** 복구용 이메일이 없으면 아무것도 고칠 수 없습니다. */
  function hasEmail() {
    return !!(state.me && String(state.me.email || '').trim());
  }

  function canEdit(dept) {
    if (!state.me || !hasEmail()) return false;
    if (state.me.role === 'admin') return true;
    return state.me.dept.split(',').map(function (s) { return s.trim(); }).indexOf(dept) >= 0;
  }

  function myDepts() {
    if (!state.me) return [];
    if (state.me.role === 'admin') return state.depts.slice();
    return state.me.dept.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /* ── 렌더링 ───────────────────────── */

  /**
   * 화면에 뿌릴 순서를 정합니다.
   *
   * sort 값은 등록할 때 한 번 정해지고 수정해도 그대로이므로,
   * 큰 값부터 늘어놓으면 "나중에 올린 것이 위" 가 됩니다.
   * 마감 임박 화면만은 급한 것이 위로 와야 해서 마감일 순으로 둡니다.
   */
  function orderFor(links) {
    if (state.filter === 'due') {
      return links.sort(function (a, b) {
        return (daysLeft(a.deadline) || 0) - (daysLeft(b.deadline) || 0);
      });
    }
    return links.sort(function (a, b) { return (b.sort || 0) - (a.sort || 0); });
  }

  function visibleLinks() {
    var q = state.q.trim().toLowerCase();
    var fav = favs();
    return orderFor(state.links.filter(function (l) {
      if (state.filter === 'fav' && fav.indexOf(l.id) < 0) return false;
      if (state.filter === 'due') {
        var n = daysLeft(l.deadline);
        if (n === null || n < 0 || n > 14) return false;
      }
      if (state.filter === 'mine' && myDepts().indexOf(l.dept) < 0) return false;
      if (state.filter !== 'all' && state.filter !== 'fav' &&
          state.filter !== 'due' && state.filter !== 'mine' && l.dept !== state.filter) return false;
      if (q) {
        var hay = (l.title + ' ' + l.dept + ' ' + (l.note || '') + ' ' +
                   (l.desc || '') + ' ' + fileNames(l)).toLowerCase();
        return q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
      }
      return true;
    }));
  }

  /**
   * 다가오는 일정(D-day) — config 시트의 dday 칸에서 읽습니다.
   *   1차 입학설명회=2026-09-11, 방학=2026-12-30
   * 날짜는 2026-09-11 도 9.11 도 됩니다. 연도를 빼면 올해로 봅니다.
   * 이미 지난 일정은 저절로 사라지므로 해마다 날짜만 고치시면 됩니다.
   */
  function parseDdays(raw) {
    var year = new Date().getFullYear();
    // 줄바꿈으로도, 쉼표로도 나눌 수 있게 합니다.
    // 이름과 날짜는 마지막 '=' 나 마지막 ',' 로 가릅니다.
    return String(raw || '').split(/[\r\n]+/).reduce(function (acc, line) {
      return acc.concat(line.indexOf('=') >= 0 ? line.split(',') : [line]);
    }, []).map(function (part) {
      part = part.trim();
      if (!part) return null;

      var at = Math.max(part.lastIndexOf('='), part.lastIndexOf(','));
      if (at < 0) return null;

      var label = part.slice(0, at).trim();
      var text = part.slice(at + 1).trim();
      var full = /^(\d{4})[-.\/](\d{1,2})[-.\/](\d{1,2})$/.exec(text);
      var short = /^(\d{1,2})[-.\/](\d{1,2})$/.exec(text);

      var date;
      if (full) date = new Date(+full[1], +full[2] - 1, +full[3]);
      else if (short) date = new Date(year, +short[1] - 1, +short[2]);
      else return null;

      if (!label || isNaN(date)) return null;
      return { label: label, date: date };
    }).filter(Boolean).sort(function (a, b) { return a.date - b.date; });
  }

  function renderDdays() {
    var today = new Date();
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());

    var items = parseDdays(state.config.dday).filter(function (d) {
      return d.date >= today;            // 지난 일정은 보여 주지 않습니다
    });

    $('#ddays').innerHTML = items.map(function (d) {
      var left = Math.round((d.date - today) / 86400000);
      var md = (d.date.getMonth() + 1) + '.' + d.date.getDate();
      return '<span class="dday">' +
        '<b>' + esc(d.label) + '</b>' +
        '<span class="dday-date">' + md + '</span>' +
        '<span class="dday-left">' + (left === 0 ? 'D-DAY' : 'D-' + left) + '</span>' +
      '</span>';
    }).join('');
  }

  function renderChips() {
    var counts = {};
    state.links.forEach(function (l) { counts[l.dept] = (counts[l.dept] || 0) + 1; });

    var items = [{ id: 'all', label: '전체', n: state.links.length }];
    if (state.me) items.push({ id: 'mine', label: '내 부서', n: null });
    items.push({ id: 'fav', label: '⭐ 즐겨찾기', n: null });
    items.push({ id: 'due', label: '⏰ 마감 임박', n: null });
    // 업무가 있는 부서는 누구에게나, 아직 비어 있는 부서는 그곳을 맡은
    // 선생님에게만 보여 줍니다. 그래야 첫 업무를 올릴 길이 생깁니다.
    var editable = hasEmail() ? myDepts() : [];
    state.depts.forEach(function (d) {
      if (counts[d]) items.push({ id: d, label: d, n: counts[d] });
      else if (editable.indexOf(d) >= 0) items.push({ id: d, label: d, n: null });
    });
    // config 목록에 없는 부서가 데이터에 있으면 뒤에 붙입니다.
    Object.keys(counts).forEach(function (d) {
      if (state.depts.indexOf(d) < 0) items.push({ id: d, label: d, n: counts[d] });
    });

    $('#chips').innerHTML = items.map(function (it) {
      return '<button class="chip" type="button" data-f="' + esc(it.id) + '" aria-pressed="' +
        (state.filter === it.id) + '">' + esc(it.label) +
        (it.n != null ? '<span class="n">' + it.n + '</span>' : '') + '</button>';
    }).join('');
  }

  function renderBoard() {
    var links = visibleLinks();
    var board = $('#board');
    var stateEl = $('#state');

    // 부서 단위로 묶습니다.
    var groups = [], index = {};
    links.forEach(function (l) {
      if (!index[l.dept]) { index[l.dept] = { dept: l.dept, items: [] }; groups.push(index[l.dept]); }
      index[l.dept].items.push(l);
    });

    // 편집 권한이 있는데 아직 링크가 없는 부서도 카드로 보여 줍니다.
    if (state.me && hasEmail() && !state.q) {
      var show = (state.filter === 'all' || state.filter === 'mine')
        ? myDepts()
        : (myDepts().indexOf(state.filter) >= 0 ? [state.filter] : []);
      show.forEach(function (d) {
        if (!index[d]) { index[d] = { dept: d, items: [] }; groups.push(index[d]); }
      });
    }

    var order = state.depts;
    groups.sort(function (a, b) {
      var ai = order.indexOf(a.dept), bi = order.indexOf(b.dept);
      return (ai < 0 ? 999 : ai) - (bi < 0 ? 999 : bi);
    });

    if (!groups.length) {
      board.innerHTML = '';
      stateEl.className = 'state';
      stateEl.textContent = state.q
        ? '"' + state.q + '" 검색 결과가 없습니다.'
        : (state.filter === 'fav' ? '즐겨찾기한 업무가 없습니다. 업무 옆 ☆ 를 눌러 추가해 보세요.'
        : state.filter === 'due' ? '2주 이내 마감인 항목이 없습니다.'
        : '표시할 링크가 없습니다.');
      stateEl.hidden = false;
      return;
    }
    stateEl.hidden = true;

    var fav = favs();
    board.innerHTML = groups.map(function (g) {
      var editable = canEdit(g.dept);
      return '<section class="card" style="--dept:' + deptColor(g.dept) + '">' +
        '<div class="card-head">' +
          '<h2>' + esc(g.dept) + '</h2>' +
          '<span class="count">' + g.items.length + '</span>' +
          '<button class="share" type="button" data-share="' + esc(g.dept) +
            '" title="' + esc(g.dept) + ' 전용 주소 복사" aria-label="' + esc(g.dept) + ' 전용 주소 복사">🔗</button>' +
          (editable ? '<button class="add" type="button" data-add="' + esc(g.dept) +
                      '" title="' + esc(g.dept) + '에 업무 추가" aria-label="' + esc(g.dept) + '에 업무 추가">＋</button>' : '') +
        '</div>' +
        (g.items.length
          ? '<ul class="items">' + g.items.map(function (l, i) {
              return itemHtml(l, fav, editable, i === 0, i === g.items.length - 1);
            }).join('') + '</ul>'
          : '<p class="empty-dept">아직 등록된 업무가 없습니다. ＋ 를 눌러 추가해 주세요.</p>') +
      '</section>';
    }).join('');
  }

  // 수합 현황 배지 — 대상 인원을 적어 두면 막대와 함께, 아니면 건수만 보여 줍니다.
  /**
   * 순서 바꾸기를 보여 줄 만한 화면인지 봅니다.
   * 검색 중이거나 즐겨찾기·마감 임박 화면에서는 눈에 보이는 이웃과
   * 실제 부서 안의 이웃이 달라서 헷갈리므로 감춥니다.
   */
  function canReorder() {
    return !state.q && state.filter !== 'due' && state.filter !== 'fav';
  }

  /** 그 부서의 업무를 화면에 보이는 순서(위에서 아래)대로 돌려줍니다. */
  function deptItems(dept) {
    return state.links
      .filter(function (l) { return l.dept === dept; })
      .sort(function (a, b) { return (b.sort || 0) - (a.sort || 0); });
  }

  function fileCount(l) { return (l.files || []).length; }
  function fileNames(l) {
    return (l.files || []).map(function (f) { return f.name || ''; }).join(' ');
  }

  function progressTag(l) {
    if (String(l.track).toUpperCase() !== 'Y') return '';
    var p = state.progress[l.id];
    if (!p) return '<span class="prog err">수합 현황 확인 중…</span>';
    if (p.error) return '<span class="prog err" title="' + esc(p.error) + '">수합 현황 –</span>';

    var target = Number(p.target) || 0;
    if (!target) return '<span class="prog">' + p.count + '건 제출</span>';

    var pct = Math.min(100, Math.round(p.count / target * 100));
    return '<span class="prog' + (p.count >= target ? ' done' : '') + '">' +
      '<span class="bar"><i style="width:' + pct + '%"></i></span>' +
      p.count + '/' + target + (p.count >= target ? ' 완료' : '') +
    '</span>';
  }

  function itemHtml(l, fav, editable, first, last) {
    var type = l.type || detectType(l.url);
    var starred = fav.indexOf(l.id) >= 0;
    var showDept = state.filter === 'fav' || state.filter === 'due' || !!state.q;

    var open = state.open.indexOf(l.id) >= 0;
    var pid = 'p-' + l.id;

    // 제목 줄을 누르면 아래로 펼쳐집니다. 링크는 펼친 안에서 엽니다.
    return '<li class="item' + (open ? ' open' : '') + '" data-id="' + esc(l.id) + '">' +
      '<div class="item-head">' +
        '<button class="item-toggle" type="button" data-toggle="' + esc(l.id) + '"' +
          ' aria-expanded="' + open + '" aria-controls="' + pid + '">' +
          '<span class="item-icon" title="' + esc(TYPE_LABEL[type] || '링크') + '">' + (TYPE_ICON[type] || '🔗') + '</span>' +
          '<span class="item-main">' +
            '<span class="item-title">' + esc(l.title) + '</span>' +
            '<span class="item-meta">' +
              (showDept ? '<span class="tag dept" style="--dept:' + deptColor(l.dept) + '">' + esc(l.dept) + '</span>' : '') +
              deadlineTag(l.deadline) +
              progressTag(l) +
              (l.note ? '<span class="tag">' + esc(l.note) + '</span>' : '') +
              (l.desc ? '<span class="tag has-desc">알릴 내용</span>' : '') +
              (fileCount(l) ? '<span class="tag has-file">📎 첨부' +
                 (fileCount(l) > 1 ? ' ' + fileCount(l) : '') + '</span>' : '') +
            '</span>' +
          '</span>' +
          '<span class="caret" aria-hidden="true">▾</span>' +
        '</button>' +
        '<div class="item-tools">' +
          '<button class="tool star' + (starred ? ' on' : '') + '" type="button" data-star="' + esc(l.id) +
            '" aria-label="즐겨찾기">' + (starred ? '★' : '☆') + '</button>' +
          (l.url
            ? '<a class="tool" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer" aria-label="새 탭에서 열기" title="새 탭에서 열기">↗</a>' +
              '<button class="tool" type="button" data-copy="' + esc(l.id) + '" aria-label="주소 복사">⧉</button>'
            : '') +
          (editable && canReorder()
            ? '<button class="tool" type="button" data-move="up" data-id="' + esc(l.id) + '"' +
                (first ? ' disabled' : '') + ' title="위로" aria-label="위로 옮기기">▲</button>' +
              '<button class="tool" type="button" data-move="down" data-id="' + esc(l.id) + '"' +
                (last ? ' disabled' : '') + ' title="아래로" aria-label="아래로 옮기기">▼</button>'
            : '') +
          (editable
            ? '<button class="tool" type="button" data-edit="' + esc(l.id) + '" aria-label="수정">✎</button>' +
              '<button class="tool" type="button" data-del="' + esc(l.id) + '" aria-label="삭제">🗑</button>'
            : '') +
        '</div>' +
      '</div>' +
      '<div class="item-panel" id="' + pid + '"' + (open ? '' : ' hidden') + '>' +
        '<dl class="detail">' +
          '<dt>제목</dt><dd>' + esc(l.title) + '</dd>' +
          '<dt>링크</dt><dd>' +
            (l.url
              ? '<a class="panel-link" href="' + esc(l.url) + '" target="_blank" rel="noopener noreferrer">' + esc(l.url) + '</a>'
              : '') +
          '</dd>' +
          '<dt>첨부파일</dt><dd class="files">' +
            (l.files || []).map(function (fl) {
              return '<a class="panel-link" href="' + esc(fl.url) + '" target="_blank" rel="noopener noreferrer">📎 ' +
                     esc(fl.name || '첨부파일') + '</a>';
            }).join('') +
          '</dd>' +
          '<dt>알릴 내용</dt><dd class="desc">' + esc(l.desc || '') + '</dd>' +
        '</dl>' +
      '</div>' +
    '</li>';
  }

  function renderAuth() {
    var btn = $('#authBtn');
    if (state.me) {
      btn.textContent = state.me.name + ' 님';
      btn.classList.remove('btn-ghost');
    } else {
      btn.textContent = '로그인';
      btn.classList.add('btn-ghost');
    }
    $('#fab').hidden = !state.me || !hasEmail();
    $('#needEmail').hidden = !state.me || hasEmail();
  }

  function renderAll() { renderChips(); renderBoard(); renderAuth(); }

  /* ── 불러오기 ───────────────────────── */

  function bootstrap() {
    if (!API) return showSetupHelp();
    return api('bootstrap').then(applyBoot).catch(function (e) {
      var el = $('#state');
      el.className = 'state error';
      el.hidden = false;
      el.textContent = '데이터를 불러오지 못했습니다.\n' + e.message;
    });
  }

  /**
   * 서버가 준 전체 상태를 화면에 반영합니다.
   * Apps Script 왕복이 한 번에 1초 넘게 걸리므로, 로그인 응답에도
   * 같은 내용을 담아 보내 두 번 부르지 않게 했습니다.
   */
  function applyBoot(d) {
      state.links = d.links || [];
      state.depts = d.depts || [];
      state.config = d.config || {};
      state.me = d.me || null;
      if (!state.me) store(LS.token, null);

      if (state.config.siteTitle) {
        $('#siteTitle').textContent = state.config.siteTitle;
        document.title = state.config.siteTitle;
      }
      if (state.config.year) $('#siteYear').textContent = state.config.year;
      if (state.config.notice) {
        $('#notice').textContent = state.config.notice;
        $('#notice').hidden = false;
      }
      fillDeptSelects();
      renderDdays();
      renderAll();

      if (d.locked) {
        var lock = $('#state');
        lock.className = 'state';
        lock.hidden = false;
        lock.textContent = '링크를 보려면 로그인이 필요합니다.';
        if (!$('#dlgLogin').open) $('#dlgLogin').showModal();
      focusLogin();
        return;
      }
      applyHash();
      loadProgress();
      handleQuickAdd();
      if (state.me && state.me.mustChange) {
        // 초기 비밀번호는 모두가 아는 값이므로 바로 바꾸도록 안내합니다.
        setTimeout(openAccount, 400);
      }
  }

  // 수합 현황은 대상 시트를 여느라 느리므로 화면을 먼저 그린 뒤 따로 불러옵니다.
  function loadProgress() {
    if (!state.links.some(function (l) { return String(l.track).toUpperCase() === 'Y'; })) return;
    api('progress').then(function (d) {
      state.progress = d.progress || {};
      renderBoard();
    }).catch(function () { /* 현황 표시는 실패해도 본 화면에 영향을 주지 않습니다 */ });
  }

  /* 부서 전용 주소 (#연구부) — 카톡 등으로 부서별 링크를 뿌릴 때 씁니다. */
  function applyHash() {
    var raw = decodeURIComponent(location.hash.replace(/^#/, '')).trim();
    if (!raw) return;
    var known = ['all', 'fav', 'due', 'mine'].concat(state.depts);
    if (known.indexOf(raw) >= 0) { state.filter = raw; renderChips(); renderBoard(); }
  }
  window.addEventListener('hashchange', applyHash);

  /* 북마클릿으로 넘어온 ?add=1&url=..&title=.. 처리 */
  var pendingAdd = null;

  function openAddWith(seed) {
    openLinkForm({
      id: '', dept: myDepts()[0] || '', title: seed.title || '',
      url: seed.url || '', deadline: '', note: '', track: '', target: ''
    });
    $('#linkFormTitle').textContent = '업무 추가';
  }

  function handleQuickAdd() {
    var p = new URLSearchParams(location.search);
    if (p.get('add') !== '1') return;
    history.replaceState(null, '', location.pathname + location.hash);

    if (!state.me) {
      pendingAdd = { url: p.get('url') || '', title: p.get('title') || '' };
      toast('로그인하면 등록창이 열립니다');
      if (!$('#dlgLogin').open) $('#dlgLogin').showModal();
      focusLogin();
      return;
    }
    openAddWith({ url: p.get('url') || '', title: p.get('title') || '' });
  }

  function showSetupHelp() {
    var el = $('#state');
    el.className = 'state error';
    el.textContent =
      '아직 구글시트와 연결되지 않았습니다.\n\n' +
      'config.js 파일을 열어 apiUrl 에 Apps Script 웹앱 주소를 넣어 주세요.\n' +
      '자세한 방법은 저장소의 apps-script/설치안내.md 를 참고해 주세요.';
  }

  function fillDeptSelects() {
    var opts = state.depts.map(function (d) {
      return '<option value="' + esc(d) + '">' + esc(d) + '</option>';
    }).join('');
    $('#linkForm select[name=dept]').innerHTML = opts;
  }

  /* ── 이벤트 ───────────────────────── */

  function showErr(form, msg) {
    var el = $('[data-err]', form);
    if (!el) return;
    el.textContent = msg || '';
    el.hidden = !msg;
  }

  // 검색
  $('#q').addEventListener('input', function (e) {
    state.q = e.target.value;
    $('#qClear').hidden = !state.q;
    renderBoard();
  });
  $('#qClear').addEventListener('click', function () {
    $('#q').value = ''; state.q = ''; this.hidden = true; renderBoard(); $('#q').focus();
  });
  document.addEventListener('keydown', function (e) {
    if (e.key === '/' && !/^(INPUT|TEXTAREA|SELECT)$/.test(document.activeElement.tagName)) {
      e.preventDefault(); $('#q').focus();
    }
  });

  // 부서 칩
  $('#chips').addEventListener('click', function (e) {
    var b = e.target.closest('[data-f]');
    if (!b) return;
    state.filter = b.dataset.f;
    // 주소창에도 반영해서 지금 보는 화면을 그대로 공유할 수 있게 합니다.
    history.replaceState(null, '',
      location.pathname + (state.filter === 'all' ? '' : '#' + encodeURIComponent(state.filter)));
    renderChips(); renderBoard();
    window.scrollTo({ top: 0, behavior: 'smooth' });
  });

  // 보드 안의 버튼들
  $('#board').addEventListener('click', function (e) {
    var el;
    if ((el = e.target.closest('[data-toggle]'))) {
      var tid = el.dataset.toggle;
      var at = state.open.indexOf(tid);
      if (at < 0) state.open.push(tid); else state.open.splice(at, 1);

      // 화면 전체를 다시 그리지 않고 해당 항목만 여닫습니다.
      var li = el.closest('.item');
      var panel = li.querySelector('.item-panel');
      var nowOpen = at < 0;
      li.classList.toggle('open', nowOpen);
      panel.hidden = !nowOpen;
      el.setAttribute('aria-expanded', String(nowOpen));
      return;
    }
    if ((el = e.target.closest('[data-move]'))) {
      moveItem(el.dataset.id, el.dataset.move);
      return;
    }
    if ((el = e.target.closest('[data-star]'))) {
      var on = toggleFav(el.dataset.star);
      el.classList.toggle('on', on);
      el.textContent = on ? '★' : '☆';
      if (state.filter === 'fav') renderBoard();
      return;
    }
    if ((el = e.target.closest('[data-copy]'))) {
      var link = state.links.filter(function (l) { return l.id === el.dataset.copy; })[0];
      if (link) copyText(link.url);
      return;
    }
    if ((el = e.target.closest('[data-share]'))) {
      copyText(location.origin + location.pathname + '#' + encodeURIComponent(el.dataset.share),
               el.dataset.share + ' 전용 주소를 복사했습니다');
      return;
    }
    if ((el = e.target.closest('[data-add]'))) { openLinkForm(null, el.dataset.add); return; }
    if ((el = e.target.closest('[data-edit]'))) {
      openLinkForm(state.links.filter(function (l) { return l.id === el.dataset.edit; })[0]);
      return;
    }
    if ((el = e.target.closest('[data-del]'))) {
      var target = state.links.filter(function (l) { return l.id === el.dataset.del; })[0];
      if (!target) return;
      if (!confirm('"' + target.title + '" 업무를 목록에서 지울까요?\n(연결된 구글시트 원본은 삭제되지 않습니다)')) return;
      api('deleteLink', { id: target.id }).then(function (d) {
        state.links = d.links; renderAll(); toast('삭제했습니다');
      }).catch(function (err) { toast(err.message, true); });
    }
  });

  function copyText(text, message) {
    var done = function () { toast(message || '주소를 복사했습니다'); };
    if (navigator.clipboard && window.isSecureContext) {
      navigator.clipboard.writeText(text).then(done, fallback);
    } else { fallback(); }
    function fallback() {
      var ta = document.createElement('textarea');
      ta.value = text; ta.style.position = 'fixed'; ta.style.opacity = '0';
      document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); done(); } catch (e) { toast('복사에 실패했습니다', true); }
      document.body.removeChild(ta);
    }
  }

  // 로그인 / 계정
  $('#authBtn').addEventListener('click', function () {
    if (state.me) { openAccount(); }
    else { showErr($('#loginForm'), ''); $('#dlgLogin').showModal(); focusLogin(); }
  });

  $('#loginForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    showErr(f, '');
    // 세션이 실제로 붙은 것을 확인한 다음에 창을 닫습니다.
    // 먼저 닫아 버리면 세션 확인이 실패했을 때 아무 안내 없이 로그아웃 상태로 돌아갑니다.
    var ok = f.querySelector('button[value="ok"]');
    ok.disabled = true;
    ok.textContent = '확인 중…';

    // 로그인 응답에 목록까지 함께 오므로 bootstrap 을 또 부르지 않습니다.
    api('login', { name: f.name.value, password: f.password.value }).then(function (d) {
      store(LS.token, d.token);
      applyBoot(d);
    }).then(function () {
      if (!state.me) {
        throw new Error('로그인은 되었지만 세션을 확인하지 못했습니다.\n' +
                        '관리자에게 Apps Script 재배포가 필요한지 문의해 주세요.');
      }
      f.reset();
      $('#dlgLogin').close();
      toast(state.me.name + ' 님, 반갑습니다');
      if (pendingAdd) { var seed = pendingAdd; pendingAdd = null; openAddWith(seed); }
    }).catch(function (err) {
      store(LS.token, null);
      showErr(f, err.message);
    }).then(function () {
      ok.disabled = false;
      ok.textContent = '로그인';
    });
  });

  // 업무 추가 / 수정
  $('#fab').addEventListener('click', function () { openLinkForm(null, myDepts()[0]); });

  /** 이웃과 자리를 바꿉니다. 화면을 먼저 고치고 서버에 알립니다. */
  function moveItem(id, dir) {
    var item = state.links.filter(function (l) { return l.id === id; })[0];
    if (!item) return;

    var list = deptItems(item.dept);
    var at = list.map(function (l) { return l.id; }).indexOf(id);
    var to = dir === 'up' ? at - 1 : at + 1;
    if (to < 0 || to >= list.length) return;

    list.splice(to, 0, list.splice(at, 1)[0]);
    // 화면이 보는 값(sort 내림차순)을 새 순서에 맞춰 다시 매깁니다.
    list.forEach(function (l, i) { l.sort = (list.length - i) * 10; });
    renderBoard();

    api('reorder', { dept: item.dept, ids: list.map(function (l) { return l.id; }) })
      .then(function (d) { state.links = d.links; })
      .catch(function (err) {
        toast(err.message, true);
        bootstrap();          // 실패하면 서버 상태로 되돌립니다
      });
  }

  function openLinkForm(link, dept) {
    var f = $('#linkForm');
    f.reset(); showErr(f, ''); $('#urlHint').textContent = '';

    var allowed = myDepts();
    $('#linkForm select[name=dept]').innerHTML = allowed.map(function (d) {
      return '<option value="' + esc(d) + '">' + esc(d) + '</option>';
    }).join('');

    if (link) {
      $('#linkFormTitle').textContent = '업무 수정';
      f.id.value = link.id;
      f.dept.value = link.dept;
      f.title.value = link.title;
      f.url.value = link.url;
      f.deadline.value = link.deadline || '';
      f.note.value = link.note || '';
      f.desc.value = link.desc || '';
      setAttached(link.files || []);
      f.track.checked = String(link.track).toUpperCase() === 'Y';
      f.target.value = link.target || '';
      hintFor(link.url);
    } else {
      $('#linkFormTitle').textContent = '업무 추가';
      f.id.value = '';
      setAttached([]);
      if (dept && allowed.indexOf(dept) >= 0) f.dept.value = dept;
    }
    syncTrackBox();
    hintFor(f.url.value);
    if (!$('#dlgLink').open) $('#dlgLink').showModal();
    setTimeout(function () { (link ? f.title : f.url).focus(); }, 40);
  }

  /* ── 첨부파일 ───────────────────────── */

  var MAX_FILE_MB = 5;
  var MAX_FILES = 3;
  var attached = [];        // [{id, name, url}, ...]

  function renderAttach() {
    $('#attachList').innerHTML = attached.map(function (f, i) {
      return '<div class="attached">' +
        '<span class="clip" aria-hidden="true">📎</span>' +
        '<a class="grow" href="' + esc(f.url) + '" target="_blank" rel="noopener noreferrer">' +
          esc(f.name) + '</a>' +
        '<button type="button" class="tool" data-unattach="' + i + '"' +
          ' title="떼기" aria-label="' + esc(f.name) + ' 떼기">✕</button>' +
      '</div>';
    }).join('');

    var full = attached.length >= MAX_FILES;
    $('#attachPick').hidden = full;
    $('#attachFull').hidden = !full;
    $('#attachInput').value = '';
  }

  function setAttached(list) {
    attached = (list || []).slice(0, MAX_FILES);
    renderAttach();
  }

  $('#attachList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-unattach]');
    if (!b) return;
    attached.splice(Number(b.dataset.unattach), 1);
    renderAttach();
  });

  $('#attachInput').addEventListener('change', function (e) {
    var picked = Array.prototype.slice.call(e.target.files || []);
    if (!picked.length) return;

    var f = $('#linkForm');
    showErr(f, '');

    var room = MAX_FILES - attached.length;
    if (picked.length > room) {
      showErr(f, room === 0
        ? '첨부는 ' + MAX_FILES + '개까지입니다. 먼저 하나를 떼어 주세요.'
        : '첨부는 ' + MAX_FILES + '개까지라 ' + room + '개만 올렸습니다.');
      picked = picked.slice(0, room);
    }

    var tooBig = picked.filter(function (x) { return x.size > MAX_FILE_MB * 1048576; });
    if (tooBig.length) {
      showErr(f, '"' + tooBig[0].name + '" 은 ' + (tooBig[0].size / 1048576).toFixed(1) + 'MB 로 너무 큽니다.\n' +
                 '첨부는 하나에 ' + MAX_FILE_MB + 'MB 이하만 됩니다. 큰 파일은 드라이브에 올리고 [링크 주소] 칸을 써 주세요.');
      picked = picked.filter(function (x) { return x.size <= MAX_FILE_MB * 1048576; });
    }
    if (!picked.length) { $('#attachInput').value = ''; return; }

    uploadEach(picked, 0);
  });

  /** 한 개씩 차례로 올립니다. 동시에 보내면 Apps Script 가 버거워합니다. */
  function uploadEach(list, i) {
    if (i >= list.length) {
      $('#attachBusy').hidden = true;
      renderAttach();
      return;
    }
    var file = list[i];
    var f = $('#linkForm');
    $('#attachBusy').hidden = false;
    $('#attachBusy').textContent =
      '올리는 중… ' + file.name + ' (' + (i + 1) + '/' + list.length + ')';

    var reader = new FileReader();
    reader.onload = function () {
      var data = String(reader.result).split(',')[1] || '';
      api('uploadFile', {
        dept: f.dept.value, name: file.name,
        mimeType: file.type || 'application/octet-stream', data: data
      }).then(function (d) {
        attached.push(d.file);
        renderAttach();
        uploadEach(list, i + 1);
      }).catch(function (err) {
        $('#attachBusy').hidden = true;
        showErr(f, err.message);
        renderAttach();
      });
    };
    reader.onerror = function () {
      $('#attachBusy').hidden = true;
      showErr(f, '"' + file.name + '" 을 읽지 못했습니다.');
    };
    reader.readAsDataURL(file);
  }

  function syncTrackBox() {
    $('.track-target').hidden = !$('#linkForm').track.checked;
  }
  $('#linkForm').track.addEventListener('change', syncTrackBox);

  $('#linkForm').url.addEventListener('input', function (e) { hintFor(e.target.value); });

  function hintFor(url) {
    var hint = $('#urlHint');
    if (!String(url || '').trim()) {
      hint.textContent = '📌 링크 없이 업무만 등록됩니다';
      return;
    }
    var t = detectType(url);
    hint.textContent = (TYPE_ICON[t] || '🔗') + ' ' + (TYPE_LABEL[t] || '웹 페이지') + ' 링크로 등록됩니다';
  }

  $('#linkForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    showErr(f, '');
    api('saveLink', {
      link: {
        id: f.id.value, dept: f.dept.value, title: f.title.value.trim(),
        url: f.url.value.trim(), deadline: f.deadline.value, note: f.note.value.trim(),
        desc: f.desc.value.trim(), track: f.track.checked, target: f.target.value,
        files: attached
      }
    }).then(function (d) {
      state.links = d.links;
      $('#dlgLink').close();
      renderAll();
      toast(f.id.value ? '수정했습니다' : '업무를 추가했습니다');
      loadProgress();
    }).catch(function (err) { showErr(f, err.message); });
  });

  /** 로그인 창을 열면 아직 안 채운 칸에 커서를 둡니다. */
  function focusLogin() {
    var f = $('#loginForm');
    setTimeout(function () {
      (f.name.value.trim() ? f.password : f.name).focus();
    }, 50);
  }

  /* 비밀번호 재설정 — 등록된 이메일로 코드를 받아 새로 정합니다. */
  $('#forgotBtn').addEventListener('click', function () {
    var ask = $('#resetAskForm'), doIt = $('#resetDoForm');
    ask.reset(); doIt.reset();
    showErr(ask, ''); showErr(doIt, '');
    ask.hidden = false; doIt.hidden = true;
    ask.querySelector('[name=name]').value = $('#loginForm').name.value.trim();
    $('#dlgLogin').close();
    $('#dlgReset').showModal();
  });

  $('#resetAskForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    showErr(f, '');
    var btn = f.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '보내는 중…';

    api('requestReset', { name: f.querySelector('[name=name]').value.trim() }).then(function (d) {
      $('#resetSent').textContent = d.sentTo + ' 로 코드를 보냈습니다. 메일함을 확인해 주세요.';
      f.hidden = true;
      $('#resetDoForm').hidden = false;
      $('#resetDoForm').code.focus();
    }).catch(function (err) {
      showErr(f, err.message);
    }).then(function () {
      btn.disabled = false; btn.textContent = '코드 받기';
    });
  });

  $('#resetDoForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    showErr(f, '');
    if (f.next.value !== f.confirm.value) return showErr(f, '새 비밀번호가 서로 다릅니다.');

    var btn = f.querySelector('button[type=submit]');
    btn.disabled = true; btn.textContent = '바꾸는 중…';

    api('confirmReset', {
      name: $('#resetAskForm').querySelector('[name=name]').value.trim(),
      code: f.code.value.trim(),
      next: f.next.value
    }).then(function (d) {
      store(LS.token, d.token);
      applyBoot(d);
      $('#dlgReset').close();
      toast('비밀번호를 바꾸고 로그인했습니다');
    }).catch(function (err) {
      showErr(f, err.message);
    }).then(function () {
      btn.disabled = false; btn.textContent = '비밀번호 바꾸기';
    });
  });

  // 내 이메일 저장
  $('#emailForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    showErr(f, '');
    api('saveMyEmail', { email: f.email.value.trim() }).then(function (d) {
      state.me = d.me;
      renderAll();
      toast(d.me.email ? '이메일을 저장했습니다. 이제 업무를 추가하실 수 있습니다' : '이메일을 지웠습니다');
    }).catch(function (err) { showErr(f, err.message); });
  });

  $$('[data-close]').forEach(function (b) {
    b.addEventListener('click', function () { $('#' + b.dataset.close).close(); });
  });

  $('#goEmail').addEventListener('click', function () {
    openAccount();
    setTimeout(function () {
      var box = $('#emailForm');
      box.scrollIntoView({ block: 'center' });
      box.email.focus();
    }, 120);
  });

  // 내 계정
  function openAccount() {
    var me = state.me;
    $('#emailForm').email.value = me.email || '';
    showErr($('#emailForm'), '');
    $('#acctName').textContent = me.name;
    $('#acctRole').textContent = me.top ? '최고관리자 (전체 부서)'
      : me.role === 'admin' ? '관리자 (전체 부서)' : '부서 담당';
    showErr($('#pwForm'), '');
    $('#pwForm').reset();
    $('#firstLogin').hidden = !me.mustChange;
    if (me.mustChange) $('#pwForm').current.value = '2026';

    renderMyDepts();

    var isAdmin = me.role === 'admin';
    $('#ddaySection').hidden = !isAdmin;
    if (isAdmin) {
      $('#ddayForm').reset();
      showErr($('#ddaySection'), '');
      renderDdayList();
    }
    $('#adminPane').hidden = !isAdmin;
    if (isAdmin) loadUsers();
    $('#dlgAccount').showModal();
  }

  /* 내가 맡은 부서 — 눌러서 넣고, 다시 눌러서 뺍니다. */
  function renderMyDepts() {
    var mine = myOwnDepts();
    $('#myDepts').innerHTML = state.depts.map(function (d) {
      var on = mine.indexOf(d) >= 0;
      return '<button class="pick' + (on ? ' on' : '') + '" type="button" data-dept="' + esc(d) + '"' +
        ' aria-pressed="' + on + '" style="--dept:' + deptColor(d) + '">' + esc(d) + '</button>';
    }).join('');

    $('#pickAll').textContent = mine.length === state.depts.length ? '모두 해제' : '모두 선택';

    $('#myDeptsNote').textContent = state.me && state.me.role === 'admin'
      ? '관리자는 고르지 않아도 모든 부서를 편집할 수 있습니다.'
      : (mine.length ? '고른 부서: ' + mine.join(', ') : '아직 고른 부서가 없습니다.');
  }

  /** 관리자여도 "직접 고른 부서"만 돌려줍니다. (myDepts 는 편집 권한 기준) */
  function myOwnDepts() {
    if (!state.me) return [];
    return String(state.me.dept || '').split(',')
      .map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /** 고른 부서를 저장합니다. 응답을 기다리지 않고 먼저 칠하고, 실패하면 되돌립니다. */
  function saveDepts(list) {
    var before = state.me.dept;
    state.me.dept = list.join(', ');
    renderMyDepts();

    api('saveMyDepts', { depts: list }).then(function (d) {
      state.me = d.me;
      renderMyDepts();
      renderAll();
    }).catch(function (err) {
      state.me.dept = before;
      renderMyDepts();
      toast(err.message, true);
    });
  }

  $('#myDepts').addEventListener('click', function (e) {
    var b = e.target.closest('[data-dept]');
    if (!b) return;

    var mine = myOwnDepts();
    var at = mine.indexOf(b.dataset.dept);
    if (at < 0) mine.push(b.dataset.dept); else mine.splice(at, 1);
    saveDepts(mine);
  });

  // 한 번에 전부 고르거나 전부 뺍니다.
  $('#pickAll').addEventListener('click', function () {
    saveDepts(myOwnDepts().length === state.depts.length ? [] : state.depts.slice());
  });

  /* ── 상단 일정(D-day) 관리 ───────────────────────── */

  function ymd(date) {
    return date.getFullYear() + '-' +
      ('0' + (date.getMonth() + 1)).slice(-2) + '-' +
      ('0' + date.getDate()).slice(-2);
  }

  function renderDdayList() {
    var items = parseDdays(state.config.dday);
    $('#ddayList').innerHTML = items.map(function (d, i) {
      return '<div class="attached">' +
        '<b class="grow">' + esc(d.label) + '</b>' +
        '<span class="dday-date">' + ymd(d.date) + '</span>' +
        '<button type="button" class="tool" data-ddel="' + i + '" title="빼기" aria-label="' +
          esc(d.label) + ' 빼기">✕</button>' +
      '</div>';
    }).join('') || '<p class="hint">아직 등록한 일정이 없습니다.</p>';
  }

  /** 목록을 한 줄짜리 설정값으로 담아 저장합니다. */
  function saveDdays(items) {
    var one = items.map(function (d) { return d.label + '=' + ymd(d.date); }).join(', ');
    return api('saveConfig', { config: { dday: one } }).then(function (r) {
      state.config = r.config;
      renderDdayList();
      renderDdays();
    });
  }

  $('#ddayForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    showErr($('#ddaySection'), '');

    var label = f.label.value.trim();
    var date = f.date.value;
    if (!label || !date) return showErr($('#ddaySection'), '이름과 날짜를 모두 넣어 주세요.');

    var items = parseDdays(state.config.dday);
    items.push({ label: label, date: new Date(date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10)) });
    items.sort(function (a, b) { return a.date - b.date; });

    saveDdays(items).then(function () {
      f.reset();
      f.label.focus();
      toast('일정을 추가했습니다');
    }).catch(function (err) { showErr($('#ddaySection'), err.message); });
  });

  $('#ddayList').addEventListener('click', function (e) {
    var b = e.target.closest('[data-ddel]');
    if (!b) return;
    var items = parseDdays(state.config.dday);
    items.splice(Number(b.dataset.ddel), 1);
    saveDdays(items).then(function () { toast('일정을 뺐습니다'); })
      .catch(function (err) { showErr($('#ddaySection'), err.message); });
  });

  $('#acctClose').addEventListener('click', function () { $('#dlgAccount').close(); });

  $('#logoutBtn').addEventListener('click', function () {
    store(LS.token, null);
    state.me = null;
    $('#dlgAccount').close();
    bootstrap().then(function () { toast('로그아웃했습니다'); });
  });

  $('#pwForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    showErr(f, '');
    if (f.next.value !== f.confirm.value) return showErr(f, '새 비밀번호가 서로 다릅니다.');
    api('changePassword', { current: f.current.value, next: f.next.value }).then(function (d) {
      store(LS.token, d.token);
      state.me = d.me;
      f.reset();
      $('#dlgAccount').close();
      $('#firstLogin').hidden = true;
      toast('비밀번호를 변경했습니다');
    }).catch(function (err) { showErr(f, err.message); });
  });

  function loadUsers() {
    $('#userList').innerHTML = '<p class="hint">불러오는 중…</p>';
    api('listUsers').then(function (d) {
      state.users = d.users || [];
      renderUsers();
    }).catch(function (err) {
      // 목록이 그냥 비어 보이면 원인을 알 수 없으므로 자리에 사유를 적습니다.
      $('#userList').innerHTML = '<p class="hint err-inline">명단을 불러오지 못했습니다.<br>' + esc(err.message) + '</p>';
    });
  }

  /** 최근 로그인 — 날짜와 함께 "오늘/어제/N일 전"을 덧붙입니다. */
  function loginAgo(text) {
    if (!text) return '<span class="never">기록 없음</span>';
    var m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(text));
    if (!m) return esc(text);

    var then = new Date(+m[1], +m[2] - 1, +m[3]);
    var today = new Date();
    today = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    var days = Math.round((today - then) / 86400000);
    var ago = days <= 0 ? '오늘' : days === 1 ? '어제' : days + '일 전';

    return esc(String(text).slice(2)) + ' <span class="ago">' + ago + '</span>';
  }

  function renderUsers() {
    if (!state.users.length) {
      $('#userList').innerHTML =
        '<p class="hint">교직원 명단이 비어 있습니다. teachers 시트를 확인해 주세요.</p>';
      return;
    }
    var joined = state.users.filter(function (u) { return u.joined; }).length;

    $('#userList').innerHTML =
      '<div class="uhead"><span>아이디</span><span>접속시간</span>' +
        '<span title="비밀번호 초기화">초기화</span><span title="계정 삭제">삭제</span></div>' +
      state.users.map(function (u) {
        // 아직 한 번도 로그인하지 않은 분은 되돌리거나 지울 계정이 없습니다.
        var tools = u.joined
          ? '<button class="tool" type="button" data-reset="' + esc(u.name) + '" title="비밀번호 초기화">↺</button>' +
            (u.top ? '<span class="tool" aria-hidden="true"></span>'
                   : '<button class="tool" type="button" data-udel="' + esc(u.name) + '" title="계정 삭제">🗑</button>')
          : '<span class="tool" aria-hidden="true"></span><span class="tool" aria-hidden="true"></span>';

        return '<div class="urow' + (u.joined ? '' : ' pending') + '">' +
          '<span class="uname">' + esc(u.name) +
            (u.top ? '<span class="badge top">최고관리자</span>'
                   : u.role === 'admin' ? '<span class="badge">관리자</span>' : '') +
            (u.joined && u.mustChange ? '<span class="badge warn">초기 비번</span>' : '') +
            (u.joined && !u.email ? '<span class="badge warn">메일 없음</span>' : '') +
            '<span class="udept">' + esc(u.dept || '부서 없음') + '</span>' +
          '</span>' +
          '<span class="ulast">' +
            (u.joined ? loginAgo(u.lastLogin) : '<span class="never">미가입</span>') +
          '</span>' + tools +
        '</div>';
      }).join('') +
      '<p class="hint utotal">전체 ' + state.users.length + '명 중 ' + joined + '명 가입</p>';
  }

  $('#userList').addEventListener('click', function (e) {
    var el;
    if ((el = e.target.closest('[data-reset]'))) {
      if (!confirm(el.dataset.reset + ' 님의 비밀번호를 2026 으로 초기화할까요?')) return;
      api('resetPassword', { name: el.dataset.reset })
        .then(function () { loadUsers(); toast('초기화했습니다 (비밀번호 2026)'); })
        .catch(function (err) { toast(err.message, true); });
    }
    if ((el = e.target.closest('[data-udel]'))) {
      if (!confirm(el.dataset.udel + ' 님 계정을 삭제할까요?')) return;
      api('deleteUser', { name: el.dataset.udel })
        .then(function (d) { state.users = d.users; renderUsers(); toast('삭제했습니다'); })
        .catch(function (err) { toast(err.message, true); });
    }
  });

  /*
   * 대화상자 바깥을 눌러 닫기.
   *
   * click 만 보면 안 됩니다. 입력칸 안에서 글자를 끌어 선택하다가 손을 바깥에서
   * 떼거나, 스크롤 막대를 잡아 끌 때도 click 의 target 이 대화상자가 되어
   * 창이 닫혀 버립니다. 그래서 "누르기 시작한 곳"까지 함께 봅니다.
   */
  $$('.dlg').forEach(function (d) {
    var startedOutside = false;
    d.addEventListener('pointerdown', function (e) { startedOutside = (e.target === d); });
    d.addEventListener('click', function (e) {
      if (startedOutside && e.target === d) d.close();
      startedOutside = false;
    });
  });

  // 테마
  function applyTheme(t) {
    if (t) document.documentElement.setAttribute('data-theme', t);
    else document.documentElement.removeAttribute('data-theme');
  }
  applyTheme(store(LS.theme));
  $('#themeBtn').addEventListener('click', function () {
    var cur = document.documentElement.getAttribute('data-theme');
    var dark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    var next = cur ? (cur === 'dark' ? 'light' : null) : (dark ? 'light' : 'dark');
    store(LS.theme, next);
    applyTheme(next);
  });

  // 시작
  bootstrap();

  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    // 이미 서비스 워커가 붙어 있던 화면이라면, 새 버전이 자리를 넘겨받는 순간
    // 한 번만 새로고침해 고쳐진 화면을 바로 보여 줍니다.
    // (처음 방문은 controller 가 없으므로 새로고침하지 않습니다)
    if (navigator.serviceWorker.controller) {
      var reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', function () {
        if (reloaded) return;
        reloaded = true;
        location.reload();
      });
    }
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
