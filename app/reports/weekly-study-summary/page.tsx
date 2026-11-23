import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";

import { WeeklyStudySummaryCharts } from "@/components/weekly-study-summary-charts";
import type { Database, Tables } from "@/src/types/supabase";
import {
  type StudyCaptionVoteEventRow,
  isPositiveStudyVote,
} from "@/utils/study-vote-events";
import { createClient } from "@/utils/supabase/server";

const DEFAULT_STUDY_LIMIT = 8;
const MAX_STUDY_LIMIT = 52;
const QUERY_CHUNK_SIZE = 120;
const QUERY_RETRY_ATTEMPTS = 3;
const QUERY_RETRY_BASE_DELAY_MS = 150;
const QUERY_PAGE_SIZE = 1000;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

type WeeklyStudySummarySearchParams = Promise<{
  limit?: string;
  week?: string;
}>;

type WeekOption = {
  value: string;
  label: string;
  studyCount: number;
};

type WeeklyStudySummaryPageProps = {
  searchParams: WeeklyStudySummarySearchParams;
};

type StudySummary = Pick<
  Tables<"studies">,
  | "id"
  | "slug"
  | "description"
  | "start_datetime_utc"
  | "end_datetime_utc"
  | "created_datetime_utc"
>;

type StudyCaptionMappingRow = Pick<Tables<"study_caption_mappings">, "id" | "study_id" | "caption_id">;

type StudyVoteRow = Pick<StudyCaptionVoteEventRow, "study_caption_mapping_id" | "vote_value">;

type NumberParamParseResult = {
  value: number;
  isValid: boolean;
};

type StudyMetric = {
  study: StudySummary;
  caption_count: number;
  total_votes: number;
  upvotes: number;
  weighted_score: number;
  votes_per_caption: number;
};

const chunkArray = <T,>(items: T[], chunkSize: number): T[][] => {
  if (items.length === 0) {
    return [];
  }

  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += chunkSize) {
    chunks.push(items.slice(index, index + chunkSize));
  }

  return chunks;
};

const wait = (ms: number): Promise<void> =>
  new Promise((resolve: () => void) => {
    setTimeout(() => resolve(), ms);
  });

const isLikelyTransientFetchError = (message: string) => {
  const normalized = message.toLowerCase();

  return (
    normalized.includes("fetch failed") ||
    normalized.includes("failed to fetch") ||
    normalized.includes("network") ||
    normalized.includes("timed out") ||
    normalized.includes("econnreset") ||
    normalized.includes("socket hang up")
  );
};

type SupabaseQueryResult<TRow> = {
  data: TRow[] | null;
  error: { message: string } | null;
};

const fetchRowsWithPagination = async <TRow,>({
  contextLabel,
  pageSize = QUERY_PAGE_SIZE,
  runQuery,
}: {
  contextLabel: string;
  pageSize?: number;
  runQuery: (from: number, to: number) => Promise<SupabaseQueryResult<TRow>>;
}): Promise<TRow[]> => {
  for (let attempt = 1; attempt <= QUERY_RETRY_ATTEMPTS; attempt += 1) {
    try {
      const rows: TRow[] = [];
      let from = 0;

      while (true) {
        const to = from + pageSize - 1;
        const { data, error } = await runQuery(from, to);
        if (error) {
          throw new Error(error.message);
        }

        const pageRows = data ?? [];
        rows.push(...pageRows);
        if (pageRows.length < pageSize) {
          return rows;
        }

        from += pageSize;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Unknown query error";
      const transient = isLikelyTransientFetchError(message);
      const hasRemainingRetries = attempt < QUERY_RETRY_ATTEMPTS;
      if (transient && hasRemainingRetries) {
        await wait(QUERY_RETRY_BASE_DELAY_MS * attempt);
        continue;
      }

      throw new Error(`Unable to load ${contextLabel}: ${message}`);
    }
  }

  throw new Error(`Unable to load ${contextLabel}: exhausted retries`);
};

const roundScore = (value: number) => Number(value.toFixed(4));

const parseBoundedInteger = (
  rawValue: string | undefined,
  fallback: number,
  min: number,
  max: number,
): NumberParamParseResult => {
  if (!rawValue) {
    return { value: fallback, isValid: true };
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return { value: fallback, isValid: false };
  }

  return { value: parsed, isValid: true };
};

const getStudyStartMs = (study: StudySummary) => {
  const parsed = Date.parse(study.start_datetime_utc ?? study.created_datetime_utc);
  return Number.isFinite(parsed) ? parsed : null;
};

const getWeekStartMs = (ms: number) => {
  const date = new Date(ms);
  const dayOfWeek = date.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  return Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday);
};

const formatWeekRangeLabel = (weekStartMs: number) => {
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const weekEndMs = weekStartMs + 6 * MS_PER_DAY;
  return `${formatter.format(new Date(weekStartMs))} - ${formatter.format(new Date(weekEndMs))}`;
};

