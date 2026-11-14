"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

const NEW_STYLE_MIN_STUDY_ID = 7;
const LAST_SEEN_STUDY_ID_STORAGE_KEY = "lolReport:lastSeenStudyId";

export type RecentStudyRow = {
  id: number;
  label: string;
  status: "Active" | "Ended" | "Upcoming";
  isLatest: boolean;
  totalVotes: number;
  upvotePercentage: number | null;
  windowLabel: string;
  weekLabel: string;
};

export type RecentStudyGroup = {
  label: string;
  studies: RecentStudyRow[];
};

type StudyBrowserProps = {
  groups: RecentStudyGroup[];
};

type ReportLink = {
  title: string;
  href: string;
};

const getReportLinksForStudy = (studyId: number): ReportLink[] => [
  { title: "Study detail", href: `/study/${studyId}/study-detail` },
  { title: "Engagement risk", href: `/study/${studyId}/engagement-risk` },
  { title: "Vote timing", href: `/study/${studyId}/vote-timing` },
  { title: "Upvote rate", href: `/study/${studyId}/user-upvote-rate` },
  { title: "Selected users", href: `/study/${studyId}/selected-user-report` },
  ...(studyId >= NEW_STYLE_MIN_STUDY_ID
    ? [{ title: "New-style report", href: `/study/${studyId}/new-style-report` }]
    : []),
];

const getStatusBadgeClassName = (status: RecentStudyRow["status"]) => {
  switch (status) {
    case "Active":
      return "bg-emerald-500/18 text-emerald-900 ring-1 ring-emerald-500/35 dark:text-emerald-100";
    case "Upcoming":
      return "bg-sky-500/18 text-sky-900 ring-1 ring-sky-500/35 dark:text-sky-100";
    default:
      return "bg-slate-500/18 text-slate-700 ring-1 ring-slate-500/30 dark:text-slate-200";
  }
};

type StudyRowProps = {
  study: RecentStudyRow;
  isSelected: boolean;
  isMissed: boolean;
  onSelect: () => void;
};

function StudyRow({ study, isSelected, isMissed, onSelect }: StudyRowProps) {
  return (
    <li>
      <button
        type="button"
        onClick={onSelect}
        aria-pressed={isSelected}
        className={`app-card flex w-full flex-wrap items-center justify-between gap-2 rounded-xl px-4 py-3 text-left transition ${
          isSelected
            ? "ring-2 ring-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_14%,transparent)]"
            : "hover:bg-white/5"
        }`}
      >
        <span className="flex min-w-0 flex-wrap items-center gap-2">
          {study.isLatest ? (
            <span className="app-button app-button-primary rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide">
              Latest
            </span>
          ) : null}
          <span
            className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${getStatusBadgeClassName(study.status)}`}
          >
            {study.status}
          </span>
          {isMissed ? (
            <span className="rounded-full bg-fuchsia-500/18 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-fuchsia-900 ring-1 ring-fuchsia-500/35 dark:text-fuchsia-100">
              New since your last visit
            </span>
          ) : null}
          <span className="truncate text-sm font-medium">{study.label}</span>
        </span>
        <span className="app-muted flex items-center gap-3 text-xs">
          <span>{study.windowLabel}</span>
          <span>
            {study.totalVotes.toLocaleString()} votes
            {study.upvotePercentage !== null ? ` · ${study.upvotePercentage}% up` : ""}
          </span>
        </span>
      </button>
    </li>
  );
}

export function StudyBrowser({ groups }: StudyBrowserProps) {
  const allStudies = groups.flatMap((group) => group.studies);
  const [selectedId, setSelectedId] = useState<number | null>(allStudies[0]?.id ?? null);
  const [missedIds, setMissedIds] = useState<Set<number>>(new Set());

  useEffect(() => {
    const allIds = groups.flatMap((group) => group.studies.map((study) => study.id));
    if (allIds.length === 0) {
      return;
    }

    try {
      const storedValue = window.localStorage.getItem(LAST_SEEN_STUDY_ID_STORAGE_KEY);
      const lastSeenId = storedValue ? Number.parseInt(storedValue, 10) : null;

      if (lastSeenId !== null && Number.isFinite(lastSeenId)) {
        setMissedIds(new Set(allIds.filter((id) => id > lastSeenId)));
      }

      const latestId = Math.max(...allIds);
      window.localStorage.setItem(LAST_SEEN_STUDY_ID_STORAGE_KEY, latestId.toString());
    } catch {
      // Local storage may be unavailable (private browsing, disabled storage, etc.) -
      // the "missed since last visit" signal is skipped, nothing else depends on it.
    }
  }, [groups]);

  const hasStudies = allStudies.length > 0;
  const selectedStudy = allStudies.find((study) => study.id === selectedId) ?? null;

  if (!hasStudies) {
    return <p className="app-muted text-sm">No studies found.</p>;
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_280px]">
      <div className="space-y-5">
        {groups.map((group) => (
          <section key={group.label} className="space-y-2">
            <h3 className="app-kicker text-xs font-semibold uppercase tracking-wide">
              {group.label}
            </h3>
            <ul className="space-y-2">
              {group.studies.map((study) => (
                <StudyRow
                  key={study.id}
                  study={study}
                  isSelected={selectedId === study.id}
                  isMissed={missedIds.has(study.id)}
                  onSelect={() => setSelectedId(study.id)}
                />
              ))}
            </ul>
          </section>
        ))}
      </div>

      <aside
        className="app-card h-fit rounded-2xl p-4 lg:sticky lg:top-6"
        style={{ border: "2px solid var(--accent)" }}
      >
        <p className="app-kicker text-xs font-semibold uppercase tracking-wide">Reports for</p>
        {selectedStudy ? (
          <div
            key={selectedStudy.id}
            className="mt-3 flex flex-col gap-1.5 [animation:app-panel-swap_0.2s_ease-out]"
          >
            <h2
              className="mb-1 truncate text-base font-bold leading-snug"
              style={{ color: "var(--accent)" }}
            >
              {selectedStudy.label}
            </h2>
            {getReportLinksForStudy(selectedStudy.id).map((reportLink) => (
              <Link
                key={reportLink.href}
                href={reportLink.href}
                className="app-button rounded-lg px-3 py-2 text-sm transition"
              >
                {reportLink.title}
              </Link>
            ))}
          </div>
        ) : (
          <p className="app-muted mt-3 text-sm">Select a study to see its reports.</p>
        )}
      </aside>
    </div>
  );
}
