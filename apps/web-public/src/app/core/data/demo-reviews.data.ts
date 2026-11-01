import type { DemoReview } from '@riad/shared';

/*
 * DEMO DATA — fictional reviews of the portfolio hotel, always displayed with a
 * « demonstration » notice. Real reviews will need their own module (collection, moderation).
 */

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
