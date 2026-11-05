"use client";

import { useState, useEffect, useMemo } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Calendar,
  Download,
  FileText,
  Image as ImageIcon,
  Table,
  Archive,
  FileCode,
  Paperclip,
  Inbox,
  Search,
  ExternalLink,
  CheckSquare2,
  User,
} from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";

import { summariesAPI, type SummaryFilesResponse } from "@/lib/api/summaries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageErrorCard } from "@/components/page-error-card";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";

function formatDisplayDate(value: string) {
  try {
    return format(parseISO(value), "MMM d, yyyy");
  } catch {
    return value;
  }
}

function formatFileSize(bytes: number) {
  if (!bytes || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  return `${(bytes / Math.pow(1024, i)).toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

function getFileTypeInfo(fileName: string, contentType?: string) {
  const ext = fileName.split(".").pop()?.toLowerCase() || "";
  if (["pdf"].includes(ext) || contentType?.includes("pdf")) {
    return {
      type: "PDF Document",
      icon: FileText,
      iconBg: "bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400",
    };
  }
  if (
    ["png", "jpg", "jpeg", "webp", "svg", "gif"].includes(ext) ||
    contentType?.startsWith("image/")
  ) {
    return {
      type: "Image",
      icon: ImageIcon,
      iconBg: "bg-sky-500/10 text-sky-600 dark:bg-sky-500/20 dark:text-sky-400",
    };
  }
  if (
    ["xls", "xlsx", "csv"].includes(ext) ||
    contentType?.includes("spreadsheet") ||
    contentType?.includes("csv")
  ) {
    return {
      type: "Spreadsheet",
      icon: Table,
      iconBg: "bg-emerald-500/10 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400",
    };
  }
  if (
    ["zip", "tar", "gz", "rar", "7z"].includes(ext) ||
    contentType?.includes("zip") ||
    contentType?.includes("compressed")
  ) {
    return {
      type: "Archive",
      icon: Archive,
      iconBg: "bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400",
    };
  }
  if (["js", "ts", "tsx", "py", "html", "css", "json", "sql"].includes(ext)) {
    return {
      type: "Code",
      icon: FileCode,
      iconBg: "bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400",
    };
  }
  return {
    type: "Document",
    icon: FileText,
    iconBg: "bg-muted text-muted-foreground",
  };
}

function FileItem({
  file,
}: {
  file: SummaryFilesResponse["tasks"][number]["files"][number];
}) {
  const fileInfo = getFileTypeInfo(file.file_name, file.content_type);
  const Icon = fileInfo.icon;

  return (
    <div className="group relative flex items-center justify-between rounded-xl border border-border/70 bg-card p-3 shadow-xs transition-all hover:border-border hover:shadow-sm">
      <div className="flex items-center gap-3 min-w-0 flex-1">
        <div
          className={cn(
            "flex size-10 shrink-0 items-center justify-center rounded-lg transition-transform group-hover:scale-105",
            fileInfo.iconBg,
          )}
        >
          <Icon className="size-5" />
        </div>
        <div className="min-w-0 flex-1 space-y-0.5">
          <p
            className="truncate text-xs sm:text-sm font-semibold text-foreground"
            title={file.file_name}
          >
            {file.file_name}
          </p>
          <div className="flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-foreground">
            <span className="font-medium tabular-nums text-foreground/80">
              {formatFileSize(file.size)}
            </span>
            <span>•</span>
            <span className="flex items-center gap-1">
              <User className="size-3" />
              {file.created_by}
            </span>
            <span>•</span>
            <span>{formatDisplayDate(file.created_at)}</span>
          </div>
        </div>
      </div>

      <div className="flex items-center gap-1.5 pl-2">
        <a
          href={file.download_url}
          download={file.file_name}
          className="inline-flex size-8.5 items-center justify-center rounded-lg border border-border/80 text-muted-foreground transition-colors hover:border-[#0d47a1]/40 hover:bg-[#0d47a1]/10 hover:text-[#0d47a1] dark:hover:bg-[#0d47a1]/20 dark:hover:text-[#38bdf8]"
          aria-label={`Download ${file.file_name}`}
          title="Download file"
        >
          <Download className="size-4" />
        </a>
      </div>
    </div>
  );
}

function TaskSection({
  task,
}: {
  task: SummaryFilesResponse["tasks"][number];
}) {
  return (
    <Card className="border-border/80 bg-card shadow-xs">
      <CardHeader className="pb-3 border-b border-border/60">
        <div className="flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2.5">
            <div className="flex size-7 items-center justify-center rounded-md bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
              <CheckSquare2 className="size-4" />
            </div>
            <div>
              <CardTitle className="text-sm sm:text-base font-semibold text-foreground">
                {task.task_title}
              </CardTitle>
              {task.task_created_at && (
                <p className="text-[11px] text-muted-foreground">
                  Task initiated on {formatDisplayDate(task.task_created_at)}
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2">
            <span className="inline-flex items-center rounded-full border border-border bg-muted/60 px-2.5 py-0.5 text-xs font-semibold tabular-nums text-foreground">
              {task.files.length} file{task.files.length === 1 ? "" : "s"}
            </span>
            <Button
              variant="ghost"
              size="sm"
              asChild
              className="h-7 text-xs text-muted-foreground hover:text-foreground"
            >
              <Link href={`/tasks/${task.task_id}`}>
                View Task
                <ExternalLink className="ml-1 size-3" />
              </Link>
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent className="pt-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
          {task.files.map((file) => (
            <FileItem key={file.file_id} file={file} />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}

export default function SummaryFilesPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const summaryId = String(params.id);
  const initialViewType = (searchParams.get("v") || "sent") as
    | "sent"
    | "received";
  const shareToken = searchParams.get("token") || undefined;

  const [files, setFiles] = useState<SummaryFilesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewType, setViewType] = useState<"sent" | "received">(
    initialViewType,
  );
  const [searchQuery, setSearchQuery] = useState("");

  useEffect(() => {
    const fetchFiles = async () => {
      try {
        setLoading(true);
        const data = await summariesAPI.getWeekFiles(
          summaryId,
          viewType,
          shareToken,
        );
        setFiles(data);
        setError(null);
      } catch (err) {
        const message = extractApiErrorMessage(err, "Failed to load files");
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    };

    fetchFiles();
  }, [summaryId, viewType, shareToken]);

  const handleViewTypeChange = (newViewType: "sent" | "received") => {
    setViewType(newViewType);
    const newUrl = shareToken
      ? `/summaries/${summaryId}/files?v=${newViewType}&token=${shareToken}`
      : `/summaries/${summaryId}/files?v=${newViewType}`;
    router.replace(newUrl);
  };

  const totals = useMemo(() => {
    if (!files || !files.tasks) {
      return { totalFiles: 0, totalSize: 0, totalTasks: 0 };
    }
    let totalFiles = 0;
    let totalSize = 0;
    files.tasks.forEach((t) => {
      totalFiles += t.files.length;
      t.files.forEach((f) => {
        totalSize += f.size || 0;
      });
    });
    return {
      totalFiles,
      totalSize,
      totalTasks: files.tasks.length,
    };
  }, [files]);

  // Filter tasks and files by search query
  const filteredTasks = useMemo(() => {
    if (!files || !files.tasks) return [];
    if (!searchQuery.trim()) return files.tasks;

    const q = searchQuery.toLowerCase().trim();
    return files.tasks
      .map((t) => {
        const titleMatches = t.task_title.toLowerCase().includes(q);
        const matchingFiles = t.files.filter(
          (f) =>
            f.file_name.toLowerCase().includes(q) ||
            f.created_by.toLowerCase().includes(q),
        );
        if (titleMatches) return t;
        if (matchingFiles.length > 0) {
          return { ...t, files: matchingFiles };
        }
        return null;
      })
      .filter((t): t is NonNullable<typeof t> => t !== null);
  }, [files, searchQuery]);

  if (loading) {
    return (
      <div className="mx-auto max-w-5xl space-y-6 pb-12">
        <div className="h-9 w-32 animate-pulse rounded-lg bg-muted" />
        <div className="space-y-4">
          <div className="h-28 animate-pulse rounded-2xl bg-muted/60" />
          <div className="h-64 animate-pulse rounded-2xl bg-muted/40" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="mx-auto max-w-3xl py-12">
        <PageErrorCard
          title="Error Loading Weekly Files"
          message={error}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  const tasksEmpty = !files || files.tasks.length === 0;

  return (
    <div className="mx-auto flex w-full max-w-5xl flex-col gap-6 pb-12">
      {/* Back button and breadcrumb */}
      <div className="flex items-center justify-between">
        <Button
          variant="outline"
          size="sm"
          onClick={() => {
            const summaryUrl = shareToken
              ? `/summaries?token=${shareToken}`
              : `/summaries?id=${files?.week_start || ""}`;
            router.push(summaryUrl);
          }}
          className="h-8.5 rounded-full px-3 text-xs text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="mr-1.5 size-3.5" />
          Back to Summary
        </Button>

        {files && (
          <div className="flex items-center gap-1.5 rounded-full border border-border/80 bg-muted/40 px-3 py-1 text-xs font-medium text-muted-foreground">
            <Calendar className="size-3.5" />
            <span className="tabular-nums">
              {formatDisplayDate(files.week_start)} –{" "}
              {formatDisplayDate(files.week_end)}
            </span>
          </div>
        )}
      </div>

      {/* Header Studio Card */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card p-6 shadow-xs sm:p-8">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                {viewType === "sent" ? (
                  <Paperclip className="size-5" />
                ) : (
                  <Inbox className="size-5" />
                )}
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                {viewType === "sent" ? "Files Attached" : "Files Received"}
              </h1>
            </div>
            <p className="text-sm text-muted-foreground">
              {viewType === "sent"
                ? "All documentation, assets, and uploads you attached to tasks this week."
                : "Incoming files and deliverables shared with you by colleagues on active tasks."}
            </p>
          </div>

          {/* Segmented View Switcher */}
          <div className="inline-flex rounded-xl border border-border/80 bg-muted/40 p-1">
            <button
              onClick={() => handleViewTypeChange("sent")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all",
                viewType === "sent"
                  ? "bg-[#0d47a1] text-white shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Paperclip className="size-3.5" />
              <span>Files Attached</span>
            </button>
            <button
              onClick={() => handleViewTypeChange("received")}
              className={cn(
                "flex items-center gap-1.5 rounded-lg px-3.5 py-1.5 text-xs font-semibold transition-all",
                viewType === "received"
                  ? "bg-[#0d47a1] text-white shadow-xs"
                  : "text-muted-foreground hover:text-foreground",
              )}
            >
              <Inbox className="size-3.5" />
              <span>Files Received</span>
            </button>
          </div>
        </div>

        {/* Quick Stats Strip */}
        {!tasksEmpty && (
          <div className="mt-6 grid grid-cols-3 gap-3 border-t border-border/60 pt-6">
            <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5">
              <p className="text-xs font-medium text-muted-foreground">Total Files</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-foreground">
                {totals.totalFiles}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5">
              <p className="text-xs font-medium text-muted-foreground">Referenced Tasks</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-[#0d47a1] dark:text-[#38bdf8]">
                {totals.totalTasks}
              </p>
            </div>
            <div className="rounded-xl border border-border/60 bg-muted/20 p-3.5">
              <p className="text-xs font-medium text-muted-foreground">Payload Size</p>
              <p className="mt-1 text-2xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatFileSize(totals.totalSize)}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Filter and Search Bar */}
      {!tasksEmpty && (
        <div className="flex items-center justify-between gap-4">
          <div className="relative flex-1 max-w-md">
            <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
            <Input
              placeholder="Search files by name or task title..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="h-9.5 pl-9 text-xs sm:text-sm"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Showing <span className="font-semibold text-foreground">{filteredTasks.length}</span> task{filteredTasks.length === 1 ? "" : "s"}
          </p>
        </div>
      )}

      {/* Tasks and Files Content */}
      <div className="space-y-6">
        {tasksEmpty ? (
          <Card className="border-border/80 bg-card shadow-xs">
            <CardContent className="flex flex-col items-center justify-center py-16 px-4 text-center">
              <div className="flex size-12 items-center justify-center rounded-2xl bg-[#0d47a1]/10 text-[#0d47a1] ring-1 ring-[#0d47a1]/20 dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                {viewType === "sent" ? (
                  <Paperclip className="size-6" />
                ) : (
                  <Inbox className="size-6" />
                )}
              </div>
              <h3 className="mt-4 text-base font-semibold text-foreground">
                No files {viewType === "sent" ? "attached" : "received"} this week
              </h3>
              <p className="mt-1.5 max-w-sm text-xs text-muted-foreground">
                {viewType === "sent"
                  ? "You haven't attached deliverables or documents to tasks during this week period."
                  : "No incoming files were attached by collaborators to tasks assigned to you this week."}
              </p>
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  handleViewTypeChange(viewType === "sent" ? "received" : "sent")
                }
                className="mt-5 text-xs"
              >
                Switch to Files {viewType === "sent" ? "Received" : "Attached"}
              </Button>
            </CardContent>
          </Card>
        ) : filteredTasks.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border/80 bg-muted/20 py-12 text-center text-xs text-muted-foreground">
            No files or tasks matching &ldquo;{searchQuery}&rdquo;
          </div>
        ) : (
          filteredTasks.map((task) => (
            <TaskSection key={task.task_id} task={task} />
          ))
        )}
      </div>
    </div>
  );
}
