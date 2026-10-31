import type {
  AmenityCode,
  BookingRules,
  DemoReview,
  HotelInfo,
  HotelService,
  LocalizedText,
  RoomCategory,
} from '@riad/shared';

/*
 * DEMO DATA — fictional hotel used for the portfolio.
 * Values validated during the analysis phase. Every screen reads them through
 * CatalogService, so the figures stay consistent from one screen to another.
 * They will be replaced by the API responses when the server is plugged in.
 */

export const DEMO_HOTEL: HotelInfo = {
  name: 'Hôtel Riad Vieux-Port',
  address: {
    fr: 'Quai du Vieux-Port, 13002 Marseille (adresse fictive)',
    en: 'Quai du Vieux-Port, 13002 Marseille, France (fictional address)',
  },
  // Number in a range reserved by ARCEP for works of fiction: it reaches nobody.
  phone: { display: '04 65 71 00 00', international: '+33465710000' },
  email: 'contact@riad-vieux-port.example',
  checkInFrom: '15:00',
  checkOutBefore: '12:00',
  timeZone: 'Europe/Paris',
};

export const DEMO_BOOKING_RULES: BookingRules = {
  maxStayNights: 30,
  bookingHorizonDays: 365,
  sameDayCutoffMinutes: 23 * 60,
  nonRefundableDiscountPercent: 10,
  freeCancellationHours: 48,
};

const COMMON_AMENITIES: AmenityCode[] = ['wifi', 'air-conditioning', 'tv', 'safe', 'hair-dryer'];

export const DEMO_ROOM_CATEGORIES: RoomCategory[] = [
  {
    code: 'single',
    name: { fr: 'Chambre individuelle', en: 'Single room' },
    description: {
      fr: 'Une chambre calme et fonctionnelle, pensée pour les voyageurs seuls et les séjours professionnels.',
      en: 'A quiet, practical room designed for solo travellers and business stays.',
    },
    beds: { fr: '1 lit simple', en: '1 single bed' },
    maxOccupancy: 1,
    baseOccupancy: 1,
    areaSqm: 14,
    roomCount: 10,
    basePriceCents: 7500,
    amenities: [...COMMON_AMENITIES, 'shower'],
  },
  {
    code: 'double-standard',
    name: { fr: 'Double standard', en: 'Standard double' },
    description: {
      fr: 'Lumineuse et confortable, idéale pour un séjour à deux au cœur de Marseille.',
      en: 'Bright and comfortable, ideal for two in the heart of Marseille.',
    },
    beds: { fr: '1 lit double', en: '1 double bed' },
    maxOccupancy: 2,
    baseOccupancy: 2,
    areaSqm: 18,
    roomCount: 40,
    basePriceCents: 9500,
    amenities: [...COMMON_AMENITIES, 'shower'],
  },
  {
    code: 'double-superior',
    name: { fr: 'Double supérieure', en: 'Superior double' },
    description: {
      fr: "Plus d'espace, une baignoire et le choix entre un grand lit ou deux lits séparés.",
      en: 'More space, a bathtub and a choice of one large bed or two twin beds.',
    },
    beds: { fr: '1 grand lit ou 2 lits simples', en: '1 king bed or 2 twin beds' },
    maxOccupancy: 2,
    baseOccupancy: 2,
    areaSqm: 24,
    roomCount: 25,
    basePriceCents: 12_500,
    amenities: [...COMMON_AMENITIES, 'bathtub'],
  },
  {
    code: 'family',
    name: { fr: 'Chambre familiale', en: 'Family room' },
    description: {
      fr: 'Un lit double et deux lits simples pour voyager en famille sans se serrer.',
      en: 'A double bed and two single beds so the whole family travels in comfort.',
    },
    beds: { fr: '1 lit double et 2 lits simples', en: '1 double bed and 2 single beds' },
    maxOccupancy: 4,
    baseOccupancy: 2,
    areaSqm: 30,
    roomCount: 5,
    basePriceCents: 16_500,
    amenities: [...COMMON_AMENITIES, 'shower'],
  },
  {
    code: 'suite',
    name: { fr: 'Suite Vieux-Port', en: 'Vieux-Port suite' },
    description: {
      fr: 'Notre plus belle chambre : un coin salon, une baignoire et la vue sur le port.',
      en: 'Our finest room: a sitting area, a bathtub and a view over the harbour.',
    },
    beds: { fr: '1 grand lit et 1 canapé-lit', en: '1 king bed and 1 sofa bed' },
    maxOccupancy: 3,
    baseOccupancy: 2,
    areaSqm: 40,
    roomCount: 5,
    basePriceCents: 22_000,
    amenities: [...COMMON_AMENITIES, 'bathtub', 'sitting-area', 'port-view'],
  },
];

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

export const DEMO_SERVICES: HotelService[] = [
  {
    code: 'breakfast',
    name: { fr: 'Petit-déjeuner', en: 'Breakfast' },
    detail: {
      fr: 'Buffet sucré et salé, 14 € par personne et par nuit.',
      en: 'Sweet and savoury buffet, €14 per person per night.',
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

/** Fictional reviews, always displayed with a "demonstration" notice. */
export const DEMO_REVIEWS: DemoReview[] = [
  {
    id: 'demo-1',
    author: 'Claire M.',
    rating: 5,
    categoryCode: 'double-superior',
    text: {
      fr: 'Accueil chaleureux et chambre impeccable, à deux pas du port. Nous reviendrons.',
      en: 'Warm welcome and a spotless room, a stone’s throw from the harbour. We will be back.',
    },
  },
  {
    id: 'demo-2',
    author: 'Thomas B.',
    rating: 4,
    categoryCode: 'single',
    text: {
      fr: 'Pratique pour un déplacement professionnel, calme et bien situé. Petit-déjeuner copieux.',
      en: 'Handy for a business trip, quiet and well located. Generous breakfast.',
    },
  },
  {
    id: 'demo-3',
    author: 'Famille R.',
    rating: 5,
    categoryCode: 'family',
    text: {
      fr: 'La chambre familiale est spacieuse et le lit bébé était prêt à notre arrivée.',
      en: 'The family room is spacious and the baby cot was ready when we arrived.',
    },
  },
];
