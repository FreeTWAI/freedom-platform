import { z } from 'zod';
import { Version } from './primitives.js';
import { StorePreviewSchema } from './storefront.js';
import { StoreTemplateSchema } from './storefront-presentation.js';
import { PrivateProductPhotoSchema } from './hosted-store-media.js';
import { DistributionPhotoItemSchema } from './supplier-console.js';

/** Additive review contract; the pinned storefront/v1 schema remains unchanged. */
export const STOREFRONT_PUBLICATION_PROFILE = 'freedom.hosted-store-publication/v1' as const;
const ReviewDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const StorePublicationReviewSchema = z.object({
  profile: z.literal(STOREFRONT_PUBLICATION_PROFILE),
  store_version: Version,
  preview: StorePreviewSchema,
  template_id: StoreTemplateSchema,
  photo_count: z.number().int().min(0).max(200),
  photos: z.array(z.object({sku: z.string(), photo: PrivateProductPhotoSchema.or(DistributionPhotoItemSchema.shape.photo.unwrap())}).strict()).max(200),
  review_digest: ReviewDigestSchema,
}).strict().refine(value => value.photo_count === value.photos.length
  && new Set(value.photos.map(item => item.sku)).size === value.photos.length
  && value.photos.every(item => value.preview.projection.products.some(product => product.sku === item.sku)));
export const ReviewedPublicationInputSchema = z.object({ review_digest: ReviewDigestSchema }).strict();
export type StorePublicationReview = z.infer<typeof StorePublicationReviewSchema>;
export type ReviewedPublicationInput = z.infer<typeof ReviewedPublicationInputSchema>;
