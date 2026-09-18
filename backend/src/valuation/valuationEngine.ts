import { RiskSignal, ValuationResult, VehicleBasicInfo } from "../types/vehicle";
import { findMarketRow } from "./marketData";

const MILEAGE_DEPRECIATION_PER_10K_KM = 0.015; // 기준 대비 1만km 초과 주행 시 -1.5%
const RISK_PENALTY: Record<RiskSignal["level"], number> = {
  info: 0,
  caution: 0.02,
  warning: 0.06,
};

export function estimateValue(params: {
  basicInfo: VehicleBasicInfo | null;
  currentMileageKm?: number;
  riskSignals: RiskSignal[];
}): ValuationResult {
  const { basicInfo, currentMileageKm, riskSignals } = params;
  const basis: string[] = [];

  const marketRow = findMarketRow(basicInfo?.manufacturer, basicInfo?.modelName, basicInfo?.modelYear);

  if (!marketRow) {
    return {
      estimatedValueKrw: 0,
      estimatedRangeKrw: [0, 0],
      confidence: "low",
      basis: [
        "동일/유사 모델의 비교 시세 데이터를 찾지 못해 가치를 추정할 수 없습니다.",
        "제조사·모델명·연식 정보를 확인하거나, 실제 시세 데이터 소스를 연동해주세요.",
      ],
    };
  }

  basis.push(
    `비교 기준: ${marketRow.manufacturer} ${marketRow.modelName} ${marketRow.modelYear}년형 평균 시세 ${format(marketRow.averagePriceKrw)}원 (표본 ${marketRow.sampleSize}건)`,
  );

  let value = marketRow.averagePriceKrw;

  if (currentMileageKm != null) {
    const mileageDiff = currentMileageKm - marketRow.averageMileageKm;
    const mileageAdjustmentRatio = -(mileageDiff / 10_000) * MILEAGE_DEPRECIATION_PER_10K_KM;
    const mileageAdjustment = marketRow.averagePriceKrw * mileageAdjustmentRatio;
    value += mileageAdjustment;
    basis.push(
      `주행거리 보정: 비교군 평균 ${format(marketRow.averageMileageKm)}km 대비 ${mileageDiff >= 0 ? "+" : ""}${format(mileageDiff)}km -> ${mileageAdjustment >= 0 ? "+" : ""}${format(Math.round(mileageAdjustment))}원`,
    );
  } else {
    basis.push("주행거리 정보가 없어 주행거리 보정은 적용하지 않았습니다.");
  }

  const totalRiskPenalty = riskSignals.reduce((sum, s) => sum + RISK_PENALTY[s.level], 0);
  if (totalRiskPenalty > 0) {
    const penaltyAmount = marketRow.averagePriceKrw * totalRiskPenalty;
    value -= penaltyAmount;
    basis.push(
      `이력상 위험 신호 반영: -${Math.round(totalRiskPenalty * 100)}% (-${format(Math.round(penaltyAmount))}원)`,
    );
  }

  value = Math.max(0, Math.round(value));
  const rangeWidth = Math.round(value * 0.08);

  return {
    estimatedValueKrw: value,
    estimatedRangeKrw: [Math.max(0, value - rangeWidth), value + rangeWidth],
    confidence: marketRow.sampleSize >= 30 ? "high" : "medium",
    basis,
  };
}

function format(n: number): string {
  return n.toLocaleString("ko-KR");
}
