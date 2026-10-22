import { z } from 'zod';
import { Version } from './primitives.js';
import { StorePreviewSchema } from './storefront.js';
import { StoreTemplateSchema } from './storefront-presentation.js';
import { PrivateProductPhotoSchema } from './hosted-store-media.js';
import { GalleryPhotoSchema } from './storefront-gallery.js';
import { DistributionPhotoItemSchema } from './supplier-console.js';

/** Additive review contract; the pinned storefront/v1 schema remains unchanged. */
export const STOREFRONT_PUBLICATION_PROFILE = 'freedom.hosted-store-publication/v1' as const;
const ReviewDigestSchema = z.string().regex(/^[a-f0-9]{64}$/);
export const StorePublicationReviewSchema = z.object({
  profile: z.literal(STOREFRONT_PUBLICATION_PROFILE),
  store_version: Version,
  preview: StorePreviewSchema,
  template_id: StoreTemplateSchema,
  appearance_changed: z.boolean().optional(),
  policies_changed: z.boolean().optional(),
  gallery_changed: z.boolean().optional(),
  variants_changed: z.boolean().optional(),
  categories_changed: z.boolean().optional(),
  photo_count: z.number().int().min(0).max(1600),
  photos: z.array(z.object({sku: z.string(), photo: PrivateProductPhotoSchema.or(DistributionPhotoItemSchema.shape.photo.unwrap()).or(GalleryPhotoSchema)}).strict()).max(1600),
  review_digest: ReviewDigestSchema,
}).strict().refine(value => value.photo_count === value.photos.length
  && (value.gallery_changed === undefined
    ? value.photo_count <= 200 && new Set(value.photos.map(item => item.sku)).size === value.photos.length
      && value.photos.every(item => !('photo_key' in item.photo))
    : new Set(value.photos.map(item => item.photo.read_path)).size === value.photos.length
      && value.preview.projection.products.every(product => value.photos.filter(item => item.sku === product.sku).length <= 8))
  && value.photos.every(item => value.preview.projection.products.some(product => product.sku === item.sku)));
export const ReviewedPublicationInputSchema = z.object({ review_digest: ReviewDigestSchema }).strict();
export type StorePublicationReview = z.infer<typeof StorePublicationReviewSchema>;
export type ReviewedPublicationInput = z.infer<typeof ReviewedPublicationInputSchema>;
