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
    '교무부': 25, '연구부': 35, '학생부': 45, '진로창체부': 330, '기본학력방과후부': 270,
    '복지상담부': 300, '특성화교육과정부': 210, '산학협력부': 195, '전문교육부': 145,
    '인성학부모부': 15, '수평공동체': 345, '1학년': 55, '2학년': 85, '3학년': 110, '자료실': 220
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

  function canEdit(dept) {
    if (!state.me) return false;
    if (state.me.role === 'admin') return true;
    return state.me.dept.split(',').map(function (s) { return s.trim(); }).indexOf(dept) >= 0;
  }

  function myDepts() {
    if (!state.me) return [];
    if (state.me.role === 'admin') return state.depts.slice();
    return state.me.dept.split(',').map(function (s) { return s.trim(); }).filter(Boolean);
  }

  /* ── 렌더링 ───────────────────────── */

  function visibleLinks() {
    var q = state.q.trim().toLowerCase();
    var fav = favs();
    return state.links.filter(function (l) {
      if (state.filter === 'fav' && fav.indexOf(l.id) < 0) return false;
      if (state.filter === 'due') {
        var n = daysLeft(l.deadline);
        if (n === null || n < 0 || n > 14) return false;
      }
      if (state.filter === 'mine' && myDepts().indexOf(l.dept) < 0) return false;
      if (state.filter !== 'all' && state.filter !== 'fav' &&
          state.filter !== 'due' && state.filter !== 'mine' && l.dept !== state.filter) return false;
      if (q) {
        var hay = (l.title + ' ' + l.dept + ' ' + (l.note || '') + ' ' + (l.desc || '')).toLowerCase();
        return q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; });
      }
      return true;
    });
  }

  function renderChips() {
    var counts = {};
    state.links.forEach(function (l) { counts[l.dept] = (counts[l.dept] || 0) + 1; });

    var items = [{ id: 'all', label: '전체', n: state.links.length }];
    if (state.me) items.push({ id: 'mine', label: '내 부서', n: null });
    items.push({ id: 'fav', label: '⭐ 즐겨찾기', n: null });
    items.push({ id: 'due', label: '⏰ 마감 임박', n: null });
    state.depts.forEach(function (d) {
      if (counts[d]) items.push({ id: d, label: d, n: counts[d] });
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
    if (state.me && !state.q && (state.filter === 'all' || state.filter === 'mine')) {
      myDepts().forEach(function (d) {
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
          ? '<ul class="items">' + g.items.map(function (l) { return itemHtml(l, fav, editable); }).join('') + '</ul>'
          : '<p class="empty-dept">아직 등록된 업무가 없습니다. ＋ 를 눌러 추가해 주세요.</p>') +
      '</section>';
    }).join('');
  }

  // 수합 현황 배지 — 대상 인원을 적어 두면 막대와 함께, 아니면 건수만 보여 줍니다.
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

  function itemHtml(l, fav, editable) {
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
    $('#fab').hidden = !state.me;
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
      renderAll();

      if (d.locked) {
        var lock = $('#state');
        lock.className = 'state';
        lock.hidden = false;
        lock.textContent = '링크를 보려면 로그인이 필요합니다.';
        if (!$('#dlgLogin').open) $('#dlgLogin').showModal();
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
    $('#deptOptions').innerHTML = opts;
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
    if (state.me) { openAccount(); } else { showErr($('#loginForm'), ''); $('#dlgLogin').showModal(); }
  });

  $('#loginForm').addEventListener('submit', function (e) {
    if (e.submitter && e.submitter.value === 'cancel') return;
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
      f.track.checked = String(link.track).toUpperCase() === 'Y';
      f.target.value = link.target || '';
      hintFor(link.url);
    } else {
      $('#linkFormTitle').textContent = '업무 추가';
      f.id.value = '';
      if (dept && allowed.indexOf(dept) >= 0) f.dept.value = dept;
    }
    syncTrackBox();
    hintFor(f.url.value);
    if (!$('#dlgLink').open) $('#dlgLink').showModal();
    setTimeout(function () { (link ? f.title : f.url).focus(); }, 40);
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
    if (e.submitter && e.submitter.value === 'cancel') return;
    e.preventDefault();
    var f = e.target;
    showErr(f, '');
    api('saveLink', {
      link: {
        id: f.id.value, dept: f.dept.value, title: f.title.value.trim(),
        url: f.url.value.trim(), deadline: f.deadline.value, note: f.note.value.trim(),
        desc: f.desc.value.trim(), track: f.track.checked, target: f.target.value
      }
    }).then(function (d) {
      state.links = d.links;
      $('#dlgLink').close();
      renderAll();
      toast(f.id.value ? '수정했습니다' : '업무를 추가했습니다');
      loadProgress();
    }).catch(function (err) { showErr(f, err.message); });
  });

  // 내 계정
  function openAccount() {
    var me = state.me;
    $('#acctName').textContent = me.name;
    $('#acctRole').textContent = me.role === 'admin' ? '관리자 (전체 부서)' : '부서 담당';
    $('#acctDept').textContent = me.role === 'admin' ? '전체' : (me.dept || '-');
    showErr($('#pwForm'), '');
    $('#pwForm').reset();
    $('#firstLogin').hidden = !me.mustChange;
    if (me.mustChange) $('#pwForm').current.value = '2026';

    buildBookmarklet();

    var isAdmin = me.role === 'admin';
    $('#adminPane').hidden = !isAdmin;
    if (isAdmin) loadUsers();
    $('#dlgAccount').showModal();
  }

  // 구글시트를 보다가 한 번에 등록할 수 있는 즐겨찾기 버튼을 만듭니다.
  function buildBookmarklet() {
    var home = location.origin + location.pathname;
    var code =
      "javascript:(function(){" +
        "var t=document.title.replace(/\\s*[-–]\\s*Google\\s+(Sheets|Docs|Drive|Forms|Slides).*$/i,'').trim();" +
        "window.open('" + home + "?add=1&url='+encodeURIComponent(location.href)+'&title='+encodeURIComponent(t),'_blank');" +
      "})()";
    $('#bookmarklet').setAttribute('href', code);
  }

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
    api('listUsers').then(function (d) { state.users = d.users; renderUsers(); })
      .catch(function (err) { toast(err.message, true); });
  }

  function renderUsers() {
    $('#userList').innerHTML = state.users.map(function (u) {
      return '<div class="urow">' +
        '<b>' + esc(u.name) + '</b>' +
        '<span class="grow">' + (u.role === 'admin' ? '관리자' : esc(u.dept || '부서 없음')) +
          (u.email ? ' · ✉' : '') + (u.mustChange ? ' · 초기 비밀번호' : '') + '</span>' +
        '<button class="tool" type="button" data-reset="' + esc(u.name) + '" title="비밀번호 초기화">↺</button>' +
        '<button class="tool" type="button" data-udel="' + esc(u.name) + '" title="삭제">🗑</button>' +
      '</div>';
    }).join('') || '<p class="hint">등록된 사용자가 없습니다.</p>';
  }

  $('#userForm').addEventListener('submit', function (e) {
    e.preventDefault();
    var f = e.target;
    api('saveUser', {
      user: {
        name: f.name.value.trim(), dept: f.dept.value.trim(),
        role: f.role.value, email: f.email.value.trim()
      }
    })
      .then(function (d) {
        state.users = d.users; renderUsers(); f.reset();
        toast('저장했습니다 (초기 비밀번호 2026)');
      })
      .catch(function (err) { toast(err.message, true); });
  });

  $('#userList').addEventListener('click', function (e) {
    var el;
    // 이름을 누르면 위 입력칸에 그대로 채워 넣어 바로 고칠 수 있게 합니다.
    if (!e.target.closest('button') && (el = e.target.closest('.urow'))) {
      var name = el.querySelector('b').textContent;
      var u = state.users.filter(function (x) { return x.name === name; })[0];
      if (u) {
        var f = $('#userForm');
        f.name.value = u.name; f.dept.value = u.dept;
        f.role.value = u.role; f.email.value = u.email || '';
        f.name.focus();
      }
      return;
    }
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

  // 대화상자 바깥 클릭으로 닫기
  $$('.dlg').forEach(function (d) {
    d.addEventListener('click', function (e) { if (e.target === d) d.close(); });
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
    navigator.serviceWorker.register('sw.js').catch(function () {});
  }
})();
