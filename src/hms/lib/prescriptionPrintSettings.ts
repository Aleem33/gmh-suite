export type PrescriptionPrintSection = {
  offsetX: number;
  offsetY: number;
};

export type PrescriptionPrintSettings = {
  offsetX: number;
  offsetY: number;
  fontScale: number;
  name: PrescriptionPrintSection;
  age: PrescriptionPrintSection;
  date: PrescriptionPrintSection;
  clinical: PrescriptionPrintSection;
  medicines: PrescriptionPrintSection;
  vitals: PrescriptionPrintSection;
};

const STORAGE_KEY = 'gmh-suite-prescription-print-settings';

export const DEFAULT_PRESCRIPTION_PRINT_SETTINGS: PrescriptionPrintSettings = {
  offsetX: 0,
  offsetY: 0,
  fontScale: 100,
  name: { offsetX: 0, offsetY: 0 },
  age: { offsetX: 0, offsetY: 0 },
  date: { offsetX: 0, offsetY: 0 },
  clinical: { offsetX: 0, offsetY: 0 },
  medicines: { offsetX: 0, offsetY: 0 },
  vitals: { offsetX: 0, offsetY: 0 },
};

function normalizeSection(value: unknown): PrescriptionPrintSection {
  const section = value as Partial<PrescriptionPrintSection> | undefined;
  return {
    offsetX: Number(section?.offsetX) || 0,
    offsetY: Number(section?.offsetY) || 0,
  };
}

function normalizeSettings(value: Partial<PrescriptionPrintSettings> | null | undefined): PrescriptionPrintSettings {
  return {
    offsetX: Number(value?.offsetX) || 0,
    offsetY: Number(value?.offsetY) || 0,
    fontScale: Number(value?.fontScale) || 100,
    name: normalizeSection(value?.name),
    age: normalizeSection(value?.age),
    date: normalizeSection(value?.date),
    clinical: normalizeSection(value?.clinical),
    medicines: normalizeSection(value?.medicines),
    vitals: normalizeSection(value?.vitals),
  };
}

export function getPrescriptionPrintSettings(): PrescriptionPrintSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_PRESCRIPTION_PRINT_SETTINGS;
    const parsed = JSON.parse(saved);
    return normalizeSettings(parsed);
  } catch {
    return DEFAULT_PRESCRIPTION_PRINT_SETTINGS;
  }
}

export function savePrescriptionPrintSettings(settings: PrescriptionPrintSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalizeSettings(settings)));
}
