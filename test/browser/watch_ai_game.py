import sys, time
from playwright.sync_api import sync_playwright
with sync_playwright() as p:
    b = p.chromium.launch(args=['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader','--ignore-gpu-blocklist'])
    pg = b.new_page(viewport={'width':1400,'height':900})
    logs=[]
    pg.on('console', lambda m: logs.append(m.type+': '+m.text) if m.type in ('error','warning') else None)
    pg.on('pageerror', lambda e: logs.append('PAGEERROR: '+str(e)))
    pg.goto('http://127.0.0.1:7781/?still=1&aispeed=0.01')
    pg.wait_for_timeout(1500)
    pg.evaluate("window.__renderOnce()"); pg.screenshot(path='/tmp/w0.png')
    # make all seats AI
    pg.evaluate("""()=>{ document.querySelectorAll('[data-seat-type]').forEach(s=>{s.value='hard'; s.dispatchEvent(new Event('change',{bubbles:true}));}); }""")
    pg.click('#btn-start')
    t0=time.time(); shot=1
    while time.time()-t0 < 150:
        pg.wait_for_timeout(3000)
        ph = pg.evaluate("window.__terrahex.state && window.__terrahex.state.phase")
        if shot==1 and time.time()-t0>10:
            pg.evaluate("window.__renderOnce()"); pg.screenshot(path='/tmp/w1.png'); shot=2
        if ph=='over': break
    print('phase-now', ph, pg.evaluate("window.__terrahex.state.turn"))
    pg.wait_for_timeout(2500)
    pg.evaluate("window.__renderOnce()"); pg.screenshot(path='/tmp/w2.png', timeout=90000)
    print('phase', ph, 'turn', pg.evaluate("window.__terrahex.state.turn"), 'elapsed', int(time.time()-t0))
    print('\n'.join(logs[-20:]))
    b.close()
