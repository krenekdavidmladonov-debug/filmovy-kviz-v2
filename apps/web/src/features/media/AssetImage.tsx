import { useEffect, useState } from 'react';
import { isSafeHttpUrl, parseQuizAsset } from '@filmovy-kviz/quiz-domain';
import { readQuizMediaBlob } from './mediaApi';
type AssetImageProps = { source: string; alt: string; sessionId?: string | undefined };
export function AssetImage(props: AssetImageProps) {
  return <ResolvedAssetImage key={props.source + ':' + (props.sessionId ?? 'private')} {...props} />;
}
function ResolvedAssetImage({ source, alt, sessionId }: AssetImageProps) {
  const [loaded, setLoaded] = useState<{ source: string; sessionId?: string | undefined; url: string }>();
  const [failure, setFailure] = useState<string>();
  const [retry, setRetry] = useState(0);
  const owned = Boolean(parseQuizAsset(source));
  useEffect(() => {
    const abort = new AbortController(); let objectUrl: string | undefined;
    const timeout = window.setTimeout(() => { abort.abort(); setFailure(source); }, 15000);
    if (owned) void readQuizMediaBlob(source, abort.signal, sessionId).then(blob => {
      if (abort.signal.aborted) return;
      window.clearTimeout(timeout);
      setFailure(undefined); objectUrl = URL.createObjectURL(blob); setLoaded({ source, sessionId, url: objectUrl });
    }).catch(() => { if (!abort.signal.aborted) setFailure(source); });
    else window.clearTimeout(timeout);
    return () => { abort.abort(); window.clearTimeout(timeout); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [owned, source, sessionId, retry]);
  const url = owned ? loaded?.source === source && loaded.sessionId === sessionId ? loaded.url : undefined : isSafeHttpUrl(source) ? source : undefined;
  return failure === source ? <span role="status">Obrázek není dostupný. <button type="button" onClick={() => { setFailure(undefined); setLoaded(undefined); setRetry(n => n + 1); }}>Zkusit načíst znovu</button></span> : url ? <img key={url + retry} src={url} alt={alt} onError={() => setFailure(source)} /> : <span role="status">Načítám obrázek…</span>;
}
