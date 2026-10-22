# Store category publication

Category snapshots contain the saved active categories and effective group SKUs.
With variants ON, membership resolves the exact group keys from that catalog; with
variants OFF, it resolves SKU singletons without reading variants metadata. Empty
categories are omitted. The immutable document embeds category members; there is
no separate publication member/ref table.

`draftPublicationDimensions` builds this snapshot once under the existing store
publication locks. `publicationChanges` compares its digest to the current frozen
sidecar. `publicationReviewDigest` includes `categories_sha256` only when enabled;
the strict private review similarly includes optional `categories_changed`.
OFF leaves both fields absent and preserves #943's review response/digest inputs.

Both `/publish` and `/publish-reviewed` insert that same dimensions snapshot into
`commerce_publication_categories`. A changed reviewed digest returns
`409 storefront_publication_changed` before effects. An unchanged reviewed publish
keeps the existing revision. Saved editor changes reload the review; unsaved and
pending commands disable one-click publication. No new flag or migration is needed.
