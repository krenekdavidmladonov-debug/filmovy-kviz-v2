import { strict as assert } from 'node:assert';
import { ref, uploadBytes, getBytes, listAll, deleteObject, updateMetadata } from 'firebase/storage';
import { mediaFixture, syntheticAudio, syntheticImage, mediaSlide } from './media-fixture.mjs';
let f,phase='fixture';
const denied=(promise,code)=>assert.rejects(promise,error=>error.code===code);
try {
  f=await mediaFixture();const image=syntheticImage(),audio=syntheticAudio();const moderator=await f.roleClient('moderator');
  phase='upload rules';
  await denied(f.begin('image',image,'image/png',f.anonymous),'functions/unauthenticated');await denied(f.begin('image',image,'image/png',moderator),'functions/permission-denied');
  const pending=await f.begin('image',image,'image/png');
  for(const who of [f.anonymous,moderator])await denied(uploadBytes(ref(who.storage,pending.path),image,{contentType:'image/png'}),'storage/unauthorized');
  await denied(uploadBytes(ref(f.admin.storage,pending.path),image,{contentType:'text/html'}),'storage/unauthorized');
  await denied(uploadBytes(ref(f.admin.storage,pending.path),image.subarray(0,10),{contentType:'image/png'}),'storage/unauthorized');
  await denied(uploadBytes(ref(f.admin.storage,pending.path.replace(f.quizId,'other-quiz')),image,{contentType:'image/png'}),'storage/unauthorized');
  await uploadBytes(ref(f.admin.storage,pending.path),image,{contentType:'image/png'});
  await denied(f.update('image',{questionImage:pending.reference}),'functions/failed-precondition');
  await f.admin.call('finalizeQuizMediaUpload',{quizId:f.quizId,assetId:pending.assetId});
  for(const who of [f.anonymous,f.admin,moderator]) {await denied(getBytes(ref(who.storage,pending.path)),'storage/unauthorized');await denied(listAll(ref(who.storage,'quiz-assets')),'storage/unauthorized');}
  await denied(uploadBytes(ref(f.admin.storage,pending.path),image,{contentType:'image/png'}),'storage/unauthorized');await denied(deleteObject(ref(f.admin.storage,pending.path)),'storage/unauthorized');await denied(updateMetadata(ref(f.admin.storage,pending.path),{contentType:'text/html'}),'storage/unauthorized');
  console.log('PASS: Storage create authorization, exact MIME/size/quiz target, ready boundary, no direct read/list/overwrite/delete');
  phase='content validation';
  await denied(f.admin.call('beginQuizMediaUpload',{quizId:f.quizId,requestId:'oversize',kind:'image',contentType:'image/png',size:10485761}),'functions/invalid-argument');
  const fake=Buffer.from('<html>not an image</html>');const bad=await f.begin('image',fake,'image/png');await uploadBytes(ref(f.admin.storage,bad.path),fake,{contentType:'image/png'});await denied(f.admin.call('finalizeQuizMediaUpload',{quizId:f.quizId,assetId:bad.assetId}),'functions/failed-precondition');
  const sound=await f.upload('audio',audio,'audio/wav');await f.update('image',{questionImage:pending.reference});await f.update('audio',{mediaSource:sound.reference});
  await denied(f.update('audio',{questionImage:sound.reference,mediaSource:sound.reference}),'functions/invalid-argument');
  await denied(f.update('image',{questionImage:sound.reference}),'functions/failed-precondition');
  const q=(await f.quizRef.get()).data();await denied(f.admin.call('updateQuizSlide',{quizId:f.quizId,slideId:f.ids.image,expectedRevision:q.revision,slide:mediaSlide('image',{questionImage:pending.reference.replace(f.quizId,'other-quiz')})}),'functions/invalid-argument');
  console.log('PASS: actual content signature, oversized declaration, audio upload, cross-quiz/type/conflicting slot denial');
  phase='snapshot and reveal';const answer=await f.upload('image',image,'image/png'),background=await f.upload('image',image,'image/png'); await f.update('image',{questionImage:pending.reference,answerImage:answer.reference,backgroundImage:background.reference}); const snapshotId=await f.lock();const replacement=await f.upload('image',image,'image/png');await f.update('image',{questionImage:replacement.reference});
  assert.equal((await f.db.doc('quizSnapshots/'+snapshotId+'/slides/'+f.ids.image).get()).data().questionImage,pending.reference);
  const sessionId=await f.live();assert.equal((await f.read(pending.reference,{sessionId})).status,404);
  await f.navigate(sessionId,3);const shown=await f.read(pending.reference,{sessionId});assert.equal(shown.status,200);assert.equal(shown.headers.get('x-content-type-options'),'nosniff');assert.deepEqual(Buffer.from(await shown.arrayBuffer()),image);
  assert.equal((await f.read(background.reference,{sessionId})).status,200); assert.equal((await f.read(answer.reference,{sessionId})).status,404);
  const beforeReveal=(await f.db.doc('publicSessions/'+sessionId).get()).data(); assert.equal(JSON.stringify(beforeReveal).includes(answer.reference),false);
  const active=(await f.db.doc('sessions/'+sessionId).get()).data(); await f.admin.call('revealAnswer',{sessionId,expectedRevision:active.revision}); assert.equal((await f.read(answer.reference,{sessionId})).status,200);
  assert.equal((await f.read(replacement.reference,{sessionId})).status,404);assert.equal((await f.read(sound.reference,{sessionId})).status,404);
  await f.navigate(sessionId,4); assert.equal((await f.read(answer.reference,{sessionId})).status,404); assert.equal((await f.read(background.reference,{sessionId})).status,404);assert.equal((await f.read(sound.reference,{sessionId,range:'bytes=0-15'})).status,404);
  const raw=(await f.db.doc('publicSessions/'+sessionId).get()).data();assert.equal(raw.mediaSource,undefined);assert.equal(JSON.stringify(raw).includes('Soukromá odpověď'),false);
  assert.equal((await f.read(sound.reference,{who:f.anonymous})).status,403);assert.equal((await f.read(sound.reference,{who:moderator})).status,200);
  await f.navigate(sessionId,5);const session=(await f.db.doc('sessions/'+sessionId).get()).data();await f.admin.call('selectRecapQuestion',{sessionId,expectedRevision:session.revision,position:4});
  const range=await f.read(sound.reference,{sessionId,range:'bytes=0-15'});assert.equal(range.status,206);assert.equal(range.headers.get('content-range'),'bytes 0-15/'+audio.length);assert.equal((await range.arrayBuffer()).byteLength,16);
  assert.equal((await f.read(sound.reference,{sessionId,range:'bytes=999999-'})).status,416);
  await f.navigate(sessionId,6);assert.equal((await f.read(sound.reference,{sessionId})).status,404);
  console.log('PASS: immutable event asset after library edit, exact current public projection, ordinary audio withheld, recap and Range, navigation revocation');
} catch(error){console.error('Media contract failed during: '+phase+'; code: '+String(error?.code??error?.name));throw error;}
finally {if(f)await f.dispose();}
