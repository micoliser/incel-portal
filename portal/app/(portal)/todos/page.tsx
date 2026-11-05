"use client";

import { useEffect, useState, useMemo, useCallback, useRef } from "react";
import { format, isToday, isTomorrow, isPast, parseISO } from "date-fns";
import {
  CheckCircle2,
  Clock,
  Calendar as CalendarIcon,
  Bell,
  BellRing,
  Plus,
  Trash2,
  Edit3,
  Flag,
  AlertTriangle,
  RotateCcw,
  Search,
  Check,
  Mail,
  ChevronDown,
  ChevronUp,
  Inbox,
  Sparkles,
} from "lucide-react";
import { toast } from "sonner";

import {
  TodosSkeleton,
  TodoItemSkeleton,
  TodoItemsListSkeleton,
} from "@/components/skeletons/todos-skeleton";
import { InfiniteScrollLoader } from "@/components/infinite-scroll-loader";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  getTodos,
  getTodoStats,
  createTodo,
  updateTodo,
  toggleTodoComplete,
  snoozeTodo,
  deleteTodo,
  clearCompletedTodos,
  type TodoItem,
  type TodoStats,
} from "@/lib/api/todos";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";

type ViewFilter = "all" | "today" | "upcoming" | "overdue" | "completed";

const priorityConfig = {
  high: {
    label: "High",
    color: "text-[#dc2626] dark:text-red-400",
    bg: "bg-[#dc2626]/10 text-[#dc2626] border-[#dc2626]/25 dark:bg-[#dc2626]/15 dark:text-red-300 dark:border-[#dc2626]/30",
    dot: "bg-[#dc2626]",
  },
  medium: {
    label: "Medium",
    color: "text-amber-600 dark:text-amber-400",
    bg: "bg-amber-50 text-amber-700 border-amber-200 dark:bg-amber-950/40 dark:text-amber-300 dark:border-amber-900/60",
    dot: "bg-amber-500",
  },
  low: {
    label: "Low",
    color: "text-[#0d47a1] dark:text-[#38bdf8]",
    bg: "bg-[#0d47a1]/10 text-[#0d47a1] border-[#0d47a1]/25 dark:bg-[#0d47a1]/15 dark:text-[#38bdf8] dark:border-[#0d47a1]/30",
    dot: "bg-[#0d47a1]",
  },
};

const REMINDER_PRESETS = [
  { value: "exact", label: "At due time" },
  { value: "5m", label: "5m before" },
  { value: "10m", label: "10m before" },
  { value: "15m", label: "15m before" },
  { value: "30m", label: "30m before" },
  { value: "1h", label: "1h before" },
  { value: "2h", label: "2h before" },
  { value: "1d", label: "1d before" },
];

