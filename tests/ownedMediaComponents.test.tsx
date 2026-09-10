// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { MediaPlayer } from '../apps/web/src/features/presentation/MediaPlayer';
import { AssetImage } from '../apps/web/src/features/media/AssetImage';
import { readQuizMediaBlob } from '../apps/web/src/features/media/mediaApi';
vi.mock('../apps/web/src/features/media/mediaApi', () => ({readQuizMediaBlob:vi.fn()}));
const source='quiz-asset:quiz-1/'+'a'.repeat(64), nextSource='quiz-asset:quiz-1/'+'b'.repeat(64);
let root:Root,host:HTMLDivElement;
const playMock=vi.fn<()=>Promise<void>>(), revokeMock=vi.fn();
const playback=vi.fn(),finished=vi.fn(),failed=vi.fn();
const render=(command:'idle'|'play'|'replay'|'stop',generation=1,reference=source)=>act(async()=>root.render(<MediaPlayer source={reference} command={command} generation={generation} startSeconds={1} endSeconds={3} onPlaybackState={playback} onFinished={finished} onError={failed}/>));
const event=async(player:HTMLAudioElement,name:string)=>act(async()=>{player.dispatchEvent(new Event(name));});
beforeEach(()=>{
  Object.assign(globalThis,{IS_REACT_ACT_ENVIRONMENT:true});window.__FILMOVY_KVIZ_MEDIA_DEBUG__=undefined;
  host=document.createElement('div');document.body.append(host);root=createRoot(host);
  vi.mocked(readQuizMediaBlob).mockResolvedValue(new Blob(['synthetic'],{type:'audio/wav'}));
  vi.spyOn(URL,'createObjectURL').mockImplementation(()=> 'blob:synthetic-'+Math.random());
  vi.spyOn(URL,'revokeObjectURL').mockImplementation(revokeMock);
  vi.spyOn(HTMLMediaElement.prototype,'duration','get').mockReturnValue(4);
  playMock.mockResolvedValue();vi.spyOn(HTMLMediaElement.prototype,'play').mockImplementation(playMock);
  vi.spyOn(HTMLMediaElement.prototype,'pause').mockImplementation(()=>{});
  vi.spyOn(HTMLMediaElement.prototype,'load').mockImplementation(()=>{});
});
afterEach(async()=>{await act(async()=>root.unmount());host.remove();vi.restoreAllMocks();vi.clearAllMocks();});
test('manual start, END and replay share a single player; late callbacks cannot affect new generation',async()=>{
  await render('idle');const idle=host.querySelector('audio')!;await event(idle,'loadedmetadata');
  expect(playMock).not.toHaveBeenCalled();expect(idle.controls).toBe(false);
  await render('play',2);const playing=host.querySelector('audio')!;await event(playing,'loadedmetadata');await event(playing,'playing');
  expect(playing.currentTime).toBe(1);expect(playback).toHaveBeenLastCalledWith(2,'playing');
  playing.currentTime=3;await event(playing,'timeupdate');await event(playing,'pause');expect(finished).toHaveBeenCalledExactlyOnceWith(2);
  await render('replay',3);await event(playing,'ended');expect(finished).toHaveBeenCalledTimes(1);
  const replay=host.querySelector('audio')!;await event(replay,'loadedmetadata');
  expect(replay.currentTime).toBe(1);expect(window.__FILMOVY_KVIZ_MEDIA_DEBUG__?.peakPlayers).toBe(1);
  await render('stop',4);expect(replay.isConnected).toBe(false);expect(revokeMock).toHaveBeenCalledTimes(3);
});
test('error during playback stays terminal after queued native pause/metadata/playing',async()=>{
  await render('play');const player=host.querySelector('audio')!;await event(player,'loadedmetadata');await event(player,'playing');
  playback.mockClear();await event(player,'error');await event(player,'pause');await event(player,'playing');await event(player,'loadedmetadata');
  expect(failed).toHaveBeenCalledOnce();expect(playback).not.toHaveBeenCalled();
  expect(host.querySelector('[data-media-lifecycle="ERROR"]')).not.toBeNull();
});
test('blocked browser play reports error without falsely claiming playing',async()=>{
  playMock.mockRejectedValue(new Error('NotAllowedError'));
  await render('play');await event(host.querySelector('audio')!,'loadedmetadata');
  expect(failed).toHaveBeenCalledOnce();expect(playback).not.toHaveBeenCalledWith(1,'playing');
});
test('STOP and source changes abort delayed fetch and revoke old image URLs',async()=>{
  let resolve!:(blob:Blob)=>void;
  vi.mocked(readQuizMediaBlob).mockImplementationOnce(()=>new Promise<Blob>(r=>{resolve=r;}));
  await render('play');const signal=vi.mocked(readQuizMediaBlob).mock.calls[0]![1];
  await render('stop',2,nextSource);expect(signal.aborted).toBe(true);await act(async()=>resolve(new Blob(['late'])));
  expect(host.querySelectorAll('audio')).toHaveLength(1);expect(window.__FILMOVY_KVIZ_MEDIA_DEBUG__?.peakPlayers).toBe(1);
  await act(async()=>root.render(<AssetImage source={source} alt="Owned"/>));
  expect(host.querySelector('img')?.src).toMatch(/^blob:/);
  vi.mocked(readQuizMediaBlob).mockRejectedValueOnce(new Error('Denied'));
  await act(async()=>root.render(<AssetImage source={nextSource} alt="Owned"/>));
  expect(host.querySelector('img')).toBeNull();
  await act(async()=>root.render(<AssetImage source="https://example.test/legacy.png" alt="Legacy"/>));
  expect(host.querySelector('img')?.src).toBe('https://example.test/legacy.png');
});
