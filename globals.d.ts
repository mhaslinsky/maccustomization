/** Übersicht / WebKit widget runtime */

declare const geolocation: GeolocationApi | undefined;

interface Window {
  geolocation?: GeolocationApi;
}

interface GeolocationApi {
  getCurrentPosition: (success: (result: UebersichtGeolocationResult) => void) => void;
}

/** Übersicht wraps the position inside a `position` key. */
interface UebersichtGeolocationResult {
  position?: UebersichtGeolocationPosition;
  address?: { City?: string; State?: string; Country?: string };
}

interface UebersichtGeolocationPosition {
  timestamp?: number;
  coords?: { latitude: number; longitude: number };
  address?: { City?: string; State?: string; Country?: string };
}
