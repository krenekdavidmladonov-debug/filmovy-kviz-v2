import { productConfig } from '../config/product';

/** Typographic placeholder; replace the artwork here once the final logo is supplied. */
export function Brand() {
  return <span className="brand-wordmark">{productConfig.name.slice(0, 4)}<span className="brand-wordmark-accent">{productConfig.name.slice(4)}</span></span>;
}
