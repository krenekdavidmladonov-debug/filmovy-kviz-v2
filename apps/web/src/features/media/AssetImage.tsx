import { useEffect, useState } from 'react';
import { isSafeHttpUrl, parseQuizAsset } from '@filmovy-kviz/quiz-domain';
import { readQuizMediaBlob } from './mediaApi';
export function AssetImage({ source, alt, sessionId }: { source: string; alt: string; sessionId?: string | undefined }) {
  const [loaded, setLoaded] = useState<{ source: string; sessionId?: string | undefined; url: string }>();
  const owned = Boolean(parseQuizAsset(source));
  useEffect(() => {
    if (!owned) return;
    const abort = new AbortController(); let objectUrl: string | undefined;
    void readQuizMediaBlob(source, abort.signal, sessionId).then(blob => {
      if (abort.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob); setLoaded({ source, sessionId, url: objectUrl });
    }).catch(() => { /* Fail closed: do not leave a prior image visible. */ });
    return () => { abort.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [owned, source, sessionId]);
  const url = owned ? loaded?.source === source && loaded.sessionId === sessionId ? loaded.url : undefined : isSafeHttpUrl(source) ? source : undefined;
  return url ? <img src={url} alt={alt} /> : <span role="status">Obrázek není načtený.</span>;
}
