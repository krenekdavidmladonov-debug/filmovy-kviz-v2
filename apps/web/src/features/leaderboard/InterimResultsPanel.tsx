import { useEffect, useRef, useState } from 'react';
import { loadRounds } from '../scoring/api';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseServices } from '../../services/firebase/client';
import type { LiveControlState } from '../live/types';
import type { ResultsPreview } from './types';
import { ResultsTable } from './ResultsTable';
import { useShowCommands, type RevisionedResult } from '../live/ShowCommandContext';
export function InterimResultsPanel({ session }: {
    session: LiveControlState;
}) {
    const show = useShowCommands();
    const previewSize = show?.enabled ? 6 : 8;
    const [rounds, setRounds] = useState<{
        id: string;
        title: string;
    }[]>([]), [roundId, setRoundId] = useState('');
    const [preview, setPreview] = useState<ResultsPreview | null>(null), [previewPage, setPreviewPage] = useState(0);
    const [pending, setPending] = useState(false), [error, setError] = useState('');
    const retry = useRef<Record<string, unknown> | null>(null), busy = useRef(false);
    useEffect(() => {
        let active = true;
        void loadRounds(session.snapshotId!).then(data => {
            if (!active)
                return;
            setRounds(data);
            setRoundId(data.length > 1 ? data[0]!.id : '');
        }).catch(() => { if (active)
            setError('Kola nelze načíst.'); });
        return () => { active = false; };
    }, [session.snapshotId]);
    async function loadPreview() {
        if (busy.current)
            return;
        busy.current = true;
        setPending(true);
        setError('');
        retry.current = null;
        try {
            const r = await httpsCallable<unknown, ResultsPreview>(getFirebaseServices().functions, 'previewInterimResults')({ eventId: session.eventId, sessionId: session.sessionId, throughRoundId: roundId });
            setPreview(r.data);
            setPreviewPage(0);
        }
        catch {
            setPreview(null);
            setError('Náhled nelze načíst. Zkontrolujte akci a spojení.');
        }
        finally {
            busy.current = false;
            setPending(false);
        }
    }
    async function control(action: 'publish' | 'hide' | 'page' | 'static', page?: number) {
        if (busy.current || show?.busy)
            return;
        const audioTicket = action === 'publish' && show?.enabled ? show.prepareAudio() : undefined;
        if (action === 'hide') show?.stopAudio();
        busy.current = true;
        setPending(true);
        setError('');
        const content = { eventId: session.eventId, sessionId: session.sessionId, action, expectedRevision: action === 'publish' ? preview!.sessionRevision : session.revision,
            ...(action === 'publish' ? { throughRoundId: preview!.throughRoundId, sourceFingerprint: preview!.sourceFingerprint, ...(show?.enabled ? { presentationStyle: 'show' } : {}) } : action === 'page' ? { page } : {}) };
        const previous = retry.current;
        const request = previous && Object.entries(content).every(([k, v]) => previous[k] === v) ? previous : { ...content, requestId: crypto.randomUUID() };
        retry.current = request;
        try {
            const invoke = async (_current: LiveControlState, revision: number) => {
                if (action !== 'publish' && request !== previous) request.expectedRevision = revision;
                return (await httpsCallable<unknown, RevisionedResult & { returnRestored?: boolean }>(getFirebaseServices().functions, 'controlInterimResults')(request)).data;
            };
            const response = show ? await show.execute(invoke) : await invoke(session, session.revision);
            retry.current = null;
            if (action === 'publish')
                setPreview(null);
            if (action === 'publish' && audioTicket !== undefined && !response.replayed) void show?.playAudio('interim', response, audioTicket);
            if (action === 'hide' && response.returnRestored === false) setError('Výsledky jsou skryté. Původní odpověď nelze s aktuálním oprávněním obnovit.');
        }
        catch (e) {
            const code = (e as {
                code?: string;
            }).code;
            if (code === 'functions/aborted') {
                retry.current = null;
                setPreview(null);
                setError('Náhled nebo prezentace se změnily. Načtěte nový náhled a zkontrolujte jej.');
            }
            else
                setError('Příkaz nelze potvrdit. Zkontrolujte stav; stejný příkaz můžete zopakovat.');
        }
        finally {
            busy.current = false;
            setPending(false);
        }
    }
    const published = session.interimResults, ended = session.status === 'ended' || session.finalReveal?.visible === true;
    const disabled = pending || show?.busy === true;
    return <section className="interim-panel" aria-label="Ovládání průběžných výsledků"><h2>Průběžné výsledky</h2>
    <p>{published ? `Zveřejněná verze ${published.versionId.slice(0, 8)} · po ${published.roundNumber}. kole · strana ${published.page + 1}/${published.pageCount}` : 'Výsledky nejsou na projektoru zobrazené.'}</p>
    {rounds.length === 1 ? <p>Jednokolová akce nemá průběžné výsledky mezi koly.</p> : <><label className="form-field"><span>Výsledky po kole</span><select value={roundId} disabled={disabled || ended} onChange={e => { setRoundId(e.target.value); setPreview(null); retry.current = null; }}>{rounds.slice(0, -1).map((r, i) => <option key={r.id} value={r.id}>{i + 1}. kolo — {r.title}</option>)}</select></label><p>Poslední kolo je součástí finálního vyhlášení.</p><button className="secondary-button" disabled={!roundId || disabled || ended} onClick={() => void loadPreview()}>Načíst náhled výsledků</button></>}
    {error && <p role="alert">{error}</p>}
    {preview && <section aria-label="Interní náhled výsledků"><h3>Interní náhled — zatím nezveřejněno</h3><p>Zahrnutá kola: {preview.includedRounds.map(r => r.title).join(', ')}</p>
      {!preview.complete ? <><p role="alert">Zveřejnění je zablokované: {preview.rows.length === 0 ? 'žádné přijaté týmy.' : 'chybějí body.'}</p><ul>{preview.missing.map(m => <li key={m.teamId + ':' + m.roundId}>{m.teamName} — {m.roundTitle}: nezadáno</li>)}</ul></> : <><div className="results-frame"><ResultsTable roundNumber={preview.roundNumber} page={previewPage} pageCount={Math.ceil(preview.rows.length / previewSize)} rows={preview.rows.slice(previewPage * previewSize, (previewPage + 1) * previewSize)}/></div><div className="interim-actions"><button disabled={previewPage === 0} onClick={() => setPreviewPage(p => p - 1)}>Předchozí stránka náhledu</button><button disabled={(previewPage + 1) * previewSize >= preview.rows.length} onClick={() => setPreviewPage(p => p + 1)}>Další stránka náhledu</button></div></>}
      <button className="primary-button" disabled={!preview.complete || disabled || session.status !== 'active'} onClick={() => void control('publish')}>{published ? 'Aktualizovat zobrazené výsledky' : 'Zobrazit výsledky'}</button>{session.status === 'waiting' && <p>Nejprve spusťte prezentaci tlačítkem Další.</p>}
    </section>}
    {published && <div className="interim-actions">{published.presentationStyle === 'show' && <button className="secondary-button" disabled={disabled || ended} onClick={() => void control('static')}>Přeskočit animaci / statický obraz</button>}<button disabled={disabled || ended || published.page === 0} onClick={() => void control('page', published.page - 1)}>Předchozí stránka projektoru</button><button disabled={disabled || ended || published.page + 1 >= published.pageCount} onClick={() => void control('page', published.page + 1)}>Další stránka projektoru</button><button className="secondary-button" disabled={disabled || ended} onClick={() => void control('hide')}>Skrýt výsledky a vrátit prezentaci</button></div>}
  </section>;
}
