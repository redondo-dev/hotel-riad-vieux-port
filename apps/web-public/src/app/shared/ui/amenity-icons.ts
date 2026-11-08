import type { AmenityCode } from '@riad/shared';
import {
  AirVent,
  Anchor,
  Bath,
  LockKeyhole,
  ShowerHead,
  Sofa,
  Tv,
  Wifi,
  Wind,
  type LucideIconData,
} from 'lucide-angular';

/** The icon of each equipment of a room (room cards and category pages). */
export const AMENITY_ICONS: Record<AmenityCode, LucideIconData> = {
  wifi: Wifi,
  'air-conditioning': AirVent,
  tv: Tv,
  safe: LockKeyhole,
  'hair-dryer': Wind,
  shower: ShowerHead,
  bathtub: Bath,
  'sitting-area': Sofa,
  'port-view': Anchor,
};
