import { test, expect } from '@playwright/test';
import { performance } from 'node:perf_hooks';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { editorIdentity } from '../e2e/editor-identity.mjs';
import { mediaSlide } from '../e2e/media-fixture.mjs';

test('comparable editor and moderator performance on separate synthetic fixture', async ({page,context,browser,baseURL}) => {
  const identity=await editorIdentity(), phase=process.env.WHOLE_EVENING_PHASE||'current';
  const quizId='whole-evening-performance-'+randomUUID(); let sessionId, publicContext;
  const count=60, samples={coldAdminNavigationMs:[],coldEditorNavigationMs:[],adminNavigationMs:[],editorNavigationMs:[],selectionMs:[],previewMs:[],saveMs:[],liveTransitionMs:[]};
  const loopback=async c=>c.route('**/*',r=>['localhost','127.0.0.1'].includes(new URL(r.request().url()).hostname)?r.continue():r.abort());
  try {
    await loopback(context);
    const ref=identity.db.doc('quizzes/'+quizId), batch=identity.db.batch();
    batch.set(ref,{title:'Synthetic comparable performance',description:'Technical load fixture only',revision:0,slideCount:count+2,questionCount:count,roundCount:1,status:'draft',createdAt:new Date(),updatedAt:new Date()});
    batch.set(ref.collection('rounds').doc('r1'),{title:'Synthetic round',position:1,questionCount:count});
    batch.set(ref.collection('slides').doc('round'),{...mediaSlide('round'),position:1,roundId:'r1',isQuestion:false,title:'Synthetic round'});
    for(let i=0;i<count;i++)batch.set(ref.collection('slides').doc('q'+i),{...mediaSlide('free',{text:'Synthetic load question '+i,correctAnswer:'Private synthetic answer '+i,authoringStatus:'ready',answerMode:'open'}),position:i+2,roundId:'r1',isQuestion:true,questionNumber:i+1,questionCount:count});
    batch.set(ref.collection('slides').doc('recap'),{...mediaSlide('recap'),position:count+2,roundId:'r1',isQuestion:false}); await batch.commit();
    await page.goto('/admin/login');await page.getByLabel('E-mail').fill(identity.email);await page.getByLabel('Heslo').fill(identity.password);await page.getByRole('button',{name:'Přihlásit se',exact:true}).click();await expect(page).toHaveURL(/\/admin$/);
    const storageState=await context.storageState({indexedDB:true});
    for(let i=0;i<3;i++)for(const surface of ['admin','editor']){
      const cold=await browser.newContext({baseURL,storageState});await loopback(cold);const coldPage=await cold.newPage();
      const start=performance.now();await coldPage.goto(surface==='admin'?'/admin':'/admin/quizzes/'+quizId+'/edit');
      if(surface==='admin')await expect(coldPage.getByRole('link',{name:'Kvízy',exact:true})).toBeVisible();else await expect(coldPage.locator('.outline-question')).toHaveCount(count);
      samples[surface==='admin'?'coldAdminNavigationMs':'coldEditorNavigationMs'].push(performance.now()-start);await cold.close();
    }
    for(let i=0;i<5;i++){
      let start=performance.now();await page.goto('/admin');await expect(page.getByRole('link',{name:'Kvízy',exact:true})).toBeVisible();samples.adminNavigationMs.push(performance.now()-start);
      start=performance.now();await page.goto('/admin/quizzes/'+quizId+'/edit');await expect(page.locator('.outline-question')).toHaveCount(count);samples.editorNavigationMs.push(performance.now()-start);
    }
    const labels=new Map();
    for(let i=0;i<24;i++){
      const index=i*17%count,label=labels.get(index)||'Synthetic load question '+index;let start=performance.now();
      await page.locator('.outline-question').nth(index).click();await expect(page.getByLabel('Otázka *',{exact:true})).toHaveValue(label);samples.selectionMs.push(performance.now()-start);
      start=performance.now();await page.getByRole('button',{name:'Náhled',exact:true}).click();await expect(page.locator('.round-editor-preview .slide-copy')).toContainText(label);samples.previewMs.push(performance.now()-start);await page.getByRole('button',{name:'Obsah',exact:true}).click();
      if(i%4===0){const revised=label+' revised';start=performance.now();await page.getByLabel('Otázka *',{exact:true}).fill(revised);await page.getByRole('button',{name:'Uložit vše',exact:true}).click();await expect(page.locator('.save-state')).toHaveText('Uloženo');samples.saveMs.push(performance.now()-start);labels.set(index,revised);}
    }
    sessionId=(await identity.call('createLiveSession',{quizId})).sessionId;
    publicContext=await browser.newContext({baseURL});await loopback(publicContext);const projector=await publicContext.newPage();await projector.goto('/projector/'+sessionId);
    await page.goto('/admin/live/'+sessionId);await expect(page.locator('.live-control')).toBeVisible();
    for(let i=0;i<12;i++){
      const start=performance.now();await Promise.all([page.waitForResponse(r=>r.url().endsWith('/nextSlide')&&r.request().method()==='POST'),page.getByRole('button',{name:'Další →',exact:true}).click()]);
      const state=(await identity.db.doc('sessions/'+sessionId).get()).data();await expect(page.locator('.live-control')).toHaveAttribute('data-current-position',String(state.currentSlidePosition));
      const published=(await identity.db.doc('publicSessions/'+sessionId).get()).data();await expect(projector.locator('.slide-renderer')).toContainText(published.text||published.title);samples.liveTransitionMs.push(performance.now()-start);
    }
    const summary=Object.fromEntries(Object.entries(samples).map(([key,values])=>{const sorted=[...values].sort((a,b)=>a-b);return [key,{n:values.length,min:sorted[0],median:sorted[Math.floor(sorted.length/2)],p95:sorted[Math.ceil(sorted.length*.95)-1],max:sorted.at(-1)}];}));
    await mkdir('.local-data/whole-evening/evidence',{recursive:true});await writeFile('.local-data/whole-evening/evidence/performance-'+phase+'.json',JSON.stringify({phase,source:phase==='baseline'?'03476da archived source and backend':'working tree integrated source',environment:'same machine, pinned Chromium, production Vite preview, demo emulators',fixture:'separate synthetic 60 free-answer question fixture; no design overlays',method:'cold navigation: fresh authenticated context with empty asset cache,3 samples each; normal navigation: same warmed authenticated context,5 samples each; first save/live sample includes endpoint cold initialization',samples,summary},null,2));
  } finally {await publicContext?.close();if(sessionId){await identity.db.recursiveDelete(identity.db.doc('sessions/'+sessionId));await identity.db.doc('publicSessions/'+sessionId).delete();}await identity.db.recursiveDelete(identity.db.doc('quizzes/'+quizId));await identity.dispose();}
});
