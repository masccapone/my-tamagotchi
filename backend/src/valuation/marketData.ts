import rawData from "../data/sampleMarketPrices.json";
import { ComparableVehicle } from "../types/vehicle";

/**
 * ⚠️ 샘플/시드 데이터입니다. 실제 서비스에서는 엔카/KB차차차 등 실매물 시세 API
 * 또는 자체 수집 데이터로 교체해야 합니다. 현재는 시세 API를 계약하기 전까지
 * 대략적인 감가 곡선과 비교군 제시 기능을 시연하기 위한 목적으로만 사용합니다.
 */
export const marketData: ComparableVehicle[] = rawData as ComparableVehicle[];

export function findMarketRow(
  manufacturer: string | undefined,
  modelName: string | undefined,
  modelYear: number | undefined,
): ComparableVehicle | undefined {
  if (!manufacturer || !modelName) return undefined;

  const sameModel = marketData.filter(
    (row) => row.manufacturer === manufacturer && row.modelName === modelName,
  );
  if (sameModel.length === 0) return undefined;

  if (modelYear != null) {
    const exact = sameModel.find((row) => row.modelYear === modelYear);
    if (exact) return exact;
  }

  // 정확한 연식이 없으면 가장 가까운 연식을 사용
  return sameModel.sort((a, b) => {
    const da = modelYear != null ? Math.abs(a.modelYear - modelYear) : 0;
    const db = modelYear != null ? Math.abs(b.modelYear - modelYear) : 0;
    return da - db;
  })[0];
}

export function findComparableVehicles(
  manufacturer: string | undefined,
  modelName: string | undefined,
  modelYear: number | undefined,
  limit = 5,
): ComparableVehicle[] {
  if (!manufacturer || !modelName) return [];

  const sameModelOtherYears = marketData.filter(
    (row) =>
      row.manufacturer === manufacturer &&
      row.modelName === modelName &&
      row.modelYear !== modelYear,
  );

  const baseline = findMarketRow(manufacturer, modelName, modelYear);
  const priceBand = baseline
    ? marketData.filter(
        (row) =>
          !(row.manufacturer === manufacturer && row.modelName === modelName) &&
          Math.abs(row.averagePriceKrw - baseline.averagePriceKrw) / baseline.averagePriceKrw <= 0.15,
      )
    : [];

  const combined = [...sameModelOtherYears, ...priceBand];
  return combined
    .sort((a, b) => Math.abs(a.modelYear - (modelYear ?? a.modelYear)) - Math.abs(b.modelYear - (modelYear ?? b.modelYear)))
    .slice(0, limit);
}
