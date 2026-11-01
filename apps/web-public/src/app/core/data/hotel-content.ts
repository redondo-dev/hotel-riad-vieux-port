import type { AmenityCode, HotelService, LocalizedText } from '@riad/shared';

/*
 * Fixed texts of the public site about the hotel. The figures (rooms, prices, rules, contact)
 * come from the API through CatalogService; only wording that never depends on them lives here.
 */

/** Name of each equipment of a room, in every language. */
export const AMENITY_LABELS: Record<AmenityCode, LocalizedText> = {
  wifi: { fr: 'Wi-Fi', en: 'Wi-Fi' },
  'air-conditioning': { fr: 'Climatisation', en: 'Air conditioning' },
  tv: { fr: 'Télévision', en: 'Television' },
  safe: { fr: 'Coffre-fort', en: 'Safe' },
  'hair-dryer': { fr: 'Sèche-cheveux', en: 'Hair dryer' },
  shower: { fr: 'Douche', en: 'Shower' },
  bathtub: { fr: 'Baignoire', en: 'Bathtub' },
  'sitting-area': { fr: 'Coin salon', en: 'Sitting area' },
  'port-view': { fr: 'Vue sur le port', en: 'Harbour view' },
};

/**
 * Highlights of the hotel on the home page. Static content of the site, not sold: the options
 * that are sold (breakfast, baby cot…) and their prices come from the API.
 */
export const HOTEL_HIGHLIGHTS: HotelService[] = [
  {
    code: 'breakfast',
    name: { fr: 'Petit-déjeuner', en: 'Breakfast' },
    detail: {
      fr: 'Buffet sucré et salé.',
      en: 'Sweet and savoury buffet.',
    },
  },
  {
    code: 'restaurant-bar',
    name: { fr: 'Restaurant et bar', en: 'Restaurant and bar' },
    detail: {
      fr: 'Cuisine méditerranéenne, réservation sur place.',
      en: 'Mediterranean cuisine, booking at the hotel.',
    },
  },
  {
    code: 'reception-24h',
    name: { fr: 'Réception 24 h/24', en: '24-hour reception' },
    detail: {
      fr: 'Une équipe disponible jour et nuit.',
      en: 'A team available day and night.',
    },
  },
  {
    code: 'baby-cot',
    name: { fr: 'Lit bébé gratuit', en: 'Free baby cot' },
    detail: {
      fr: 'Sur demande, pour les enfants de moins de 2 ans.',
      en: 'On request, for children under 2.',
    },
  },
  {
    code: 'wifi',
    name: { fr: 'Wi-Fi gratuit', en: 'Free Wi-Fi' },
    detail: {
      fr: 'Dans les chambres et les espaces communs.',
      en: 'In the rooms and common areas.',
    },
  },
  {
    code: 'air-conditioning',
    name: { fr: 'Climatisation', en: 'Air conditioning' },
    detail: {
      fr: 'Dans toutes les chambres.',
      en: 'In every room.',
    },
  },
];
