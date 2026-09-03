export interface ProductConfig {
  readonly name: string;
  readonly shortName: string;
  readonly adminLabel: string;
}

export const productConfig: ProductConfig = Object.freeze({
  name: 'QUIZ PLATFORM',
  shortName: 'QP',
  adminLabel: 'Kvízová platforma',
});
