import {strict as assert} from 'node:assert';
import {randomUUID} from 'node:crypto';
import {editorIdentity} from './editor-identity.mjs';
import {mediaSlide} from './media-fixture.mjs';
const admin=await editorIdentity(),moderator=await editorIdentity('moderator'),viewer=await editorIdentity('viewer');let quizId,eventId;
const denied=(p,code)=>assert.rejects(p,e=>e.code==='functions/'+code);
try {
  ({quizId}=await admin.call('createQuiz',{title:'Draft boundary synthetic',requestId:randomUUID()}));
  const qref=admin.db.doc('quizzes/'+quizId),revision=async()=>(await qref.get()).get('revision');
  for(const actor of [moderator,viewer])await denied(actor.call('createQuizRound',{quizId,expectedRevision:0,title:'Forbidden'}),'permission-denied');
  await admin.call('createQuizRound',{quizId,expectedRevision:0,title:'First'});await denied(admin.call('createQuizRound',{quizId,expectedRevision:0,title:'First'}),'aborted');assert.equal((await qref.collection('rounds').get()).size,1);
  await denied(admin.call('createQuizSlide',{quizId,expectedRevision:await revision(),position:4,scope:'quiz',slide:mediaSlide('free')}),'invalid-argument');
  const end=await admin.call('createQuizSlide',{quizId,expectedRevision:await revision(),position:4,scope:'quiz',slide:mediaSlide('end')});assert.equal((await qref.collection('slides').doc(end.selectedSlideId).get()).get('roundId'),undefined);
  const incomplete=mediaSlide('free',{authoringStatus:'draft',answerMode:'open',correctAnswer:'',text:'Private incomplete draft'});
  const created=await admin.call('createQuizSlide',{quizId,expectedRevision:await revision(),position:3,slide:incomplete});
  const slideId=created.selectedSlideId;assert.equal((await qref.collection('slides').doc(slideId).get()).get('authoringStatus'),'draft');
  const duplicated=await admin.call('duplicateQuizSlide',{quizId,slideId,expectedRevision:await revision()});assert.equal((await qref.collection('slides').doc(duplicated.selectedSlideId).get()).get('authoringStatus'),'draft');
  for(const actor of [moderator,viewer])await denied(actor.call('updateQuizSlide',{quizId,slideId,expectedRevision:await revision(),slide:{...incomplete,authoringStatus:'ready',correctAnswer:'answer'}}),'permission-denied');
  await denied(admin.call('updateQuizSlide',{quizId,slideId,expectedRevision:await revision(),slide:{...incomplete,authoringStatus:'ready'}}),'invalid-argument');
  await denied(admin.call('updateQuizSlide',{quizId,slideId,expectedRevision:await revision(),slide:{...incomplete,clipStartSeconds:9,clipEndSeconds:1}}),'invalid-argument');
  await denied(admin.call('createLiveSession',{quizId}),'failed-precondition');
  ({eventId}=await admin.call('createEvent',{expectedRevision:0,event:{title:'Draft boundary event',startsAt:'2031-11-20T18:00:00Z',timeZone:'Europe/Prague',venue:{name:'Synthetic',publicLocation:'Synthetic'},teamCapacity:30,peopleCapacity:120,teamSizeMin:2,teamSizeMax:6}}));
  const event=admin.db.doc('events/'+eventId);await denied(admin.call('lockEventQuiz',{eventId,quizId,expectedRevision:(await event.get()).get('revision'),expectedQuizRevision:await revision(),acknowledgeWarnings:true}),'failed-precondition');assert.equal((await event.get()).get('quizAssignment')==null,true);
  const before=await revision();await admin.call('updateQuizSlide',{quizId,slideId,expectedRevision:before,slide:{...incomplete,authoringStatus:'ready',correctAnswer:'Completed answer'}});
  await denied(admin.call('updateQuizSlide',{quizId,slideId,expectedRevision:before,slide:incomplete}),'aborted');assert.equal((await qref.collection('slides').doc(slideId).get()).get('authoringStatus'),'ready');
  await denied(admin.call('createLiveSession',{quizId}),'failed-precondition');
  console.log('PASS: draft shape, role, revision, duplicate preservation, strict completion, duplicate round retry, live and snapshot rejection, no assignment written');
}finally{if(quizId)await admin.db.recursiveDelete(admin.db.doc('quizzes/'+quizId));if(eventId){await admin.db.recursiveDelete(admin.db.doc('events/'+eventId));await admin.db.doc('publicEvents/'+eventId).delete();}await Promise.all([admin.dispose(),moderator.dispose(),viewer.dispose()]);}
