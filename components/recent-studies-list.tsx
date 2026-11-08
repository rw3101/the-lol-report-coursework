"use client";

import Link from "next/link";
import { useState } from "react";

const NEW_STYLE_MIN_STUDY_ID = 7;

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

type RecentStudiesListProps = {
  groups: RecentStudyGroup[];
};

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
  isOpen: boolean;
  onHover: () => void;
  onUnhover: () => void;
  onToggle: () => void;
};

function StudyRow({ study, isOpen, onHover, onUnhover, onToggle }: StudyRowProps) {
  const reportLinks = [
    { title: "Study detail", href: `/study/${study.id}/study-detail` },
    { title: "Engagement risk", href: `/study/${study.id}/engagement-risk` },
    { title: "Vote timing", href: `/study/${study.id}/vote-timing` },
    { title: "Upvote rate", href: `/study/${study.id}/user-upvote-rate` },
    { title: "Selected users", href: `/study/${study.id}/selected-user-report` },
    ...(study.id >= NEW_STYLE_MIN_STUDY_ID
      ? [{ title: "New-style report", href: `/study/${study.id}/new-style-report` }]
      : []),
  ];

  return (
    <li
      className="app-card overflow-hidden rounded-xl"
      onMouseEnter={onHover}
      onMouseLeave={onUnhover}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full flex-wrap items-center justify-between gap-2 px-4 py-3 text-left transition hover:bg-white/5"
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
          <span className="truncate text-sm font-medium">{study.label}</span>
        </span>
        <span className="app-muted flex items-center gap-3 text-xs">
          <span>{study.windowLabel}</span>
          <span>
            {study.totalVotes.toLocaleString()} votes
            {study.upvotePercentage !== null ? ` · ${study.upvotePercentage}% up` : ""}
          </span>
          <span aria-hidden="true" className="text-sm">
            {isOpen ? "▲" : "▼"}
          </span>
        </span>
      </button>

      {isOpen ? (
        <div className="grid gap-1.5 border-t border-white/10 p-3 sm:grid-cols-3">
          {reportLinks.map((reportLink) => (
            <Link
              key={reportLink.href}
              href={reportLink.href}
              className="app-button rounded-lg px-3 py-2 text-center text-xs font-medium transition"
            >
              {reportLink.title}
            </Link>
          ))}
        </div>
      ) : null}
    </li>
  );
}

export function RecentStudiesList({ groups }: RecentStudiesListProps) {
  const [pinnedIds, setPinnedIds] = useState<Set<number>>(new Set());
  const [hoveredId, setHoveredId] = useState<number | null>(null);

  const togglePinned = (id: number) => {
    setPinnedIds((current) => {
      const next = new Set(current);
      if (next.has(id)) {
        next.delete(id);
      } else {
        next.add(id);
      }
      return next;
    });
  };

  const hasStudies = groups.some((group) => group.studies.length > 0);
  if (!hasStudies) {
    return <p className="app-muted text-sm">No studies found.</p>;
  }

  return (
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
                isOpen={pinnedIds.has(study.id) || hoveredId === study.id}
                onHover={() => setHoveredId(study.id)}
                onUnhover={() =>
                  setHoveredId((current) => (current === study.id ? null : current))
                }
                onToggle={() => togglePinned(study.id)}
              />
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}
