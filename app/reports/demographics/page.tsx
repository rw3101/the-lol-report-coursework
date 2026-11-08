import Link from "next/link";
import type { SupabaseClient } from "@supabase/supabase-js";

import { DemographicBreakdownChart } from "@/components/demographic-breakdown-chart";
import type { Database } from "@/src/types/supabase";
import { createClient } from "@/utils/supabase/server";
import { isPositiveStudyVote, type StudyVoteValue } from "@/utils/study-vote-events";

const QUERY_CHUNK_SIZE = 120;
const MIN_QUERY_CHUNK_SIZE = 1;
const QUERY_RETRY_ATTEMPTS = 3;
const QUERY_RETRY_BASE_DELAY_MS = 150;
const QUERY_PAGE_SIZE = 1000;
const DEFAULT_MIN_VOTERS = 20;
const MAX_MIN_VOTERS = 1000;

type DemographicReportSearchParams = Promise<{
  question?: string;
  minVoters?: string;
}>;

type DemographicReportPageProps = {
  searchParams: DemographicReportSearchParams;
};

// These tables were added to the production schema after this project's
// generated src/types/supabase.ts was last refreshed, so they are typed
// manually here instead of through the Tables<> helper.
type DemographicQuestionRow = { id: number; question: string };
type DemographicAnswerRow = { id: number; answer: string };
type DemographicAnswerQuestionMappingRow = {
  id: number;
  question_id: number;
  answer_id: number;
};
type DemographicUserResponseRow = {
  user_id: string;
  answer_question_mapping_id: number;
  created_datetime_utc: string;
};
type StudyVoteRow = { profile_id: string; vote_value: StudyVoteValue };

type SupabaseQueryResult<TRow> = {
  data: TRow[] | null;
  error: { message: string } | null;
};

type AnswerGroupSummary = {
  answer: string;
  distinct_voters: number;
  vote_count: number;
  average_score: number;
  upvote_percentage: number;
  meets_minimum_sample: boolean;
};

const VOTE_VALUE_SCORE: Record<StudyVoteValue, number> = {
  "didnt get it": 1,
  "not funny at all": 2,
  "not very funny": 3,
  meh: 4,
  funny: 5,
  "very funny": 6,
};

const roundNumber = (value: number, digits = 2) => Number(value.toFixed(digits));

