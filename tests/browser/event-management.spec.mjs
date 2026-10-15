import { test, expect } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import { randomUUID, randomBytes } from 'node:crypto';
import { editorIdentity } from '../e2e/editor-identity.mjs';
import { syntheticImage, syntheticAudio } from '../e2e/media-fixture.mjs';
const origin = process.env.EVENT_QA_ORIGIN ?? (process.env.EVENT_QA_STAGING ? 'https://filmovy-kviz-v2-staging.web.app' : 'http://127.0.0.1:5198');
if(process.env.EVENT_QA_ORIGIN && process.env.EVENT_QA_ORIGIN !== 'http://127.0.0.1:5199') throw Error('Only exact candidate preview is allowed');
const identity = async () => process.env.EVENT_QA_STAGING ? (await import('../../tools/event-management/qa-identity.mjs')).cloudQaIdentity() : editorIdentity();

test('normal UI: create, edit, two-window conflict, team, cancellation, archive, trash, restore and real deletion', async ({ browser }) => {
  const person = await identity(), context = await browser.newContext({ baseURL: origin, viewport: { width: 1366, height: 900 }, timezoneId: 'America/New_York' });
  const page = await context.newPage(); let title = 'QA Správa akcí ' + randomUUID().slice(0, 8);
  const screenshots = '.local-data/event-management/' + (process.env.EVENT_QA_STAGING ? 'online-screenshots' : 'screenshots'); await mkdir(screenshots, { recursive: true });
  let eventId, deletionRequest, cancelRequest, expectedTeams=2;
  page.on('request', request=>{if(request.method()!=='POST')return;if(request.url().endsWith('/deleteEvent')) deletionRequest=request.postDataJSON().data;if(request.url().endsWith('/cancelEvent'))cancelRequest=request.postDataJSON().data;});
  async function menu(name) { await page.locator('.event-actions summary').click(); await page.locator('.event-actions').getByRole('button', { name, exact: true }).click(); }
  async function confirm(name) { const dialog = page.getByRole('dialog'); await expect(dialog.getByRole('button', { name, exact: true })).toBeEnabled(); await dialog.getByRole('button', { name, exact: true }).click(); await expect(dialog).toHaveCount(0); }
  try {
    await page.goto('/admin/login'); await page.getByLabel('E-mail', { exact: true }).fill(person.email); await page.getByLabel('Heslo', { exact: true }).fill(person.password); await page.getByRole('button', { name: 'Přihlásit se', exact: true }).click(); await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/events'); await page.getByRole('link', { name: 'Vytvořit akci', exact: true }).click();
    await page.getByLabel('Název akce', { exact: true }).fill(title); await page.getByLabel('Datum a čas v Praze').fill('2031-07-20T19:30'); await page.getByLabel('Místo', { exact: true }).fill('QA sál'); await page.getByLabel('Veřejné upřesnění místa').fill('Praha');
    await page.getByRole('button', { name: 'Vytvořit akci', exact: true }).click(); await expect(page.getByRole('heading', { name: 'Upravit akci', exact: true })).toBeVisible(); await expect(page).toHaveURL(/\/admin\/events\/[A-Za-z0-9]{20}$/); eventId = page.url().split('/').at(-1);
    if(person.rawCall) { const denied=await person.rawCall('cancelEvent',{eventId,expectedRevision:1},null);expect(denied.data.error.status).toBe('UNAUTHENTICATED'); }
    await expect(page.getByLabel('Datum a čas v Praze')).toHaveValue('2031-07-20T19:30'); expect((await person.db.doc('events/' + eventId).get()).get('startsAt').toDate().toISOString()).toBe('2031-07-20T17:30:00.000Z');
    title += ' upravená';await page.getByLabel('Název akce',{exact:true}).fill(title);await page.getByLabel('Datum a čas v Praze').fill('2031-07-21T20:00');await page.getByLabel('Místo',{exact:true}).fill('QA upravený sál');await page.getByLabel('Maximální počet týmů',{exact:true}).fill('8');await page.getByLabel('Maximální počet účastníků',{exact:true}).fill('40');await page.getByRole('button',{name:'Uložit změny',exact:true}).click();await expect(page.getByText('Změny akce byly uloženy.')).toBeVisible();await page.reload();await expect(page.getByLabel('Název akce',{exact:true})).toHaveValue(title);await expect(page.getByLabel('Datum a čas v Praze')).toHaveValue('2031-07-21T20:00');await expect(page.getByLabel('Místo',{exact:true})).toHaveValue('QA upravený sál');await expect(page.getByLabel('Maximální počet týmů',{exact:true})).toHaveValue('8');
    const second = await context.newPage(); await second.goto('/admin/events/' + eventId); await expect(second.getByLabel('Název akce', { exact: true })).toHaveValue(title);
    await page.getByLabel('Popis akce').fill('Organizační popis\nDruhý řádek'); await page.getByRole('button', { name: 'Uložit změny', exact: true }).click(); await expect(page.getByText('Změny akce byly uloženy.')).toBeVisible();
    await second.getByLabel('Místo', { exact: true }).fill('Druhý návrh místa'); await second.getByRole('button', { name: 'Uložit změny', exact: true }).click(); await expect(second.getByText('Novější změnu jsme nepřepsali.', { exact: false })).toBeVisible(); await expect(second.getByLabel('Místo', { exact: true })).toHaveValue('Druhý návrh místa'); await second.close();
    await page.reload(); await expect(page.getByLabel('Popis akce')).toHaveValue('Organizační popis\nDruhý řádek'); await page.screenshot({ path: screenshots + '/event-detail.png', fullPage: true });
    await page.getByRole('button', { name: '+ Přidat tým', exact: true }).click(); const teamDialog = page.getByRole('dialog'); await teamDialog.getByLabel('Název týmu').fill('QA tým'); await teamDialog.getByRole('button', { name: 'Přidat tým', exact: true }).click(); await expect(teamDialog).toHaveCount(0);
    await page.getByRole('link',{name:'Spravovat týmy a registrace',exact:true}).click();await page.getByLabel('Otevření',{exact:true}).fill('2020-01-01T00:00');await page.getByLabel('Uzavření',{exact:true}).fill('2031-07-20T18:30');await page.getByLabel('Zveřejnit registraci').check();await page.getByRole('button',{name:'Uložit nastavení',exact:true}).click();await expect(page.getByText('Nastavení registrací bylo uloženo.')).toBeVisible();
    const publicPage=await browser.newPage();await publicPage.goto(origin+'/events/'+eventId);await publicPage.getByLabel('Název týmu *',{exact:true}).fill('QA online tým');await publicPage.getByLabel(/^Počet členů/).fill('2');await publicPage.getByLabel('E-mail *',{exact:true}).fill('qa-public@example.test');await publicPage.getByRole('button',{name:'Přihlásit tým',exact:true}).click();await expect(publicPage.getByRole('heading',{name:'Děkujeme, tým byl přihlášen.'})).toBeVisible();
    const oldLink=await publicPage.getByRole('link',{name:'Spravovat registraci'}).getAttribute('href');await publicPage.goto(origin+'/events/'+eventId);await publicPage.getByLabel('Název týmu *',{exact:true}).fill('QA opožděný tým');await publicPage.getByLabel(/^Počet členů/).fill('2');await publicPage.getByLabel('E-mail *',{exact:true}).fill('qa-stale@example.test');
    await page.goto('/admin/events/'+eventId); await menu('Zrušit akci'); await page.getByRole('dialog').getByLabel('Soukromý důvod zrušení').fill('Soukromá QA poznámka'); await page.getByRole('dialog').getByLabel('Zpráva pro veřejnost (volitelné)').fill('QA akce se nekoná.'); await expect(page.getByRole('dialog').getByRole('button', { name: 'Zrušit akci', exact: true })).toBeEnabled(); await page.screenshot({ path: screenshots + '/cancel-dialog.png' });
    if(person.rawCall) {
      const [registration] = await Promise.all([person.rawCall('createEventRegistration',{eventId,teamName:'QA souběh',memberCount:2,contactEmail:'qa-race@example.test',requestKey:randomBytes(32).toString('base64url')},null),confirm('Zrušit akci')]);
      if(!registration.data.error) expectedTeams++;
      else expect(['FAILED_PRECONDITION','ABORTED']).toContain(registration.data.error.status);
      const afterCancel=person.digest(await person.readRaw('events/'+eventId));
      await Promise.all([person.call('cancelEvent',cancelRequest),person.call('cancelEvent',cancelRequest)]);
      expect(person.digest(await person.readRaw('events/'+eventId))).toBe(afterCancel);
      await expect(person.call('cancelEvent',{...cancelRequest,requestId:randomUUID()})).rejects.toThrow('ABORTED');
      person.evidence('concurrency',{registrationBeforeCancellation:!registration.data.error,duplicateCancellation:'no-op',staleRevision:'denied'});
    } else await confirm('Zrušit akci');
    await expect(page.getByText('Akce byla zrušena. Účastníci nebyli automaticky upozorněni.')).toBeVisible();
    await publicPage.getByRole('button',{name:'Přihlásit tým',exact:true}).click();await expect(publicPage.getByRole('alert')).toBeVisible();await publicPage.goto(origin+oldLink);await expect(publicPage.getByRole('alert')).toBeVisible();await expect(publicPage.getByRole('button',{name:'Uložit změny',exact:true})).toHaveCount(0);await publicPage.close();
    const anonymous = await browser.newPage(); await anonymous.goto(origin + '/events/' + eventId); await expect(anonymous.getByRole('heading', { name: 'Akce byla zrušena' })).toBeVisible(); await expect(anonymous.getByText('Soukromá QA poznámka')).toHaveCount(0); await anonymous.close();
    await menu('Vrátit do přípravy'); await confirm('Vrátit do přípravy'); expect((await person.db.doc('events/' + eventId).get()).get('registrationPublished')).toBe(false); await menu('Zrušit akci'); await confirm('Zrušit akci');
    await menu('Archivovat'); await confirm('Archivovat'); await menu('Vrátit z archivu'); await confirm('Vrátit z archivu');
    await menu('Přesunout do koše'); await confirm('Přesunout do koše');
    await page.goto('/admin/events'); await expect(page.getByRole('link', { name: new RegExp(title) })).toHaveCount(0); await page.getByRole('button', { name: /^Koš/ }).click(); await page.screenshot({ path: screenshots + '/trash.png', fullPage: true }); await page.locator('.event-card-main').filter({ hasText: title }).click();
    await menu('Obnovit'); await confirm('Obnovit'); expect((await person.db.doc('events/' + eventId).get()).get('lifecycleStatus')).toBe('cancelled'); expect((await person.db.collection('events/' + eventId + '/registrations').get()).size).toBe(expectedTeams);
    await menu('Přesunout do koše'); await confirm('Přesunout do koše'); await menu('Trvale smazat'); const deletion = page.getByRole('dialog'); await deletion.getByLabel('Opište název akce').fill('jiná akce'); await deletion.getByLabel('Vaše současné heslo').fill(person.password); await expect(deletion.getByRole('button', { name: 'Trvale smazat', exact: true })).toBeDisabled(); await deletion.getByLabel('Opište název akce').fill(title); await expect(deletion.getByRole('button', { name: 'Trvale smazat', exact: true })).toBeEnabled(); await page.screenshot({ path: screenshots + '/delete-dialog.png' });
    if (person.deletionFault) {
      await person.deletionFault(eventId);await deletion.getByRole('button',{name:'Trvale smazat',exact:true}).click();await expect(deletion.getByRole('alert')).toBeVisible();expect((await person.db.doc('events/'+eventId).get()).get('disposition')).toBe('deleting');
      await expect(person.call('restoreEvent',{eventId,expectedRevision:(await person.db.doc('events/'+eventId).get()).get('revision'),action:'restore'})).rejects.toThrow();
      await expect(person.call('adminAddEventTeam',{eventId,requestId:randomUUID(),teamName:'QA delayed write',memberCount:2})).rejects.toThrow('FAILED_PRECONDITION');
      await person.deletionFault(eventId,true);await page.reload();await menu('Pokračovat v mazání');await page.getByRole('dialog').getByLabel('Opište název akce').fill(title);await page.getByRole('dialog').getByLabel('Vaše současné heslo').fill(person.password);
    }
    await confirm('Trvale smazat'); await expect(page).toHaveURL(/\/admin\/events$/);
    expect((await person.db.doc('events/' + eventId).get()).exists).toBe(false); expect((await person.db.doc('events/' + eventId).listCollections()).length).toBe(0); expect((await person.db.doc('eventTombstones/' + eventId).get()).exists).toBe(true);
    if(person.rawCall) { expect(deletionRequest).toBeTruthy(); await person.reauthenticate(); const replies=await Promise.all([person.call('deleteEvent',deletionRequest),person.call('deleteEvent',deletionRequest)]);expect(replies[0]).toEqual(replies[1]);person.evidence('deletion-noop',{eventId,repeated:true,children:0}); }
  } finally {
    if (eventId) { await person.db.recursiveDelete(person.db.doc('events/' + eventId)); await person.db.doc('publicEvents/' + eventId).delete(); }
    await context.close(); await person.dispose();
  }
});

