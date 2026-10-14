import type { ResultTemplate } from '@filmovy-kviz/quiz-domain';
import { AssetImage } from '../media/AssetImage';
import { Brand } from '../../ui/Brand';

export function ResultBackdrop({ template, mediaSessionId }: { readonly template?: ResultTemplate | undefined; readonly mediaSessionId?: string | undefined }) {
  return <>
    {template?.design?.backgroundImage && <div className="result-background" aria-hidden="true"><AssetImage source={template.design.backgroundImage} alt="" sessionId={mediaSessionId} /></div>}
    <div className="result-background-overlay" style={{ opacity: (template?.design?.backgroundOverlay ?? 0) / 100 }} aria-hidden="true" />
  </>;
}

export function ResultBrand({ template, mediaSessionId }: { readonly template?: ResultTemplate | undefined; readonly mediaSessionId?: string | undefined }) {
  if (template?.design?.showLogo === false) return null;
  return template?.design?.logoImage ? <span className="result-custom-logo"><AssetImage source={template.design.logoImage} alt="Logo pořadatele" sessionId={mediaSessionId} /></span> : <Brand />;
}
