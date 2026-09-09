import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { httpsCallable } from 'firebase/functions';
import { getFirebaseServices } from '../../services/firebase/client';
export function EventLiveButton({ eventId, revision }: {
    eventId: string;
    revision: number;
}) {
    const navigate = useNavigate();
    const [pending, setPending] = useState(false), [error, setError] = useState('');
    return <section className="event-section"><h2>Moderování a průběžné výsledky</h2><p>Prezentace používá připravený kvíz této akce.</p>
    <button type="button" className="primary-button" disabled={pending} onClick={() => {
            setPending(true);
            setError('');
            void httpsCallable<{
                eventId: string;
                expectedRevision: number;
            }, {
                sessionId: string;
            }>(getFirebaseServices().functions, 'createEventLiveSession')({ eventId, expectedRevision: revision })
                .then(r => navigate('/admin/live/' + r.data.sessionId)).catch(() => setError('Moderování nelze otevřít. Obnovte detail akce a zkontrolujte její stav.')).finally(() => setPending(false));
        }}>Otevřít moderování akce</button>{error && <p role="alert">{error}</p>}</section>;
}
