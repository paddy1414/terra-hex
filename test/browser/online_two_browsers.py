import json, time
from playwright.sync_api import sync_playwright
DRIVE = r"""
async (maxSteps) => {
  const app = window.__terrahex;
  const { decide, createAIMemory } = await import('/shared/ai.js');
  window.__mem ||= createAIMemory(Math.floor(Math.random()*1e6));
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let n = 0, errs = [];
  for (let i = 0; i < maxSteps && app.view && app.view.phase !== 'over'; i++) {
    await sleep(40);
    const v = app.view, me = app.viewer;
    let a = null;
    if (v.phase === 'discard' ? v.discards[me] : v.current === me) a = decide(v, me, window.__mem);
    else if (v.trade && v.trade.from !== me && !v.trade.responses[me]) a = decide(v, me, window.__mem);
    if (!a) continue;
    if (a.type === 'wait') { await sleep(300); a = { type: 'cancelTrade' }; }
    if (a.type === 'offerTrade' && Math.random() < 0.5) a = { type: 'endTurn' };
    const ok = await app.act(a, me);
    n++;
    if (!ok) { errs.push(a.type); if (v.phase === 'main') await app.act({ type: 'endTurn' }, me); }
    await sleep(60);
  }
  return { n, errs: errs.slice(0, 10), phase: app.view && app.view.phase, turn: app.view && app.view.turn };
}
"""
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    logs = []
    def mk(name):
        ctx = b.new_context(viewport={'width':1200,'height':800})
        pg = ctx.new_page()
        pg.on('pageerror', lambda e: logs.append(name+' PAGEERROR: '+str(e)))
        pg.on('console', lambda m: logs.append(name+' '+m.type+': '+m.text) if m.type=='error' and 'ERR_NAME' not in m.text else None)
        pg.goto('http://127.0.0.1:7781/?still=1'); pg.wait_for_timeout(800)
        return ctx, pg
    ca, A = mk('host'); cb, B = mk('guest')
    A.click('#tab-online'); A.fill('#on-name', 'Hana'); A.wait_for_timeout(300); A.click('#btn-create'); A.wait_for_timeout(800)
    code = A.inner_text('#lobby-code'); print('room', code)
    B.click('#tab-online'); B.fill('#on-name', 'Gus'); B.fill('#on-code', code); B.click('#btn-join'); B.wait_for_timeout(800)
    A.click('#host-controls [data-ai="hard"]'); A.wait_for_timeout(300); A.click('#host-controls [data-ai="normal"]'); A.wait_for_timeout(500)
    A.click('[data-olayout="random"]'); A.wait_for_timeout(300)
    A.evaluate("window.__renderOnce && window.__renderOnce()")
    A.screenshot(path='/tmp/lobby.png', timeout=90000)
    print('guest sees seats:', B.locator('#lobby-seats .seat').count(), 'guest start hidden:', B.locator('#btn-lobby-start').is_hidden())
    A.click('#btn-lobby-start'); A.wait_for_timeout(1500)
    print('host viewer', A.evaluate("window.__terrahex.viewer"), 'guest viewer', B.evaluate("window.__terrahex.viewer"))
    # privacy: guest must not see host's hand
    print('guest sees host hand:', B.evaluate("JSON.stringify(window.__terrahex.view.players[0].hand)"))
    t0 = time.time()
    # drive both for a while
    for rnd in range(40):
        ra = A.evaluate(DRIVE, 25); rb = B.evaluate(DRIVE, 25)
        if rnd == 6:
            print('reloading guest mid-game at turn', rb['turn'])
            B.goto('http://127.0.0.1:7781/?still=1'); B.wait_for_timeout(800)
            B.click('#tab-online'); B.wait_for_timeout(400); B.click('#btn-rejoin'); B.wait_for_timeout(1500)
            print('guest back in game:', B.evaluate("window.__terrahex.mode"), 'seat', B.evaluate("window.__terrahex.viewer"))
        if ra['phase'] == 'over' or rb['phase'] == 'over': break
        if time.time() - t0 > 240: break
    print('A', ra, 'B', rb)
    A.wait_for_timeout(2500)
    A.evaluate("window.__renderOnce && window.__renderOnce()")
    A.screenshot(path='/tmp/online_end.png', timeout=90000)
    print('\n'.join(logs[-15:]))
    b.close()
