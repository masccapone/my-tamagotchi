import type {
  ComparableVehicle,
  InspectionRecord,
  MaintenanceRecord,
  RecallRecord,
  VehicleReport,
} from "../types";

const won = (n: number) => `${n.toLocaleString("ko-KR")}원`;

export function VehicleReportView({ report }: { report: VehicleReport }) {
  const { history, valuation, comparableVehicles } = report;
  const { basicInfo } = history;

  return (
    <div className="report">
      <section className="card">
        <h2>기본 정보</h2>
        {basicInfo ? (
          <dl className="info-grid">
            <dt>차량번호</dt>
            <dd>{basicInfo.plateNumber}</dd>
            <dt>제조사 / 모델</dt>
            <dd>{basicInfo.manufacturer ?? "-"} {basicInfo.modelName ?? ""}</dd>
            <dt>연식</dt>
            <dd>{basicInfo.modelYear ?? "-"}</dd>
            <dt>최초등록일</dt>
            <dd>{basicInfo.firstRegistrationDate ?? "-"}</dd>
            <dt>연료</dt>
            <dd>{basicInfo.fuelType ?? "-"}</dd>
          </dl>
        ) : (
          <p className="muted">기본 정보를 불러오지 못했습니다. 아래 안내 메시지를 확인하세요.</p>
        )}
      </section>

      <section className="card">
        <h2>위험 신호 체크</h2>
        <ul className="risk-list">
          {history.riskSignals.map((signal, i) => (
            <li key={i} className={`risk-${signal.level}`}>
              {signal.message}
            </li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>적정 가치 추정</h2>
        {valuation.estimatedValueKrw > 0 ? (
          <>
            <p className="estimate">
              {won(valuation.estimatedValueKrw)}
              <span className="range">
                {" "}
                (예상 범위 {won(valuation.estimatedRangeKrw[0])} ~ {won(valuation.estimatedRangeKrw[1])})
              </span>
            </p>
            <p className="confidence">신뢰도: {confidenceLabel(valuation.confidence)}</p>
          </>
        ) : (
          <p className="muted">비교 데이터 부족으로 가치를 추정할 수 없습니다.</p>
        )}
        <ul className="basis-list">
          {valuation.basis.map((b, i) => (
            <li key={i}>{b}</li>
          ))}
        </ul>
      </section>

      <section className="card">
        <h2>비교 차량</h2>
        <ComparableTable vehicles={comparableVehicles} />
      </section>

      <section className="card">
        <h2>검사 이력</h2>
        <InspectionTable rows={history.inspections} />
      </section>

      <section className="card">
        <h2>정비 이력</h2>
        <MaintenanceTable rows={history.maintenance} />
      </section>

      <section className="card">
        <h2>리콜 정보</h2>
        <RecallTable rows={history.recalls} />
      </section>

      {history.dataSourceWarnings.length > 0 && (
        <section className="card warning-card">
          <h2>데이터 조회 안내</h2>
          <ul>
            {history.dataSourceWarnings.map((w, i) => (
              <li key={i}>{w}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

function confidenceLabel(c: "low" | "medium" | "high") {
  return { low: "낮음", medium: "보통", high: "높음" }[c];
}

function ComparableTable({ vehicles }: { vehicles: ComparableVehicle[] }) {
  if (vehicles.length === 0) return <p className="muted">비교 가능한 차량이 없습니다.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>제조사</th>
          <th>모델</th>
          <th>연식</th>
          <th>평균 시세</th>
          <th>평균 주행거리</th>
        </tr>
      </thead>
      <tbody>
        {vehicles.map((v, i) => (
          <tr key={i}>
            <td>{v.manufacturer}</td>
            <td>{v.modelName}</td>
            <td>{v.modelYear}</td>
            <td>{won(v.averagePriceKrw)}</td>
            <td>{v.averageMileageKm.toLocaleString("ko-KR")}km</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function InspectionTable({ rows }: { rows: InspectionRecord[] }) {
  if (rows.length === 0) return <p className="muted">검사 이력이 없습니다.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>검사일</th>
          <th>종류</th>
          <th>결과</th>
          <th>주행거리</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.inspectionDate}</td>
            <td>{r.inspectionType ?? "-"}</td>
            <td className={r.result === "합격" ? "" : "text-warning"}>{r.result}</td>
            <td>{r.mileageKm ? `${r.mileageKm.toLocaleString("ko-KR")}km` : "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function MaintenanceTable({ rows }: { rows: MaintenanceRecord[] }) {
  if (rows.length === 0) return <p className="muted">정비 이력이 없습니다.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>정비일</th>
          <th>항목</th>
          <th>내용</th>
          <th>주행거리</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.serviceDate}</td>
            <td>{r.workType ?? "-"}</td>
            <td>{r.description ?? "-"}</td>
            <td>{r.mileageKm ? `${r.mileageKm.toLocaleString("ko-KR")}km` : "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function RecallTable({ rows }: { rows: RecallRecord[] }) {
  if (rows.length === 0) return <p className="muted">리콜 이력이 없습니다.</p>;
  return (
    <table>
      <thead>
        <tr>
          <th>리콜일</th>
          <th>사유</th>
          <th>조치</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i}>
            <td>{r.recallDate}</td>
            <td>{r.reason}</td>
            <td>{r.remedy ?? "-"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
