import {
  StudyBrowser,
  type RecentStudyGroup,
  type RecentStudyRow,
} from "@/components/study-browser";
import { TopNavbar } from "@/components/top-navbar";
import { createClient } from "@/utils/supabase/server";
import { isPositiveStudyVote, type StudyVoteValue } from "@/utils/study-vote-events";
import Link from "next/link";

const NEW_STYLE_MIN_STUDY_ID = 7;
const RECENT_STUDIES_LIMIT = 20;
const MS_PER_DAY = 24 * 60 * 60 * 1000;
const MS_PER_WEEK = 7 * MS_PER_DAY;

type StudySummaryRow = {
  id: number;
  slug: string | null;
  description: string | null;
  start_datetime_utc: string | null;
  end_datetime_utc: string | null;
  created_datetime_utc: string;
};

type StudyVoteStats = {
  totalVotes: number;
  upvotePercentage: number | null;
};

type LatestStudyStats = {
  label: string;
  totalVotes: number;
  upvotePercentage: number | null;
};

const getStudyLabel = (study: StudySummaryRow) =>
  study.slug
    ? `${study.id} - ${study.slug}`
    : study.description
      ? `${study.id} - ${study.description}`
      : `Study ${study.id}`;

const getStudyStatus = (study: StudySummaryRow, nowMs: number): RecentStudyRow["status"] => {
  const startMs = Date.parse(study.start_datetime_utc ?? study.created_datetime_utc);
  const endMs = study.end_datetime_utc ? Date.parse(study.end_datetime_utc) : null;

  if (Number.isFinite(startMs) && startMs > nowMs) {
    return "Upcoming";
  }

  if (endMs !== null && Number.isFinite(endMs) && endMs <= nowMs) {
    return "Ended";
  }

  return "Active";
};

const getWeekStartMs = (ms: number) => {
  const date = new Date(ms);
  const dayOfWeek = date.getUTCDay();
  const daysSinceMonday = (dayOfWeek + 6) % 7;
  const monday = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate() - daysSinceMonday);
  return monday;
};

const formatWeekRangeLabel = (weekStartMs: number) => {
  // Week boundaries are computed in UTC (see getWeekStartMs), so they must
  // also be displayed in UTC - otherwise a server running behind UTC would
  // show dates shifted a day earlier than the actual grouping boundary.
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const weekEndMs = weekStartMs + 6 * MS_PER_DAY;
  return `Week of ${formatter.format(new Date(weekStartMs))} - ${formatter.format(new Date(weekEndMs))}`;
};

const getWeekGroupLabel = (study: StudySummaryRow, nowMs: number) => {
  const startMs = Date.parse(study.start_datetime_utc ?? study.created_datetime_utc);
  if (!Number.isFinite(startMs)) {
    return "Unknown week";
  }

  const studyWeekStart = getWeekStartMs(startMs);
  const currentWeekStart = getWeekStartMs(nowMs);
  const weeksAgo = Math.round((currentWeekStart - studyWeekStart) / MS_PER_WEEK);

  if (weeksAgo === 0) {
    return "This Week";
  }

  if (weeksAgo === 1) {
    return "Last Week";
  }

  return formatWeekRangeLabel(studyWeekStart);
};

const formatStudyWindowLabel = (study: StudySummaryRow) => {
  const formatter = new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
  const startMs = Date.parse(study.start_datetime_utc ?? study.created_datetime_utc);
  if (!Number.isFinite(startMs)) {
    return "Unknown window";
  }

  const startLabel = formatter.format(new Date(startMs));
  if (!study.end_datetime_utc) {
    return `From ${startLabel}`;
  }

  const endMs = Date.parse(study.end_datetime_utc);
  if (!Number.isFinite(endMs)) {
    return `From ${startLabel}`;
  }

  return `${startLabel} - ${formatter.format(new Date(endMs))}`;
};

const getStudyVoteStats = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  studyId: number,
): Promise<StudyVoteStats> => {
  const { data: mappings, error: mappingsError } = await supabase
    .from("study_caption_mappings")
    .select("id")
    .eq("study_id", studyId);

  if (mappingsError || !mappings || mappings.length === 0) {
    return { totalVotes: 0, upvotePercentage: null };
  }

  const mappingIds = mappings.map((mapping) => mapping.id);
  const { data: votes, error: votesError } = await supabase
    .from("study_caption_vote_events")
    .select("vote_value")
    .in("study_caption_mapping_id", mappingIds);

  if (votesError || !votes || votes.length === 0) {
    return { totalVotes: 0, upvotePercentage: null };
  }

  const upvotes = votes.filter((vote) =>
    isPositiveStudyVote(vote.vote_value as StudyVoteValue),
  ).length;

  return {
    totalVotes: votes.length,
    upvotePercentage: Math.round((100 * upvotes) / votes.length),
  };
};

