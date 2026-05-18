const INTEGER_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 0
});

const DECIMAL_FORMAT = new Intl.NumberFormat("en-US", {
  maximumFractionDigits: 1,
  minimumFractionDigits: 1
});

export function formatInteger(value: number): string {
  return INTEGER_FORMAT.format(value);
}

export function formatDecimal(value: number): string {
  return DECIMAL_FORMAT.format(value);
}

export function formatArea(value: number): string {
  return value > 0 ? `${formatDecimal(value)} m2` : "From model";
}
