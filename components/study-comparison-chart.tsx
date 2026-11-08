"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type StudyComparisonChartRow = {
  metric: string;
  studyA: number;
  studyB: number;
};

type StudyComparisonChartProps = {
  studyALabel: string;
  studyBLabel: string;
  data: StudyComparisonChartRow[];
};

const COLORS = {
  grid: "rgba(148, 163, 184, 0.28)",
  axis: "#64748b",
  studyA: "#ec4899",
  studyB: "#38bdf8",
};

const formatPercentTick = (value: number) => `${value}%`;

export function StudyComparisonChart({
  studyALabel,
  studyBLabel,
  data,
}: StudyComparisonChartProps) {
  if (data.length === 0) {
    return null;
  }

  return (
    <article className="app-chart-card rounded-xl p-4">
      <h3 className="text-sm font-semibold">Score Metrics, Side by Side</h3>
      <p className="app-muted mt-1 text-xs">
        Weighted score, average caption score, median caption score, and caption overlap ratio.
        All metrics are percentages, so differences are directly comparable at a glance.
      </p>
      <div className="mt-3 h-80 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 10, right: 10, bottom: 10, left: 0 }}
            accessibilityLayer
          >
            <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" />
            <XAxis dataKey="metric" stroke={COLORS.axis} tick={{ fontSize: 12 }} />
            <YAxis
              stroke={COLORS.axis}
              tickFormatter={formatPercentTick}
              tick={{ fontSize: 12 }}
              domain={[0, 100]}
            />
            <Tooltip
              formatter={(value, name) => [
                `${Number(value).toFixed(2)}%`,
                name === "studyA" ? studyALabel : studyBLabel,
              ]}
            />
            <Legend
              iconType="circle"
              formatter={(value) => (value === "studyA" ? studyALabel : studyBLabel)}
              wrapperStyle={{ fontSize: 12 }}
            />
            <Bar dataKey="studyA" name="studyA" fill={COLORS.studyA} radius={[4, 4, 0, 0]} />
            <Bar dataKey="studyB" name="studyB" fill={COLORS.studyB} radius={[4, 4, 0, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}
