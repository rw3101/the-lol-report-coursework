"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

export type DemographicBreakdownChartRow = {
  answer: string;
  upvote_percentage: number;
};

type DemographicBreakdownChartProps = {
  questionLabel: string;
  data: DemographicBreakdownChartRow[];
};

const COLORS = {
  grid: "rgba(148, 163, 184, 0.28)",
  axis: "#64748b",
  bar: "#ec4899",
};

const formatPercentTick = (value: number) => `${value}%`;

export function DemographicBreakdownChart({
  questionLabel,
  data,
}: DemographicBreakdownChartProps) {
  if (data.length === 0) {
    return (
      <section className="space-y-2">
        <h2 className="text-lg font-semibold">Upvote Rate by Answer</h2>
        <p className="app-muted text-sm">
          No answer group currently has enough distinct voters to chart.
        </p>
      </section>
    );
  }

  return (
    <section className="space-y-2">
      <h2 className="text-lg font-semibold">Upvote Rate by Answer</h2>
      <article className="app-chart-card rounded-xl p-4">
        <h3 className="text-sm font-semibold">{questionLabel}</h3>
        <p className="app-muted mt-1 text-xs">
          Only answer groups meeting the minimum distinct-voter threshold are shown.
        </p>
        <div className="mt-3 h-80 w-full">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart
              data={data}
              layout="vertical"
              margin={{ top: 10, right: 20, bottom: 10, left: 10 }}
              accessibilityLayer
            >
              <CartesianGrid stroke={COLORS.grid} strokeDasharray="3 3" />
              <XAxis
                type="number"
                stroke={COLORS.axis}
                tickFormatter={formatPercentTick}
                tick={{ fontSize: 12 }}
                domain={[0, 100]}
              />
              <YAxis
                type="category"
                dataKey="answer"
                stroke={COLORS.axis}
                tick={{ fontSize: 12 }}
                width={160}
              />
              <Tooltip formatter={(value) => [`${Number(value).toFixed(1)}%`, "Upvote rate"]} />
              <Bar dataKey="upvote_percentage" fill={COLORS.bar} radius={[0, 4, 4, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </article>
    </section>
  );
}
