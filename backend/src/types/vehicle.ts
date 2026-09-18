export interface VehicleBasicInfo {
  plateNumber: string;
  vin?: string;
  manufacturer?: string;
  modelName?: string;
  modelYear?: number;
  firstRegistrationDate?: string;
  fuelType?: string;
  displacement?: number;
  usageType?: string;
  vehicleType?: string;
}

export interface InspectionRecord {
  inspectionDate: string;
  inspectionType?: string;
  result: "합격" | "부적합" | string;
  mileageKm?: number;
  defectItems?: string[];
}

export interface MaintenanceRecord {
  serviceDate: string;
  mileageKm?: number;
  workshopName?: string;
  workType?: string;
  description?: string;
  cost?: number;
}

export interface OwnershipChangeRecord {
  changeDate: string;
  changeType: string;
  region?: string;
}

export interface RecallRecord {
  recallDate: string;
  manufacturer: string;
  modelName: string;
  reason: string;
  remedy?: string;
}

export interface VehicleHistoryReport {
  plateNumber: string;
  fetchedAt: string;
  basicInfo: VehicleBasicInfo | null;
  inspections: InspectionRecord[];
  maintenance: MaintenanceRecord[];
  ownershipChanges: OwnershipChangeRecord[];
  recalls: RecallRecord[];
  riskSignals: RiskSignal[];
  dataSourceWarnings: string[];
}

export interface RiskSignal {
  level: "info" | "caution" | "warning";
  message: string;
}

export interface ValuationResult {
  estimatedValueKrw: number;
  estimatedRangeKrw: [number, number];
  confidence: "low" | "medium" | "high";
  basis: string[];
}

export interface ComparableVehicle {
  manufacturer: string;
  modelName: string;
  modelYear: number;
  averagePriceKrw: number;
  averageMileageKm: number;
  sampleSize: number;
}

export interface VehicleReport {
  history: VehicleHistoryReport;
  valuation: ValuationResult;
  comparableVehicles: ComparableVehicle[];
}
