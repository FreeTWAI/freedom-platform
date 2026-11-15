export type StoreNextStepsInput = {
  publicationState: 'never_published' | 'published' | 'unpublished';
  productCount: number;
  writable: boolean;
  canWrite: boolean;
  canPublish: boolean;
};

export type StoreNextStep = {
  key: 'store' | 'products' | 'publish';
  done: boolean;
  text: string;
};

/** Derive onboarding steps for a store that has never been published. */
export function storeNextSteps(input: StoreNextStepsInput): {
  steps: StoreNextStep[];
  current: 'products' | 'publish';
  next: 'products' | 'publish' | null;
} | null {
  if (input.publicationState !== 'never_published' || !input.writable || !input.canWrite) {
    return null;
  }
  const hasProducts = input.productCount > 0;
  const steps: StoreNextStep[] = [
    { key: 'store', done: true, text: '商店資料已建立' },
    {
      key: 'products',
      done: hasProducts,
      text: hasProducts ? `已新增 ${input.productCount} 件商品` : '新增第一件商品',
    },
    {
      key: 'publish',
      done: false,
      text: input.canPublish ? '在「店面與發布」預覽後發布' : '請有發布權限的成員預覽後發布',
    },
  ];
  return {
    steps,
    current: hasProducts ? 'publish' : 'products',
    next: !hasProducts ? 'products' : input.canPublish ? 'publish' : null,
  };
}
