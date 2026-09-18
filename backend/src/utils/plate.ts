const PLATE_REGEX = /^(?:[가-힣]{2})?\d{2,3}[가-힣]\d{4}$/;

export function normalizePlateNumber(input: string): string {
  return input.replace(/[\s-]/g, "").trim();
}

export function isValidPlateNumber(input: string): boolean {
  return PLATE_REGEX.test(normalizePlateNumber(input));
}
