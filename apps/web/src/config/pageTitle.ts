import { productConfig } from './product';

/** Uses only route structure, never private titles, IDs, query strings or tokens. */
export function pageTitle(pathname: string): string {
  if (/^\/projector(?:\/|$)/u.test(pathname)) return `Projekce | ${productConfig.name}`;
  if (/^\/admin\/quizzes\/[^/]+\/edit\/?$/u.test(pathname)) return `Editor kvízu | ${productConfig.name}`;
  if (/^\/admin\/quizzes(?:\/|$)/u.test(pathname)) return `Knihovna kvízů | ${productConfig.name}`;
  if (/^\/(?:admin\/)?events(?:\/|$)/u.test(pathname)) return `Akce | ${productConfig.name}`;
  return productConfig.name;
}
