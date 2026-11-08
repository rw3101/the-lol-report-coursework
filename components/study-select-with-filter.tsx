"use client";

import { useId, useMemo, useState } from "react";

export type StudySelectOption = {
  id: number;
  label: string;
  hasVotes: boolean;
};

type StudySelectWithFilterProps = {
  name: string;
  options: StudySelectOption[];
  defaultValue: string;
  disabled?: boolean;
};

export function StudySelectWithFilter({
  name,
  options,
  defaultValue,
  disabled = false,
}: StudySelectWithFilterProps) {
  const checkboxId = useId();
  const [onlyWithData, setOnlyWithData] = useState(false);

  const visibleOptions = useMemo(
    () => (onlyWithData ? options.filter((option) => option.hasVotes) : options),
    [onlyWithData, options],
  );

  const selectedIsHidden =
    onlyWithData && !visibleOptions.some((option) => option.id.toString() === defaultValue);

  return (
    <div className="space-y-1.5">
      <label className="app-muted space-y-1 text-sm">
        <span className="block">Study</span>
        <select
          name={name}
          defaultValue={defaultValue}
          disabled={disabled}
          className="app-input h-9 min-w-80 rounded-md px-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
        >
          {selectedIsHidden ? (
            <option value={defaultValue}>
              {options.find((option) => option.id.toString() === defaultValue)?.label ??
                defaultValue}
            </option>
          ) : null}
          {visibleOptions.map((option) => (
            <option key={option.id} value={option.id}>
              {option.label}
              {option.hasVotes ? "" : " (no votes yet)"}
            </option>
          ))}
        </select>
      </label>
      <label htmlFor={checkboxId} className="app-muted flex items-center gap-1.5 text-xs">
        <input
          id={checkboxId}
          type="checkbox"
          checked={onlyWithData}
          onChange={(event) => setOnlyWithData(event.target.checked)}
          className="size-3.5"
        />
        Only show studies with data
      </label>
    </div>
  );
}
