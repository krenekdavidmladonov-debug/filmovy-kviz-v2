import { eventDisposition, eventOperational, transitionProblem, type EventManagementAction } from '@filmovy-kviz/quiz-domain';
import { EmailAuthProvider, reauthenticateWithCredential } from 'firebase/auth';
import { httpsCallable } from 'firebase/functions';
import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useAuth } from '../../auth/AuthProvider';
import { getFirebaseServices } from '../../services/firebase/client';
import { privateRead } from '../access/api';
import { eventActionError } from './eventApi';
import { getEvent } from './eventRepository';
import type { EventRecord } from './types';
import './eventManagement.css';

const inventoryLabels: Record<string, string> = { registrations: 'Týmy', registrationNames: 'Rezervace názvů týmů', registrationOperations: 'Potvrzení registračních změn', scores: 'Skóre', scoreHistory: 'Historie skóre', scoreOperations: 'Potvrzení bodování', refereeAccess: 'Odkazy rozhodčích', emailIntents: 'Dřívější zprávy', emailSecrets: 'Chráněné odkazy zpráv', emailCampaigns: 'Dřívější rozesílky', eventOperations: 'Potvrzení změn akce', sessionChildren: 'Historie publikovaných výsledků', snapshotChildren: 'Podklady připravených kvízů', retainedSharedSnapshots: 'Sdílené připravené kvízy (zachováme)' };
type Action = EventManagementAction | 'delete';
const labels: Record<Action, string> = { cancel: 'Zrušit akci', prepare: 'Vrátit do přípravy', archive: 'Archivovat', unarchive: 'Vrátit z archivu', trash: 'Přesunout do koše', restore: 'Obnovit', delete: 'Trvale smazat' };
export const eventDate = (date: Date) => new Intl.DateTimeFormat('cs-CZ', { timeZone: 'Europe/Prague', dateStyle: 'medium', timeStyle: 'short' }).format(date);
export const lifecycleLabels = { draft: 'Koncept', scheduled: 'Naplánováno', ready: 'Připraveno', live: 'Probíhá', finalizing: 'Uzavírání', completed: 'Dokončeno', cancelled: 'Zrušeno', archived: 'Archivováno' };
interface Inventory { counts: Record<string, number>; sessions: number; ownedSnapshots: number; storageObjects: number; progress: { state: string; deletedCount: number; phase: number; totalPhases: number; error: string | null; retainedSnapshots: number } | null }
export function EventActions({ event, onChanged }: { event: EventRecord; onChanged: (message: string, deleted?: boolean) => Promise<void> }) {
  const { can } = useAuth();
  const [action, setAction] = useState<Action | null>(null);
  const disposition = eventDisposition(event);
  const actions: Action[] = disposition === 'deleting' ? ['delete'] : disposition === 'trash' ? ['restore', 'delete'] : disposition === 'archived' ? ['unarchive', 'trash'] : [event.lifecycleStatus === 'cancelled' ? 'prepare' : 'cancel', 'archive', 'trash'];
  return <>
    <details className="event-actions"><summary aria-label={`Možnosti akce ${event.title}`}>Možnosti akce</summary><div className="event-action-menu">
      {disposition === 'active' && (can('event.manage') && eventOperational(event) ? <Link to={`/admin/events/${event.id}#event-edit`}>Upravit</Link> : <p>Úpravy nejsou dostupné: {can('event.manage') ? 'akce je uzavřená' : 'chybí právo správy'}.</p>)}
      {actions.map(item => {
        const permitted = can(item === 'delete' ? 'event.delete' : 'event.manage');
        const reason = !permitted ? item === 'delete' ? 'Vyžaduje samostatné právo trvalého mazání.' : 'Vyžaduje právo správy akcí.' : item === 'delete' ? null : transitionProblem({ ...event, hasActiveSession: Boolean(event.liveSessionId) && ['ready', 'live', 'finalizing'].includes(event.lifecycleStatus) }, item);
        return <div key={item}><button type="button" disabled={Boolean(reason)} onClick={() => setAction(item)}>{disposition === 'deleting' && item === 'delete' ? 'Pokračovat v mazání' : labels[item]}</button>{reason && <small>{reason}</small>}</div>;
      })}
    </div></details>
    {action && <ActionDialog key={action} event={event} action={action} onClose={() => setAction(null)} onChanged={onChanged} />}
  </>;
}
function ActionDialog({ event: initial, action, onClose, onChanged }: { event: EventRecord; action: Action; onClose: () => void; onChanged: (message: string, deleted?: boolean) => Promise<void> }) {
  const { can, currentUser } = useAuth();
  const dialog = useRef<HTMLDialogElement>(null), busy = useRef(false);
  const [event, setEvent] = useState(initial), [requestId] = useState(() => crypto.randomUUID());
  const [inventory, setInventory] = useState<Inventory | null>(null), [pending, setPending] = useState(false), [error, setError] = useState<string | null>(null);
  const [reason, setReason] = useState(''), [publicMessage, setPublicMessage] = useState(''), [endLive, setEndLive] = useState(false);
  const [confirmation, setConfirmation] = useState(''), [password, setPassword] = useState('');
  useEffect(() => {
    const modal = dialog.current, previous = document.activeElement;
    modal?.showModal();
    let active = true;
    void privateRead<Inventory>('eventManagement', { eventId: initial.id }).then(value => { if (active) setInventory(value); }).catch(e => { if (active) setError(eventActionError(e)); });
    return () => { active = false; modal?.close(); if (previous instanceof HTMLElement && previous.isConnected) previous.focus(); };
  }, [initial.id]);
  const submit = async () => {
    if (busy.current) return;
    busy.current = true; setPending(true); setError(null);
    try {
      if (action === 'delete') {
        if (!currentUser?.email) throw new Error('Přihlaste se znovu.');
        await reauthenticateWithCredential(currentUser, EmailAuthProvider.credential(currentUser.email, password));
        await currentUser.getIdToken(true);
        setPassword('');
      }
      const name = action === 'delete' ? 'deleteEvent' : action === 'cancel' ? 'cancelEvent' : action === 'archive' ? 'archiveEvent' : action === 'trash' ? 'trashEvent' : 'restoreEvent';
      const result = (await httpsCallable<Record<string, unknown>, { state?: string }>(getFirebaseServices().functions, name, { timeout: 310000 })({ eventId: event.id, expectedRevision: event.revision, requestId, action, reason, publicMessage, endLive, confirmTitle: confirmation })).data;
      if (action === 'delete' && result.state !== 'complete') {
        const refreshed = await getEvent(event.id); if (refreshed) setEvent(refreshed);
        setInventory(await privateRead<Inventory>('eventManagement', { eventId: event.id }));
        setError('Mazání stále probíhá. Hotové dávky zůstaly uložené; znovu ověřte účet a pokračujte.');
        return;
      }
      const message = action === 'cancel' ? 'Akce byla zrušena. Účastníci nebyli automaticky upozorněni.' : action === 'delete' ? 'Akce byla trvale smazána v aplikaci.' : ['prepare', 'restore', 'unarchive'].includes(action) ? 'Akce byla obnovena. Registrace zůstávají uzavřené; staré odkazy a relace se neobnovují.' : action === 'archive' ? 'Akce byla archivována. Výsledky zůstávají zachované.' : 'Akce byla přesunuta do koše. Kvíz a média v knihovně zůstávají zachované.';
      await onChanged(message, action === 'delete'); onClose();
    } catch (e) {
      setError(eventActionError(e));
      if (action === 'delete') {
        const refreshed = await getEvent(event.id).catch(() => null); if (refreshed) setEvent(refreshed);
        setInventory(await privateRead<Inventory>('eventManagement', { eventId: event.id }).catch(() => null));
      }
    } finally { busy.current = false; setPending(false); }
  };
  return <dialog className="team-tool-dialog event-management-dialog" ref={dialog} aria-labelledby="event-action-title" onCancel={e => { e.preventDefault(); if (!busy.current) onClose(); }}>
    <h2 id="event-action-title">{labels[action]}</h2><p><strong>{event.title}</strong><br />{eventDate(event.startsAt)} · {lifecycleLabels[event.lifecycleStatus]}</p>
    {inventory ? <p>{inventory.counts.registrations ?? 0} týmových registrací · {inventory.counts.scores ?? 0} záznamů skóre · {inventory.counts.scoreHistory ?? 0} změn skóre · {inventory.sessions} relací</p> : <p>Ověřuji skutečný rozsah dat…</p>}
    <p>Kvíz „{event.quizAssignment?.quizTitle ?? 'nepřiřazen'}“ a sdílená média v knihovně zůstanou zachované.</p>
    {action === 'cancel' && <p>Registrace, bodování a další provozní zápisy se zastaví. Týmy, snapshoty a výsledky zůstanou zachované. Účastníci neobdrží automatický e-mail.</p>}
    {action === 'trash' && <p>Akce zmizí z běžného použití. Data zůstanou v koši, veřejné a týmové odkazy přestanou fungovat.</p>}
    {['restore', 'prepare', 'unarchive'].includes(action) && <p>Registrace zůstanou uzavřené. Obnova nespustí projekci ani neobnoví odvolané odkazy.</p>}
    {action === 'archive' && <p>Dokončený nebo zrušený výsledek zůstane zachovaný. Archiv je určený ke čtení.</p>}
    {action === 'delete' && <><p>Odstraní se vlastní registrace, kontakty, bodování, historie, relace, veřejné kopie a prokazatelně výhradní snapshoty. Zůstane minimální audit a technická stopa ID. Smazání v aplikaci nemění retenci poskytovatelských záloh.</p><details><summary>Podrobný rozsah</summary>{inventory && <ul>{Object.entries(inventory.counts).map(([key, value]) => <li key={key}>{inventoryLabels[key] ?? key}: {value}</li>)}<li>Vlastní snapshoty: {inventory.ownedSnapshots}</li><li>Soubory Storage: 0 (knihovní média)</li></ul>}</details></>}
    {inventory?.progress && <p role="status">Odstraněno {inventory.progress.deletedCount} dokumentů · krok {inventory.progress.phase} / {inventory.progress.totalPhases}. {inventory.progress.error} Akci již nelze obnovit.</p>}
    <form onSubmit={e => { e.preventDefault(); void submit(); }}><fieldset disabled={pending} className="manual-team-fields">
      {action === 'cancel' && <><label className="form-field"><span>Soukromý důvod zrušení</span><textarea maxLength={2000} value={reason} onChange={e => setReason(e.target.value)} /></label><label className="form-field"><span>Zpráva pro veřejnost (volitelné)</span><textarea maxLength={1000} value={publicMessage} onChange={e => setPublicMessage(e.target.value)} /></label>{can('event.live') ? <label><input type="checkbox" checked={endLive} onChange={e => setEndLive(e.target.checked)} /> Ukončit běh a zrušit akci — zastaví všechna související živá ovládání a přehrávání.</label> : <p>Ukončení živého běhu navíc vyžaduje právo ovládat promítání.</p>}</>}
      {action === 'delete' && <><label className="form-field"><span>Opište název akce</span><input required autoComplete="off" value={confirmation} onChange={e => setConfirmation(e.target.value)} /></label><label className="form-field"><span>Vaše současné heslo</span><input required type="password" autoComplete="current-password" value={password} onChange={e => setPassword(e.target.value)} /></label></>}
    </fieldset>{error && <p className="round-editor-error" role="alert">{error}</p>}<div className="team-tool-actions"><button type="button" className="secondary-button" disabled={pending} onClick={onClose}>Zpět</button><button className="danger-button" disabled={pending || !inventory || (action === 'delete' && (confirmation !== event.title || !password))}>{pending ? action === 'delete' ? 'Mažu bezpečné dávky…' : 'Ukládám…' : action === 'cancel' && endLive ? 'Ukončit běh a zrušit akci' : labels[action]}</button></div></form>
  </dialog>;
}
