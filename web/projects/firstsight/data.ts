import originalData from './original-data.json';
import type { WeddingSeries } from './types';

// Preserve FirstSight's original groups, image records and captions.
// Missing source images remain records with an explicit unavailable state.
export const WEDDING_COLLECTIONS: WeddingSeries[] = originalData.collections.map((collection) => ({
  ...collection,
  photos: collection.photos.map((photo) => ({ ...photo, alt: photo.title })),
}));

export const PHOTO_COUNT = WEDDING_COLLECTIONS.reduce((count, collection) => count + collection.photos.length, 0);
export const UNAVAILABLE_COUNT = WEDDING_COLLECTIONS.reduce((count, collection) => count + collection.photos.filter((photo) => !photo.available).length, 0);