const getWeekOptions = (studies: StudySummary[]): WeekOption[] => {
  const countByWeekStart = new Map<number, number>();
  for (const study of studies) {
    const startMs = getStudyStartMs(study);
    if (startMs === null) {
      continue;
    }

    const weekStartMs = getWeekStartMs(startMs);
    countByWeekStart.set(weekStartMs, (countByWeekStart.get(weekStartMs) ?? 0) + 1);
  }

  return [...countByWeekStart.entries()]
    .sort(([left], [right]) => right - left)
    .map(([weekStartMs, studyCount]) => ({
      value: weekStartMs.toString(),
      label: `Week of ${formatWeekRangeLabel(weekStartMs)}`,
      studyCount,
    }));
};

const getChartStudyLabel = (study: StudySummary) => {
  if (study.slug) {
    return study.slug.length <= 14 ? study.slug : `${study.slug.slice(0, 14)}…`;
  }

  return `S${study.id}`;
};

const getStudies = async (
  supabase: SupabaseClient<Database>,
  limit: number,
): Promise<StudySummary[]> => {
  const { data, error } = await supabase
    .from("studies")
    .select(
      "id, slug, description, start_datetime_utc, end_datetime_utc, created_datetime_utc",
    )
    .order("id", { ascending: false })
    .limit(limit);

  if (error) {
    throw new Error(`Unable to load studies: ${error.message}`);
  }

  return data;
};

const getStudyCaptionMappings = async (
  supabase: SupabaseClient<Database>,
  studyIds: number[],
): Promise<StudyCaptionMappingRow[]> => {
  if (studyIds.length === 0) {
    return [];
  }

  return fetchRowsWithPagination<StudyCaptionMappingRow>({
    contextLabel: "study caption mappings",
    runQuery: async (from, to) =>
      (await supabase
        .from("study_caption_mappings")
        .select("id, study_id, caption_id")
        .in("study_id", studyIds)
        .order("id", { ascending: true })
        .range(from, to)) as SupabaseQueryResult<StudyCaptionMappingRow>,
  });
};

const getVoteSummaryByMappingId = async (
  supabase: SupabaseClient<Database>,
  mappingIds: number[],
): Promise<Map<number, { totalVotes: number; upvotes: number }>> => {
  const voteSummaryByMappingId = new Map<number, { totalVotes: number; upvotes: number }>();
  if (mappingIds.length === 0) {
    return voteSummaryByMappingId;
  }

  await Promise.all(
    chunkArray(mappingIds, QUERY_CHUNK_SIZE).map(async (chunk) => {
      const voteRows = await fetchRowsWithPagination<StudyVoteRow>({
        contextLabel: "study caption vote events",
        runQuery: async (from, to) =>
          (await supabase
            .from("study_caption_vote_events")
            .select("study_caption_mapping_id, vote_value")
            .in("study_caption_mapping_id", chunk)
            .order("id", { ascending: true })
            .range(from, to)) as SupabaseQueryResult<StudyVoteRow>,
      });

      for (const vote of voteRows) {
        if (vote.study_caption_mapping_id === null) {
          continue;
        }

        const current = voteSummaryByMappingId.get(vote.study_caption_mapping_id) ?? {
          totalVotes: 0,
          upvotes: 0,
        };
        current.totalVotes += 1;
        if (isPositiveStudyVote(vote.vote_value)) {
          current.upvotes += 1;
        }

        voteSummaryByMappingId.set(vote.study_caption_mapping_id, current);
      }
    }),
  );

  return voteSummaryByMappingId;
};

const buildStudyMetrics = async ({
  studies,
  mappingsByStudyId,
  voteSummaryByMappingId,
}: {
  studies: StudySummary[];
  mappingsByStudyId: Map<number, StudyCaptionMappingRow[]>;
  voteSummaryByMappingId: Map<number, { totalVotes: number; upvotes: number }>;
}): Promise<StudyMetric[]> =>
  Promise.all(
    studies.map(async (study) => {
      const mappings = mappingsByStudyId.get(study.id) ?? [];
      const captionCount = new Set(mappings.map((mapping) => mapping.caption_id)).size;
      let totalVotes = 0;
      let upvotes = 0;

      for (const mapping of mappings) {
        const voteSummary = voteSummaryByMappingId.get(mapping.id);
        if (!voteSummary) {
          continue;
        }

        totalVotes += voteSummary.totalVotes;
        upvotes += voteSummary.upvotes;
      }

      const weightedScore = totalVotes === 0 ? 0 : upvotes / totalVotes;
      const votesPerCaption = captionCount === 0 ? 0 : totalVotes / captionCount;

      return {
        study,
        caption_count: captionCount,
        total_votes: totalVotes,
        upvotes,
        weighted_score: roundScore(weightedScore),
        votes_per_caption: roundScore(votesPerCaption),
      };
    }),
  );

export const dynamic = "force-dynamic";

