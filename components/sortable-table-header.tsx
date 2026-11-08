"use client";

export type SortDirection = "asc" | "desc";

export const getSortAriaValue = <T extends string>(
  activeSortBy: T,
  activeSortDirection: SortDirection,
  column: T,
): "none" | "ascending" | "descending" => {
  if (activeSortBy !== column) {
    return "none";
  }

  return activeSortDirection === "asc" ? "ascending" : "descending";
};

type SortableTableHeaderProps<T extends string> = {
  label: string;
  column: T;
  activeSortBy: T;
  activeSortDirection: SortDirection;
  onSort: (column: T) => void;
  disabled?: boolean;
};

/**
 * Renders a <th> whose whole header is a button, with a sort arrow that is
 * always visible (not just once the column becomes the active sort) so the
 * sort capability is discoverable without reading the page description.
 */
export function SortableTableHeader<T extends string>({
  label,
  column,
  activeSortBy,
  activeSortDirection,
  onSort,
  disabled = false,
}: SortableTableHeaderProps<T>) {
  const isActive = activeSortBy === column;
  const indicator = isActive ? (activeSortDirection === "asc" ? "↑" : "↓") : "↕";

  return (
    <th
      aria-sort={getSortAriaValue(activeSortBy, activeSortDirection, column)}
      className="px-1.5 py-1.5 text-left"
      scope="col"
    >
      <button
        type="button"
        disabled={disabled}
        onClick={() => onSort(column)}
        className={`app-button inline-flex cursor-pointer items-center gap-1.5 whitespace-nowrap rounded-md px-2.5 py-1.5 text-xs font-semibold transition disabled:cursor-wait disabled:opacity-70 ${
          isActive ? "app-button-primary" : ""
        }`}
      >
        <span>{label}</span>
        <span className={isActive ? "" : "app-muted"} aria-hidden="true">
          {indicator}
        </span>
      </button>
    </th>
  );
}
