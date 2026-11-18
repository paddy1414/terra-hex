import time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width':1300,'height':850}); errs=[]; pg.on('pageerror', lambda e: errs.append(str(e)))
    pg.goto('http://127.0.0.1:7781/?still=1'); pg.wait_for_timeout(800)
    pg.click('#tab-online'); pg.wait_for_timeout(300); pg.click('#btn-create'); pg.wait_for_timeout(600)
    for ai in ['normal','normal','normal']: pg.click(f'#host-controls [data-ai="{ai}"]'); pg.wait_for_timeout(200)
    pg.click('#btn-lobby-start'); pg.wait_for_timeout(1500)
    # setup through the engine policy (board clicks are tested elsewhere), then turns via the real buttons only
    pg.evaluate("""async () => { const app = window.__terrahex; const { decide, createAIMemory } = await import('/shared/ai.js'); const m = createAIMemory(1); const sleep = ms => new Promise(r => setTimeout(r, ms));
      for (let i = 0; i < 400 && app.view.phase === 'setup'; i++) { await sleep(60); if (app.view.current === app.viewer) await app.act(decide(app.view, app.viewer, m), app.viewer); } }""")
    turns = 0; stuck = 0; worst = 0; t0 = time.time()
    while turns < 12 and time.time() - t0 < 200:
        v = pg.evaluate("(() => { const v = window.__terrahex.view; return [v.phase, v.current === window.__terrahex.viewer, v.phase === 'discard' && !!v.discards[window.__terrahex.viewer]]; })()")
        phase, mine, mustDiscard = v
        if mustDiscard or phase in ('robber',) and mine:
            pg.evaluate("""async () => { const app = window.__terrahex; const { decide, createAIMemory } = await import('/shared/ai.js'); await app.act(decide(app.view, app.viewer, createAIMemory(2)), app.viewer); }""")
            pg.wait_for_timeout(300); continue
        if mine and phase in ('roll', 'main'):
            btn = '#btn-roll' if phase == 'roll' else '#btn-end'
            waited = 0
            while pg.locator(btn).is_disabled() and waited < 4000:
                pg.wait_for_timeout(100); waited += 100
            worst = max(worst, waited)
            if waited >= 2000: stuck += 1
            if not pg.locator(btn).is_disabled():
                pg.click(btn)
                if phase == 'main': turns += 1
            pg.wait_for_timeout(250)
        else:
            pg.wait_for_timeout(200)
    print('turns played', turns, 'times buttons stayed locked >2s:', stuck, 'longest wait ms:', worst, 'errors', errs)
    b.close()