test('normal UI: shared media quiz, live cancellation, completed archive and scoped stale-token denials', async ({ browser }) => {
  const person = await identity(), context = await browser.newContext({ baseURL: origin, viewport: { width: 1366, height: 900 } });
  const page = await context.newPage(), prefix = 'QA Sdílený ' + randomUUID().slice(0,8), ids=[];
  let quizId;
  const menu = async name => { await page.locator('.event-actions summary').click(); await page.locator('.event-actions').getByRole('button',{name,exact:true}).click(); };
  const confirm = async name => { const dialog=page.getByRole('dialog'); await expect(dialog.getByRole('button',{name,exact:true})).toBeEnabled();await dialog.getByRole('button',{name,exact:true}).click();await expect(dialog).toHaveCount(0); };
  const save = async () => { await page.getByRole('button',{name:'Uložit vše',exact:true}).click(); await expect(page.locator('.save-state')).toHaveText('Uloženo'); };
  async function createEvent(label) {
    await page.goto('/admin/events/new'); await page.getByLabel('Název akce',{exact:true}).fill(prefix+label);await page.getByLabel('Datum a čas v Praze').fill('2031-07-20T19:30');await page.getByLabel('Místo',{exact:true}).fill('QA sál');await page.getByLabel('Veřejné upřesnění místa').fill('Praha');await page.getByRole('button',{name:'Vytvořit akci',exact:true}).click();await expect(page.getByRole('heading',{name:'Upravit akci',exact:true})).toBeVisible();
    const id=page.url().split('/').at(-1); ids.push(id); await person.db.doc('events/'+id).get();
    await page.getByTestId('event-quiz-assignment').getByRole('combobox').selectOption(quizId);const warning=page.getByLabel('Potvrzuji upozornění pro tuto verzi kvízu.');if(await warning.count())await warning.check();await page.getByRole('button',{name:'Zkontrolovat a připravit',exact:true}).click();await expect(page.getByText('Kvíz byl zkontrolován a připraven.',{exact:true})).toBeVisible();
    await page.getByRole('button',{name:'+ Přidat tým',exact:true}).click();const d=page.getByRole('dialog');await d.getByLabel('Název týmu').fill('QA tým '+label.trim());await d.getByRole('button',{name:'Přidat tým',exact:true}).click();await expect(d).toHaveCount(0);await page.reload();return id;
  }
  try {
    await page.goto('/admin/login');await page.getByLabel('E-mail',{exact:true}).fill(person.email);await page.getByLabel('Heslo',{exact:true}).fill(person.password);await page.getByRole('button',{name:'Přihlásit se',exact:true}).click();await expect(page).toHaveURL(/\/admin$/);
    await page.goto('/admin/quizzes/new');await page.getByLabel('Název kvízu').fill(prefix);await page.getByRole('button',{name:'Vytvořit',exact:true}).click();await expect(page).toHaveURL(/\/edit$/);quizId=page.url().split('/').at(-2);await person.db.doc('quizzes/'+quizId).get();
    await page.getByRole('button',{name:'+ Přidat kolo',exact:true}).click();await page.getByLabel('Název kola *').fill('QA kolo');await save();await page.locator('.outline-round').getByRole('button',{name:'+ Přidat otázku',exact:true}).click();await page.getByRole('dialog',{name:/Typ otázky/}).getByRole('button',{name:'Obrázek',exact:true}).click();await page.getByLabel('Otázka *',{exact:true}).fill('QA Soukromá otázka');await page.getByLabel('Způsob odpovědi').selectOption('open');await page.getByLabel('Správná odpověď *',{exact:true}).fill('QA_PRIVATE_ANSWER');await page.getByLabel('Obrázek otázky — soubor',{exact:true}).setInputFiles({name:'qa-shared.png',mimeType:'image/png',buffer:syntheticImage()});await expect(page.getByRole('button',{name:'Zrušit nahrávání'})).toHaveCount(0);await save();
    await page.locator('.outline-round').getByRole('button',{name:'+ Přidat otázku',exact:true}).click();await page.getByRole('dialog',{name:/Typ otázky/}).getByRole('button',{name:'Audio',exact:true}).click();await page.getByLabel('Otázka *',{exact:true}).fill('QA Audio');await page.getByLabel('Správná odpověď *',{exact:true}).fill('QA_AUDIO_ANSWER');await page.getByLabel('Zdroj ukázky — soubor',{exact:true}).setInputFiles({name:'qa-shared.wav',mimeType:'audio/wav',buffer:syntheticAudio(30)});await expect(page.getByRole('button',{name:'Zrušit nahrávání'})).toHaveCount(0);await page.getByLabel('Začátek ukázky *').fill('0:01');await page.getByLabel('Konec ukázky *').fill('0:25');await page.getByLabel('Konec ukázky *').press('Tab');await save();
    await page.getByRole('button',{name:'+ Závěrečná obrazovka',exact:true}).click();await page.getByLabel('Titulek',{exact:true}).fill('QA konec');await save();
    const a=await createEvent(' A'), b=await createEvent(' B');
    const beforeB=(await person.db.doc('events/'+b).get()).data(), library=(await person.db.doc('quizzes/'+quizId).get()).data();
    const preserved = person.readRaw ? { event: person.digest(await person.readRaw('events/'+b)), library:person.digest(await person.readRaw('quizzes/'+quizId)) } : null;
    const assignmentA=(await person.db.doc('events/'+a).get()).get('quizAssignment');
    await person.db.doc('quizSnapshots/'+assignmentA.snapshotId).get();
    // A: real UI live start, trash blocked, explicit end-and-cancel neutralizes the projector.
    await page.goto('/admin/events/'+a);await page.getByRole('button',{name:'Otevřít moderování akce',exact:true}).click();await expect(page).toHaveURL(/\/admin\/live\//);const sessionId=page.url().split('/').at(-1);await person.db.doc('sessions/'+sessionId).get();await page.getByRole('button',{name:'Další →',exact:true}).click();
    const projector=await browser.newPage();await projector.goto(origin+'/projector/'+sessionId);
    const staleControl=await context.newPage();await staleControl.goto('/admin/live/'+sessionId);
    for(let step=0;step<10&&!await staleControl.getByRole('button',{name:'Play',exact:true}).count();step++) await Promise.all([staleControl.waitForResponse(r=>r.url().endsWith('/nextSlide')&&r.request().method()==='POST'),staleControl.getByRole('button',{name:'Další →',exact:true}).click()]);
    await staleControl.getByRole('button',{name:'Play',exact:true}).click();await expect.poll(()=>staleControl.locator('audio').evaluateAll(items=>items.some(a=>!a.paused&&a.currentTime>1))).toBe(true);
    const staleRevision=(await person.db.doc('sessions/'+sessionId).get()).get('revision');
    await page.goto('/admin/events/'+a);await page.locator('.event-actions summary').click();await expect(page.locator('.event-actions').getByRole('button',{name:'Přesunout do koše',exact:true})).toBeDisabled();await page.locator('.event-actions').getByRole('button',{name:'Zrušit akci',exact:true}).click();await page.getByRole('dialog').getByRole('checkbox').check();await confirm('Ukončit běh a zrušit akci');
    await expect.poll(()=>staleControl.locator('audio').evaluateAll(items=>items.every(a=>a.paused))).toBe(true);await staleControl.close();
    expect((await person.db.doc('publicSessions/'+sessionId).get()).get('status')).toBe('ended');await expect(projector.getByText('QA_PRIVATE_ANSWER')).toHaveCount(0);await projector.close();await expect(person.call('nextSlide',{sessionId,expectedRevision:staleRevision})).rejects.toThrow();
    await menu('Přesunout do koše');await confirm('Přesunout do koše');await menu('Trvale smazat');await page.getByRole('dialog').getByLabel('Opište název akce').fill(prefix+' A');await page.getByRole('dialog').getByLabel('Vaše současné heslo').fill(person.password);await confirm('Trvale smazat');
    expect((await person.db.doc('events/'+b).get()).get('revision')).toBe(beforeB.revision);expect((await person.db.doc('quizzes/'+quizId).get()).get('revision')).toBe(library.revision);expect((await person.db.doc('quizSnapshots/'+assignmentA.snapshotId).get()).exists).toBe(false);
    if (preserved) { const after={event:person.digest(await person.readRaw('events/'+b)),library:person.digest(await person.readRaw('quizzes/'+quizId))};expect(after).toEqual(preserved);person.evidence('shared-preservation',{before:preserved,after}); }
    // B still uses the same library asset; its normal completed/archived path retains scores and snapshot.
    await page.goto('/admin/events/'+b+'/scoring');await page.getByLabel('Body — QA tým B',{exact:true}).fill('1');await Promise.all([page.waitForResponse(r=>r.url().endsWith('/saveEventScore')&&r.request().method()==='POST'),page.getByRole('button',{name:'Uložit',exact:true}).click()]);
    await page.goto('/admin/events/'+b);await page.getByRole('button',{name:'Otevřít moderování akce',exact:true}).click();await expect(page).toHaveURL(/\/admin\/live\//);await page.getByRole('button',{name:'Další →',exact:true}).click();page.once('dialog',d=>d.accept());await Promise.all([page.waitForResponse(r=>r.url().endsWith('/endLiveSession')&&r.request().method()==='POST'),page.getByRole('button',{name:'Ukončit kvíz',exact:true}).click()]);await page.goto('/admin/events/'+b);expect((await person.db.doc('events/'+b).get()).get('lifecycleStatus')).toBe('completed');
    const scoreCount=(await person.db.collection('events/'+b+'/scores').get()).size;await menu('Archivovat');await confirm('Archivovat');await menu('Vrátit z archivu');await confirm('Vrátit z archivu');expect((await person.db.collection('events/'+b+'/scores').get()).size).toBe(scoreCount);expect((await person.db.doc('events/'+b).get()).get('quizAssignment.snapshotId')).toBe(beforeB.quizAssignment.snapshotId);
    await page.goto('/admin/quizzes/'+quizId+'/edit');await page.locator('.outline-question').filter({hasText:'QA Soukromá otázka'}).click();await page.getByRole('button',{name:'Náhled',exact:true}).click();await expect.poll(()=>page.locator('.round-editor-preview .question-image-frame img').evaluate(img=>img.naturalWidth)).toBe(8);
    if(person.patchMembership) {
      await person.patchMembership({events:{mode:'selected',ids:[a]}});await expect(person.call('readAccessData',{operation:'event',eventId:b})).rejects.toThrow();const list=await person.call('readAccessData',{operation:'eventPage'});expect(list.items).toHaveLength(0);
      await person.patchMembership({events:{mode:'selected',ids:[b]},permissions:['event.read','event.manage']});await expect(person.call('deleteEvent',{eventId:b,expectedRevision:1,confirmTitle:prefix+' B'})).rejects.toThrow();await person.patchMembership({permissions:[]});await expect(person.call('trashEvent',{eventId:b,expectedRevision:1})).rejects.toThrow();await person.patchMembership({status:'suspended'});await expect(person.call('readAccessData',{operation:'event',eventId:b})).rejects.toThrow();
    }
  } finally {
    await page.screenshot({path:'.local-data/event-management/shared-ui-final.png',fullPage:true}).catch(()=>{});
    await context.close();
    if (!person.origin) { for(const id of ids) await person.db.recursiveDelete(person.db.doc('events/'+id)); if(quizId) await person.db.recursiveDelete(person.db.doc('quizzes/'+quizId)); }
    await person.dispose();
  }
});
