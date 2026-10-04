export const AIRCRAFT_TYPES = ['Freestyle', 'Racing', 'Cinewhoop', 'Long range', 'Tiny whoop', 'Other'] as const;
export type AircraftType = (typeof AIRCRAFT_TYPES)[number];

export interface Aircraft {
  id: number;
  name: string;
  type: AircraftType;
  propSize: string;          // e.g. 5"
  frame: string;
  flightController: string;
  battery: string;           // e.g. 6S 1300mAh
  weightGrams: number | null;
  notes: string;
  imageUrl: string | null;
  createdAt: string;
  tuneCount: number;
  lastTuneAt: string | null;
}

/** What the form edits. The image travels separately as a File. */
export interface AircraftInput {
  name: string;
  type: AircraftType;
  propSize: string;
  frame: string;
  flightController: string;
  battery: string;
  weightGrams: number | null;
  notes: string;
}
