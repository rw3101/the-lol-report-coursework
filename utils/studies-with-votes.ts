import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";

import type { Database } from "@/src/types/supabase";

const QUERY_PAGE_SIZE = 1000;

type MappingRow = { id: number; study_id: number };

/**
 * Returns the subset of studyIds that have at least one recorded vote.
 * Used to let a study picker filter out studies that would otherwise render
 * an empty or "not enough data" report (see Study Engagement Risk's
 * "No user met the current vote threshold for scoring" state).
 */
export const getStudyIdsWithVotes = async (
  supabase: SupabaseClient<Database>,
  studyIds: number[],
): Promise<Set<number>> => {
  if (studyIds.length === 0) {
    return new Set();
  }

  const mappings: MappingRow[] = [];
  let from = 0;
  while (true) {
    const to = from + QUERY_PAGE_SIZE - 1;
    const { data, error } = await supabase
      .from("study_caption_mappings")
      .select("id, study_id")
      .in("study_id", studyIds)
      .order("id", { ascending: true })
      .range(from, to);

    if (error) {
      throw new Error(`Unable to load study caption mappings: ${error.message}`);
    }

    const pageRows = (data ?? []) as MappingRow[];
    mappings.push(...pageRows);
    if (pageRows.length < QUERY_PAGE_SIZE) {
      break;
    }

    from += QUERY_PAGE_SIZE;
  }

  const mappingIdsByStudyId = new Map<number, number[]>();
  for (const mapping of mappings) {
    const bucket = mappingIdsByStudyId.get(mapping.study_id) ?? [];
    bucket.push(mapping.id);
    mappingIdsByStudyId.set(mapping.study_id, bucket);
  }

  const results = await Promise.all(
    studyIds.map(async (studyId): Promise<[number, boolean]> => {
      const mappingIds = mappingIdsByStudyId.get(studyId) ?? [];
      if (mappingIds.length === 0) {
        return [studyId, false];
      }

      const { count, error } = await supabase
        .from("study_caption_vote_events")
        .select("id", { count: "exact", head: true })
        .in("study_caption_mapping_id", mappingIds);

      if (error) {
        return [studyId, false];
      }

      return [studyId, (count ?? 0) > 0];
    }),
  );

  return new Set(results.filter(([, hasVotes]) => hasVotes).map(([studyId]) => studyId));
};
