import { getVehicleBasicInfo } from "../providers/car365/registration";
import { getInspectionHistory } from "../providers/car365/inspection";
import { getMaintenanceHistory } from "../providers/car365/maintenance";
import { getOwnershipChangeHistory } from "../providers/car365/ownershipChange";
import { getRecallsByModel } from "../providers/recall/recallClient";
import { analyzeRiskSignals } from "../valuation/riskAnalysis";
import { estimateValue } from "../valuation/valuationEngine";
import { findComparableVehicles } from "../valuation/marketData";
import {
  InspectionRecord,
  MaintenanceRecord,
  OwnershipChangeRecord,
  RecallRecord,
  VehicleBasicInfo,
  VehicleReport,
} from "../types/vehicle";
import { normalizePlateNumber } from "../utils/plate";

async function settle<T>(promise: Promise<T>, fallback: T, onError: (message: string) => void): Promise<T> {
  try {
    return await promise;
  } catch (error) {
    onError(error instanceof Error ? error.message : String(error));
    return fallback;
  }
}

export async function buildVehicleReport(rawPlateNumber: string): Promise<VehicleReport> {
  const plateNumber = normalizePlateNumber(rawPlateNumber);
  const warnings: string[] = [];
  const addWarning = (message: string) => warnings.push(message);

  const basicInfo: VehicleBasicInfo | null = await settle(
    getVehicleBasicInfo(plateNumber),
    null,
    (m) => addWarning(`기본정보 조회 실패: ${m}`),
  );

  const [inspections, maintenance, ownershipChanges] = await Promise.all([
    settle<InspectionRecord[]>(getInspectionHistory(plateNumber), [], (m) =>
      addWarning(`검사이력 조회 실패: ${m}`),
    ),
    settle<MaintenanceRecord[]>(getMaintenanceHistory(plateNumber), [], (m) =>
      addWarning(`정비이력 조회 실패: ${m}`),
    ),
    settle<OwnershipChangeRecord[]>(getOwnershipChangeHistory(plateNumber), [], (m) =>
      addWarning(`소유변경이력 조회 실패: ${m}`),
    ),
  ]);

  const recalls: RecallRecord[] = await settle<RecallRecord[]>(
    getRecallsByModel(basicInfo?.manufacturer ?? "", basicInfo?.modelName ?? ""),
    [],
    (m) => addWarning(`리콜정보 조회 실패: ${m}`),
  );

  const riskSignals = analyzeRiskSignals({ inspections, maintenance, ownershipChanges, recalls });

  const latestMileage =
    inspections.find((i) => i.mileageKm != null)?.mileageKm ??
    maintenance.find((m) => m.mileageKm != null)?.mileageKm;

  const valuation = estimateValue({
    basicInfo,
    currentMileageKm: latestMileage,
    riskSignals,
  });

  const comparableVehicles = findComparableVehicles(
    basicInfo?.manufacturer,
    basicInfo?.modelName,
    basicInfo?.modelYear,
  );

  return {
    history: {
      plateNumber,
      fetchedAt: new Date().toISOString(),
      basicInfo,
      inspections,
      maintenance,
      ownershipChanges,
      recalls,
      riskSignals,
      dataSourceWarnings: warnings,
    },
    valuation,
    comparableVehicles,
  };
}
