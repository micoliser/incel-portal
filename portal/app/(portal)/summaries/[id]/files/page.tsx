"use client";

import { useState, useEffect } from "react";
import { useParams, useSearchParams, useRouter } from "next/navigation";
import Image from "next/image";
import { ArrowLeft, Download } from "lucide-react";
import { toast } from "sonner";
import { format, parseISO } from "date-fns";
import { summariesAPI, type SummaryFilesResponse } from "@/lib/api/summaries";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageErrorCard } from "@/components/page-error-card";

function formatDisplayDate(value: string) {
  return format(parseISO(value), "MMM d, yyyy");
}

function FileItem({
  file,
}: {
  file: SummaryFilesResponse["tasks"][number]["files"][number];
}) {
  return (
    <div className="flex items-center justify-between rounded-lg bg-gray-50 p-3 dark:bg-slate-800">
      <div className="flex items-center gap-3 flex-1 min-w-0">
        <Image
          src="/file.png"
          alt=""
          width={40}
          height={40}
          className="h-10 w-10 flex-shrink-0"
        />
        <div className="flex-1 min-w-0">
          <p className="font-medium text-sm text-gray-900 dark:text-slate-100 truncate">
            {file.file_name}
          </p>
          <p className="text-xs text-gray-500 dark:text-slate-400">
            {(file.size / 1024).toFixed(1)} KB • {file.created_by} • Attached on{" "}
            {formatDisplayDate(file.created_at)}
          </p>
        </div>
      </div>
      <a
        href={file.download_url}
        download={file.file_name}
        className="ml-2 inline-flex h-9 w-9 items-center justify-center rounded-md text-gray-600 transition-colors hover:bg-blue-100 hover:text-blue-700 dark:hover:bg-blue-900"
        aria-label={`Download ${file.file_name}`}
        title="Download"
      >
        <Download className="h-5 w-5" />
      </a>
    </div>
  );
}

function TaskSection({
  task,
}: {
  task: SummaryFilesResponse["tasks"][number];
}) {
  return (
    <div className="space-y-3">
      <div className="space-y-1">
        <h3 className="font-semibold text-gray-900 dark:text-slate-100">
          {task.task_title}
        </h3>
        {task.task_created_at && (
          <p className="text-xs text-gray-500 dark:text-slate-400">
            Created {formatDisplayDate(task.task_created_at)}
          </p>
        )}
      </div>
      <div className="grid gap-3 grid-cols-1 md:grid-cols-2 xl:grid-cols-3">
        {task.files.map((file) => (
          <FileItem key={file.file_id} file={file} />
        ))}
      </div>
    </div>
  );
}

const backButtonClassName =
  "rounded-full border border-slate-200/80 bg-white/80 px-3 py-1.5 text-sm font-medium text-slate-600 shadow-sm backdrop-blur transition-colors hover:border-slate-300 hover:bg-slate-100 hover:text-slate-900 dark:border-slate-700/70 dark:bg-slate-900/70 dark:text-slate-300 dark:hover:border-slate-600 dark:hover:bg-slate-800 dark:hover:text-white";

export default function SummaryFilesPage() {
  const params = useParams();
  const searchParams = useSearchParams();
  const router = useRouter();

  const summaryId = String(params.id);
  const initialViewType = (searchParams.get("v") || "sent") as
    | "sent"
    | "recieved";
  const shareToken = searchParams.get("token") || undefined;

  const [files, setFiles] = useState<SummaryFilesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [viewType, setViewType] = useState<"sent" | "recieved">(
    initialViewType,
  );

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
        const message =
          err instanceof Error ? err.message : "Failed to load files";
        setError(message);
        toast.error(message);
      } finally {
        setLoading(false);
      }
    };

    fetchFiles();
  }, [summaryId, viewType, shareToken]);

  const handleViewTypeChange = (newViewType: "sent" | "recieved") => {
    setViewType(newViewType);
    // Update URL with new view type
    const newUrl = shareToken
      ? `/summaries/${summaryId}/files?v=${newViewType}&token=${shareToken}`
      : `/summaries/${summaryId}/files?v=${newViewType}`;
    router.replace(newUrl);
  };

  if (loading) {
    return (
      <div className="container mx-auto py-10">
        <div className="space-y-4">
          <div className="h-8 w-32 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
          <div className="h-64 animate-pulse rounded bg-gray-200 dark:bg-slate-700" />
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="container mx-auto py-10">
        <PageErrorCard
          title="Error Loading Files"
          message={error}
          onRetry={() => window.location.reload()}
        />
      </div>
    );
  }

  const tasksEmpty = !files || files.tasks.length === 0;

  return (
    <div className="container mx-auto">
      <div className="mb-6 flex items-center justify-between">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.back()}
          className={backButtonClassName}
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Summary
        </Button>
      </div>

      <div className="mb-5 space-y-3">
        <div>
          <h1 className="text-3xl font-bold text-gray-900 dark:text-slate-100">
            Files {viewType === "sent" ? "Sent" : "Received"}
          </h1>
          <p className="mt-2 text-gray-600 dark:text-slate-400">
            Week of{" "}
            {files &&
              new Date(files.week_start).toLocaleDateString("en-US", {
                month: "short",
                day: "numeric",
                year: "numeric",
              })}
          </p>
        </div>

        <div className="flex gap-2">
          <Button
            onClick={() => handleViewTypeChange("sent")}
            variant={viewType === "sent" ? "default" : "outline"}
          >
            Files Sent
          </Button>
          <Button
            onClick={() => handleViewTypeChange("recieved")}
            variant={viewType === "recieved" ? "default" : "outline"}
          >
            Files Received
          </Button>
        </div>
      </div>

      <div className="space-y-8">
        {tasksEmpty ? (
          <Card className="bg-blue-50 dark:bg-slate-900 border-blue-200 dark:border-blue-900">
            <CardHeader>
              <CardTitle className="text-blue-900 dark:text-blue-300">
                No Files
              </CardTitle>
            </CardHeader>
            <CardContent>
              <p className="text-blue-700 dark:text-blue-400">
                No files {viewType === "sent" ? "sent" : "received"} during this
                week.
              </p>
            </CardContent>
          </Card>
        ) : (
          files.tasks.map((task) => (
            <div key={task.task_id}>
              <TaskSection task={task} />
            </div>
          ))
        )}
      </div>
    </div>
  );
}
