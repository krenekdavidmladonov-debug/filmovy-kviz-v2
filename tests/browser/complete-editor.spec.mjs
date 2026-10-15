/* global window, document */
import { test, expect } from '@playwright/test';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { editorIdentity } from '../e2e/editor-identity.mjs';
import { syntheticImage, syntheticAudio } from '../e2e/media-fixture.mjs';
const dir='.local-data/complete-editor';
const { FieldValue } = createRequire(new URL('../../functions/package.json', import.meta.url))('firebase-admin/firestore');
const prompt=p=>p.getByLabel('Otázka *',{exact:true});
const save=async p=>{await p.getByRole('button',{name:'Uložit vše',exact:true}).click();await expect(p.locator('.save-state')).toHaveText('Uloženo');};
const round=(p,n)=>p.locator('.outline-round').nth(n);
const expand=async(p,name)=>{const summary=p.locator('details.editor-extra').locator('summary').filter({hasText:name});if((await summary.locator('..').getAttribute('open'))===null)await summary.click();};
const layout=async(p,value)=>{const fields=p.locator('.slide-design-editor').first(),details=fields.locator('details.editor-extra');if(await details.getAttribute('open')===null)await details.locator('summary').first().click();await fields.getByLabel(/^Rozložení /).selectOption(value);};
const timing=async p=>{await p.getByLabel('Začátek ukázky *').fill('0:01');await p.getByLabel('Konec ukázky *').fill('0:03');await p.getByLabel('Konec ukázky *').press('Tab');};
const link=async(p,label,url)=>{const field=p.getByRole('region',{name:label,exact:true});await field.getByRole('button',{name:'Vložit odkaz',exact:true}).click();await field.getByRole('textbox').fill(url);await field.getByRole('button',{name:'Použít odkaz',exact:true}).click();await expect(field.getByRole('textbox')).toHaveCount(0);};
const select=async(p,text)=>{await p.locator('.outline-question').filter({hasText:text}).click();await expect(prompt(p)).toHaveValue(text);};

