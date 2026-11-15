import { createContext } from 'react';

export type ExploreFeatureMatch = { id: string; label: string; select: () => void };
export const ExploreFeatureSearchContext = createContext<((query: string) => ExploreFeatureMatch[]) | null>(null);