export default async function WeeklyStudySummaryPage({
  searchParams,
}: WeeklyStudySummaryPageProps) {
  const params = await searchParams;
  const studyLimitResult = parseBoundedInteger(
    params.limit,
    DEFAULT_STUDY_LIMIT,
    1,
    MAX_STUDY_LIMIT,
  );
  const generatedAtUtc = new Date().toISOString();

  const supabase = await createClient();
  const loadedStudies = await getStudies(supabase, studyLimitResult.value);
  const weekOptions = getWeekOptions(loadedStudies);
  const selectedWeek = params.week?.trim() ?? "";
  const isValidWeekSelection =
    selectedWeek !== "" && weekOptions.some((option) => option.value === selectedWeek);
  const studies = isValidWeekSelection
    ? loadedStudies.filter((study) => {
        const startMs = getStudyStartMs(study);
        return startMs !== null && getWeekStartMs(startMs).toString() === selectedWeek;
      })
    : loadedStudies;
  const studyIds = studies.map((study) => study.id);

  const mappings = await getStudyCaptionMappings(supabase, studyIds);
  const mappingsByStudyId = new Map<number, StudyCaptionMappingRow[]>();
  for (const studyId of studyIds) {
    mappingsByStudyId.set(studyId, []);
  }

  for (const mapping of mappings) {
    const bucket = mappingsByStudyId.get(mapping.study_id);
    if (!bucket) {
      continue;
    }

    bucket.push(mapping);
  }
  const voteSummaryByMappingId = await getVoteSummaryByMappingId(
    supabase,
    [...new Set(mappings.map((mapping) => mapping.id))],
  );

  const studyMetrics = await buildStudyMetrics({
    studies,
    mappingsByStudyId,
    voteSummaryByMappingId,
  });
  const chartRows = [...studyMetrics].reverse().map((metric) => ({
    study_id: metric.study.id,
    study_label: getChartStudyLabel(metric.study),
    weighted_score_pct: roundScore(metric.weighted_score * 100),
    total_votes: metric.total_votes,
    caption_count: metric.caption_count,
    votes_per_caption: metric.votes_per_caption,
  }));

  return (
    <main className="page-shell min-h-screen p-6 text-foreground">
      <section className="app-panel mx-auto w-full max-w-7xl space-y-6 rounded-2xl p-6">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="space-y-2">
            <p className="app-kicker text-xs font-semibold uppercase tracking-[0.24em]">
              Humor Study Stats
            </p>
            <h1 className="text-2xl font-semibold">Weekly Humor Study Summary</h1>
            <p className="app-muted text-sm">
              Studies charted: {chartRows.length} | Generated at: {generatedAtUtc}
            </p>
            <p className="app-muted text-sm">
              This faster view uses study-level aggregates instead of per-caption vote scans.
            </p>
            <p className="app-muted text-sm">
              Weighted score formula: total upvotes / total votes.
            </p>
            <form method="get" className="flex flex-wrap items-end gap-3">
              <label className="app-muted space-y-1 text-sm">
                <span className="block">Studies to include</span>
                <input
                  type="number"
                  name="limit"
                  min={1}
                  max={MAX_STUDY_LIMIT}
                  defaultValue={studyLimitResult.value}
                  className="app-input h-9 w-40 rounded-md px-2 text-sm outline-none"
                />
              </label>
              <label className="app-muted space-y-1 text-sm">
                <span className="block">Week</span>
                <select
                  name="week"
                  defaultValue={isValidWeekSelection ? selectedWeek : ""}
                  disabled={weekOptions.length === 0}
                  className="app-input h-9 min-w-56 rounded-md px-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
                >
                  <option value="">All weeks in window</option>
                  {weekOptions.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label} ({option.studyCount} {option.studyCount === 1 ? "study" : "studies"})
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="submit"
                disabled={loadedStudies.length === 0}
                className="app-button h-9 rounded-md px-3 text-sm font-medium transition disabled:cursor-not-allowed disabled:opacity-60"
              >
                Refresh
              </button>
            </form>
            <p className="app-muted text-xs">
              The week picker only covers weeks within the loaded "Studies to include" window —
              raise that number first to reach further back.
            </p>
            {!studyLimitResult.isValid && params.limit ? (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Invalid `limit` value. Using default of {DEFAULT_STUDY_LIMIT}.
              </p>
            ) : null}
            {selectedWeek !== "" && !isValidWeekSelection ? (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                Selected week isn&apos;t in the current window. Showing all loaded studies instead.
              </p>
            ) : null}
            {loadedStudies.length === 0 ? (
              <p className="text-sm text-amber-700 dark:text-amber-300">
                No studies were found in the `studies` table.
              </p>
            ) : null}
          </div>

          <Link
            href="/"
            className="app-button inline-flex rounded-lg px-3 py-2 text-sm font-medium transition"
          >
            Back to dashboard
          </Link>
        </header>

        <WeeklyStudySummaryCharts data={chartRows} />
      </section>
    </main>
  );
}