test('entire quiz from empty library through normal UI, private drafts, structure, rehearsal and immutable event',async({page,context})=>{
  const identity=await editorIdentity(), network=[], expected=[], pageErrors=[], emailChunks=[];let quizId,eventId,snapshotId,sessionId;
  page.on('pageerror',error=>pageErrors.push(error.message));context.on('request',request=>{if(request.url().includes('EventTeamMessagePanel'))emailChunks.push(request.url());});
  await mkdir(dir,{recursive:true});const video=await readFile('tests/fixtures/media/synthetic.webm');
  await context.route('**/*',route=>['localhost','127.0.0.1'].includes(new URL(route.request().url()).hostname)?route.continue():route.abort());
  await context.route('**/qa.webm',route=>route.fulfill({contentType:'video/webm',body:video}));
  await context.route('**/qa.wav',route=>route.fulfill({contentType:'audio/wav',body:syntheticAudio(5)}));
  await context.route('**/qa.png',route=>route.fulfill({contentType:'image/png',body:syntheticImage()}));
  context.on('response',response=>{const u=new URL(response.url());if(u.port==='5001')network.push({endpoint:u.pathname.split('/').pop(),status:response.status()});});
  try {
    expect((await identity.db.collection('quizzes').get()).size).toBe(0);
    await page.goto('/admin/login');await page.getByLabel('E-mail').fill(identity.email);await page.getByLabel('Heslo').fill(identity.password);await page.getByRole('button',{name:'Přihlásit se'}).click();await expect(page).toHaveURL(/\/admin$/);
    const libraryLink = page.getByRole('navigation', { name: 'Akce přehledu', exact: true }).getByRole('link', { name: 'Kvízy', exact: true });
    await expect(libraryLink).toHaveCount(1);
    await expect(libraryLink).toHaveAttribute('href', '/admin/quizzes');
    await libraryLink.click();
    await expect(page).toHaveURL(/\/admin\/quizzes$/);
    await expect(page.getByRole('heading',{name:'Zatím tu nejsou žádné kvízy'})).toBeVisible();await page.screenshot({path:dir+'/01-empty-library.png'});
    await page.getByRole('link',{name:'+ Nový kvíz',exact:true}).first().click();await page.getByLabel('Název kvízu').fill('Celý syntetický kvíz');await page.getByRole('button',{name:'Vytvořit',exact:true}).click();await expect(page).toHaveURL(/\/edit$/);quizId=page.url().split('/').at(-2);
    await link(page,/^Pozadí · (děděné|vlastní)$/,'http://127.0.0.1:5198/qa.png');await layout(page,'image-first');await save(page);expect((await identity.db.doc('quizzes/'+quizId).get()).get('defaultDesign')).toMatchObject({layout:'image-first',backgroundImage:'http://127.0.0.1:5198/qa.png'});
    await page.getByRole('button',{name:'Úvodní obrazovka',exact:false}).click();await page.getByLabel('Název na úvodní obrazovce').fill('Syntetický filmový večer');await page.getByLabel('Podtitulek').fill('Tři kola vytvořená běžným UI');await save(page);
    await page.getByRole('button',{name:'Pravidla',exact:false}).click();await page.getByLabel('Pravidlo 1',{exact:true}).fill('Syntetické pravidlo fair play');await save(page);
    const systemParts=(await identity.db.collection('quizzes/'+quizId+'/slides').get()).docs.map(d=>d.data());expect(systemParts.find(s=>s.kind==='intro')?.title).toBe('Syntetický filmový večer');expect(systemParts.find(s=>s.kind==='rules')?.options[0]).toBe('Syntetické pravidlo fair play');
    for(let r=0;r<3;r++){await page.getByRole('button',{name:'+ Přidat kolo',exact:true}).click();await expect(page.locator('.outline-round')).toHaveCount(r+1);await page.getByLabel('Název kola *').fill('Kolo '+(r+1));await save(page);if(r===1)await page.screenshot({path:dir+'/02-second-round.png'});}
    await round(page,1).getByRole('button',{name:'Úvod a vzhled kola',exact:true}).click();await page.getByLabel('Název kola *').fill('Druhé filmové kolo');await save(page);
    const types=['ABCD','Volná odpověď','Obrázek','Audio','Video'];
    for(let r=0;r<3;r++)for(let t=0;t<5;t++){
      const text=`K${r+1} ${types[t]} syntetická otázka`;if(!await page.getByRole('dialog',{name:/Typ otázky/}).count())await round(page,r).getByRole('button',{name:'+ Přidat otázku',exact:true}).click();await page.getByRole('dialog',{name:/Typ otázky/}).getByRole('button',{name:types[t],exact:true}).click();await prompt(page).fill(text);
      const choice=t===0||(r===0&&(t===2||t===3));if(choice){await page.getByLabel('Způsob odpovědi').selectOption('choice');for(let i=0;i<4;i++)await page.getByLabel('Možnost '+String.fromCharCode(65+i),{exact:true}).fill(`Varianta ${i+1}`);await page.getByLabel('Označit možnost B jako správnou').check();}else await page.getByLabel('Správná odpověď *',{exact:true}).fill('Odpověď '+text);
      if(t===2){if(r===1)await link(page,'Obrázek otázky','http://127.0.0.1:5198/qa.png');else if(r===2){const picker=page.getByRole('region',{name:'Obrázek otázky',exact:true});await picker.getByRole('button',{name:'Vybrat z médií tohoto kvízu'}).click();await picker.getByRole('button',{name:/Vybrat médium 1/}).click();}else{await page.getByLabel('Obrázek otázky — soubor',{exact:true}).setInputFiles({name:'synthetic.png',mimeType:'image/png',buffer:syntheticImage()});await expect(page.getByRole('button',{name:'Zrušit nahrávání'})).toHaveCount(0);}}
      if(t===3){if(r===1)await link(page,'Zdroj ukázky','http://127.0.0.1:5198/qa.wav');else{await page.getByLabel('Zdroj ukázky — soubor',{exact:true}).setInputFiles({name:'synthetic.wav',mimeType:'audio/wav',buffer:syntheticAudio(5)});await expect(page.getByRole('button',{name:'Zrušit nahrávání'})).toHaveCount(0);}await timing(page);}
      if(t===4){await link(page,'Zdroj ukázky','http://127.0.0.1:5198/qa.webm');await timing(page);}
      if(r===0&&t===2){await expand(page,'Odpověď po odhalení');await page.getByLabel('Obrázek odpovědi (soukromý) — soubor',{exact:true}).setInputFiles({name:'answer.png',mimeType:'image/png',buffer:syntheticImage()});await expect(page.getByRole('button',{name:'Zrušit nahrávání'})).toHaveCount(0);await page.getByLabel('Vysvětlení pro hráče po odhalení').fill('Syntetické vysvětlení až po reveal');await expand(page,'Vzhled slidu');await page.locator('.slide-design-editor').first().getByLabel(/^Pozadí · (děděné|vlastní) — soubor$/).setInputFiles({name:'background.png',mimeType:'image/png',buffer:syntheticImage()});await expect(page.getByRole('button',{name:'Zrušit nahrávání'})).toHaveCount(0);await layout(page,'image-first');}
      await save(page);expected.push({text,choice,kind:t===0?'question':t===1?'free':t===2?'image':t===3?'audio':'video'});
      if(r===0){await page.screenshot({path:dir+'/form-'+t+'.png'});if(t===4){await page.getByRole('button',{name:'Přehrát ukázku',exact:true}).click();await expect.poll(()=>page.locator('video').evaluate(v=>v.currentTime)).toBeGreaterThan(1);await page.getByRole('button',{name:'Stop',exact:true}).click();await expect.poll(()=>page.locator('video').evaluate(v=>v.paused)).toBe(true);await page.getByRole('button',{name:'Pustit znovu',exact:true}).click();await expect(page.getByText('Ukázka dohrála.',{exact:true})).toBeVisible();}}
      if(r===0&&t===0) {await page.getByRole('button',{name:'Uložit a přidat další',exact:true}).click();await expect(page.getByRole('dialog',{name:/Typ otázky/})).toBeVisible();}
      if(r===0&&t===1)await page.screenshot({path:dir+'/03-second-question.png'});
    }
    await expect(page.locator('.outline-question')).toHaveCount(15);
    await round(page,0).getByRole('button',{name:'+ Přidat otázku'}).click();await page.getByRole('dialog',{name:/Typ otázky/}).getByRole('button',{name:'Volná odpověď',exact:true}).click();await prompt(page).fill('Soukromý nedokončený koncept');await page.getByRole('button',{name:'Uložit koncept',exact:true}).click();await expect(page.locator('.save-state')).toHaveText('Uloženo');await expect(page.getByRole('button',{name:'Soukromá zkouška',exact:true})).toBeDisabled();await page.reload();await select(page,'Soukromý nedokončený koncept');await expect(page.getByLabel('Správná odpověď *',{exact:true})).toHaveValue('');
    await expand(page,'Poznámka moderátora');await page.getByLabel('Poznámka moderátora',{exact:true}).fill('Soukromá poznámka uložená při odchodu');await page.locator('.outline-question').filter({hasText:expected[0].text}).click();await expect(page.getByRole('dialog')).toHaveCount(0);await save(page);await expect(prompt(page)).toHaveValue(expected[0].text);await select(page,'Soukromý nedokončený koncept');
    await expect(identity.call('createLiveSession',{quizId})).rejects.toThrow();await page.getByLabel('Správná odpověď *',{exact:true}).fill('Dokončená soukromá odpověď');await page.getByRole('button',{name:'Dokončit otázku',exact:true}).click();await expect(page.locator('.save-state')).toHaveText('Uloženo');
    await page.getByRole('button',{name:'Duplikovat',exact:true}).click();await expect(page.locator('.outline-question')).toHaveCount(17);await prompt(page).fill('Přesunutá duplikovaná otázka');await save(page);await page.getByLabel('Přesunout do kola',{exact:true}).selectOption({label:'2. kolo – Druhé filmové kolo'});await expect(round(page,1)).toContainText('Přesunutá duplikovaná otázka');
    await round(page,1).getByRole('button',{name:'Úvod a vzhled kola',exact:true}).click();await page.getByRole('button',{name:'Přesunout nahoru',exact:true}).click();await expect(round(page,0)).toContainText('Druhé filmové kolo');await page.getByRole('button',{name:'Odstranit kolo…',exact:true}).click();await expect(page.getByRole('dialog')).toContainText('6 otázek');await page.getByRole('dialog').getByRole('button',{name:'Zrušit',exact:true}).click();
    await page.getByRole('button',{name:'+ Přidat kolo',exact:true}).click();await expect(page.locator('.outline-round')).toHaveCount(4);await page.getByRole('button',{name:'Odstranit kolo…',exact:true}).click();await page.getByRole('button',{name:'Odstranit kolo včetně 0 otázek',exact:true}).click();await expect(page.locator('.outline-round')).toHaveCount(3);
    await page.getByRole('button',{name:'+ Závěrečná obrazovka',exact:true}).click();await page.getByLabel('Titulek',{exact:true}).fill('Syntetický konec');await save(page);
    await page.getByRole('link',{name:'← Knihovna kvízů'}).click();await page.getByRole('link',{name:'Celý syntetický kvíz',exact:true}).click();await page.getByRole('link',{name:'Otevřít editor'}).click();await page.reload();
    for(const item of expected){await select(page,item.text);await expect(page.getByLabel('Způsob odpovědi')).toHaveValue(item.choice?'choice':'open');if(item.choice){await expect(page.getByLabel('Možnost B',{exact:true})).toHaveValue('Varianta 2');await expect(page.getByLabel('Označit možnost B jako správnou')).toBeChecked();}else await expect(page.getByLabel('Správná odpověď *',{exact:true})).toHaveValue('Odpověď '+item.text);if(['audio','video'].includes(item.kind)){await expect(page.getByLabel('Začátek ukázky *')).toHaveValue('0:01');await expect(page.getByLabel('Konec ukázky *')).toHaveValue('0:03');}}
    await select(page,expected[2].text);await page.screenshot({path:dir+'/04-reopened.png'});
    page.once('dialog',dialog=>dialog.dismiss());await page.getByLabel('Způsob zadání').selectOption('audio');await expect(page.getByLabel('Způsob zadání')).toHaveValue('image');
    for(const viewport of [{width:1366,height:768},{width:1024,height:768},{width:390,height:844}]) {
      await page.setViewportSize(viewport);await page.getByRole('button',{name:'Náhled',exact:true}).click();await expect(page.locator('.round-editor-preview')).toBeVisible();await expect.poll(()=>page.locator('.round-editor-preview .question-image-frame img').evaluate(img=>img.naturalWidth)).toBe(8);await expect.poll(()=>page.locator('.round-editor-preview .slide-background img').evaluate(img=>img.naturalWidth)).toBe(8);await expect(page.locator('.round-editor-preview').getByText('Obrázek není dostupný.',{exact:false})).toHaveCount(0);await page.screenshot({path:dir+'/preview-'+viewport.width+'.png'});
      expect(await page.evaluate(()=>document.documentElement.scrollWidth<=window.innerWidth)).toBe(true);
      await page.getByRole('button',{name:'Obsah',exact:true}).click();await expect(prompt(page)).toBeVisible();await page.screenshot({path:dir+'/content-'+viewport.width+'.png'});
    }
    await page.setViewportSize({width:1366,height:768});
    await page.getByRole('button',{name:'Zkontrolovat kvíz',exact:true}).click();await expect(page.getByRole('button',{name:'Soukromá zkouška',exact:true})).toBeEnabled();await page.getByRole('button',{name:'Soukromá zkouška',exact:true}).click();const practice=page.getByRole('dialog',{name:'Soukromá zkouška kvízu'});let steps=0;const visited=[],rehearsedMedia=new Set();await page.screenshot({path:dir+'/practice-intro.png'});
    while(await practice.getByRole('button',{name:'Další',exact:true}).isEnabled()){
      const current=await practice.locator('.practice-stage').getAttribute('data-slide-id');expect(visited).not.toContain(current);visited.push(current);
      if(await practice.getByLabel('Otázka rekapitulace').count()) {const choices=await practice.getByLabel('Otázka rekapitulace').locator('option').count();for(let i=1;i<choices;i++){await practice.getByLabel('Otázka rekapitulace').selectOption({index:i});await expect(practice.locator('.slide-answer')).toBeVisible();}}
      for(const media of ['audio','video']) if(!rehearsedMedia.has(media)&&await practice.locator('.kind-'+media).count()&&await practice.getByRole('button',{name:'Přehrát',exact:true}).count()){
        await practice.getByRole('button',{name:'Přehrát',exact:true}).click();await expect.poll(()=>practice.locator(media).evaluate(p=>p.currentTime)).toBeGreaterThan(1);await practice.getByRole('button',{name:'Zastavit',exact:true}).click();rehearsedMedia.add(media);
      }
      await practice.getByRole('button',{name:'Další',exact:true}).click();await expect(practice.locator('.practice-stage')).not.toHaveAttribute('data-slide-id',current);steps++;
    }
    expect(steps).toBeGreaterThan(22);expect([...rehearsedMedia].sort()).toEqual(['audio','video']);await page.screenshot({path:dir+'/practice-end.png'});await practice.getByRole('button',{name:'Zavřít zkoušku'}).click();expect((await identity.db.collection('publicSessions').get()).size).toBe(0);
    // Content above is exclusively authored through UI. Event setup below is a separate boundary check.
    const created=await identity.call('createEvent',{expectedRevision:0,event:{title:'Syntetická akce kompletního editoru',startsAt:'2031-11-20T18:00:00Z',timeZone:'Europe/Prague',venue:{name:'Sál',publicLocation:'Praha'},teamCapacity:30,peopleCapacity:120,teamSizeMin:2,teamSizeMax:6}});eventId=created.eventId;
    const q=(await identity.db.doc('quizzes/'+quizId).get()).data(),event=(await identity.db.doc('events/'+eventId).get()).data();await identity.call('lockEventQuiz',{eventId,quizId,expectedRevision:event.revision,expectedQuizRevision:q.revision,acknowledgeWarnings:true});const locked=(await identity.db.doc('events/'+eventId).get()).data();snapshotId=locked.quizAssignment.snapshotId;const snapshot=await identity.db.collection('quizSnapshots/'+snapshotId+'/slides').get();const image=snapshot.docs.find(d=>d.data().text===expected[2].text);const originalImage=image.data();expect(snapshot.docs.filter(d=>d.data().kind==='rules')).toHaveLength(1);expect(snapshot.docs.filter(d=>d.data().kind==='intro')).toHaveLength(1);expect(snapshot.docs.find(d=>d.data().kind==='agenda').data().options).toHaveLength(3);expect(snapshot.docs.map(d=>d.data()).sort((a,b)=>a.position-b.position).slice(0,3).map(d=>d.kind)).toEqual(['intro','agenda','rules']);expect(snapshot.docs.find(d=>d.data().kind==='end').data().roundId).toBeUndefined();expect(steps).toBe(snapshot.size-1);
    const live=await identity.call('createEventLiveSession',{eventId,expectedRevision:locked.revision});sessionId=live.sessionId;let state=(await identity.db.doc('sessions/'+sessionId).get()).data();await identity.call('goToSlide',{sessionId,expectedRevision:state.revision,position:originalImage.position});let pub=(await identity.db.doc('publicSessions/'+sessionId).get()).data();expect(pub.answerImage).toBeUndefined();expect(pub.answerExplanation).toBeUndefined();expect(pub.correctAnswer).toBeUndefined();state=(await identity.db.doc('sessions/'+sessionId).get()).data();await identity.call('revealAnswer',{sessionId,expectedRevision:state.revision});pub=(await identity.db.doc('publicSessions/'+sessionId).get()).data();expect(pub.answerImage).toBe(originalImage.answerImage);expect(pub.answerExplanation).toBe(originalImage.answerExplanation);
    await select(page,expected[2].text);await prompt(page).fill('Knihovna upravená po snapshotu');await save(page);expect((await image.ref.get()).data()).toEqual(originalImage);
    await page.getByRole('link',{name:'← Knihovna kvízů'}).click();await page.getByRole('link',{name:'Akce',exact:true}).click();await page.getByRole('link',{name:/Syntetická akce kompletního editoru/}).click();await expect(page).toHaveURL(new RegExp('/admin/events/'+eventId+'$'));
    await expect(page.getByRole('heading',{name:'Upravit akci',exact:true})).toBeVisible();
    await expect(page.locator('.event-detail-page .lead')).toContainText('Syntetická akce kompletního editoru');
    await expect(page.locator('.event-team-message-panel')).toHaveCount(0);
    expect(network.filter(n=>n.endpoint==='createQuizRound'&&n.status===200)).toHaveLength(4);expect(network.some(n=>/Email|TeamMessage/.test(n.endpoint))).toBe(false);expect(pageErrors).toEqual([]);expect(emailChunks).toEqual([]);
    await writeFile(dir+'/evidence.json',JSON.stringify({eventDetailLoaded:true,teamEmailChunksLoaded:emailChunks.length,pageErrors,quizCreatedThroughUI:true,questionsCreated:17,roundsAfterOperations:3,practiceSteps:steps,storedSlides:snapshot.size,network},null,2));await page.screenshot({path:dir+'/05-event-detail.png'});
  }catch(error){console.error('Synthetic acceptance state:',(await page.locator('body').innerText()).slice(-7000));throw error;}finally{
    if(sessionId){await identity.db.doc('sessions/'+sessionId).delete();await identity.db.doc('publicSessions/'+sessionId).delete();}if(snapshotId)await identity.db.recursiveDelete(identity.db.doc('quizSnapshots/'+snapshotId));if(eventId){await identity.db.recursiveDelete(identity.db.doc('events/'+eventId));await identity.db.doc('publicEvents/'+eventId).delete();}if(quizId)await identity.db.recursiveDelete(identity.db.doc('quizzes/'+quizId));await identity.dispose();
  }
});