export default function TodosPage() {
  const [todos, setTodos] = useState<TodoItem[]>([]);
  const [stats, setStats] = useState<TodoStats>({
    total: 0,
    today: 0,
    upcoming: 0,
    overdue: 0,
    completed: 0,
  });
  const [loading, setLoading] = useState(true);
  const [isFiltering, setIsFiltering] = useState(false);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const hasInitialLoadCompleted = useRef(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const isRequestInFlightRef = useRef(false);
  const [activeView, setActiveView] = useState<ViewFilter>("all");
  const [priorityFilter, setPriorityFilter] = useState<string>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [showCompletedSection, setShowCompletedSection] = useState(true);

  // Quick Capture State
  const [newTitle, setNewTitle] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [newDueDate, setNewDueDate] = useState<string>("");
  const [newDueTime, setNewDueTime] = useState<string>("");
  const [newPriority, setNewPriority] = useState<"low" | "medium" | "high">("medium");
  const [newReminderOffsets, setNewReminderOffsets] = useState<string[]>(["15m"]);
  const [newSendEmail, setNewSendEmail] = useState(false);
  const [isExpandingCapture, setIsExpandingCapture] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Edit Modal State
  const [editingTodo, setEditingTodo] = useState<TodoItem | null>(null);
  const [editTitle, setEditTitle] = useState("");
  const [editDescription, setEditDescription] = useState("");
  const [editDueDate, setEditDueDate] = useState("");
  const [editDueTime, setEditDueTime] = useState("");
  const [editPriority, setEditPriority] = useState<"low" | "medium" | "high">("medium");
  const [editReminderOffsets, setEditReminderOffsets] = useState<string[]>(["15m"]);
  const [editSendEmail, setEditSendEmail] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);

  // Clear completed confirm modal
  const [isConfirmClearOpen, setIsConfirmClearOpen] = useState(false);
  const [isClearingCompleted, setIsClearingCompleted] = useState(false);

  // Single todo delete confirmation modal
  const [todoToDelete, setTodoToDelete] = useState<TodoItem | null>(null);
  const [isDeletingTodo, setIsDeletingTodo] = useState(false);

  // Browser desktop notification permission status
  const [hasBrowserNotificationSupport, setHasBrowserNotificationSupport] = useState(false);
  const [notificationPermission, setNotificationPermission] = useState<NotificationPermission>("default");

  useEffect(() => {
    if (typeof window !== "undefined" && "Notification" in window) {
      setHasBrowserNotificationSupport(true);
      setNotificationPermission(Notification.permission);
    }
  }, []);

  const requestBrowserNotification = async () => {
    if (typeof window !== "undefined" && "Notification" in window) {
      const perm = await Notification.requestPermission();
      setNotificationPermission(perm);
      if (perm === "granted") {
        toast.success("Desktop notifications enabled! You'll receive alert reminders.");
      } else {
        toast.info("Notification permission was not granted.");
      }
    }
  };

  useEffect(() => {
    setCurrentPage(1);
    setHasNextPage(false);
  }, [activeView, priorityFilter, searchQuery]);

  const loadData = useCallback(async () => {
    if (isRequestInFlightRef.current) return;
    try {
      isRequestInFlightRef.current = true;
      if (!hasInitialLoadCompleted.current) {
        setLoading(true);
      } else if (currentPage === 1) {
        setIsFiltering(true);
      } else {
        setIsLoadingMore(true);
      }

      const [todosData, statsData] = await Promise.all([
        getTodos({
          view: activeView,
          priority: priorityFilter !== "all" ? (priorityFilter as "low" | "medium" | "high") : undefined,
          search: searchQuery.trim() || undefined,
          page: currentPage,
        }),
        getTodoStats(),
      ]);

      setTodos((prev) => (currentPage === 1 ? todosData.results : [...prev, ...todosData.results]));
      setHasNextPage(Boolean(todosData.next));
      setStats(statsData);
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to load to-dos"));
    } finally {
      isRequestInFlightRef.current = false;
      hasInitialLoadCompleted.current = true;
      setLoading(false);
      setIsFiltering(false);
      setIsLoadingMore(false);
    }
  }, [activeView, priorityFilter, searchQuery, currentPage]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!hasNextPage || loading || isFiltering || isLoadingMore) return;
    const element = loadMoreRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !isRequestInFlightRef.current) {
          setCurrentPage((page) => page + 1);
        }
      },
      { threshold: 0.1 }
    );

    observer.observe(element);
    return () => observer.disconnect();
  }, [hasNextPage, loading, isFiltering, isLoadingMore]);

  // Set default due date to today for quick creation
  const handleSetQuickDate = (preset: "today" | "tomorrow" | "none") => {
    const now = new Date();
    if (preset === "today") {
      setNewDueDate(format(now, "yyyy-MM-dd"));
      if (!newDueTime) setNewDueTime("17:00");
    } else if (preset === "tomorrow") {
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);
      setNewDueDate(format(tomorrow, "yyyy-MM-dd"));
      if (!newDueTime) setNewDueTime("09:00");
    } else {
      setNewDueDate("");
      setNewDueTime("");
    }
  };

  // Toggle multiple reminder offsets helper
  const handleToggleReminderOffset = (
    currentList: string[],
    setter: (val: string[]) => void,
    offsetValue: string
  ) => {
    if (currentList.includes(offsetValue)) {
      setter(currentList.filter((item) => item !== offsetValue));
    } else {
      const order = REMINDER_PRESETS.map((p) => p.value);
      const updated = [...currentList, offsetValue].sort(
        (a, b) => order.indexOf(a) - order.indexOf(b)
      );
      setter(updated);
    }
  };

  const handleCreateTodo = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!newTitle.trim()) {
      toast.error("Please enter a to-do title");
      return;
    }

    try {
      setIsSubmitting(true);

      let computedDueDatetime: string | null = null;
      if (newDueDate) {
        const timePart = newDueTime ? `${newDueTime}:00` : "23:59:59";
        const localDt = new Date(`${newDueDate}T${timePart}`);
        if (!isNaN(localDt.getTime())) {
          computedDueDatetime = localDt.toISOString();
        }
      }

      const created = await createTodo({
        title: newTitle.trim(),
        description: newDescription.trim() || undefined,
        due_date: newDueDate || null,
        due_time: newDueTime || null,
        due_datetime: computedDueDatetime,
        priority: newPriority,
        reminder_offset: newReminderOffsets[0] || "none",
        reminder_offsets: newReminderOffsets,
        send_email_reminder: newSendEmail,
      });

      setTodos((prev) => [created, ...prev]);
      setStats((prev) => ({
        ...prev,
        total: prev.total + 1,
        today: newDueDate === format(new Date(), "yyyy-MM-dd") ? prev.today + 1 : prev.today,
      }));

      // Reset form
      setNewTitle("");
      setNewDescription("");
      setNewDueDate("");
      setNewDueTime("");
      setNewPriority("medium");
      setNewReminderOffsets(["15m"]);
      setNewSendEmail(false);
      setIsExpandingCapture(false);

      toast.success("To-do created successfully");
      loadData();
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to create to-do"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleToggleComplete = async (todo: TodoItem) => {
    try {
      const updatedIsCompleted = !todo.is_completed;
      // Optimistic update
      setTodos((prev) =>
        prev.map((item) =>
          item.id === todo.id
            ? {
                ...item,
                is_completed: updatedIsCompleted,
                completed_at: updatedIsCompleted ? new Date().toISOString() : null,
              }
            : item
        )
      );

      const updated = await toggleTodoComplete(todo.id);
      setTodos((prev) =>
        prev.map((item) => (item.id === todo.id ? updated : item))
      );

      toast.success(
        updated.is_completed ? "To-do completed! Great work." : "To-do reopened."
      );
      getTodoStats().then(setStats);
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to update to-do"));
      loadData();
    }
  };

  const handleSnooze = async (id: string, minutes: number) => {
    try {
      const updated = await snoozeTodo(id, minutes);
      setTodos((prev) => prev.map((item) => (item.id === id ? updated : item)));
      toast.success(
        `Reminder snoozed for ${minutes >= 60 ? `${minutes / 60} hour(s)` : `${minutes} minutes`}`
      );
      loadData();
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to snooze reminder"));
    }
  };

  const handleConfirmDelete = async () => {
    if (!todoToDelete) return;
    try {
      setIsDeletingTodo(true);
      await deleteTodo(todoToDelete.id);
      setTodos((prev) => prev.filter((item) => item.id !== todoToDelete.id));
      toast.success("To-do removed");
      setTodoToDelete(null);
      loadData();
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to delete to-do"));
    } finally {
      setIsDeletingTodo(false);
    }
  };

  const handleOpenEditModal = (todo: TodoItem) => {
    setEditingTodo(todo);
    setEditTitle(todo.title);
    setEditDescription(todo.description || "");
    setEditDueDate(todo.due_date || "");
    setEditDueTime(todo.due_time ? todo.due_time.slice(0, 5) : "");
    setEditPriority(todo.priority);
    setEditReminderOffsets(
      todo.reminder_offsets && todo.reminder_offsets.length > 0
        ? todo.reminder_offsets
        : todo.reminder_offset && todo.reminder_offset !== "none"
        ? [todo.reminder_offset]
        : ["15m"]
    );
    setEditSendEmail(todo.send_email_reminder);
  };

  const handleSaveEdit = async () => {
    if (!editingTodo) return;
    if (!editTitle.trim()) {
      toast.error("Please enter a to-do title");
      return;
    }

    try {
      setIsSavingEdit(true);

      let computedDueDatetime: string | null = null;
      if (editDueDate) {
        const timePart = editDueTime ? `${editDueTime}:00` : "23:59:59";
        const localDt = new Date(`${editDueDate}T${timePart}`);
        if (!isNaN(localDt.getTime())) {
          computedDueDatetime = localDt.toISOString();
        }
      }

      const updated = await updateTodo(editingTodo.id, {
        title: editTitle.trim(),
        description: editDescription.trim() || "",
        due_date: editDueDate || null,
        due_time: editDueTime || null,
        due_datetime: computedDueDatetime,
        priority: editPriority,
        reminder_offset: editReminderOffsets[0] || "none",
        reminder_offsets: editReminderOffsets,
        send_email_reminder: editSendEmail,
      });

      setTodos((prev) =>
        prev.map((item) => (item.id === editingTodo.id ? updated : item))
      );
      setEditingTodo(null);
      toast.success("To-do updated successfully");
      loadData();
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to update to-do"));
    } finally {
      setIsSavingEdit(false);
    }
  };

  const handleClearCompleted = async () => {
    try {
      setIsClearingCompleted(true);
      const res = await clearCompletedTodos();
      toast.success(`Cleared ${res.deleted_count} completed to-dos`);
      setIsConfirmClearOpen(false);
      loadData();
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to clear completed to-dos"));
    } finally {
      setIsClearingCompleted(false);
    }
  };

  // Group to-dos into clean sections.
  // Note: Today is grouped into Open and Completed Today so completed items remain visible on Today!
  const groupedTodos = useMemo(() => {
    const overdueList: TodoItem[] = [];
    const todayOpenList: TodoItem[] = [];
    const todayCompletedList: TodoItem[] = [];
    const upcomingList: TodoItem[] = [];
    const noDateList: TodoItem[] = [];
    const otherCompletedList: TodoItem[] = [];
    const allCompletedList: TodoItem[] = [];

    const now = new Date();
    const todayStr = format(now, "yyyy-MM-dd");

    todos.forEach((item) => {
      if (item.is_completed) {
        allCompletedList.push(item);
        const wasCompletedToday = item.completed_at
          ? isToday(parseISO(item.completed_at))
          : false;
        const isDueToday = item.due_date === todayStr;

        if (isDueToday || wasCompletedToday) {
          todayCompletedList.push(item);
        } else {
          otherCompletedList.push(item);
        }
        return;
      }

      if (!item.due_date) {
        noDateList.push(item);
        return;
      }

      let isOverdue = false;
      if (item.due_datetime) {
        isOverdue = isPast(parseISO(item.due_datetime));
      } else if (item.due_date < todayStr) {
        isOverdue = true;
      }

      if (isOverdue) {
        overdueList.push(item);
      } else if (item.due_date === todayStr) {
        todayOpenList.push(item);
      } else {
        upcomingList.push(item);
      }
    });

    return {
      overdue: overdueList,
      todayOpen: todayOpenList,
      todayCompleted: todayCompletedList,
      upcoming: upcomingList,
      noDate: noDateList,
      otherCompleted: otherCompletedList,
      allCompleted: allCompletedList,
    };
  }, [todos]);

  const formatTimeDisplay = (timeStr: string) => {
    try {
      const [hours, minutes] = timeStr.split(":");
      const h = parseInt(hours, 10);
      const ampm = h >= 12 ? "PM" : "AM";
      const formattedH = h % 12 || 12;
      return `${formattedH}:${minutes} ${ampm}`;
    } catch {
      return timeStr;
    }
  };

  const renderDueBadge = (todo: TodoItem) => {
    if (!todo.due_date) return null;

    const todayStr = format(new Date(), "yyyy-MM-dd");
    let label = "";
    let isPastDue = false;

    if (todo.due_datetime) {
      isPastDue = isPast(parseISO(todo.due_datetime)) && !todo.is_completed;
    } else if (todo.due_date < todayStr && !todo.is_completed) {
      isPastDue = true;
    }

    if (todo.due_date === todayStr) {
      label = todo.due_time ? `Today, ${formatTimeDisplay(todo.due_time)}` : "Today";
    } else {
      try {
        const parsed = parseISO(todo.due_date);
        if (isTomorrow(parsed)) {
          label = todo.due_time
            ? `Tomorrow, ${formatTimeDisplay(todo.due_time)}`
            : "Tomorrow";
        } else {
          label = todo.due_time
            ? `${format(parsed, "EEE, MMM d")}, ${formatTimeDisplay(todo.due_time)}`
            : format(parsed, "EEE, MMM d");
        }
      } catch {
        label = todo.due_date;
      }
    }

    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs font-medium px-2.5 py-1 rounded-full transition-colors",
          isPastDue
            ? "bg-[#dc2626]/10 text-[#dc2626] dark:bg-[#dc2626]/15 dark:text-rose-300 border border-[#dc2626]/25 dark:border-[#dc2626]/30"
            : todo.due_date === todayStr
            ? "bg-amber-100 text-amber-800 dark:bg-amber-950/50 dark:text-amber-300 border border-amber-200 dark:border-amber-900/60"
            : "bg-muted text-foreground border border-border"
        )}
      >
        <CalendarIcon className="size-3.5" />
        {label}
        {isPastDue && <span className="font-bold">• Overdue</span>}
      </span>
    );
  };

  const renderReminderBadge = (todo: TodoItem) => {
    const offsets =
      todo.reminder_offsets && todo.reminder_offsets.length > 0
        ? todo.reminder_offsets
        : todo.reminder_offset && todo.reminder_offset !== "none"
        ? [todo.reminder_offset]
        : [];

    if (offsets.length === 0 && !todo.reminder_at) return null;

    let timeStr = "";
    if (todo.reminder_at) {
      try {
        const parsed = parseISO(todo.reminder_at);
        timeStr = format(parsed, "h:mm a");
      } catch {
        // fallback
      }
    }

    const offsetLabels = offsets.map((o) => {
      const match = REMINDER_PRESETS.find((p) => p.value === o);
      return match ? match.label.replace(" before", "") : o;
    });

    const summary =
      offsetLabels.length > 0
        ? `${offsetLabels.join(", ")} before`
        : "Reminder set";

    return (
      <span
        className={cn(
          "inline-flex items-center gap-1.5 text-xs px-2.5 py-1 rounded-full font-medium transition-colors",
          todo.reminder_sent
            ? "bg-[#16a34a]/10 text-[#16a34a] border border-[#16a34a]/25 dark:text-[#4ade80]"
            : "bg-[#0d47a1]/10 text-[#0d47a1] border border-[#0d47a1]/25 dark:text-[#38bdf8]"
        )}
        title={
          todo.reminder_sent
            ? "All scheduled reminders have been sent"
            : `Scheduled alert: ${timeStr ? `${timeStr} (${summary})` : summary}`
        }
      >
        <Bell className="size-3.5" />
        <span>{timeStr ? `${timeStr} (${summary})` : summary}</span>
        {todo.reminder_sent ? (
          <span className="text-[10px] uppercase font-bold text-[#16a34a] dark:text-[#4ade80]">
            (Sent)
          </span>
        ) : todo.reminders_sent && todo.reminders_sent.length > 0 ? (
          <span className="text-[10px] font-semibold text-[#0d47a1] dark:text-[#38bdf8]">
            ({todo.reminders_sent.length}/{offsets.length} sent)
          </span>
        ) : null}
        {todo.send_email_reminder && (
          <span title="Email reminder enabled">
            <Mail className="size-3 ml-0.5 text-[#0d47a1] dark:text-[#38bdf8]" />
          </span>
        )}
      </span>
    );
  };

  // Render a single to-do row
  const renderTodoItem = (todo: TodoItem) => {
    const priority = priorityConfig[todo.priority] || priorityConfig.medium;

    return (
      <div
        key={todo.id}
        className={cn(
          "group relative flex items-start gap-3.5 p-3.5 sm:p-4 rounded-xl border transition-all duration-200 bg-card hover:shadow-md",
          todo.is_completed
            ? "border-border/50 bg-muted/20 opacity-75 hover:opacity-100"
            : "border-border hover:border-[#0d47a1]/30 hover:bg-card"
        )}
      >
        {/* Toggle Checkbox Button */}
        <button
          type="button"
          onClick={() => handleToggleComplete(todo)}
          className={cn(
            "mt-0.5 flex-shrink-0 size-5 sm:size-6 rounded-full border-2 flex items-center justify-center transition-all duration-200 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2",
            todo.is_completed
              ? "bg-[#16a34a] border-[#16a34a] text-white"
              : "border-muted-foreground/40 hover:border-[#0d47a1] hover:bg-[#0d47a1]/10 text-transparent hover:text-[#0d47a1]/70"
          )}
          aria-label={todo.is_completed ? "Mark incomplete" : "Mark complete"}
        >
          <Check className="size-3.5 stroke-[3]" />
        </button>

        {/* Content Details */}
        <div className="flex-1 min-w-0 pr-1">
          <div className="flex items-start justify-between gap-2">
            <h4
              className={cn(
                "text-sm sm:text-base font-semibold leading-snug break-words transition-all",
                todo.is_completed
                  ? "line-through text-muted-foreground"
                  : "text-foreground"
              )}
            >
              {todo.title}
            </h4>

            {/* Quick Priority Indicator */}
            <span
              className={cn(
                "inline-flex items-center gap-1 text-[11px] font-semibold px-2 py-0.5 rounded-md border flex-shrink-0",
                priority.bg
              )}
            >
              <Flag className={cn("size-3", priority.color)} />
              {priority.label}
            </span>
          </div>

          {todo.description && (
            <p
              className={cn(
                "mt-1 text-xs sm:text-sm text-muted-foreground line-clamp-2 break-words",
                todo.is_completed && "line-through opacity-75"
              )}
            >
              {todo.description}
            </p>
          )}

          {/* Badges / Meta row */}
          <div className="mt-2.5 flex flex-wrap items-center gap-2">
            {renderDueBadge(todo)}
            {renderReminderBadge(todo)}

            {todo.completed_at && (
              <span className="text-[11px] text-muted-foreground flex items-center gap-1">
                <CheckCircle2 className="size-3 text-[#16a34a] dark:text-[#4ade80]" />
                Completed {format(parseISO(todo.completed_at), "MMM d, h:mm a")}
              </span>
            )}
          </div>
        </div>

        {/* Action Controls - Always visible and prominently styled */}
        <div className="flex items-center gap-1.5 flex-shrink-0">
          {/* Snooze action for non-completed reminders */}
          {!todo.is_completed && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="outline"
                  size="sm"
                  className="size-8 p-0 rounded-lg border border-border/80 bg-background/90 hover:bg-muted text-muted-foreground hover:text-foreground shadow-xs transition-colors"
                  title="Snooze reminder"
                >
                  <RotateCcw className="size-3.5 text-amber-600 dark:text-amber-400" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-44">
                <div className="px-2 py-1.5 text-xs font-semibold text-muted-foreground">
                  Snooze Reminder
                </div>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={() => handleSnooze(todo.id, 15)}>
                  15 minutes
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSnooze(todo.id, 30)}>
                  30 minutes
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSnooze(todo.id, 60)}>
                  1 hour
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSnooze(todo.id, 180)}>
                  3 hours
                </DropdownMenuItem>
                <DropdownMenuItem onClick={() => handleSnooze(todo.id, 1440)}>
                  Tomorrow
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Edit Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => handleOpenEditModal(todo)}
            className="size-8 p-0 rounded-lg border border-border/80 bg-background/90 hover:bg-muted text-muted-foreground hover:text-foreground shadow-xs transition-colors"
            title="Edit to-do"
          >
            <Edit3 className="size-3.5 text-[#0d47a1] dark:text-[#38bdf8]" />
          </Button>

          {/* Delete Button */}
          <Button
            variant="outline"
            size="sm"
            onClick={() => setTodoToDelete(todo)}
            className="size-8 p-0 rounded-lg border border-[#dc2626]/25 bg-[#dc2626]/60 hover:bg-[#dc2626]/10 text-[#dc2626] dark:border-[#dc2626]/30 dark:bg-[#dc2626]/15 dark:text-rose-400 dark:hover:bg-[#dc2626]/15 shadow-xs transition-colors"
            title="Delete to-do"
          >
            <Trash2 className="size-3.5" />
          </Button>
        </div>
      </div>
    );
  };

  if (loading && !hasInitialLoadCompleted.current) {
    return <TodosSkeleton />;
  }

  return (
    <div className="mx-auto max-w-5xl space-y-5 pb-16 px-1 sm:px-4 max-w-full overflow-hidden">
      {/* Top Quick Status & Stats Row */}
      <div className="flex flex-wrap items-center justify-between gap-2.5 pb-1">
        <div className="flex items-center gap-2 flex-wrap">
          <Badge
            variant="outline"
            className="px-2.5 py-1 bg-background text-xs font-medium"
          >
            Total:{" "}
            <span className="ml-1 font-bold text-foreground">
              {stats.total}
            </span>
          </Badge>
          <Badge
            variant="outline"
            className="px-2.5 py-1 bg-amber-50 dark:bg-amber-950/40 text-amber-700 dark:text-amber-300 border-amber-200 text-xs font-medium"
          >
            Today: <span className="ml-1 font-bold">{stats.today}</span>
          </Badge>
          {stats.overdue > 0 && (
            <Badge
              variant="outline"
              className="px-2.5 py-1 bg-[#dc2626]/10 dark:bg-[#dc2626]/15 text-[#dc2626] dark:text-rose-300 border-[#dc2626]/25 text-xs font-bold animate-pulse"
            >
              Overdue: <span className="ml-1">{stats.overdue}</span>
            </Badge>
          )}
        </div>

        {stats.completed > 0 && (
          <Button
            variant="outline"
            size="sm"
            onClick={() => setIsConfirmClearOpen(true)}
            className="text-xs text-muted-foreground hover:text-destructive h-7 px-2.5 ml-auto"
          >
            <Trash2 className="size-3 mr-1" />
            Clear Completed ({stats.completed})
          </Button>
        )}
      </div>

      {/* Browser Desktop Notification Opt-in Banner */}
      {hasBrowserNotificationSupport && notificationPermission === "default" && (
        <div className="flex items-center justify-between gap-3 p-3.5 rounded-xl border border-[#0d47a1]/25 bg-[#0d47a1]/10 text-foreground">
          <div className="flex items-center gap-2.5 text-xs sm:text-sm">
            <BellRing className="size-4 text-[#0d47a1] dark:text-[#38bdf8] flex-shrink-0" />
            <span>
              <strong>Enable desktop alerts:</strong> Receive pop-up notifications
              right on your screen when reminders are due, even if you are working
              in another tab.
            </span>
          </div>
          <Button
            size="sm"
            onClick={requestBrowserNotification}
            className="h-8 px-3 text-xs bg-[#0d47a1] hover:bg-[#0a3880] text-white flex-shrink-0"
          >
            Allow Alerts
          </Button>
        </div>
      )}

      {/* Quick Task Capture Card */}
      <Card className="p-4 sm:p-5 border-border shadow-sm rounded-2xl bg-card">
        <form onSubmit={handleCreateTodo} className="space-y-3">
          <div className="flex items-center gap-3">
            <div className="size-6 rounded-full border-2 border-dashed border-muted-foreground/50 flex items-center justify-center flex-shrink-0">
              <Plus className="size-3.5 text-muted-foreground" />
            </div>
            <Input
              value={newTitle}
              onChange={(e) => setNewTitle(e.target.value)}
              onFocus={() => setIsExpandingCapture(true)}
              placeholder="What needs to be done? (e.g., Prepare slide deck, Submit report by 4 PM...)"
              className="flex-1 border-0 shadow-none focus-visible:ring-0 text-sm sm:text-base px-0 font-medium placeholder:font-normal placeholder:text-muted-foreground/70"
            />
          </div>

          {/* Expanded creation options */}
          {(isExpandingCapture || newTitle.length > 0) && (
            <div className="pt-3 border-t border-border/60 space-y-3.5 animate-in fade-in-50 duration-200">
              <Textarea
                value={newDescription}
                onChange={(e) => setNewDescription(e.target.value)}
                placeholder="Add optional notes, links, or instructions..."
                rows={2}
                className="text-xs sm:text-sm resize-none bg-muted/20 border-border/60"
              />

              <div className="flex flex-wrap items-center gap-2.5 pt-1">
                {/* Quick Date Presets */}
                <div className="flex items-center gap-1">
                  <Button
                    type="button"
                    variant={newDueDate === format(new Date(), "yyyy-MM-dd") ? "secondary" : "outline"}
                    size="sm"
                    onClick={() => handleSetQuickDate("today")}
                    className="h-9 px-3 text-sm font-medium"
                  >
                    Today
                  </Button>
                  <Button
                    type="button"
                    variant={
                      newDueDate === format(new Date(Date.now() + 86400000), "yyyy-MM-dd")
                        ? "secondary"
                        : "outline"
                    }
                    size="sm"
                    onClick={() => handleSetQuickDate("tomorrow")}
                    className="h-9 px-3 text-sm font-medium"
                  >
                    Tomorrow
                  </Button>
                </div>

                {/* Specific Date Picker */}
                <div className="flex items-center gap-1.5">
                  <Input
                    type="date"
                    value={newDueDate}
                    onChange={(e) => setNewDueDate(e.target.value)}
                    className="h-9 text-sm w-36 px-2.5 bg-background border-border rounded-md font-sans"
                  />
                  {/* Specific Time Picker */}
                  <Input
                    type="time"
                    value={newDueTime}
                    onChange={(e) => setNewDueTime(e.target.value)}
                    className="h-9 text-sm w-28 px-2.5 bg-background border-border rounded-md font-sans"
                    title="Specific due time"
                  />
                </div>

                {/* Priority Selector */}
                <div className="flex items-center gap-1">
                  <select
                    value={newPriority}
                    onChange={(e) => setNewPriority(e.target.value as "low" | "medium" | "high")}
                    className="h-9 text-sm font-sans rounded-md border border-border bg-background px-3 text-foreground focus:outline-none focus:ring-1 focus:ring-primary font-medium"
                  >
                    <option value="low">Low Priority</option>
                    <option value="medium">Medium Priority</option>
                    <option value="high">High Priority</option>
                  </select>
                </div>

                {/* Prominent Email Reminder Toggle Button */}
                <button
                  type="button"
                  onClick={() => setNewSendEmail((prev) => !prev)}
                  className={cn(
                    "h-9 px-3 rounded-md border text-xs sm:text-sm font-medium transition-all shadow-xs inline-flex items-center gap-2 select-none ml-auto",
                    newSendEmail
                      ? "bg-[#0d47a1] border-[#0d47a1] text-white font-semibold ring-2 ring-[#0d47a1]/25 shadow-sm"
                      : "bg-background border-border text-foreground hover:bg-muted hover:border-border"
                  )}
                  title={newSendEmail ? "Email reminder is enabled" : "Click to enable email reminder"}
                >
                  <Mail className={cn("size-4", newSendEmail ? "text-white" : "text-[#0d47a1] dark:text-[#38bdf8]")} />
                  <span>Email Reminder</span>
                  <span
                    className={cn(
                      "px-1.5 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                      newSendEmail
                        ? "bg-white/20 text-white"
                        : "bg-muted text-muted-foreground border border-border/50"
                    )}
                  >
                    {newSendEmail ? "ON" : "OFF"}
                  </span>
                </button>
              </div>

              {/* Multi-Select Reminder Offsets Section */}
              <div className="pt-2 border-t border-border/40 space-y-1.5">
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 font-semibold text-foreground">
                    <Bell className="size-3.5 text-[#0d47a1]" />
                    Reminder Alerts (Select one or multiple alert times):
                  </span>
                  {newReminderOffsets.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => setNewReminderOffsets([])}
                      className="text-[11px] text-muted-foreground hover:text-foreground underline"
                    >
                      Clear alerts ({newReminderOffsets.length} selected)
                    </button>
                  ) : (
                    <span className="text-[11px] text-muted-foreground italic">
                      No reminder alerts selected
                    </span>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-1.5 pt-0.5">
                  {REMINDER_PRESETS.map((preset) => {
                    const isSelected = newReminderOffsets.includes(preset.value);
                    return (
                      <button
                        key={preset.value}
                        type="button"
                        onClick={() =>
                          handleToggleReminderOffset(
                            newReminderOffsets,
                            setNewReminderOffsets,
                            preset.value
                          )
                        }
                        className={cn(
                          "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border transition-all select-none",
                          isSelected
                            ? "bg-[#0d47a1] border-[#0d47a1] text-white shadow-xs font-semibold"
                            : "bg-background border-border/80 text-muted-foreground hover:bg-muted hover:text-foreground"
                        )}
                      >
                        {isSelected && <Check className="size-3 stroke-[3]" />}
                        <span>{preset.label}</span>
                      </button>
                    );
                  })}
                </div>
              </div>

              {/* Bottom action row */}
              <div className="flex items-center justify-between pt-2">
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    setIsExpandingCapture(false);
                    setNewTitle("");
                    setNewDescription("");
                  }}
                  className="text-xs sm:text-sm text-muted-foreground h-9"
                >
                  Cancel
                </Button>

                <Button
                  type="submit"
                  size="sm"
                  disabled={!newTitle.trim() || isSubmitting}
                  className="h-9 px-4 text-sm font-medium gap-1.5"
                >
                  <Plus className="size-4" />
                  Add To-Do
                </Button>
              </div>
            </div>
          )}
        </form>
      </Card>

      {/* Filter Navigation Bar & Search */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pt-1">
        {/* View Tabs */}
        <div className="flex max-w-full items-center overflow-x-auto rounded-lg border border-border bg-muted/60 p-1 scrollbar-none">
          {(
            [
              { id: "all", label: "All", count: stats.total },
              { id: "today", label: "Today", count: stats.today },
              { id: "upcoming", label: "Upcoming", count: stats.upcoming },
              {
                id: "overdue",
                label: "Overdue",
                count: stats.overdue,
              },
              { id: "completed", label: "Completed", count: stats.completed },
            ] as const
          ).map((tab) => (
            <Button
              key={tab.id}
              type="button"
              size="sm"
              variant={activeView === tab.id ? "default" : "ghost"}
              className="rounded-md flex-shrink-0 text-xs sm:text-sm font-medium h-8 sm:h-9 gap-1.5"
              onClick={() => setActiveView(tab.id)}
            >
              <span>{tab.label}</span>
              <span
                className={cn(
                  "px-1.5 py-0.2 rounded-full text-[10px] sm:text-xs font-semibold",
                  activeView === tab.id
                    ? "bg-primary-foreground/20 text-primary-foreground"
                    : tab.id === "overdue" && stats.overdue > 0
                    ? "bg-[#dc2626]/10 text-[#dc2626] dark:bg-[#dc2626]/15 dark:text-rose-300 font-extrabold"
                    : "bg-muted text-muted-foreground"
                )}
              >
                {tab.count}
              </span>
            </Button>
          ))}
        </div>

        {/* Priority Filter & Search Bar */}
        <div className="flex items-center gap-2 w-full sm:w-auto">
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="h-9 text-xs sm:text-sm font-sans rounded-md border border-border bg-background px-3 text-foreground focus:outline-none flex-1 sm:flex-initial"
          >
            <option value="all">All Priorities</option>
            <option value="high">High Priority</option>
            <option value="medium">Medium Priority</option>
            <option value="low">Low Priority</option>
          </select>

          <div className="relative flex-1 sm:flex-initial">
            <Search className="size-4 absolute left-3 top-2.5 text-muted-foreground" />
            <Input
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search to-dos..."
              className="h-9 pl-9 pr-3 text-xs sm:text-sm w-full sm:w-48 bg-background border-border font-sans rounded-md"
            />
          </div>
        </div>
      </div>

      {/* Main List Content */}
      {isFiltering ? (
        <TodoItemsListSkeleton count={4} />
      ) : todos.length === 0 ? (
        /* Empty State */
        <Card className="py-16 px-4 text-center border-dashed rounded-2xl bg-card/60">
          <div className="inline-flex items-center justify-center size-12 rounded-full bg-muted text-muted-foreground mb-3">
            <Inbox className="size-6" />
          </div>
          <h3 className="text-base font-semibold text-foreground">No to-dos found</h3>
          <p className="mt-1 text-xs text-muted-foreground max-w-sm mx-auto">
            {searchQuery
              ? `No to-dos matching "${searchQuery}". Try clearing your search.`
              : activeView === "today"
              ? "You have no to-dos scheduled for today. Enjoy your day or add one above!"
              : activeView === "overdue"
              ? "Awesome! You have zero overdue items."
              : "Keep yourself organized. Use the capture bar above to add your first to-do item."}
          </p>
          {searchQuery && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSearchQuery("")}
              className="mt-4 text-xs h-8"
            >
              Clear Search
            </Button>
          )}
        </Card>
      ) : (
        /* Unified List Divided into Time Sections */
        <div className="space-y-6">
          {/* Overdue Section (Visible in All or Overdue views) */}
          {groupedTodos.overdue.length > 0 &&
            (activeView === "all" || activeView === "overdue") && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 px-1">
                  <AlertTriangle className="size-4 text-[#dc2626] dark:text-rose-400" />
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-[#dc2626] dark:text-rose-400">
                    Overdue
                  </h3>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#dc2626]/10 text-[#dc2626] dark:bg-[#dc2626]/15 dark:text-rose-300">
                    {groupedTodos.overdue.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {groupedTodos.overdue.map(renderTodoItem)}
                </div>
              </div>
            )}

          {/* Today Section (Visible in All or Today views) */}
          {(groupedTodos.todayOpen.length > 0 || groupedTodos.todayCompleted.length > 0) &&
            (activeView === "all" || activeView === "today") && (
              <div className="space-y-3">
                {/* Today Header */}
                <div className="flex items-center justify-between px-1">
                  <div className="flex items-center gap-2">
                    <CalendarIcon className="size-4 text-amber-600 dark:text-amber-400" />
                    <h3 className="text-sm font-semibold uppercase tracking-wide text-amber-700 dark:text-amber-400">
                      Today
                    </h3>
                    <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300">
                      {groupedTodos.todayOpen.length} open
                    </span>
                    {groupedTodos.todayCompleted.length > 0 && (
                      <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#16a34a]/10 text-[#16a34a] dark:bg-[#16a34a]/15 dark:text-[#4ade80]">
                        {groupedTodos.todayCompleted.length} completed
                      </span>
                    )}
                  </div>
                </div>

                {/* Open Today To-Dos */}
                {groupedTodos.todayOpen.length > 0 ? (
                  <div className="space-y-2">
                    {groupedTodos.todayOpen.map(renderTodoItem)}
                  </div>
                ) : groupedTodos.todayCompleted.length > 0 ? (
                  <div className="p-3.5 rounded-xl border border-dashed border-[#16a34a]/25 bg-[#16a34a]/40 dark:border-[#16a34a]/30 dark:bg-[#16a34a]/15 text-center">
                    <p className="text-xs font-medium text-[#16a34a] dark:text-[#4ade80] flex items-center justify-center gap-1.5">
                      <Sparkles className="size-3.5" />
                      All to-dos for today are completed! Great job.
                    </p>
                  </div>
                ) : null}

                {/* Completed Today To-Dos (Grouped right below open items so they don't disappear) */}
                {groupedTodos.todayCompleted.length > 0 && (
                  <div className="pt-2 space-y-2">
                    <div className="flex items-center gap-2 px-1 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                      <CheckCircle2 className="size-3.5 text-[#16a34a] dark:text-[#4ade80]" />
                      <span>Completed Today ({groupedTodos.todayCompleted.length})</span>
                    </div>
                    <div className="space-y-2">
                      {groupedTodos.todayCompleted.map(renderTodoItem)}
                    </div>
                  </div>
                )}
              </div>
            )}

          {/* Upcoming Section (Visible in All or Upcoming views) */}
          {groupedTodos.upcoming.length > 0 &&
            (activeView === "all" || activeView === "upcoming") && (
              <div className="space-y-2.5">
                <div className="flex items-center gap-2 px-1">
                  <Clock className="size-4 text-[#0d47a1] dark:text-[#38bdf8]" />
                  <h3 className="text-sm font-semibold uppercase tracking-wide text-[#0d47a1] dark:text-[#38bdf8]">
                    Upcoming
                  </h3>
                  <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/15 dark:text-[#38bdf8]">
                    {groupedTodos.upcoming.length}
                  </span>
                </div>
                <div className="space-y-2">
                  {groupedTodos.upcoming.map(renderTodoItem)}
                </div>
              </div>
            )}

          {/* No Date Section (Visible in All view) */}
          {groupedTodos.noDate.length > 0 && activeView === "all" && (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 px-1">
                <Inbox className="size-4 text-muted-foreground" />
                <h3 className="text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  No Due Date
                </h3>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {groupedTodos.noDate.length}
                </span>
              </div>
              <div className="space-y-2">
                {groupedTodos.noDate.map(renderTodoItem)}
              </div>
            </div>
          )}

          {/* Completed View: All Completed Items */}
          {activeView === "completed" && (
            <div className="space-y-2.5">
              <div className="flex items-center gap-2 px-1">
                <CheckCircle2 className="size-4 text-[#16a34a] dark:text-[#4ade80]" />
                <h3 className="text-sm font-semibold uppercase tracking-wide text-[#16a34a] dark:text-[#4ade80]">
                  All Completed To-Dos
                </h3>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-[#16a34a]/10 text-[#16a34a] dark:bg-[#16a34a]/15 dark:text-[#4ade80]">
                  {groupedTodos.allCompleted.length}
                </span>
              </div>
              <div className="space-y-2">
                {groupedTodos.allCompleted.map(renderTodoItem)}
              </div>
            </div>
          )}

          {/* Older Completed Section in All view (Collapsible) */}
          {activeView === "all" && groupedTodos.otherCompleted.length > 0 && (
            <div className="space-y-2.5 pt-4 border-t border-border/50">
              <button
                type="button"
                onClick={() => setShowCompletedSection((prev) => !prev)}
                className="flex items-center gap-2 px-1 text-sm font-semibold uppercase tracking-wide text-muted-foreground hover:text-foreground transition-colors"
              >
                <CheckCircle2 className="size-4 text-[#16a34a]" />
                <span>Older Completed</span>
                <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-muted text-muted-foreground">
                  {groupedTodos.otherCompleted.length}
                </span>
                {showCompletedSection ? (
                  <ChevronUp className="size-4 ml-1" />
                ) : (
                  <ChevronDown className="size-4 ml-1" />
                )}
              </button>

              {showCompletedSection && (
                <div className="space-y-2">
                  {groupedTodos.otherCompleted.map(renderTodoItem)}
                </div>
              )}
            </div>
          )}

          {isLoadingMore && (
            <div className="pt-2">
              <TodoItemSkeleton />
            </div>
          )}

          <InfiniteScrollLoader isLoading={isLoadingMore} entityName="to-dos" />

          {hasNextPage && <div ref={loadMoreRef} className="h-6" />}
        </div>
      )}

      {/* Edit To-Do Modal */}
      <Dialog
        open={Boolean(editingTodo)}
        onOpenChange={(open) => !open && setEditingTodo(null)}
      >
        <DialogContent className="max-w-md">
          <DialogHeader icon={<Edit3 className="size-4.5" />}>
            <DialogTitle>Edit To-Do</DialogTitle>
            <DialogDescription>
              Update the details, due time, and reminder options for this item.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-3.5 py-2">
            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">
                Title
              </label>
              <Input
                value={editTitle}
                onChange={(e) => setEditTitle(e.target.value)}
                placeholder="Task title..."
                className="text-sm font-medium"
              />
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">
                Description
              </label>
              <Textarea
                value={editDescription}
                onChange={(e) => setEditDescription(e.target.value)}
                placeholder="Add optional notes or checklist details..."
                rows={3}
                className="text-xs resize-none"
              />
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="text-xs font-semibold text-foreground mb-1 block">
                  Due Date
                </label>
                <Input
                  type="date"
                  value={editDueDate}
                  onChange={(e) => setEditDueDate(e.target.value)}
                  className="text-xs"
                />
              </div>

              <div>
                <label className="text-xs font-semibold text-foreground mb-1 block">
                  Due Time
                </label>
                <Input
                  type="time"
                  value={editDueTime}
                  onChange={(e) => setEditDueTime(e.target.value)}
                  className="text-xs"
                />
              </div>
            </div>

            <div>
              <label className="text-xs font-semibold text-foreground mb-1 block">
                Priority
              </label>
              <select
                value={editPriority}
                onChange={(e) =>
                  setEditPriority(e.target.value as "low" | "medium" | "high")
                }
                className="w-full h-9 text-xs rounded-md border border-border bg-background px-2.5 text-foreground focus:outline-none"
              >
                <option value="low">Low Priority</option>
                <option value="medium">Medium Priority</option>
                <option value="high">High Priority</option>
              </select>
            </div>

            {/* Multi-Select Reminder Offsets for Edit Modal */}
            <div>
              <div className="flex items-center justify-between text-xs mb-1.5">
                <label className="font-semibold text-foreground flex items-center gap-1.5">
                  <Bell className="size-3.5 text-[#0d47a1]" />
                  Reminder Alerts (Select multiple)
                </label>
                {editReminderOffsets.length > 0 && (
                  <button
                    type="button"
                    onClick={() => setEditReminderOffsets([])}
                    className="text-[11px] text-muted-foreground hover:text-foreground underline"
                  >
                    Clear ({editReminderOffsets.length})
                  </button>
                )}
              </div>
              <div className="flex flex-wrap items-center gap-1.5 p-2 rounded-lg border border-border/70 bg-muted/20">
                {REMINDER_PRESETS.map((preset) => {
                  const isSelected = editReminderOffsets.includes(preset.value);
                  return (
                    <button
                      key={preset.value}
                      type="button"
                      onClick={() =>
                        handleToggleReminderOffset(
                          editReminderOffsets,
                          setEditReminderOffsets,
                          preset.value
                        )
                      }
                      className={cn(
                        "inline-flex items-center gap-1 px-2.5 py-1 rounded-md text-xs font-medium border transition-all select-none",
                        isSelected
                          ? "bg-[#0d47a1] border-[#0d47a1] text-white shadow-xs font-semibold"
                          : "bg-background border-border text-muted-foreground hover:bg-muted hover:text-foreground"
                      )}
                    >
                      {isSelected && <Check className="size-3 stroke-[3]" />}
                      <span>{preset.label}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="pt-1">
              <button
                type="button"
                onClick={() => setEditSendEmail((prev) => !prev)}
                className={cn(
                  "w-full h-11 px-3.5 rounded-lg border text-xs sm:text-sm font-medium transition-all shadow-xs inline-flex items-center justify-between select-none",
                  editSendEmail
                    ? "bg-[#0d47a1] border-[#0d47a1] text-white font-semibold ring-2 ring-[#0d47a1]/25 shadow-sm"
                    : "bg-background border-border text-foreground hover:bg-muted hover:border-border"
                )}
              >
                <div className="flex items-center gap-2.5">
                  <div
                    className={cn(
                      "size-7 rounded-md flex items-center justify-center",
                      editSendEmail
                        ? "bg-white/20 text-white"
                        : "bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/15 dark:text-indigo-400"
                    )}
                  >
                    <Mail className="size-4" />
                  </div>
                  <div className="text-left">
                    <p className="font-semibold leading-tight">Email Notification</p>
                    <p
                      className={cn(
                        "text-[11px] leading-tight",
                        editSendEmail ? "text-[#0d47a1]" : "text-muted-foreground"
                      )}
                    >
                      Receive an email when this reminder triggers
                    </p>
                  </div>
                </div>
                <span
                  className={cn(
                    "px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider",
                    editSendEmail
                      ? "bg-white/20 text-white"
                      : "bg-muted text-muted-foreground border border-border/50"
                  )}
                >
                  {editSendEmail ? "ENABLED" : "DISABLED"}
                </span>
              </button>
            </div>
          </div>

          <DialogFooter className="pt-4 border-t border-border/60 sm:justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setEditingTodo(null)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              size="sm"
              onClick={handleSaveEdit}
              disabled={isSavingEdit || !editTitle.trim()}
              className="text-xs font-semibold bg-[#0d47a1] hover:bg-[#0a3880] text-white shadow-sm"
            >
              {isSavingEdit ? "Saving..." : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Clear Completed Modal */}
      <Dialog open={isConfirmClearOpen} onOpenChange={setIsConfirmClearOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader
            icon={<Trash2 className="size-4.5" />}
            iconClassName="bg-rose-500/10 text-rose-600 ring-rose-500/20 dark:bg-rose-500/20 dark:text-rose-400"
          >
            <DialogTitle>Clear Completed To-Dos?</DialogTitle>
            <DialogDescription>
              This will permanently delete all {stats.completed} completed to-dos
              from your personal list.
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="sm:justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setIsConfirmClearOpen(false)}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleClearCompleted}
              disabled={isClearingCompleted}
              className="text-xs font-semibold"
            >
              {isClearingCompleted ? "Clearing..." : "Delete Completed"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      {/* Confirm Delete Single To-Do Modal */}
      <Dialog
        open={Boolean(todoToDelete)}
        onOpenChange={(open) => !open && setTodoToDelete(null)}
      >
        <DialogContent className="max-w-sm">
          <DialogHeader
            icon={<Trash2 className="size-4.5" />}
            iconClassName="bg-rose-500/10 text-rose-600 ring-rose-500/20 dark:bg-rose-500/20 dark:text-rose-400"
          >
            <DialogTitle>Delete To-Do?</DialogTitle>
            <DialogDescription className="space-y-2 pt-1 text-xs sm:text-sm">
              <span className="block text-muted-foreground">
                Are you sure you want to permanently delete this to-do?
              </span>
              {todoToDelete && (
                <span className="block font-medium text-foreground p-2.5 rounded-lg bg-muted/60 border border-border/80 break-words line-clamp-2">
                  &ldquo;{todoToDelete.title}&rdquo;
                </span>
              )}
              <span className="block text-xs text-muted-foreground/80">
                This action cannot be undone.
              </span>
            </DialogDescription>
          </DialogHeader>

          <DialogFooter className="pt-3 border-t border-border/60 sm:justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setTodoToDelete(null)}
              disabled={isDeletingTodo}
              className="text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              size="sm"
              onClick={handleConfirmDelete}
              disabled={isDeletingTodo}
              className="text-xs font-semibold gap-1.5"
            >
              <Trash2 className="size-3.5" />
              {isDeletingTodo ? "Deleting..." : "Delete To-Do"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
