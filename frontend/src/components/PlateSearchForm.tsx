import { useState } from "react";
import type { FormEvent } from "react";

interface Props {
  onSearch: (plateNumber: string) => void;
  loading: boolean;
}

export function PlateSearchForm({ onSearch, loading }: Props) {
  const [value, setValue] = useState("");

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!value.trim()) return;
    onSearch(value.trim());
  }

  return (
    <form className="search-form" onSubmit={handleSubmit}>
      <input
        type="text"
        placeholder="차량번호 입력 (예: 123가4567)"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        disabled={loading}
      />
      <button type="submit" disabled={loading}>
        {loading ? "조회 중..." : "안전 리포트 조회"}
      </button>
    </form>
  );
}
