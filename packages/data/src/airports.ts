import type { Airport } from "@aerofocus/core";

/** Supported airports: validated IATA codes, coordinates, countries and IANA time zones (FR-001). */
export const AIRPORTS: readonly Airport[] = [
  { iata: "SIN", name: "Singapore Changi", city: "Singapore", country: "SG", region: "asia", lat: 1.3644, lon: 103.9915, timeZone: "Asia/Singapore" },
  { iata: "KUL", name: "Kuala Lumpur International", city: "Kuala Lumpur", country: "MY", region: "asia", lat: 2.7456, lon: 101.7099, timeZone: "Asia/Kuala_Lumpur" },
  { iata: "PEN", name: "Penang International", city: "Penang", country: "MY", region: "asia", lat: 5.2971, lon: 100.277, timeZone: "Asia/Kuala_Lumpur" },
  { iata: "BKK", name: "Suvarnabhumi", city: "Bangkok", country: "TH", region: "asia", lat: 13.69, lon: 100.7501, timeZone: "Asia/Bangkok" },
  { iata: "HKG", name: "Hong Kong International", city: "Hong Kong", country: "HK", region: "asia", lat: 22.308, lon: 113.9185, timeZone: "Asia/Hong_Kong" },
  { iata: "HND", name: "Tokyo Haneda", city: "Tokyo", country: "JP", region: "asia", lat: 35.5494, lon: 139.7798, timeZone: "Asia/Tokyo" },
  { iata: "ICN", name: "Incheon International", city: "Seoul", country: "KR", region: "asia", lat: 37.4602, lon: 126.4407, timeZone: "Asia/Seoul" },
  { iata: "MNL", name: "Ninoy Aquino International", city: "Manila", country: "PH", region: "asia", lat: 14.5086, lon: 121.0194, timeZone: "Asia/Manila" },
  { iata: "SGN", name: "Tan Son Nhat International", city: "Ho Chi Minh City", country: "VN", region: "asia", lat: 10.8188, lon: 106.652, timeZone: "Asia/Ho_Chi_Minh" },
  { iata: "CGK", name: "Soekarno–Hatta International", city: "Jakarta", country: "ID", region: "asia", lat: -6.1256, lon: 106.6559, timeZone: "Asia/Jakarta" },
  { iata: "DPS", name: "Ngurah Rai International", city: "Denpasar", country: "ID", region: "asia", lat: -8.7482, lon: 115.1675, timeZone: "Asia/Makassar" },
  { iata: "DEL", name: "Indira Gandhi International", city: "Delhi", country: "IN", region: "asia", lat: 28.5562, lon: 77.1, timeZone: "Asia/Kolkata" },
  { iata: "BOM", name: "Chhatrapati Shivaji Maharaj International", city: "Mumbai", country: "IN", region: "asia", lat: 19.0896, lon: 72.8656, timeZone: "Asia/Kolkata" },
  { iata: "SYD", name: "Sydney Kingsford Smith", city: "Sydney", country: "AU", region: "oceania", lat: -33.9399, lon: 151.1753, timeZone: "Australia/Sydney" },
  { iata: "BNE", name: "Brisbane", city: "Brisbane", country: "AU", region: "oceania", lat: -27.3842, lon: 153.1175, timeZone: "Australia/Brisbane" },
  { iata: "MEL", name: "Melbourne Tullamarine", city: "Melbourne", country: "AU", region: "oceania", lat: -37.669, lon: 144.841, timeZone: "Australia/Melbourne" },
  { iata: "DXB", name: "Dubai International", city: "Dubai", country: "AE", region: "middle_east", lat: 25.2532, lon: 55.3657, timeZone: "Asia/Dubai" },
  { iata: "DOH", name: "Hamad International", city: "Doha", country: "QA", region: "middle_east", lat: 25.2731, lon: 51.6081, timeZone: "Asia/Qatar" },
  { iata: "LHR", name: "London Heathrow", city: "London", country: "GB", region: "europe", lat: 51.47, lon: -0.4543, timeZone: "Europe/London" },
  { iata: "LGW", name: "London Gatwick", city: "London", country: "GB", region: "europe", lat: 51.1537, lon: -0.1821, timeZone: "Europe/London" },
  { iata: "CDG", name: "Paris Charles de Gaulle", city: "Paris", country: "FR", region: "europe", lat: 49.0097, lon: 2.5479, timeZone: "Europe/Paris" },
  { iata: "AMS", name: "Amsterdam Schiphol", city: "Amsterdam", country: "NL", region: "europe", lat: 52.3105, lon: 4.7683, timeZone: "Europe/Amsterdam" },
  { iata: "FRA", name: "Frankfurt", city: "Frankfurt", country: "DE", region: "europe", lat: 50.0379, lon: 8.5622, timeZone: "Europe/Berlin" },
  { iata: "DUB", name: "Dublin", city: "Dublin", country: "IE", region: "europe", lat: 53.4264, lon: -6.2499, timeZone: "Europe/Dublin" },
  { iata: "BCN", name: "Barcelona–El Prat", city: "Barcelona", country: "ES", region: "europe", lat: 41.2974, lon: 2.0833, timeZone: "Europe/Madrid" },
  { iata: "JFK", name: "John F. Kennedy International", city: "New York", country: "US", region: "north_america", lat: 40.6413, lon: -73.7781, timeZone: "America/New_York" },
  { iata: "LAX", name: "Los Angeles International", city: "Los Angeles", country: "US", region: "north_america", lat: 33.9416, lon: -118.4085, timeZone: "America/Los_Angeles" },
];

export const AIRPORTS_BY_IATA: ReadonlyMap<string, Airport> = new Map(AIRPORTS.map((a) => [a.iata, a]));
