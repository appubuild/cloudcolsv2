/**
 * Countries, with their calling codes.
 *
 * Kept as data in the app rather than fetched: the list changes about once a
 * decade, and a sign-up form that cannot finish because a lookup service is down
 * is a worse trade than a file that occasionally needs a line added.
 *
 * The flag is derived from the code rather than stored, since regional indicator
 * symbols are just the two letters offset into a Unicode block — no image, no
 * request, and it inherits the reader's font.
 */

export interface Country {
  /** ISO 3166-1 alpha-2, uppercase. */
  code: string;
  name: string;
  /** Calling code with the plus. */
  dial: string;
}

/** A flag emoji from the country code. */
export function flagOf(code: string): string {
  if (!/^[A-Za-z]{2}$/.test(code)) return "";
  return String.fromCodePoint(
    ...code
      .toUpperCase()
      .split("")
      .map((c) => 0x1f1e6 + c.charCodeAt(0) - 65),
  );
}

export const COUNTRIES: Country[] = [
  { code: "BD", name: "Bangladesh", dial: "+880" },
  { code: "IN", name: "India", dial: "+91" },
  { code: "PK", name: "Pakistan", dial: "+92" },
  { code: "LK", name: "Sri Lanka", dial: "+94" },
  { code: "NP", name: "Nepal", dial: "+977" },
  { code: "MY", name: "Malaysia", dial: "+60" },
  { code: "SG", name: "Singapore", dial: "+65" },
  { code: "ID", name: "Indonesia", dial: "+62" },
  { code: "TH", name: "Thailand", dial: "+66" },
  { code: "PH", name: "Philippines", dial: "+63" },
  { code: "VN", name: "Vietnam", dial: "+84" },
  { code: "CN", name: "China", dial: "+86" },
  { code: "JP", name: "Japan", dial: "+81" },
  { code: "KR", name: "South Korea", dial: "+82" },
  { code: "AE", name: "United Arab Emirates", dial: "+971" },
  { code: "SA", name: "Saudi Arabia", dial: "+966" },
  { code: "QA", name: "Qatar", dial: "+974" },
  { code: "KW", name: "Kuwait", dial: "+965" },
  { code: "OM", name: "Oman", dial: "+968" },
  { code: "BH", name: "Bahrain", dial: "+973" },
  { code: "TR", name: "Türkiye", dial: "+90" },
  { code: "EG", name: "Egypt", dial: "+20" },
  { code: "ZA", name: "South Africa", dial: "+27" },
  { code: "NG", name: "Nigeria", dial: "+234" },
  { code: "KE", name: "Kenya", dial: "+254" },
  { code: "GB", name: "United Kingdom", dial: "+44" },
  { code: "IE", name: "Ireland", dial: "+353" },
  { code: "FR", name: "France", dial: "+33" },
  { code: "DE", name: "Germany", dial: "+49" },
  { code: "NL", name: "Netherlands", dial: "+31" },
  { code: "BE", name: "Belgium", dial: "+32" },
  { code: "ES", name: "Spain", dial: "+34" },
  { code: "PT", name: "Portugal", dial: "+351" },
  { code: "IT", name: "Italy", dial: "+39" },
  { code: "CH", name: "Switzerland", dial: "+41" },
  { code: "AT", name: "Austria", dial: "+43" },
  { code: "SE", name: "Sweden", dial: "+46" },
  { code: "NO", name: "Norway", dial: "+47" },
  { code: "DK", name: "Denmark", dial: "+45" },
  { code: "FI", name: "Finland", dial: "+358" },
  { code: "PL", name: "Poland", dial: "+48" },
  { code: "CZ", name: "Czechia", dial: "+420" },
  { code: "RO", name: "Romania", dial: "+40" },
  { code: "GR", name: "Greece", dial: "+30" },
  { code: "RU", name: "Russia", dial: "+7" },
  { code: "UA", name: "Ukraine", dial: "+380" },
  { code: "US", name: "United States", dial: "+1" },
  { code: "CA", name: "Canada", dial: "+1" },
  { code: "MX", name: "Mexico", dial: "+52" },
  { code: "BR", name: "Brazil", dial: "+55" },
  { code: "AR", name: "Argentina", dial: "+54" },
  { code: "CL", name: "Chile", dial: "+56" },
  { code: "CO", name: "Colombia", dial: "+57" },
  { code: "AU", name: "Australia", dial: "+61" },
  { code: "NZ", name: "New Zealand", dial: "+64" },
];

export function countryByCode(code: string | null | undefined): Country | undefined {
  if (!code) return undefined;
  return COUNTRIES.find((c) => c.code === code.toUpperCase());
}

/**
 * A first guess at where the visitor is, from the browser's own settings.
 *
 * The region in the locale — "en-GB", "bn-BD" — and, failing that, the time zone.
 * Neither is an IP lookup: no third party is told who is signing up, and nothing
 * has to be reachable for the form to work. It is only a default, and the user
 * can change it.
 */
export function guessCountry(): string | null {
  if (typeof navigator === "undefined") return null;

  for (const locale of navigator.languages ?? [navigator.language]) {
    const region = locale?.split("-")[1];
    if (region && /^[A-Za-z]{2}$/.test(region) && countryByCode(region)) {
      return region.toUpperCase();
    }
  }

  try {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone ?? "";
    const byZone: Record<string, string> = {
      "Asia/Dhaka": "BD",
      "Asia/Kolkata": "IN",
      "Asia/Karachi": "PK",
      "Asia/Colombo": "LK",
      "Asia/Kathmandu": "NP",
      "Asia/Kuala_Lumpur": "MY",
      "Asia/Singapore": "SG",
      "Asia/Jakarta": "ID",
      "Asia/Dubai": "AE",
      "Europe/London": "GB",
      "America/New_York": "US",
      "America/Los_Angeles": "US",
      "Australia/Sydney": "AU",
    };
    return byZone[zone] ?? null;
  } catch {
    // Intl is missing or the zone is unknown; the form simply opens with no
    // country chosen, which is a fine place to start.
    return null;
  }
}
