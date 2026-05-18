export type PrescriptionPrintSettings = {
  offsetX: number;
  offsetY: number;
  fontScale: number;
};

const STORAGE_KEY = 'gmh-suite-prescription-print-settings';

export const DEFAULT_PRESCRIPTION_PRINT_SETTINGS: PrescriptionPrintSettings = {
  offsetX: 0,
  offsetY: 0,
  fontScale: 100,
};

export function getPrescriptionPrintSettings(): PrescriptionPrintSettings {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (!saved) return DEFAULT_PRESCRIPTION_PRINT_SETTINGS;
    const parsed = JSON.parse(saved);
    return {
      offsetX: Number(parsed.offsetX) || 0,
      offsetY: Number(parsed.offsetY) || 0,
      fontScale: Number(parsed.fontScale) || 100,
    };
  } catch {
    return DEFAULT_PRESCRIPTION_PRINT_SETTINGS;
  }
}

export function savePrescriptionPrintSettings(settings: PrescriptionPrintSettings) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({
    offsetX: Number(settings.offsetX) || 0,
    offsetY: Number(settings.offsetY) || 0,
    fontScale: Number(settings.fontScale) || 100,
  }));
}
