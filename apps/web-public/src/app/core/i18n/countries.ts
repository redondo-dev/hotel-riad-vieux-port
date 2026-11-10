import type { Locale } from '@riad/shared';
import { INTL_LOCALE } from './locale';

/** ISO 3166-1 codes of the countries and territories a guest may come from. */
const COUNTRY_CODES =
  'AD AE AF AG AL AM AO AR AT AU AZ BA BB BD BE BF BG BH BI BJ BN BO BR BS BT BW BY BZ CA CD ' +
  'CF CG CH CI CL CM CN CO CR CU CV CY CZ DE DJ DK DM DO DZ EC EE EG ER ES ET FI FJ FM FR GA ' +
  'GB GD GE GH GM GN GQ GR GT GW GY HK HN HR HT HU ID IE IL IN IQ IR IS IT JM JO JP KE KG KH ' +
  'KI KM KN KP KR KW KZ LA LB LC LI LK LR LS LT LU LV LY MA MC MD ME MG MH MK ML MM MN MO MR ' +
  'MT MU MV MW MX MY MZ NA NC NE NG NI NL NO NP NR NZ OM PA PE PF PG PH PK PL PR PS PT PW PY ' +
  'QA RE RO RS RU RW SA SB SC SD SE SG SI SK SL SM SN SO SR SS ST SV SY SZ TD TG TH TJ TL TM ' +
  'TN TO TR TT TV TW TZ UA UG US UY UZ VA VC VE VN VU WS YE ZA ZM ZW';

export interface CountryOption {
  code: string;
  name: string;
}

/** Every country, named in the language of the page and sorted by that name. */
export function countryOptions(locale: Locale): CountryOption[] {
  const names = new Intl.DisplayNames([INTL_LOCALE[locale]], { type: 'region' });
  const collator = new Intl.Collator(INTL_LOCALE[locale]);
  return COUNTRY_CODES.split(' ')
    .map((code) => ({ code, name: names.of(code) ?? code }))
    .sort((a, b) => collator.compare(a.name, b.name));
}
