import { useState } from "react";
import "./index.css";
import { ApiError, fetchVehicleReport } from "./api/client";
import { PlateSearchForm } from "./components/PlateSearchForm";
import { VehicleReportView } from "./components/VehicleReportView";
import type { VehicleReport } from "./types";

export default function App() {
  const [report, setReport] = useState<VehicleReport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSearch(plateNumber: string) {
    setLoading(true);
    setError(null);
    setReport(null);
    try {
      const result = await fetchVehicleReport(plateNumber);
      setReport(result);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "알 수 없는 오류가 발생했습니다.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="app">
      <header>
        <h1>중고차 안전구매 도우미</h1>
        <p className="subtitle">차량번호만 입력하면 이력, 위험 신호, 적정 가치, 비교 차량까지 한 번에 확인하세요.</p>
      </header>

      <PlateSearchForm onSearch={handleSearch} loading={loading} />

      {error && <p className="error-message">{error}</p>}
      {report && <VehicleReportView report={report} />}
    </div>
  );
}
