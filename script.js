/* Spider Flowers — Spider Solitaire de 1 naipe (símbolo: flor)
 *
 * VERSO DAS CARTAS: o verso padrão é um placeholder desenhado em CSS.
 * Para usar sua arte, salve a imagem como  assets/card-back.png  (proporção 5:7,
 * por exemplo 500×700 px). Ela é carregada automaticamente ao abrir a página.
 * Se quiser outro nome ou formato, altere CARD_BACK_PATH abaixo.
 */
(() => {
  'use strict';

  const CARD_BACK_PATH = 'assets/card-back.png';

  const COLS = 10;        // colunas do tabuleiro
  const SEQS = 8;         // sequências K→A necessárias para vencer (2 baralhos)
  const RATIO = 1.4;      // altura / largura da carta
  const RANKS = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K'];

  const $ = (sel) => document.querySelector(sel);
  const root = document.documentElement;
  const wrap = $('#wrap');
  const board = $('#board');
  const stockBtn = $('#stock');
  const foundationEl = $('#foundation');
  const toastEl = $('#toast');
  const winDlg = $('#win');

  // Estado do jogo: cols = colunas do tabuleiro; stock = 5 distribuições de 10 cartas
  let state = null;
  let history = [];
  let seconds = 0;
  let timerId = null;
  let started = false;
  let hintTimer = null;
  let toastTimer = null;
  let drag = null;
  let gameOver = false;

  // Placar da sessão: fica só na memória (zera ao atualizar a página)
  const session = { total: 0, wins: 0, best: 0 };
  const START_SCORE = 500;     // pontos iniciais; cada movimento custa 1, cada sequência vale +100
  const SEQ_BONUS = 100;
  const score = () => Math.max(0, START_SCORE - state.moves + SEQ_BONUS * state.done);

  /* ---------- Verso personalizado (opcional) ---------- */
  const probe = new Image();
  probe.onload = () => {
    root.style.setProperty('--card-back-image', `url("${CARD_BACK_PATH}")`);
    root.classList.add('custom-back');
  };
  probe.src = CARD_BACK_PATH;

  /* ---------- Utilidades ---------- */
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const clone = (o) => JSON.parse(JSON.stringify(o));
  const fmtTime = (s) => String(Math.floor(s / 60)).padStart(2, '0') + ':' + String(s % 60).padStart(2, '0');

  function toast(msg) {
    toastEl.textContent = msg;
    toastEl.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('show'), 2400);
  }

  /* ---------- Novo jogo ---------- */
  function shuffle(arr) {            // Fisher-Yates
    for (let i = arr.length - 1; i > 0; i--) {
      const j = Math.floor(Math.random() * (i + 1));
      [arr[i], arr[j]] = [arr[j], arr[i]];
    }
    return arr;
  }

  function newGame() {
    const deck = [];
    for (let s = 0; s < SEQS; s++) {
      for (let r = 1; r <= 13; r++) deck.push({ id: s * 13 + r - 1, rank: r, up: false });
    }
    shuffle(deck);

    // 54 cartas no tabuleiro: 4 colunas com 6 e 6 colunas com 5; só a do topo fica virada para cima
    const cols = [];
    for (let c = 0; c < COLS; c++) {
      const col = deck.splice(0, c < 4 ? 6 : 5);
      col[col.length - 1].up = true;
      cols.push(col);
    }
    // 50 cartas restantes: 5 distribuições de 10
    const stock = [];
    while (deck.length) stock.push(deck.splice(0, COLS));

    state = { cols, stock, done: 0, moves: 0, refreshUsed: false };
    gameOver = false;
    history = [];
    stopTimer();
    started = false;
    seconds = 0;
    clearHint();
    render();
  }

  function askNewGame() {
    if (state && state.moves > 0 && state.done < SEQS) {
      if (!confirm('Começar um novo jogo? O progresso atual será perdido.')) return;
    }
    newGame();
  }

  /* ---------- Cronômetro ---------- */
  function startTimer() {
    if (started) return;
    started = true;
    timerId = setInterval(() => { seconds++; updateStats(); }, 1000);
  }
  function stopTimer() {
    clearInterval(timerId);
    timerId = null;
  }

  /* ---------- Regras ---------- */
  // Índice onde começa a sequência decrescente (virada para cima) no fim da coluna
  function runStart(col) {
    let i = col.length - 1;
    if (i < 0) return -1;
    while (i > 0 && col[i - 1].up && col[i - 1].rank === col[i].rank + 1) i--;
    return i;
  }

  function canGrab(c, i) {
    const col = state.cols[c];
    return !!col[i] && col[i].up && i >= runStart(col);
  }

  function canDrop(from, idx, to) {
    if (from === to) return false;
    const moving = state.cols[from][idx];
    const target = state.cols[to];
    if (!target.length) return true;
    return target[target.length - 1].rank === moving.rank + 1;
  }

  function flipTop(c) {
    const col = state.cols[c];
    if (col.length && !col[col.length - 1].up) col[col.length - 1].up = true;
  }

  // Se os últimos 13 cartas formam K→A, a sequência vai para a base
  function checkComplete(c) {
    const col = state.cols[c];
    if (col.length < 13) return;
    const last = col.slice(-13);
    for (let i = 0; i < 13; i++) {
      if (!last[i].up || last[i].rank !== 13 - i) return;
    }
    col.splice(-13);
    state.done++;
    flipTop(c);
  }

  function pushHistory() { history.push(clone(state)); }

  function afterAction() {
    render();
    if (state.done === SEQS && !gameOver) {
      gameOver = true;
      stopTimer();
      const final = score();
      session.total += final;
      session.wins++;
      session.best = Math.max(session.best, final);
      updateStats();
      setTimeout(showWin, 450);
    }
  }

  function doMove(from, idx, to) {
    clearHint();
    pushHistory();
    startTimer();
    const moved = state.cols[from].splice(idx);
    state.cols[to].push(...moved);
    state.moves++;
    flipTop(from);
    checkComplete(to);
    afterAction();
  }

  function deal() {
    if (!state.stock.length) { toast('O monte está vazio.'); return; }
    if (state.cols.some((col) => col.length === 0)) {
      toast('Preencha as colunas vazias antes de distribuir.');
      return;
    }
    clearHint();
    pushHistory();
    startTimer();
    const row = state.stock.pop();
    row.forEach((card, i) => { card.up = true; state.cols[i].push(card); });
    state.moves++;
    for (let c = 0; c < COLS; c++) checkComplete(c);
    afterAction();
  }

  function undo() {
    if (!history.length || gameOver) return;
    clearHint();
    const movesNow = state.moves;
    state = history.pop();
    state.moves = movesNow + 1;      // desfazer custa 1 ponto, como no Spider clássico
    render();
  }

  // Reembaralha só as cartas do monte (as colunas não mudam). Uma vez por partida.
  function reshuffleStock() {
    if (gameOver) return;
    if (state.refreshUsed) { toast('Você já usou o embaralhar nesta partida.'); return; }
    if (!state.stock.length) { toast('O monte está vazio.'); return; }
    clearHint();
    pushHistory();
    startTimer();
    const cards = shuffle(state.stock.flat());
    state.stock = [];
    while (cards.length) state.stock.push(cards.splice(0, COLS));
    state.refreshUsed = true;
    state.moves++;
    render();
    stockBtn.classList.add('shuffling');
    setTimeout(() => stockBtn.classList.remove('shuffling'), 650);
  }

  /* ---------- Pontuação de jogadas (cliques e dicas) ---------- */
  // Retorna < 0 para jogadas inúteis; maior = melhor
  function scoreMove(c, i, t) {
    const col = state.cols[c];
    const tgt = state.cols[t];
    const below = i > 0 ? col[i - 1] : null;
    const reveals = !!below && !below.up;
    const emptiesCol = i === 0;
    const toEmpty = tgt.length === 0;
    const splitsRun = !!below && below.up && below.rank === col[i].rank + 1;

    if (splitsRun) return -1;               // quebraria uma sequência já feita
    if (toEmpty && emptiesCol) return -1;   // só trocaria a coluna de lugar

    let s = 0.5;
    if (reveals) s += 10;
    if (emptiesCol) s += 6;
    if (!toEmpty) {
      const rs = runStart(tgt);
      const run = tgt.length - rs;
      s += 4 + run;
      if (tgt[rs].rank === 13 && run + (col.length - i) === 13) s += 20; // completa K→A
    }
    s += (col.length - i) * 0.1;
    return s;
  }

  function allMoves() {
    const moves = [];
    for (let c = 0; c < COLS; c++) {
      const col = state.cols[c];
      if (!col.length) continue;
      for (let i = runStart(col); i < col.length; i++) {
        for (let t = 0; t < COLS; t++) {
          if (!canDrop(c, i, t)) continue;
          const s = scoreMove(c, i, t);
          if (s > 0) moves.push({ c, i, t, s });
        }
      }
    }
    return moves.sort((a, b) => b.s - a.s);
  }

  /* ---------- Dica ---------- */
  function clearHint() {
    clearTimeout(hintTimer);
    document.querySelectorAll('.hint-src, .hint-dst-card, .hint-dst').forEach((el) => {
      el.classList.remove('hint-src', 'hint-dst-card', 'hint-dst');
    });
  }

  function showHint() {
    clearHint();
    const moves = allMoves();
    if (!moves.length) {
      toast(state.stock.length
        ? 'Sem jogadas no tabuleiro. Clique no monte para distribuir.'
        : 'Sem jogadas disponíveis. Tente desfazer.');
      return;
    }
    const m = moves[0];
    board.querySelectorAll(`.card[data-col="${m.c}"]`).forEach((el) => {
      if (+el.dataset.idx >= m.i) el.classList.add('hint-src');
    });
    const targetCards = board.querySelectorAll(`.card[data-col="${m.t}"]`);
    if (targetCards.length) targetCards[targetCards.length - 1].classList.add('hint-dst-card');
    else board.querySelector(`.col[data-col="${m.t}"]`).classList.add('hint-dst');
    hintTimer = setTimeout(clearHint, 2600);
  }

  /* ---------- Renderização ---------- */
  function metrics() {
    const availW = wrap.clientWidth - 32;
    const gap = clamp(Math.round(availW * 0.01), 4, 12);
    const cw = clamp(Math.floor((availW - gap * (COLS - 1)) / COLS), 44, 112);
    const ch = Math.round(cw * RATIO);
    root.style.setProperty('--cw', cw + 'px');
    root.style.setProperty('--ch', ch + 'px');
    root.style.setProperty('--gap', gap + 'px');
    return { cw, ch, gap };
  }

  function faceHTML(rank) {
    const label = RANKS[rank - 1];
    return `<div class="head"><span>${label}</span><svg><use href="#flower"/></svg></div>` +
           `<svg class="big"><use href="#flower"/></svg>` +
           `<div class="foot"><span>${label}</span><svg><use href="#flower"/></svg></div>`;
  }

  const BACK_HTML = '<svg class="back-flower"><use href="#flower"/></svg>';

  function cardEl(card, c, i, top) {
    const el = document.createElement('div');
    el.className = 'card ' + (card.up ? 'up' : 'back');
    el.style.top = top + 'px';
    el.dataset.col = c;
    el.dataset.idx = i;
    el.innerHTML = card.up ? faceHTML(card.rank) : BACK_HTML;
    return el;
  }

  function render() {
    const m = metrics();
    board.replaceChildren();

    const boardTop = board.getBoundingClientRect().top + window.scrollY;
    const avail = Math.max(m.ch * 3, window.innerHeight - boardTop - 20);
    const downOff = m.ch * 0.13;
    const upOff = m.ch * 0.3;

    state.cols.forEach((col, c) => {
      const colEl = document.createElement('div');
      colEl.className = 'col';
      colEl.dataset.col = c;

      // Comprime a pilha quando ela não cabe na altura da janela
      let span = 0;
      for (let i = 0; i < col.length - 1; i++) span += col[i].up ? upOff : downOff;
      let k = 1;
      if (span + m.ch > avail && span > 0) k = Math.max(0.6, (avail - m.ch) / span);

      let top = 0;
      let lastTop = 0;
      col.forEach((card, i) => {
        colEl.appendChild(cardEl(card, c, i, top));
        lastTop = top;
        top += (card.up ? upOff : downOff) * k;
      });
      colEl.style.height = (lastTop + m.ch) + 'px';
      board.appendChild(colEl);
    });

    renderStock(m);
    renderFoundation();
    updateStats();
  }

  function renderStock() {
    stockBtn.replaceChildren();
    const n = state.stock.length;
    if (!n) {
      const empty = document.createElement('div');
      empty.className = 'empty';
      stockBtn.appendChild(empty);
    }
    for (let i = 0; i < n; i++) {
      const el = document.createElement('div');
      el.className = 'card back';
      el.style.top = '0px';
      el.style.left = (i * 5) + 'px';
      el.innerHTML = BACK_HTML;
      stockBtn.appendChild(el);
    }
    stockBtn.disabled = !n;
    stockBtn.setAttribute('aria-label', n
      ? `Distribuir 10 cartas do monte (restam ${n} distribuições)`
      : 'Monte vazio');
  }

  function renderFoundation() {
    foundationEl.replaceChildren();
    for (let i = 0; i < SEQS; i++) {
      const slot = document.createElement('div');
      slot.className = 'fslot' + (i < state.done ? ' full' : '');
      if (i < state.done) slot.innerHTML = '<svg><use href="#flower"/></svg>';
      foundationEl.appendChild(slot);
    }
  }

  function updateStats() {
    $('#stat-time').textContent = fmtTime(seconds);
    $('#stat-moves').textContent = state.moves;
    $('#stat-score').textContent = score();
    $('#stat-session').textContent = `${session.total} pts · ${session.wins} ${session.wins === 1 ? 'vitória' : 'vitórias'}`;
    $('#stat-seq').textContent = `${state.done}/${SEQS}`;
    $('#stat-stock').textContent = state.stock.length;
    $('#btn-undo').disabled = !history.length || gameOver;
    const shuffleBtn = $('#btn-shuffle');
    shuffleBtn.disabled = gameOver || state.refreshUsed || !state.stock.length;
    shuffleBtn.textContent = `Embaralhar monte (${state.refreshUsed ? 0 : 1})`;
  }

  function showWin() {
    $('#win-msg').textContent =
      `Você terminou em ${fmtTime(seconds)} com ${state.moves} movimentos e fez ${score()} pontos. ` +
      `Na sessão: ${session.total} pontos em ${session.wins} ${session.wins === 1 ? 'vitória' : 'vitórias'} (melhor partida: ${session.best}).`;
    if (typeof winDlg.showModal === 'function') winDlg.showModal();
  }

  /* ---------- Arrastar e soltar (mouse e toque) ---------- */
  function nope(els) {
    els.forEach((el) => {
      el.classList.remove('nope');
      void el.offsetWidth;
      el.classList.add('nope');
      setTimeout(() => el.classList.remove('nope'), 320);
    });
  }

  function colCards(c, fromIdx) {
    return [...board.querySelectorAll(`.card[data-col="${c}"]`)].filter((el) => +el.dataset.idx >= fromIdx);
  }

  function onDown(e) {
    if (drag) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    const el = e.target.closest('.card.up');
    if (!el) return;
    const c = +el.dataset.col;
    const i = +el.dataset.idx;
    if (!canGrab(c, i)) { nope([el]); return; }

    e.preventDefault();
    const r = el.getBoundingClientRect();
    drag = {
      c, i, id: e.pointerId,
      sx: e.clientX, sy: e.clientY,
      gx: e.clientX - r.left, gy: e.clientY - r.top,
      moved: false, ghost: null, els: [],
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onCancel);
  }

  function startDrag() {
    clearHint();
    drag.els = colCards(drag.c, drag.i);
    const ghost = document.createElement('div');
    ghost.className = 'ghost';
    const baseTop = parseFloat(drag.els[0].style.top);
    drag.els.forEach((el) => {
      const cl = el.cloneNode(true);
      cl.classList.remove('hint-src', 'nope');
      cl.style.top = (parseFloat(el.style.top) - baseTop) + 'px';
      ghost.appendChild(cl);
      el.classList.add('lifted');
    });
    document.body.appendChild(ghost);
    document.body.classList.add('dragging');
    drag.ghost = ghost;
    drag.moved = true;
  }

  function onMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    if (!drag.moved) {
      if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) < 6) return;
      startDrag();
    }
    drag.ghost.style.left = (e.clientX - drag.gx) + 'px';
    drag.ghost.style.top = (e.clientY - drag.gy) + 'px';
  }

  function endDrag() {
    window.removeEventListener('pointermove', onMove);
    window.removeEventListener('pointerup', onUp);
    window.removeEventListener('pointercancel', onCancel);
    if (drag && drag.ghost) drag.ghost.remove();
    document.body.classList.remove('dragging');
    drag = null;
  }

  function onCancel(e) {
    if (!drag || e.pointerId !== drag.id) return;
    drag.els.forEach((el) => el.classList.remove('lifted'));
    endDrag();
  }

  function onUp(e) {
    if (!drag || e.pointerId !== drag.id) return;
    const { c, i, moved, els, gx } = drag;

    if (!moved) {            // clique simples: joga automaticamente no melhor destino
      endDrag();
      clickMove(c, i);
      return;
    }

    // Soltar: escolhe a coluna válida mais próxima do centro das cartas arrastadas
    const cw = parseFloat(getComputedStyle(root).getPropertyValue('--cw'));
    const cx = e.clientX - gx + cw / 2;
    const cols = [...board.querySelectorAll('.col')].map((el) => {
      const r = el.getBoundingClientRect();
      return { t: +el.dataset.col, d: Math.abs(cx - (r.left + r.width / 2)) };
    }).sort((a, b) => a.d - b.d);

    let target = -1;
    for (const col of cols) {
      if (col.d > cw * 0.9) break;
      if (canDrop(c, i, col.t)) { target = col.t; break; }
    }

    endDrag();
    if (target >= 0) {
      doMove(c, i, target);
    } else {
      els.forEach((el) => el.classList.remove('lifted'));
      nope(els);
    }
  }

  function clickMove(c, i) {
    let best = null;
    for (let t = 0; t < COLS; t++) {
      if (!canDrop(c, i, t)) continue;
      const s = scoreMove(c, i, t);
      if (s > 0 && (!best || s > best.s)) best = { t, s };
    }
    if (best) doMove(c, i, best.t);
    else nope(colCards(c, i));
  }

  /* ---------- Fundo animado: jardim ao vento ---------- */
  const garden = (() => {
    const cv = $('#garden');
    const ctx = cv.getContext('2d');
    const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');

    // Camadas de capim, do fundo (escuro, alto, lento) para a frente (claro, baixo, mais agitado).
    // min/max = altura da lâmina como fração da altura da tela; sway = quanto a ponta balança.
    const LAYERS = [
      { color: '#0f2e28', alpha: 1,    min: 0.26, max: 0.46, step: 12, sway: 0.10, speed: 0.55, width: 8 },
      { color: '#15403a', alpha: 1,    min: 0.18, max: 0.34, step: 13, sway: 0.13, speed: 0.75, width: 7 },
      { color: '#1e5a4b', alpha: 0.9,  min: 0.10, max: 0.22, step: 15, sway: 0.17, speed: 0.95, width: 6 },
      { color: '#2e7d65', alpha: 0.55, min: 0.05, max: 0.13, step: 19, sway: 0.22, speed: 1.2,  width: 5 },
    ];

    let w = 0, h = 0, blades = [], raf = 0, last = 0, enabled = true;
    const t0 = performance.now();

    function build() {
      blades = LAYERS.map((L) => {
        const list = [];
        for (let x = -10; x < w + 10; x += L.step) {
          list.push({
            x: x + Math.random() * L.step,
            h: (L.min + Math.random() * (L.max - L.min)) * h,
            lean: Math.random() * 2 - 1,
            phase: Math.random() * Math.PI * 2,
            w: L.width * (0.7 + Math.random() * 0.6),
          });
        }
        return list;
      });
    }

    function resize() {
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth;
      h = window.innerHeight;
      cv.width = Math.round(w * dpr);
      cv.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      build();
      if (enabled) draw((performance.now() - t0) / 1000);
    }

    function draw(t) {
      // Base escura
      ctx.globalAlpha = 1;
      ctx.fillStyle = '#0c211d';
      ctx.fillRect(0, 0, w, h);

      // Manchas de luz verde que passeiam bem devagar (o degradê em movimento)
      const R = Math.max(w, h) * 0.75;
      const blobs = [
        { x: w * (0.30 + 0.20 * Math.sin(t * 0.05)),  y: h * (0.10 + 0.08 * Math.cos(t * 0.04)), c: 'rgba(46,125,101,0.50)' },
        { x: w * (0.78 + 0.14 * Math.cos(t * 0.037)), y: h * (0.55 + 0.12 * Math.sin(t * 0.045)), c: 'rgba(30,90,75,0.40)' },
        { x: w * (0.50 + 0.25 * Math.sin(t * 0.03 + 2)), y: h * 0.95, c: 'rgba(60,150,120,0.22)' },
      ];
      for (const b of blobs) {
        const g = ctx.createRadialGradient(b.x, b.y, 0, b.x, b.y, R);
        g.addColorStop(0, b.c);
        g.addColorStop(1, 'rgba(0,0,0,0)');
        ctx.fillStyle = g;
        ctx.fillRect(0, 0, w, h);
      }

      // Capim balançando: uma onda de vento viaja pela tela + oscilação própria de cada lâmina
      LAYERS.forEach((L, li) => {
        ctx.globalAlpha = L.alpha;
        ctx.fillStyle = L.color;
        ctx.beginPath();
        for (const b of blades[li]) {
          const gust = Math.sin(b.x * 0.006 - t * L.speed) * 0.6 + Math.sin(b.x * 0.017 + t * L.speed * 1.7 + b.phase) * 0.4;
          const dx = b.h * (L.sway * gust + b.lean * 0.05);
          ctx.moveTo(b.x - b.w / 2, h + 2);
          ctx.quadraticCurveTo(b.x + dx * 0.3, h - b.h * 0.55, b.x + dx, h - b.h);
          ctx.quadraticCurveTo(b.x + dx * 0.3 + b.w * 0.4, h - b.h * 0.55, b.x + b.w / 2, h + 2);
        }
        ctx.fill();
      });
      ctx.globalAlpha = 1;
    }

    function frame(now) {
      raf = requestAnimationFrame(frame);
      if (now - last < 33) return;           // ~30 quadros por segundo bastam e poupam bateria
      last = now;
      draw((now - t0) / 1000);
    }

    function start() {
      cancelAnimationFrame(raf);
      if (!enabled) return;
      if (reduce.matches) { draw(0); return; }   // quem prefere menos movimento recebe uma imagem parada
      raf = requestAnimationFrame(frame);
    }

    function setEnabled(on) {
      enabled = on;
      cv.style.display = on ? '' : 'none';
      cancelAnimationFrame(raf);
      if (on) { resize(); start(); }
    }

    window.addEventListener('resize', resize);
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) cancelAnimationFrame(raf); else start();
    });
    reduce.addEventListener('change', start);

    return { setEnabled };
  })();

  /* ---------- Configurações (ficam salvas neste navegador) ---------- */
  const SETTINGS_KEY = 'spiderFlowers.settings';
  const PALETTES = ['framboesa', 'violeta', 'cobalto'];
  const settings = { animatedBg: true, palette: 'framboesa' };
  try { Object.assign(settings, JSON.parse(localStorage.getItem(SETTINGS_KEY) || '{}')); } catch (e) { /* sem armazenamento */ }
  if (!PALETTES.includes(settings.palette)) settings.palette = 'framboesa';

  function saveSettings() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); } catch (e) { /* ignora */ }
  }

  function applySettings() {
    root.dataset.palette = settings.palette;
    garden.setEnabled(!!settings.animatedBg);
    $('#opt-bg').checked = !!settings.animatedBg;
    document.querySelector(`input[name="palette"][value="${settings.palette}"]`).checked = true;
  }

  /* ---------- Eventos ---------- */
  board.addEventListener('pointerdown', onDown);
  stockBtn.addEventListener('click', deal);
  $('#btn-new').addEventListener('click', askNewGame);
  $('#btn-undo').addEventListener('click', undo);
  $('#btn-hint').addEventListener('click', showHint);
  $('#btn-shuffle').addEventListener('click', reshuffleStock);
  $('#btn-settings').addEventListener('click', () => $('#settings').showModal());
  $('#opt-bg').addEventListener('change', (e) => { settings.animatedBg = e.target.checked; saveSettings(); applySettings(); });
  document.querySelectorAll('input[name="palette"]').forEach((input) => {
    input.addEventListener('change', () => { settings.palette = input.value; saveSettings(); applySettings(); });
  });
  $('#btn-again').addEventListener('click', () => { winDlg.close(); newGame(); });

  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); }
  });

  let resizeTimer = null;
  window.addEventListener('resize', () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => { if (state && !drag) render(); }, 120);
  });

  applySettings();
  newGame();
})();
