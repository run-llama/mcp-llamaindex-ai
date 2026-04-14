import z from 'zod';

export type ParsingResult = {
  text?: string | undefined;
  markdown?: string | undefined;
};

export const Category = z.object({
  type: z.string().describe('Category identifier'),
  description: z.string().describe('Category description'),
});

export const SplitCategory = z.object({
  name: z.string().describe('Category identifier'),
  description: z.string().describe('Category description'),
});

export type CategoryType = z.infer<typeof Category>;
export type SplitCategoryType = z.infer<typeof SplitCategory>;

export interface ClassifyResult {
  fileId: string;
  classifiedAs: string;
  reasoning: string;
  confidence: number;
  asString: () => string;
}

export interface SplitResult {
  fileId: string;
  segements: {
    category: string;
    confidence: string;
    pages: number[];
  }[];
  asString: () => string;
}
