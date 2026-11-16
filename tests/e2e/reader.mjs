/* eslint-disable no-console -- informe de validación por consola */
/** Catálogo local: tamaños táctiles, filtros, idiomas y estados de la biblioteca. */
import { spawn } from 'node:child_process'
import { existsSync, mkdtempSync, mkdirSync, readFileSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
const BASE = (process.argv[2] || 'http://127.0.0.1:3000').replace(/\/$/, '')
const OUT = process.env.READER_SHOTS || ''
if (OUT) mkdirSync(OUT, { recursive: true })
const profile = mkdtempSync(join(tmpdir(), 'survivelia-guides-chrome-'))
const port = 9500 + Math.floor(Math.random() * 300)
const chromePath = [process.env.CHROME_PATH, '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', '/usr/bin/chromium', '/usr/bin/chromium-browser', '/usr/bin/google-chrome', 'C:/Program Files/Google/Chrome/Application/chrome.exe'].filter(Boolean).find(path => existsSync(path))
if (!chromePath) throw new Error('Chrome no encontrado: define CHROME_PATH')
const chrome = spawn(chromePath, ['--headless=new', `--remote-debugging-port=${port}`, `--user-data-dir=${profile}`, '--no-first-run', '--password-store=basic', 'about:blank'], { stdio: 'ignore' })
const sleep = ms => new Promise(r => setTimeout(r, ms))
let ws
try {
  let targets
  for (let n=0; n<60 && !targets; n++) { await sleep(100); targets=await fetch(`http://127.0.0.1:${port}/json`).then(r=>r.json()).catch(()=>null) }
  if (!targets) throw new Error('Chrome no responde')
  ws = new WebSocket(targets.find(t=>t.type==='page').webSocketDebuggerUrl)
  await new Promise(r=>ws.addEventListener('open',r,{once:true}))
  let seq=0
  const pending=new Map()
  const errors=[], external=[]
  let override = null
  ws.addEventListener('message',ev=>{
    const m=JSON.parse(ev.data)
    if(m.method==='Fetch.requestPaused') {
      const requestId=m.params.requestId
      const action=override ? send('Fetch.fulfillRequest',{requestId,responseCode:override.status,responseHeaders:override.headers??[{name:'content-type',value:'application/json'}],body:override.encoded??Buffer.from(JSON.stringify(override.body)).toString('base64')}) : send('Fetch.continueRequest',{requestId})
      void action.catch(error=>errors.push(error.message))
    }
    if(m.id) { const cb=pending.get(m.id); if(cb){ pending.delete(m.id); if(m.error)cb.reject(new Error(m.error.message));else cb.resolve(m.result) } }
    if(m.method==='Runtime.exceptionThrown')errors.push(m.params.exceptionDetails.exception?.description ?? m.params.exceptionDetails.text)
    if(m.method==='Runtime.consoleAPICalled' && m.params.type==='error')errors.push(m.params.args.map(a=>a.value??a.description).join(' '))
    if(m.method==='Network.requestWillBeSent' && /^https?:/.test(m.params.request.url) && !['127.0.0.1','localhost'].includes(new URL(m.params.request.url).hostname)) external.push(m.params.request.url)
  })
  const send=(method,params={})=>new Promise((resolve,reject)=>{const id=++seq;pending.set(id,{resolve,reject});ws.send(JSON.stringify({id,method,params}))})
  const evaluate=async expression=>{
    const r=await send('Runtime.evaluate',{expression,returnByValue:true,awaitPromise:true})
    if(r.exceptionDetails)throw new Error(r.exceptionDetails.exception?.description??r.exceptionDetails.text)
    return r.result.value
  }
  const waitFor=async expr=>{for(let n=0;n<120;n++){if(await evaluate(expr))return;await sleep(150)}console.log(await evaluate('document.body.innerText.slice(0,2500)'));throw new Error('Timeout: '+expr)}
  const check=(ok,label,data)=>{if(!ok)throw new Error(label+' '+JSON.stringify(data));console.log('PASS '+label+(data?' '+JSON.stringify(data):''))}
  const source = await fetch(BASE+'/api/library/protocols').then(r=>{if(!r.ok)throw new Error('Biblioteca no disponible');return r.json()})
  const total=source.length
  check(total>0,'biblioteca con contenido real')
  await send('Page.enable');await send('Runtime.enable');await send('Network.enable')
  await send('Emulation.setTouchEmulationEnabled',{enabled:true,maxTouchPoints:5})

  async function openGuide(id,width=1024,height=600,lang='es',large=false,shot='',supplied=null) {
    const detail=supplied??await fetch(BASE+'/api/library/protocols/'+id,{headers:{cookie:'survival-lang='+lang}}).then(r=>r.json())
    await send('Emulation.setDeviceMetricsOverride',{width,height,deviceScaleFactor:1,mobile:width<600})
    await send('Page.addScriptToEvaluateOnNewDocument',{source:`localStorage.setItem('survival-os:locale',${JSON.stringify(lang)});document.cookie='survival-lang=${lang}; path=/';localStorage.setItem('survival-os:display',JSON.stringify({highContrast:${large},largeText:${large},osk:false,dim:0}));`})
    await send('Page.navigate',{url:BASE+'/emergencias/'+id})
    await waitFor(`document.querySelector('.reader-heading')?.getAttribute('aria-label')===${JSON.stringify(detail.title)}`)
    await evaluate('document.fonts.ready.then(()=>true)')
    const audit=await evaluate(`(()=>{
      const original=document.createElement('template');original.innerHTML=${JSON.stringify(detail.html)};
      const compact=t=>t.replace(/\\s+/g,'');
      const actual=[...document.querySelectorAll('.reader-intro,.reader-section')].map(el=>el.textContent).join('');
      const wide=[document.documentElement,...document.querySelectorAll('.guide-reader,.reader-workspace,.reader-main,.reader-scroll')].filter(el=>el.scrollWidth>el.clientWidth+1).map(el=>el.className);
      const controls=[...document.querySelectorAll('.guide-reader button,.guide-reader a.btn,.guide-reader select')].filter(el=>{const r=el.getBoundingClientRect();return r.width&&r.height});
      const small=controls.filter(el=>{const r=el.getBoundingClientRect();return Math.min(r.width,r.height)<44}).map(el=>el.textContent.trim());
      const headings=[...original.content.querySelectorAll('h2,h3,h4')].map(el=>el.textContent);
      const shown=[...document.querySelectorAll('.reader-section > .reader-section-title')].map(el=>el.textContent);
      const index=[...document.querySelectorAll('.reader-index button span')].map(el=>el.textContent).slice(0,headings.length);
      return {same:compact(actual)===compact(original.content.textContent),headingSame:JSON.stringify(headings)===JSON.stringify(shown),indexSame:JSON.stringify(headings)===JSON.stringify(index),wide,small,styles:[...document.querySelectorAll('.reader-section')].map(el=>el.className),phone:!!document.querySelector('.reader-phone'),medical:!!document.querySelector('.reader-review')};
    })()`)
    check(audit.same,id+' texto y cantidades intactos '+lang)
    check(audit.headingSame&&audit.indexSame,id+' apartados e índice propios '+lang)
    check(!audit.wide.length&&!audit.small.length,id+' presentación táctil '+width+'×'+height,{wide:audit.wide,small:audit.small})
    if(shot&&OUT){const capture=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(OUT,shot+'.png'),Buffer.from(capture.data,'base64'))}
    return audit
  }
  const rcp=await openGuide('rcp-adulto',1536,1024,'es',false,'rcp-escritorio')
  check(rcp.styles.filter(s=>s.includes('section--steps')).length===1,'RCP tiene una sección de pasos')
  await openGuide('rcp-adulto',1024,600,'es',false,'rcp-pi-1024x600')
  await evaluate(`[...document.querySelectorAll('.reader-tabs button')].find(el=>el.textContent==='Pasos').click()`)
  await waitFor(`document.activeElement?.textContent==='Pasos'`)
  check(await evaluate(`document.querySelector('.reader-scroll').scrollTop>0`),'índice táctil desplaza la lectura y enfoca el apartado')
  await evaluate(`[...document.querySelectorAll('.reader-tabs button')].find(el=>el.textContent==='Fuentes').click()`)
  await waitFor(`document.activeElement?.id==='guide-sources'`)
  check(await evaluate(`document.querySelector('.reader-sources').textContent.includes('European Resuscitation')`),'fuentes accesibles')
  if(OUT){const capture=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(OUT,'rcp-fuentes.png'),Buffer.from(capture.data,'base64'))}
  await openGuide('rcp-adulto',800,480,'es',false,'rcp-pi-800x480')
  const water=await openGuide('agua-potable',1024,600,'es',false,'agua-pi')
  check(water.styles.filter(s=>s.includes('section--method')).length===3&&!water.medical&&!water.phone,'agua conserva tres métodos y no recibe estado sanitario ni llamada')
  const kit=await openGuide('kit-emergencia-72h',1024,600,'es',false,'kit-pi')
  check(kit.styles.filter(s=>s.includes('section--inventory')).length===4,'kit conserva cuatro grupos de suministros')
  const choking=await openGuide('atragantamiento',1024,600,'es',false,'atragantamiento-pi')
  check(choking.styles.filter(s=>s.includes('section--condition')).length===2,'atragantamiento conserva dos condiciones')
  const flood=await openGuide('inundacion',1024,600,'es',false,'inundacion-pi')
  check(flood.styles.length===3&&flood.styles.every(s=>s.includes('section--phase')),'inundación conserva las tres fases sin inventar Advertencias')
  const serum=await openGuide('deshidratacion-suero-oral',1024,600,'es',false,'suero-pi')
  check(serum.styles[1].includes('section--recipe')&&serum.styles[2].includes('section--steps'),'ingredientes y administración se presentan de forma diferente')
  await openGuide('rcp-adulto',390,844,'es',false,'rcp-movil')
  await openGuide('agua-potable',390,844,'es',false,'agua-movil')
  await openGuide('atragantamiento',800,480,'es',true,'atragantamiento-texto-grande')
  for(const lang of ['en','fr','it'])await openGuide('agua-potable',1024,600,lang,false,'agua-'+lang)
  // Recorrido real de todas las fichas para detectar pérdida de bloques o índices fijos.
  for(const item of source)await openGuide(item.id)
  // Ficha futura: títulos propios, subapartado real, tabla y lista numerada no clasificada como actuación.
  const future={id:'manual-nuevo',title:'Manual de reparación',category:'Reparación',reviewed:'2026-11-16',sources:'Fixture de prueba',html:'<p>Introducción original.</p>\n<h3>Herramientas</h3>\n<ul><li>Destornillador</li><li>Linterna</li></ul>\n<h4>Modelos</h4>\n<div class="table"><table><thead><tr><th>Dato</th><th>Valor</th></tr></thead><tbody><tr><td>A</td><td>1</td></tr></tbody></table></div>\n<h3>Referencia</h3>\n<ol><li>Entrada de referencia</li><li>Otra entrada</li></ol>'}
  override={status:200,body:future}
  await send('Fetch.enable',{patterns:[{urlPattern:'*/api/library/protocols/manual-nuevo',requestStage:'Request'}]})
  const neutral=await openGuide('manual-nuevo',390,844,'es',false,'manual-nuevo',future)
  check(neutral.styles.every(style=>style.includes('section--prose'))&&!neutral.medical&&!neutral.phone,'guía nueva neutral sin plantilla médica')
  check(await evaluate(`document.querySelector('[data-level="1"]').tagName==='H3' && !!document.querySelector('.reader-body table')`),'subapartados y tablas conservan su jerarquía')
  await send('Fetch.disable')
  // El PDF es el documento real en papel del repositorio, interceptado solo en este navegador de prueba.
  const pdf=readFileSync(new URL('../../docs/guia-emergencia-a5.pdf',import.meta.url))
  override={status:200,encoded:pdf.toString('base64'),headers:[{name:'content-type',value:'application/pdf'}]}
  await send('Fetch.enable',{patterns:[{urlPattern:'*/api/library/docs/900001/raw',requestStage:'Request'}]})
  await send('Emulation.setDeviceMetricsOverride',{width:1024,height:600,deviceScaleFactor:1,mobile:false})
  await send('Page.navigate',{url:BASE+'/visor?u='+encodeURIComponent('/api/library/docs/900001/raw')+'&t=Documento%20original'})
  await waitFor(`!!document.querySelector('.pdf canvas')`)
  check(await evaluate(`!!document.querySelector('.pdf .tools') && !document.querySelector('.reader-section')`),'PDF conserva páginas, zoom y visor nativo')
  if(OUT){const capture=await send('Page.captureScreenshot',{format:'png'});writeFileSync(join(OUT,'pdf-nativo.png'),Buffer.from(capture.data,'base64'))}
  await send('Fetch.disable')
  const native='<html><head><title>Artículo original</title></head><body><h1>Artículo original</h1><p id="native-text">Texto original de la fuente.</p><table><tr><th>Dato</th><th>Valor</th></tr><tr><td>A</td><td>1</td></tr></table></body></html>'
  override={status:200,encoded:Buffer.from(native).toString('base64'),headers:[{name:'content-type',value:'text/html; charset=utf-8'}]}
  await send('Fetch.enable',{patterns:[{urlPattern:'*/api/library/docs/900002/raw',requestStage:'Request'},{urlPattern:'*/kiwix/content/reader-fixture',requestStage:'Request'}]})
  await send('Page.navigate',{url:BASE+'/visor?u='+encodeURIComponent('/api/library/docs/900002/raw')+'&t=Art%C3%ADculo%20original'})
  await waitFor(`document.querySelector('.viewer iframe')?.contentDocument?.querySelector('#native-text')`)
  check(await evaluate(`!!document.querySelector('.viewer iframe').contentDocument.querySelector('table') && !document.querySelector('.reader-section')`),'HTML conserva su documento original')
  await send('Page.navigate',{url:BASE+'/biblioteca/leer?u='+encodeURIComponent('/kiwix/content/reader-fixture')})
  await waitFor(`document.querySelector('.reader iframe')?.contentDocument?.querySelector('#native-text')`)
  check(await evaluate(`document.querySelector('.reader iframe').contentDocument.querySelector('#native-text').textContent==='Texto original de la fuente.'`),'artículo Kiwix conserva texto y estructura originales')
  await send('Fetch.disable')
  check(!external.length,'lector sin peticiones externas',external)
  check(!errors.length,'lector sin errores JS',errors)
  console.log('AUDITORÍA COMPLETA '+total+' fichas; capturas '+OUT)
} finally { if(ws)ws.close();chrome.kill();await sleep(300);rmSync(profile,{recursive:true,force:true,maxRetries:3,retryDelay:150}) }
