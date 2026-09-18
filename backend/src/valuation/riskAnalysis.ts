import {
  InspectionRecord,
  MaintenanceRecord,
  OwnershipChangeRecord,
  RecallRecord,
  RiskSignal,
} from "../types/vehicle";

const FLOOD_KEYWORDS = ["침수", "수해"];
const FRAME_KEYWORDS = ["프레임", "골격", "전손"];

export function analyzeRiskSignals(params: {
  inspections: InspectionRecord[];
  maintenance: MaintenanceRecord[];
  ownershipChanges: OwnershipChangeRecord[];
  recalls: RecallRecord[];
}): RiskSignal[] {
  const signals: RiskSignal[] = [];
  const { inspections, maintenance, ownershipChanges, recalls } = params;

  const failedInspections = inspections.filter((i) => i.result !== "합격");
  if (failedInspections.length > 0) {
    signals.push({
      level: "warning",
      message: `검사 부적합 이력 ${failedInspections.length}건이 있습니다. 부적합 사유를 반드시 확인하세요.`,
    });
  }

  const allText = maintenance.map((m) => `${m.workType ?? ""} ${m.description ?? ""}`).join(" ");
  if (FLOOD_KEYWORDS.some((k) => allText.includes(k))) {
    signals.push({
      level: "warning",
      message: "정비 이력에 침수 관련 키워드가 발견되었습니다. 침수차 여부를 전문가와 반드시 재확인하세요.",
    });
  }
  if (FRAME_KEYWORDS.some((k) => allText.includes(k))) {
    signals.push({
      level: "warning",
      message: "정비 이력에 프레임/골격 손상 관련 키워드가 발견되었습니다.",
    });
  }

  const heavyRepairCount = maintenance.filter((m) => (m.cost ?? 0) >= 1_000_000).length;
  if (heavyRepairCount > 0) {
    signals.push({
      level: "caution",
      message: `고액(100만원 이상) 정비 이력이 ${heavyRepairCount}건 있습니다. 수리 내역을 확인해보세요.`,
    });
  }

  const ownershipCount = ownershipChanges.filter((c) => c.changeType.includes("소유")).length;
  if (ownershipCount >= 3) {
    signals.push({
      level: "caution",
      message: `소유자 변경이 ${ownershipCount}회로 잦은 편입니다. 단기 전매 이력이 있는지 확인해보세요.`,
    });
  }

  if (recalls.length > 0) {
    signals.push({
      level: "info",
      message: `해당 모델에 리콜 이력이 ${recalls.length}건 있습니다. 리콜 시정조치(무상수리) 완료 여부를 확인하세요.`,
    });
  }

  if (signals.length === 0) {
    signals.push({ level: "info", message: "확인된 주요 위험 신호가 없습니다. 다만 공개 데이터만으로는 사고/침수 이력을 100% 보장할 수 없습니다." });
  }

  return signals;
}