// Regression: never visit/save the optional opening, rules or ending sections.
test('minimal quiz authored through UI rehearses exactly the persisted live stream', async ({ page, context }) => {
  const identity = await editorIdentity();
  let quizId, sessionId;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await context.route('**/*', route => ['localhost', '127.0.0.1'].includes(new URL(route.request().url()).hostname) ? route.continue() : route.abort());
  try {
    await page.goto('/admin/login');
    await page.getByLabel('E-mail').fill(identity.email);
    await page.getByLabel('Heslo').fill(identity.password);
    await page.getByRole('button', { name: 'Přihlásit se' }).click();
    await expect(page).toHaveURL(/\/admin$/);
    const libraryLink = page.getByRole('navigation', { name: 'Akce přehledu', exact: true }).getByRole('link', { name: 'Kvízy', exact: true });
    await expect(libraryLink).toHaveCount(1);
    await expect(libraryLink).toHaveAttribute('href', '/admin/quizzes');
    await libraryLink.click();
    await expect(page).toHaveURL(/\/admin\/quizzes$/);
    await page.getByRole('link', { name: '+ Nový kvíz', exact: true }).first().click();
    await page.getByLabel('Název kvízu').fill('Minimální syntetický kvíz');
    await page.getByRole('button', { name: 'Vytvořit', exact: true }).click();
    await expect(page).toHaveURL(/\/edit$/);
    quizId = page.url().split('/').at(-2);
    await page.getByRole('button', { name: '+ Přidat kolo', exact: true }).click();
    await page.getByLabel('Název kola *').fill('Jediné kolo');
    await save(page);
    const agendaDto = async () => (await identity.call('readAccessData', { operation: 'editor', quizId })).slides.find(slide => slide.kind === 'agenda');
    expect((await agendaDto()).automaticAgenda).toBe(true);
    await page.getByRole('button', { name: /^Harmonogram/ }).click();
    const agendaForm = page.locator('[data-preflight-field="agenda"]');
    await expect(agendaForm).toContainText('Automaticky podle pořadí a názvů kol');
    await expect(agendaForm.locator('ol')).toContainText('Jediné kolo');
    await round(page, 0).getByRole('button', { name: 'Úvod a vzhled kola', exact: true }).click();
    await page.getByLabel('Název kola *').fill('Přejmenované jediné kolo');
    await save(page);
    const automaticAgenda = await agendaDto();
    expect(automaticAgenda.automaticAgenda).toBe(true);
    expect(automaticAgenda.options.join(' ')).toContain('Přejmenované jediné kolo');
    await round(page, 0).getByRole('button', { name: '+ Přidat otázku', exact: true }).click();
    await page.getByRole('dialog', { name: /Typ otázky/ }).getByRole('button', { name: 'Volná odpověď', exact: true }).click();
    await prompt(page).fill('Jediná syntetická otázka');
    await page.getByLabel('Správná odpověď *', { exact: true }).fill('Syntetická odpověď');
    await save(page);
    await page.reload();
    const stored = (await identity.db.collection('quizzes/' + quizId + '/slides').get()).docs.map(d => ({ ...d.data(), id: d.id })).sort((a, b) => a.position - b.position);
    expect(stored.map(s => s.kind)).toEqual(['agenda', 'round', 'free', 'recap']);
    await page.getByRole('button', { name: 'Soukromá zkouška', exact: true }).click();
    const practice = page.getByRole('dialog', { name: 'Soukromá zkouška kvízu' });
    await expect(practice.getByRole('button', { name: 'Zavřít zkoušku' })).toBeFocused();
    // Native modal navigation must skip disabled Previous and keep shell links inert.
    const firstControl = practice.getByRole('button', { name: 'Zvětšit', exact: true });
    const lastControl = practice.getByRole('button', { name: 'Další', exact: true });
    await expect(practice.getByRole('button', { name: 'Předchozí', exact: true })).toBeDisabled();
    await lastControl.focus();
    await page.keyboard.press('Tab');
    await expect(firstControl).toBeFocused();
    await page.keyboard.press('Shift+Tab');
    await expect(lastControl).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(practice).toHaveCount(0);
    const practiceButton = page.getByRole('button', { name: 'Soukromá zkouška', exact: true });
    await expect(practiceButton).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(practice.getByRole('button', { name: 'Zavřít zkoušku' })).toBeFocused();
    await firstControl.click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.className)).toBe('practice-content');
    await page.screenshot({ path: dir + '/minimal-practice-fullscreen.png' });
    await practice.getByRole('button', { name: 'Zavřít zkoušku' }).click();
    await expect.poll(() => page.evaluate(() => document.fullscreenElement === null)).toBe(true);
    await expect(practiceButton).toBeFocused();
    await page.keyboard.press('Enter');
    await page.setViewportSize({ width: 390, height: 844 });
    await page.screenshot({ path: dir + '/minimal-practice-narrow.png' });
    expect(await practice.evaluate(dialog => dialog.scrollWidth <= dialog.clientWidth + 1)).toBe(true);
    await page.setViewportSize({ width: 1366, height: 768 });
    const visited = [];
    for (let i = 0; i < stored.length; i++) {
      await expect(practice.locator('.practice-stage')).toHaveAttribute('data-slide-id', stored[i].id);
      visited.push(await practice.locator('.practice-stage').getAttribute('data-slide-id'));
      if (i < stored.length - 1) await practice.getByRole('button', { name: 'Další', exact: true }).click();
    }
    await expect(practice.getByRole('button', { name: 'Další', exact: true })).toBeDisabled();
    await expect(practice.locator('header strong')).toHaveText('Soukromá zkouška · 4 / 4');
    await page.screenshot({ path: dir + '/minimal-practice.png' });
    await practice.getByRole('button', { name: 'Zavřít zkoušku' }).click();
    await expect(practiceButton).toBeFocused();
    expect((await identity.db.collection('publicSessions').get()).size).toBe(0);
    // Separate technical legacy fixture: mutate only this UI-created quiz's own agenda.
    // No content in the authored journey above was seeded through the database.
    const manualOptions = ['Původní ruční syntetický program'];
    const agendaRef = identity.db.doc('quizzes/' + quizId + '/slides/' + automaticAgenda.id);
    await agendaRef.update({ automaticAgenda: FieldValue.delete(), options: manualOptions });
    await page.reload();
    const manualDto = await agendaDto();
    expect(manualDto).not.toHaveProperty('automaticAgenda');
    expect(manualDto.options).toEqual(manualOptions);
    await page.getByRole('button', { name: /^Harmonogram/ }).click();
    await expect(agendaForm).toContainText('Uložený ruční harmonogram');
    await expect(agendaForm.locator('ol')).toHaveText(manualOptions[0]);
    await round(page, 0).getByRole('button', { name: 'Úvod a vzhled kola', exact: true }).click();
    await page.getByLabel('Název kola *').fill('Nový název při ruční agendě');
    await save(page);
    const preservedAgenda = (await agendaRef.get()).data();
    expect(preservedAgenda).not.toHaveProperty('automaticAgenda');
    expect(preservedAgenda.options).toEqual(manualOptions);
    const preservedDto = await agendaDto();
    expect(preservedDto).not.toHaveProperty('automaticAgenda');
    expect(preservedDto.options).toEqual(manualOptions);
    await page.getByRole('button', { name: /^Harmonogram/ }).click();
    await expect(agendaForm.locator('ol')).toHaveText(manualOptions[0]);
    await practiceButton.click();
    await expect(practice.locator('.practice-stage')).toHaveAttribute('data-slide-id', automaticAgenda.id);
    await expect(practice.locator('.agenda-items')).toHaveText(manualOptions[0]);
    await practice.getByRole('button', { name: 'Zavřít zkoušku' }).click();
    await expect(practiceButton).toBeFocused();
    // Separate technical comparison; the quiz content above was authored only in UI.
    sessionId = (await identity.call('createLiveSession', { quizId })).sessionId;
    for (const slide of stored) {
      const state = (await identity.db.doc('sessions/' + sessionId).get()).data();
      await identity.call('goToSlide', { sessionId, expectedRevision: state.revision, position: slide.position });
      const live = (await identity.db.doc('sessions/' + sessionId).get()).data();
      const published = (await identity.db.doc('publicSessions/' + sessionId).get()).data();
      expect(live.currentSlideId).toBe(slide.id);
      expect(published.slideKind).toBe(slide.kind);
    }
    expect(errors).toEqual([]);
    await writeFile(dir + '/minimal-practice.json', JSON.stringify({ quizCreatedThroughUI: true, storedKinds: stored.map(s => s.kind), storedIds: stored.map(s => s.id), practiceIds: visited, technicalLiveComparison: true, automaticAgendaDtoVerified: true, separateTechnicalLegacyAgendaFixture: true, manualAgendaPreservedAcrossRoundSaveAndRehearsal: true, pageErrors: errors }, null, 2));
  } finally {
    if (sessionId) { await identity.db.doc('sessions/' + sessionId).delete(); await identity.db.doc('publicSessions/' + sessionId).delete(); }
    if (quizId) await identity.db.recursiveDelete(identity.db.doc('quizzes/' + quizId));
    await identity.dispose();
  }
});
