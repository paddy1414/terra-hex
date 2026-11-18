import sys, time, json
from playwright.sync_api import sync_playwright
DRIVER = r"""
async () => {
  const app = window.__terrahex;
  const { decide, createAIMemory } = await import('/shared/ai.js');
  const mem = createAIMemory(7);
  const stats = { ui: 0, boardClicks: 0, fallbacks: 0, kinds: {}, errors: [] };
  window.__stats = stats;
  const sleep = (ms) => new Promise(r => setTimeout(r, ms));
  const $ = (s) => document.querySelector(s);
  const click = async (sel) => { const el = typeof sel === 'string' ? $(sel) : sel; if (!el) throw new Error('missing ' + sel); if (el.disabled) throw new Error('disabled ' + sel); el.click(); stats.ui++; await sleep(30); };
  const canvas = document.getElementById('canvas');
  const boardClick = async (kind, id) => {
    const sc = window.__scene;
    const p = kind === 'vertex' ? sc.projectVertex(id) : kind === 'edge' ? (()=>{ const e = sc.board.edges[id]; return sc.project(e.x, 0.2, e.y); })() : sc.projectHex(id);
    const top = document.elementFromPoint(p.x, p.y);
    const before = app.view.version;
    if (top === canvas) {
      const o = { clientX: p.x, clientY: p.y, bubbles: true, pointerType: 'mouse', pointerId: 1 };
      canvas.dispatchEvent(new PointerEvent('pointerdown', o));
      canvas.dispatchEvent(new PointerEvent('pointerup', o));
      stats.boardClicks++;
      await sleep(40);
      if (app.view.version !== before || document.querySelector('[data-victim]') || app.modal === 'knight' || app.knightMode || (app.shipFrom !== null && app.shipFrom !== undefined)) return;
    }
    stats.fallbacks++;
    if (!stats.fb) stats.fb = [];
    if (stats.fb.length < 4) stats.fb.push({ kind, id, hl: sc.highlight.kind, has: sc.highlight.set ? sc.highlight.set.has(id) : null, top: top && (top.id || top.className), phase: app.view.phase, cur: app.view.current });
    app.onPick({ kind, id });
    await sleep(40);
  };
  let guard = 0;
  const t0 = Date.now(), budget = (window.__budget || 600) * 1000;
  let lastVersion = -1, stall = 0;
  while (app.view.phase !== 'over' && guard++ < 6000 && Date.now() - t0 < budget) {
    if (app.view.version === lastVersion) { if (++stall > 400) { stats.errors.push('stalled at ' + app.view.phase + ' ' + JSON.stringify(app.view.prompts && app.view.prompts[0])); break; } } else { stall = 0; lastVersion = app.view.version; }
    await sleep(60);
    const v = app.view; const me = app.viewer;
    const t = v.trade;
    let a = null;
    if (v.gold && Object.keys(v.gold).length) { if (v.gold[me]) a = decide(v, me, mem); }
    else if (v.prompts && v.prompts.length) { if (v.prompts[0].pid === me) a = decide(v, me, mem); }
    else if (v.phase === 'discard' && v.discards[me]) a = decide(v, me, mem);
    else if (t && t.from !== me && !t.responses[me] && $('#offer-card') && !$('#offer-card').classList.contains('hidden')) a = decide(v, me, mem);
    else if (v.current === me && v.phase !== 'discard') a = decide(v, me, mem);
    if (!a) continue;
    stats.kinds[a.type] = (stats.kinds[a.type] || 0) + 1;
    const ver = v.version;
    try {
      switch (a.type) {
        case 'roll': await click('#btn-roll'); break;
        case 'endTurn': if (app.modal) await click('[data-close]'); await click('#btn-end'); break;
        case 'buyDev': await click('#act-dev'); break;
        case 'buildSettlement': if (v.phase === 'main' || v.phase === 'specialBuild') await click('#act-settlement'); await boardClick('vertex', a.vertex); break;
        case 'buildCity': await click('#act-city'); await boardClick('vertex', a.vertex); break;
        case 'buildSettlement_': break;
        case 'buildRoad': if (v.phase === 'main' || v.phase === 'specialBuild') await click('#act-road'); else if ($('[data-piece="road"]')) await click('[data-piece="road"]'); await boardClick('edge', a.edge); break;
        case 'buildShip': if (v.phase === 'main' || v.phase === 'specialBuild') await click('#act-ship'); else await click('[data-piece="ship"]'); await boardClick('edge', a.edge); break;
        case 'pickGold': await sleep(80); for (const [r, n] of Object.entries(a.cards)) for (let i = 0; i < n; i++) await click(`[data-gstep="${r}"][data-d="1"]`); await click('[data-gconfirm]'); break;
        case 'moveRobber': await boardClick('hex', a.hex); if ($('[data-victim]')) await click(`[data-victim="${a.victim}"]`); break;
        case 'discard':
          await sleep(100);
          for (const [r, n] of Object.entries(a.cards)) for (let i = 0; i < n; i++) await click(`[data-step="discard"][data-res="${r}"][data-d="1"]`);
          await click('#btn-discard'); break;
        case 'playDev':
          await click(`[data-play="${a.card}"]`);
          if (a.card === 'monopoly') { await click(`[data-mono="${a.resource}"]`); await click('#btn-pick-ok'); }
          if (a.card === 'yearOfPlenty') { for (const r of a.resources) await click(`[data-step="yop"][data-res="${r}"][data-d="1"]`); await click('#btn-pick-ok'); }
          break;
        case 'bankTrade':
          await click('#btn-trade'); await click('[data-tab="bank"]'); await click(`[data-bgive="${a.give}"]`); await click(`[data-bget="${a.get}"]`); await click('#btn-bank-trade'); await click('[data-close]'); break;
        case 'offerTrade':
          await click('#btn-trade');
          for (const [r, n] of Object.entries(a.give)) for (let i = 0; i < n; i++) await click(`[data-step="give"][data-res="${r}"][data-d="1"]`);
          for (const [r, n] of Object.entries(a.get)) for (let i = 0; i < n; i++) await click(`[data-step="get"][data-res="${r}"][data-d="1"]`);
          await click('#btn-offer'); break;
        case 'acceptTrade': if (!$(`[data-confirm="${a.partner}"]`)) await click('#btn-trade'); await click(`[data-confirm="${a.partner}"]`); break;
        case 'cancelTrade': if (!$('#btn-cancel-offer')) await click('#btn-trade'); await click('#btn-cancel-offer'); await click('[data-close]'); break;
        case 'wait': await sleep(300); break;
        case 'respondTrade': await click(`[data-resp="${a.answer}"][data-pid="${me}"]`); break;
        case 'answer': {
          const p = v.prompts[0];
          await sleep(80);
          if (a.value === null) { if ($('[data-pskip]')) await click('[data-pskip]'); else app.act(a, me); break; }
          if (['vertex', 'edge', 'hex'].includes(p.kind)) { await boardClick(p.kind, a.value); break; }
          if (p.kind === 'cards') { for (const [r, n] of Object.entries(a.value)) for (let i = 0; i < n; i++) await click(`[data-pstep="${r}"][data-d="1"]`); await click('[data-pcards]'); break; }
          await click(`[data-pans='${JSON.stringify(a.value)}']`);
          break;
        }
        case 'improveCity': await click('#btn-improve'); await click(`[data-improve="${a.track}"]`); await sleep(60); await click('[data-close]'); break;
        case 'buildKnight': await click('#act-dev'); await boardClick('vertex', a.vertex); break;
        case 'buildWall': await click('#act-wall'); await boardClick('vertex', a.vertex); break;
        case 'activateKnight': case 'promoteKnight': case 'chaseRobber':
          await boardClick('vertex', a.vertex); await sleep(60);
          await click(`[data-kact="${{ activateKnight: 'activate', promoteKnight: 'promote', chaseRobber: 'chase' }[a.type]}"]`);
          if (app.modal === 'knight') await click('[data-close]');
          break;
        case 'moveKnight': case 'displaceKnight':
          await boardClick('vertex', a.vertex); await sleep(60);
          await click(`[data-kact="${a.type === 'moveKnight' ? 'move' : 'displace'}"]`);
          await boardClick('vertex', a.type === 'moveKnight' ? a.to : a.target);
          break;
        case 'playProgress': {
          const idx = Number.isInteger(a.index) ? a.index : v.players[me].prog.findIndex(c => c.type === a.card);
          await click(`[data-pplay="${idx}"]`);
          if (v.players[me].prog[idx].type === 'alchemist') { await click(`[data-alch="red"][data-n="${a.red}"]`); await click(`[data-alch="yellow"][data-n="${a.yellow}"]`); await click('#btn-alch'); }
          break;
        }
        default: stats.errors.push('unhandled ' + a.type);
      }
    } catch (err) { stats.errors.push(a.type + ': ' + err.message); if (app.modal) { const c = $('[data-close]'); if (c) c.click(); } }
    // wait for the action to land
    for (let k = 0; k < 20 && app.view.version === ver && a.type !== 'wait'; k++) await sleep(25);
  }
  return { elapsed: Math.round((Date.now() - t0) / 1000), phase: app.view.phase, winner: app.view.winner, turn: app.view.turn, vp: app.view.players.map(p => p.vp), players: app.view.players.length, map: app.view.board.map, rules: app.view.config, stats };
}
"""
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width':1400,'height':900})
    logs=[]
    pg.on('console', lambda m: logs.append(m.type+': '+m.text) if m.type in ('error','warning') else None)
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: '+str(e)))
    pg.goto('http://127.0.0.1:7781/?still=1&aispeed=0.01')
    pg.wait_for_timeout(1200)
    pg.evaluate("localStorage.clear()")
    if len(sys.argv) > 5 and sys.argv[5] == 'board': pg.evaluate("localStorage.setItem('terrahex.view', 'board')")
    mapid = sys.argv[2] if len(sys.argv)>2 else 'classic'
    nseats = int(sys.argv[3]) if len(sys.argv)>3 else 4
    pg.reload(); pg.wait_for_timeout(800)
    while pg.locator('.seat').count() < nseats: pg.click('#btn-add-seat')
    pg.click(f'[data-map="{mapid}"]')
    pg.click('[data-layout="%s"]' % (sys.argv[1] if len(sys.argv)>1 else 'balanced'))
    if len(sys.argv)>4:
        pg.click('#house-rules summary')
        for r in sys.argv[4].split(','): pg.click(f'[data-rule="{r}"]')
    pg.click('#btn-start')
    pg.wait_for_timeout(500)
    pg.evaluate("window.__renderOnce()")
    pg.evaluate("window.__scene = (()=>{ return window.__sceneRef })()")
    pg.evaluate(f"window.__budget = {int(sys.argv[6]) if len(sys.argv) > 6 else 600}")
    res = pg.evaluate(DRIVER)
    print(json.dumps(res))
    pg.wait_for_timeout(2000)
    pg.evaluate("window.__renderOnce()"); pg.screenshot(path='/tmp/h_end.png', timeout=120000)
    print('\n'.join([l for l in logs if 'ERR_NAME_NOT_RESOLVED' not in l][-20:]))
    b.close()