const parseBoundedInteger = (
  rawValue: string | undefined,
  fallback: number,
  min: number,
  max: number,
): { value: number; isValid: boolean } => {
  if (!rawValue) {
    return { value: fallback, isValid: true };
  }

  const parsed = Number.parseInt(rawValue, 10);
  if (!Number.isInteger(parsed) || parsed < min || parsed > max) {
    return { value: fallback, isValid: false };
  }

  return { value: parsed, isValid: true };
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

const fetchRowsWithAdaptiveChunks = async <TRow,>({
  ids,
  contextLabel,
  pageSize = QUERY_PAGE_SIZE,
  runQuery,
}: {
  ids: string[];
  contextLabel: string;
  pageSize?: number;
  runQuery: (chunk: string[], from: number, to: number) => Promise<SupabaseQueryResult<TRow>>;
}): Promise<TRow[]> => {
  const rows: TRow[] = [];

  const fetchChunk = async (chunk: string[]): Promise<void> => {
    for (let attempt = 1; attempt <= QUERY_RETRY_ATTEMPTS; attempt += 1) {
      try {
        const chunkRows: TRow[] = [];
        let from = 0;

        while (true) {
          const to = from + pageSize - 1;
          const { data, error } = await runQuery(chunk, from, to);
          if (error) {
            throw new Error(error.message);
          }

          const pageRows = data ?? [];
          chunkRows.push(...pageRows);
          if (pageRows.length < pageSize) {
            break;
          }

          from += pageSize;
        }

        rows.push(...chunkRows);
        return;
      } catch (error) {
        const message = error instanceof Error ? error.message : "Unknown query error";
        const transient = isLikelyTransientFetchError(message);
        const hasRemainingRetries = attempt < QUERY_RETRY_ATTEMPTS;
        if (transient && hasRemainingRetries) {
          await wait(QUERY_RETRY_BASE_DELAY_MS * attempt);
          continue;
        }

        const canSplitChunk = transient && chunk.length > MIN_QUERY_CHUNK_SIZE;
        if (canSplitChunk) {
          const midpoint = Math.ceil(chunk.length / 2);
          await fetchChunk(chunk.slice(0, midpoint));
          await fetchChunk(chunk.slice(midpoint));
          return;
        }

        throw new Error(`Unable to load ${contextLabel}: ${message}`);
      }
    }
  };

  for (const chunk of chunkArray(ids, QUERY_CHUNK_SIZE)) {
    await fetchChunk(chunk);
  }

  return rows;
};

const getDemographicQuestions = async (
  supabase: SupabaseClient<Database>,
): Promise<DemographicQuestionRow[]> =>
  fetchRowsWithPagination<DemographicQuestionRow>({
    contextLabel: "demographic questions",
    runQuery: async (from, to) =>
      (await supabase
        .schema("public")
        .from("demographic_questions" as never)
        .select("id, question")
        .order("id", { ascending: true })
        .range(from, to)) as unknown as SupabaseQueryResult<DemographicQuestionRow>,
  });

const getAnswerMappingsForQuestion = async (
  supabase: SupabaseClient<Database>,
  questionId: number,
): Promise<DemographicAnswerQuestionMappingRow[]> =>
  fetchRowsWithPagination<DemographicAnswerQuestionMappingRow>({
    contextLabel: "demographic answer mappings",
    runQuery: async (from, to) =>
      (await supabase
        .schema("public")
        .from("demographic_answer_question_mapping" as never)
        .select("id, question_id, answer_id")
        .eq("question_id", questionId)
        .eq("is_deleted", false)
        .order("display_order", { ascending: true })
        .range(from, to)) as unknown as SupabaseQueryResult<DemographicAnswerQuestionMappingRow>,
  });

const getAnswersById = async (
  supabase: SupabaseClient<Database>,
  answerIds: number[],
): Promise<Map<number, string>> => {
  const answersById = new Map<number, string>();
  if (answerIds.length === 0) {
    return answersById;
  }

  const rows = await fetchRowsWithAdaptiveChunks<DemographicAnswerRow>({
    ids: answerIds.map(String),
    contextLabel: "demographic answers",
    runQuery: async (chunk, from, to) =>
      (await supabase
        .schema("public")
        .from("demographic_answers" as never)
        .select("id, answer")
        .in(
          "id",
          chunk.map((value) => Number.parseInt(value, 10)),
        )
        .range(from, to)) as unknown as SupabaseQueryResult<DemographicAnswerRow>,
  });

  for (const row of rows) {
    answersById.set(row.id, row.answer);
  }

  return answersById;
};

const getUserResponsesForMappings = async (
  supabase: SupabaseClient<Database>,
  mappingIds: number[],
): Promise<DemographicUserResponseRow[]> => {
  if (mappingIds.length === 0) {
    return [];
  }

  return fetchRowsWithAdaptiveChunks<DemographicUserResponseRow>({
    ids: mappingIds.map(String),
    contextLabel: "demographic user responses",
    runQuery: async (chunk, from, to) =>
      (await supabase
        .schema("public")
        .from("demographic_user_responses" as never)
        .select("user_id, answer_question_mapping_id, created_datetime_utc")
        .in(
          "answer_question_mapping_id",
          chunk.map((value) => Number.parseInt(value, 10)),
        )
        .order("created_datetime_utc", { ascending: false })
        .range(from, to)) as unknown as SupabaseQueryResult<DemographicUserResponseRow>,
  });
};

const getVotesByProfileId = async (
  supabase: SupabaseClient<Database>,
  profileIds: string[],
): Promise<StudyVoteRow[]> => {
  if (profileIds.length === 0) {
    return [];
  }

  return fetchRowsWithAdaptiveChunks<StudyVoteRow>({
    ids: profileIds,
    contextLabel: "study caption vote events",
    runQuery: async (chunk, from, to) =>
      (await supabase
        .from("study_caption_vote_events")
        .select("profile_id, vote_value")
        .in("profile_id", chunk)
        .range(from, to)) as SupabaseQueryResult<StudyVoteRow>,
  });
};

const buildAnswerGroupSummaries = ({
  answerByUserId,
  votes,
  minVoters,
}: {
  answerByUserId: Map<string, string>;
  votes: StudyVoteRow[];
  minVoters: number;
}): AnswerGroupSummary[] => {
  const votersByAnswer = new Map<string, Set<string>>();
  const voteCountByAnswer = new Map<string, number>();
  const scoreSumByAnswer = new Map<string, number>();
  const upvoteCountByAnswer = new Map<string, number>();

  for (const vote of votes) {
    const answer = answerByUserId.get(vote.profile_id);
    if (!answer) {
      continue;
    }

    const voters = votersByAnswer.get(answer) ?? new Set<string>();
    voters.add(vote.profile_id);
    votersByAnswer.set(answer, voters);

    voteCountByAnswer.set(answer, (voteCountByAnswer.get(answer) ?? 0) + 1);
    scoreSumByAnswer.set(
      answer,
      (scoreSumByAnswer.get(answer) ?? 0) + VOTE_VALUE_SCORE[vote.vote_value],
    );
    if (isPositiveStudyVote(vote.vote_value)) {
      upvoteCountByAnswer.set(answer, (upvoteCountByAnswer.get(answer) ?? 0) + 1);
    }
  }

  const summaries: AnswerGroupSummary[] = [];
  for (const [answer, voters] of votersByAnswer.entries()) {
    const voteCount = voteCountByAnswer.get(answer) ?? 0;
    const scoreSum = scoreSumByAnswer.get(answer) ?? 0;
    const upvoteCount = upvoteCountByAnswer.get(answer) ?? 0;

    summaries.push({
      answer,
      distinct_voters: voters.size,
      vote_count: voteCount,
      average_score: voteCount === 0 ? 0 : roundNumber(scoreSum / voteCount),
      upvote_percentage: voteCount === 0 ? 0 : roundNumber((100 * upvoteCount) / voteCount, 1),
      meets_minimum_sample: voters.size >= minVoters,
    });
  }

  return summaries.sort((left, right) => right.distinct_voters - left.distinct_voters);
};

export const dynamic = "force-dynamic";

export default async function DemographicBreakdownPage({
  searchParams,
}: DemographicReportPageProps) {
  const params = await searchParams;
  const minVotersResult = parseBoundedInteger(
    params.minVoters,
    DEFAULT_MIN_VOTERS,
    1,
    MAX_MIN_VOTERS,
  );
  const generatedAtUtc = new Date().toISOString();

  const supabase = await createClient();
  const questions = await getDemographicQuestions(supabase);

  const requestedQuestionId = params.question ? Number.parseInt(params.question, 10) : null;
  const selectedQuestion =
    questions.find((question) => question.id === requestedQuestionId) ?? questions[0] ?? null;

  let summaries: AnswerGroupSummary[] = [];
  let totalDistinctVoters = 0;

  if (selectedQuestion) {
    const mappings = await getAnswerMappingsForQuestion(supabase, selectedQuestion.id);
    const answerIds = [...new Set(mappings.map((mapping) => mapping.answer_id))];
    const answersById = await getAnswersById(supabase, answerIds);
    const mappingIds = mappings.map((mapping) => mapping.id);
    const responses = await getUserResponsesForMappings(supabase, mappingIds);

    // Multiple responses can exist per user (e.g. a retake); keep only the
    // most recent one per user since responses were fetched newest-first.
    const answerByUserId = new Map<string, string>();
    const mappingById = new Map(mappings.map((mapping) => [mapping.id, mapping]));
    for (const response of responses) {
      if (answerByUserId.has(response.user_id)) {
        continue;
      }

      const mapping = mappingById.get(response.answer_question_mapping_id);
      const answerText = mapping ? answersById.get(mapping.answer_id) : undefined;
      if (!answerText) {
        continue;
      }

      answerByUserId.set(response.user_id, answerText);
    }

    const profileIds = [...answerByUserId.keys()];
    totalDistinctVoters = profileIds.length;
    const votes = await getVotesByProfileId(supabase, profileIds);

    summaries = buildAnswerGroupSummaries({
      answerByUserId,
      votes,
      minVoters: minVotersResult.value,
    });
  }

  const reliableSummaries = summaries.filter((summary) => summary.meets_minimum_sample);
  const unreliableSummaries = summaries.filter((summary) => !summary.meets_minimum_sample);
  const chartRows = reliableSummaries.map((summary) => ({
    answer: summary.answer,
    upvote_percentage: summary.upvote_percentage,
  }));

  return (
    <main className="page-shell min-h-screen p-6 text-foreground">
      <section className="app-panel mx-auto w-full max-w-6xl space-y-6 rounded-2xl p-6">
        <header className="space-y-2">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <p className="app-kicker text-xs font-semibold uppercase tracking-[0.24em]">
                Humor Study Stats
              </p>
              <h1 className="text-2xl font-semibold">Vote Outcomes by Demographic</h1>
            </div>
            <Link
              href="/"
              className="app-button inline-flex rounded-lg px-3 py-2 text-sm font-medium transition"
            >
              Home
            </Link>
          </div>
          <p className="app-muted text-sm">
            Pick a demographic question participants answered, and see how upvote rate, average
            score, and sample size break down across each answer, pooled across all studies.
          </p>
          <p className="app-muted text-sm">
            Answer groups with fewer than the minimum distinct voters are shown separately below
            and excluded from the chart, since a small number of heavy voters can otherwise
            produce misleading rates.
          </p>
          <p className="app-muted text-sm">Generated at: {generatedAtUtc}</p>

          <form method="get" className="flex flex-wrap items-end gap-3">
            <label className="app-muted space-y-1 text-sm">
              <span className="block">Demographic question</span>
              <select
                name="question"
                defaultValue={selectedQuestion?.id.toString() ?? ""}
                disabled={questions.length === 0}
                className="app-input h-9 min-w-80 rounded-md px-2 text-sm outline-none disabled:cursor-not-allowed disabled:opacity-60"
              >
                {questions.map((question) => (
                  <option key={question.id} value={question.id}>
                    {question.question}
                  </option>
                ))}
              </select>
            </label>
            <label className="app-muted space-y-1 text-sm">
              <span className="block">Min distinct voters</span>
              <input
                type="number"
                name="minVoters"
                min={1}
                max={MAX_MIN_VOTERS}
                defaultValue={minVotersResult.value}
                className="app-input h-9 w-44 rounded-md px-2 text-sm outline-none"
              />
            </label>
            <button
              type="submit"
              className="app-button h-9 rounded-md px-3 text-sm font-medium transition"
            >
              Refresh
            </button>
          </form>
          {!minVotersResult.isValid && params.minVoters ? (
            <p className="text-sm text-amber-700 dark:text-amber-300">
              Invalid <code>minVoters</code> value. Using default of {DEFAULT_MIN_VOTERS}.
            </p>
          ) : null}
        </header>

        {questions.length === 0 ? (
          <p className="app-muted text-sm">No demographic questions found.</p>
        ) : (
          <>
            <section className="grid gap-3 md:grid-cols-3">
              <article className="app-card app-stat-card-teal rounded-xl p-4">
                <p className="app-kicker text-xs font-semibold uppercase tracking-wide">
                  Respondents With Votes
                </p>
                <p className="mt-2 text-2xl font-semibold">
                  {totalDistinctVoters.toLocaleString()}
                </p>
                <p className="app-muted mt-1 text-xs">
                  Users who answered this question and have at least one study vote.
                </p>
              </article>
              <article className="app-card app-stat-card-amber rounded-xl p-4">
                <p className="app-kicker text-xs font-semibold uppercase tracking-wide">
                  Reliable Groups
                </p>
                <p className="mt-2 text-2xl font-semibold">{reliableSummaries.length}</p>
                <p className="app-muted mt-1 text-xs">
                  Answers with at least {minVotersResult.value} distinct voters.
                </p>
              </article>
              <article className="app-card app-stat-card-rose rounded-xl p-4">
                <p className="app-kicker text-xs font-semibold uppercase tracking-wide">
                  Flagged Groups
                </p>
                <p className="mt-2 text-2xl font-semibold">{unreliableSummaries.length}</p>
                <p className="app-muted mt-1 text-xs">
                  Below the minimum sample size; shown separately, excluded from the chart.
                </p>
              </article>
            </section>

            <DemographicBreakdownChart
              questionLabel={selectedQuestion?.question ?? ""}
              data={chartRows}
            />

            <section className="space-y-2">
              <h2 className="text-lg font-semibold">Reliable Answer Groups</h2>
              {reliableSummaries.length ? (
                <div className="app-table-shell overflow-x-auto rounded-xl">
                  <table className="app-table min-w-full divide-y divide-slate-200/60 text-sm dark:divide-slate-700/60">
                    <thead>
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Answer</th>
                        <th className="px-3 py-2 text-left font-semibold">Distinct voters</th>
                        <th className="px-3 py-2 text-left font-semibold">Votes</th>
                        <th className="px-3 py-2 text-left font-semibold">Avg score (1-6)</th>
                        <th className="px-3 py-2 text-left font-semibold">Upvote %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {reliableSummaries.map((summary) => (
                        <tr key={summary.answer}>
                          <td className="px-3 py-2 font-medium">{summary.answer}</td>
                          <td className="px-3 py-2">{summary.distinct_voters.toLocaleString()}</td>
                          <td className="px-3 py-2">{summary.vote_count.toLocaleString()}</td>
                          <td className="px-3 py-2">{summary.average_score.toFixed(2)}</td>
                          <td className="px-3 py-2">{summary.upvote_percentage.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <p className="app-muted text-sm">
                  No answer group for this question currently meets the minimum sample size.
                </p>
              )}
            </section>

            {unreliableSummaries.length ? (
              <section className="space-y-2">
                <h2 className="text-lg font-semibold">
                  Flagged: Below Minimum Sample ({minVotersResult.value} voters)
                </h2>
                <p className="app-muted text-sm">
                  These groups are shown for transparency only. With this few distinct voters, a
                  handful of heavy voters can make the rate look far more extreme or uniform than
                  it actually is.
                </p>
                <div className="app-table-shell overflow-x-auto rounded-xl">
                  <table className="app-table min-w-full divide-y divide-slate-200/60 text-sm dark:divide-slate-700/60">
                    <thead>
                      <tr>
                        <th className="px-3 py-2 text-left font-semibold">Answer</th>
                        <th className="px-3 py-2 text-left font-semibold">Distinct voters</th>
                        <th className="px-3 py-2 text-left font-semibold">Votes</th>
                        <th className="px-3 py-2 text-left font-semibold">Upvote %</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-200 dark:divide-slate-700">
                      {unreliableSummaries.map((summary) => (
                        <tr key={summary.answer}>
                          <td className="px-3 py-2 font-medium">{summary.answer}</td>
                          <td className="px-3 py-2">{summary.distinct_voters.toLocaleString()}</td>
                          <td className="px-3 py-2">{summary.vote_count.toLocaleString()}</td>
                          <td className="px-3 py-2">{summary.upvote_percentage.toFixed(1)}%</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            ) : null}
          </>
        )}
      </section>
    </main>
  );
}