const getLatestStudyStats = async (
  supabase: Awaited<ReturnType<typeof createClient>>,
  studyId: number,
): Promise<LatestStudyStats | null> => {
  const { data: study, error: studyError } = await supabase
    .from("studies")
    .select("id, slug, description")
    .eq("id", studyId)
    .maybeSingle();

  if (studyError || !study) {
    return null;
  }

  const label = study.slug
    ? `${study.id} - ${study.slug}`
    : study.description
      ? `${study.id} - ${study.description}`
      : `Study ${study.id}`;

  const stats = await getStudyVoteStats(supabase, studyId);

  return { label, ...stats };
};

export default async function Home() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: newStyleStudies, error: newStyleStudiesError } = await supabase
    .from("studies")
    .select("id")
    .gte("id", NEW_STYLE_MIN_STUDY_ID)
    .order("id", { ascending: false })
    .limit(1);

  if (newStyleStudiesError) {
    throw new Error(`Unable to load new style studies: ${newStyleStudiesError.message}`);
  }

  const latestNewStyleStudyId = newStyleStudies?.[0]?.id ?? null;
  const latestStudyStats = latestNewStyleStudyId
    ? await getLatestStudyStats(supabase, latestNewStyleStudyId)
    : null;

  const { data: recentStudyRows, error: recentStudiesError } = await supabase
    .from("studies")
    .select("id, slug, description, start_datetime_utc, end_datetime_utc, created_datetime_utc")
    .order("id", { ascending: false })
    .limit(RECENT_STUDIES_LIMIT);

  if (recentStudiesError) {
    throw new Error(`Unable to load recent studies: ${recentStudiesError.message}`);
  }

  const nowMs = Date.now();
  const recentStudies: RecentStudyRow[] = await Promise.all(
    (recentStudyRows ?? []).map(async (study, index) => {
      const stats = await getStudyVoteStats(supabase, study.id);

      return {
        id: study.id,
        label: getStudyLabel(study),
        status: getStudyStatus(study, nowMs),
        isLatest: index === 0,
        totalVotes: stats.totalVotes,
        upvotePercentage: stats.upvotePercentage,
        windowLabel: formatStudyWindowLabel(study),
        weekLabel: getWeekGroupLabel(study, nowMs),
      };
    }),
  );

  const recentStudyGroups: RecentStudyGroup[] = [];
  for (const study of recentStudies) {
    const lastGroup = recentStudyGroups[recentStudyGroups.length - 1];
    if (lastGroup && lastGroup.label === study.weekLabel) {
      lastGroup.studies.push(study);
    } else {
      recentStudyGroups.push({ label: study.weekLabel, studies: [study] });
    }
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <TopNavbar />
      <main className="page-shell flex-1 p-6">
        <div className="mx-auto w-full max-w-6xl">
          <section className="app-panel rounded-2xl p-8">
            <div className="flex flex-wrap items-start justify-between gap-4">
              <div>
                <p className="app-kicker text-xs font-semibold uppercase tracking-[0.24em]">
                  Humor Study Stats
                </p>
                <h1 className="mt-3 text-3xl font-semibold">Dashboard</h1>
              </div>
            </div>

            <p className="app-muted mt-3 text-sm">
              Signed in as <span className="font-semibold text-foreground">{user?.email}</span>
            </p>

            <div className="mt-8">
              {latestNewStyleStudyId ? (
                <Link
                  href={`/study/${latestNewStyleStudyId}/new-style-report`}
                  className="app-button app-button-primary flex min-h-44 w-full flex-col items-center justify-center gap-2 rounded-2xl px-8 py-10 text-center transition"
                >
                  <span className="text-4xl font-semibold tracking-tight sm:text-5xl">
                    Latest Study
                  </span>
                  {latestStudyStats ? (
                    <span className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-sm font-medium opacity-90">
                      <span>{latestStudyStats.label}</span>
                      <span aria-hidden="true">&middot;</span>
                      <span>{latestStudyStats.totalVotes.toLocaleString()} votes</span>
                      {latestStudyStats.upvotePercentage !== null ? (
                        <>
                          <span aria-hidden="true">&middot;</span>
                          <span>{latestStudyStats.upvotePercentage}% upvoted</span>
                        </>
                      ) : (
                        <>
                          <span aria-hidden="true">&middot;</span>
                          <span>No votes recorded yet</span>
                        </>
                      )}
                    </span>
                  ) : null}
                </Link>
              ) : (
                <span className="app-button flex min-h-44 w-full cursor-not-allowed items-center justify-center rounded-2xl px-8 py-10 text-center text-4xl font-semibold tracking-tight opacity-60 sm:text-5xl">
                  Latest Study
                </span>
              )}
            </div>

          </section>

          <section className="mt-6">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h2 className="text-lg font-semibold">Recent Studies</h2>
              <p className="app-muted text-xs">Click a study to see its reports</p>
            </div>
            <div className="mt-3">
              <StudyBrowser groups={recentStudyGroups} />
            </div>
          </section>
        </div>
      </main>
    </div>
  );
}
