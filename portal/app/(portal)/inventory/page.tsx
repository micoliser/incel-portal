"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import Link from "next/link";
import Image from "next/image";
import {
  Archive,
  Loader2,
  Plus,
  Search,
  Filter,
  Monitor,
  CheckCircle,
  Clock,
  Wrench,
  FileSpreadsheet,
  AlertCircle,
  Pencil,
  Package,
  Layers,
  RotateCcw,
  Building2,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { PageErrorCard } from "@/components/page-error-card";
import {
  InventorySkeleton,
  InventoryTableRowSkeleton,
} from "@/components/skeletons/inventory-skeleton";
import { InfiniteScrollLoader } from "@/components/infinite-scroll-loader";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  AssigneeCombobox,
  AssigneeOption,
} from "@/components/inventory/assignee-combobox";
import { Textarea } from "@/components/ui/textarea";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { processAndValidateFile } from "@/lib/file-utils";
import { cn } from "@/lib/utils";

type InventoryCategory = {
  id: string;
  name: string;
  description: string;
};

type InventoryItem = {
  id: string;
  code: string;
  name: string;
  category: InventoryCategory;
  serial_number: string;
  quantity: number;
  status: string;
  status_reason?: string;
  photo_url?: string;
  purchase_date?: string | null;
  current_assignee: {
    id: string | number;
    first_name?: string;
    last_name?: string;
    email?: string;
    full_name?: string;
  } | null;
  current_assignee_department?: { id: string; name: string } | null;
  managing_department?: { id: string; name: string } | null;
};

type InventoryStats = {
  total: number;
  available: number;
  assigned: number;
  maintenance: number;
  retired: number;
  unaccounted: number;
};

const statusConfig: Record<
  string,
  { label: string; badge: string; dot: string }
> = {
  available: {
    label: "Available",
    badge: "bg-[#16a34a]/10 text-[#16a34a] dark:bg-[#16a34a]/20 dark:text-[#4ade80]",
    dot: "bg-[#16a34a] dark:bg-[#4ade80]",
  },
  assigned: {
    label: "Assigned",
    badge: "bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]",
    dot: "bg-[#0d47a1] dark:bg-[#38bdf8]",
  },
  maintenance: {
    label: "Maintenance",
    badge: "bg-amber-500/10 text-amber-700 dark:bg-amber-500/20 dark:text-amber-400",
    dot: "bg-amber-500 dark:bg-amber-400",
  },
  retired: {
    label: "Retired",
    badge: "bg-muted text-muted-foreground dark:bg-muted/40 dark:text-muted-foreground",
    dot: "bg-muted-foreground",
  },
  unaccounted: {
    label: "Unaccounted",
    badge: "bg-[#dc2626]/10 text-[#dc2626] dark:bg-[#dc2626]/20 dark:text-red-400",
    dot: "bg-[#dc2626] dark:bg-red-400",
  },
};

const statusColors: Record<string, string> = {
  available:
    "bg-[#16a34a]/10 text-[#16a34a] dark:bg-[#16a34a]/25 dark:text-[#4ade80]",
  assigned: "bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/25 dark:text-[#38bdf8]",
  maintenance:
    "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-400",
  retired: "bg-muted text-foreground dark:bg-muted/20 dark:text-muted-foreground",
  unaccounted: "bg-[#dc2626]/10 text-[#dc2626] dark:bg-[#dc2626]/25 dark:text-red-400",
};

export default function InventoryDashboard() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [stats, setStats] = useState<InventoryStats>({
    total: 0,
    available: 0,
    assigned: 0,
    maintenance: 0,
    retired: 0,
    unaccounted: 0,
  });
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const hasInitialLoadCompleted = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [hasWriteAccess, setHasWriteAccess] = useState(false);

  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const [refreshCounter, setRefreshCounter] = useState(0);
  const loadMoreRef = useRef<HTMLDivElement>(null);
  const isRequestInFlightRef = useRef(false);

  // Modals
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<InventoryItem | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  // Filters
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [managingDeptFilter, setManagingDeptFilter] = useState("all");

  // Forms
  const [categoryForm, setCategoryForm] = useState({
    name: "",
    description: "",
  });
  const [itemForm, setItemForm] = useState({
    name: "",
    category: "",
    serial_number: "",
    quantity: 1,
    status: "available",
            status_reason: "",
    photo_url: "",
    purchase_date: "",
    assigned_to: "" as string | null,
    assigned_to_type: null as "user" | "department" | null,
    managing_department: "" as string | null,
    condition_notes: "",
    new_category_name: "",
    new_category_description: "",
  });
  const [selectedAssignee, setSelectedAssignee] =
    useState<AssigneeOption | null>(null);
  const [itemPhoto, setItemPhoto] = useState<File | null>(null);

  const fetchStatsAndCategories = async () => {
    try {
      const [statsRes, catsRes, meRes, permsRes] = await Promise.all([
        apiClient.get("/inventory/items/stats/"),
        apiClient.get("/inventory/categories/"),
        apiClient.get("/me"),
        apiClient.get("/me/permissions"),
      ]);
      setStats(statsRes.data);
      setCategories(catsRes.data);

      const meData = meRes.data as { department_code?: string | null };
      const permsData = permsRes.data as {
        is_superuser?: boolean;
        role_code?: string | null;
      };

      const isAdmin =
        Boolean(permsData.is_superuser) ||
        String(permsData.role_code ?? "").toUpperCase() === "ADMIN";
      const isIT = String(meData.department_code ?? "").toUpperCase() === "IT";

      setHasWriteAccess(isAdmin || isIT);
    } catch (err) {
      console.error("Failed to load stats or categories", err);
    }
  };

  useEffect(() => {
    fetchStatsAndCategories();
  }, []);

  useEffect(() => {
    async function loadItems() {
      if (isRequestInFlightRef.current) return;

      try {
        isRequestInFlightRef.current = true;
        if (currentPage === 1) {
          setLoading(true);
        } else {
          setIsLoadingMore(true);
        }

        const params: Record<string, string | number> = { page: currentPage };
        if (searchQuery) params.q = searchQuery;
        if (statusFilter !== "all") params.status = statusFilter;
        if (categoryFilter !== "all") params.category = categoryFilter;
        if (managingDeptFilter !== "all") params.managing_department = managingDeptFilter;

        const response = await apiClient.get("/inventory/items/", { params });
        const payload = response.data;

        let results: InventoryItem[] = [];
        if (Array.isArray(payload)) {
          results = payload;
        } else if (payload && typeof payload === "object") {
          const typedPayload = payload as { results?: InventoryItem[] };
          results = Array.isArray(typedPayload.results)
            ? typedPayload.results
            : [];
        }

        setItems((current) =>
          currentPage === 1 ? results : [...current, ...results],
        );

        const hasNext =
          !Array.isArray(payload) && payload && typeof payload === "object"
            ? Boolean((payload as { next_page?: unknown }).next_page)
            : false;

        setHasNextPage(hasNext);
        setError(null);
      } catch (err) {
        setError(extractApiErrorMessage(err, "Failed to load inventory data."));
      } finally {
        isRequestInFlightRef.current = false;
        hasInitialLoadCompleted.current = true;
        setLoading(false);
        setIsLoadingMore(false);
      }
    }

    void loadItems();
  }, [searchQuery, statusFilter, categoryFilter, managingDeptFilter, currentPage, refreshCounter]);

  useEffect(() => {
    setItems([]);
    setCurrentPage(1);
    setHasNextPage(false);
  }, [searchQuery, statusFilter, categoryFilter, managingDeptFilter]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (!hasNextPage || loading || isLoadingMore) return;
    const element = loadMoreRef.current;
    if (!element) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (!entry?.isIntersecting || isRequestInFlightRef.current) return;
        setCurrentPage((p) => p + 1);
      },
      { threshold: 0.1 },
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasNextPage, loading, isLoadingMore]);

  const handleExport = async () => {
    try {
      setIsExporting(true);
      const params: Record<string, string> = {};
      if (statusFilter !== "all") params.status = statusFilter;
      if (categoryFilter !== "all") params.category = categoryFilter;
      if (managingDeptFilter !== "all") params.managing_department = managingDeptFilter;
      if (searchQuery) params.q = searchQuery;

      const response = await apiClient.get("/inventory/items/export/", {
        params,
        responseType: "blob",
      });
      const url = window.URL.createObjectURL(new Blob([response.data]));
      const link = document.createElement("a");
      link.href = url;
      link.setAttribute("download", "inventory.csv");
      document.body.appendChild(link);
      link.click();
      link.parentNode?.removeChild(link);
      window.URL.revokeObjectURL(url);
    } catch (err) {
      toast.error(
        extractApiErrorMessage(err, "Failed to export inventory items"),
      );
    } finally {
      setIsExporting(false);
    }
  };

  const handleCreateCategory = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!categoryForm.name) return toast.error("Name is required");

    try {
      setIsSubmitting(true);
      await apiClient.post("/inventory/categories/", categoryForm);
      toast.success("Category created");
      setIsCategoryModalOpen(false);
      setCategoryForm({ name: "", description: "" });
      fetchStatsAndCategories();
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "Failed to create category"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openEditModal = (item: InventoryItem) => {
    setEditingItem(item);
    setItemForm({
      name: item.name,
      category: item.category.id,
      serial_number: item.serial_number || "",
      quantity: item.quantity || 1,
      status: item.status,
      status_reason: item.status_reason || "",
      photo_url: item.photo_url || "",
      purchase_date: item.purchase_date || "",
      assigned_to: null,
      assigned_to_type: null,
      managing_department: item.managing_department
        ? String(item.managing_department.id)
        : null,
      condition_notes: "",
      new_category_name: "",
      new_category_description: "",
    });
    setSelectedAssignee(null); // Edit doesn't pre-fill assignment here, they are managed via Assign modal or we can leave it empty
    setIsEditModalOpen(true);
  };

  const handleEditItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingItem) return;
    if (!itemForm.name || !itemForm.category)
      return toast.error("Name and Category are required");

    const hasEditChanges =
      itemForm.name.trim() !== (editingItem.name || "") ||
      itemForm.category !== (editingItem.category.id || "") ||
      itemForm.serial_number.trim() !== (editingItem.serial_number || "") ||
      itemForm.quantity !== (editingItem.quantity || 1) ||
      itemForm.status !== (editingItem.status || "") ||
      (itemForm.purchase_date || "") !== (editingItem.purchase_date || "") ||
      (itemForm.managing_department || "") !==
        (editingItem.managing_department
          ? String(editingItem.managing_department.id)
          : "") ||
      Boolean(itemPhoto) ||
      Boolean(itemForm.assigned_to && itemForm.assigned_to_type);

    if (!hasEditChanges) {
      toast.info("No changes detected.");
      return;
    }

    try {
      setIsSubmitting(true);

      let finalPhotoUrl = itemForm.photo_url;
      if (itemPhoto) {
        let processedFile = itemPhoto;
        try {
          processedFile = await processAndValidateFile(itemPhoto);
        } catch (fileError) {
          toast.error(fileError instanceof Error ? fileError.message : "File processing failed");
          setIsSubmitting(false);
          return;
        }

        const { getInventoryPhotoUploadUrl } =
          await import("@/lib/api/inventory");
        const uploadData = await getInventoryPhotoUploadUrl({
          file_name: processedFile.name,
          content_type: processedFile.type,
        });

        await fetch(uploadData.upload_url, {
          method: "PUT",
          body: processedFile,
          headers: { "Content-Type": processedFile.type },
        });
        finalPhotoUrl = uploadData.public_url;
      }

      const payload: Record<string, string | number> = {
        name: itemForm.name,
        category: itemForm.category,
        serial_number: itemForm.serial_number,
        quantity: itemForm.quantity,
        status: itemForm.status,
        status_reason: itemForm.status_reason,
        ...(itemForm.purchase_date
          ? { purchase_date: itemForm.purchase_date }
          : {}),
        ...(finalPhotoUrl ? { photo_url: finalPhotoUrl } : {}),
        ...(itemForm.managing_department
          ? { managing_department: itemForm.managing_department }
          : {}),
      };

      await apiClient.patch(`/inventory/items/${editingItem.id}/`, payload);

      if (itemForm.assigned_to && itemForm.assigned_to_type) {
        const assignPayload =
          itemForm.assigned_to_type === "user"
            ? {
                assigned_to: itemForm.assigned_to,
                condition_notes: itemForm.condition_notes,
              }
            : {
                assigned_to_department: itemForm.assigned_to,
                condition_notes: itemForm.condition_notes,
              };

        await apiClient.post(
          `/inventory/items/${editingItem.id}/assign/`,
          assignPayload,
        );
      }

      toast.success("Item updated");
      setIsEditModalOpen(false);
      setItemPhoto(null);
      setCurrentPage(1);
      setItems([]);
      fetchStatsAndCategories();
      setRefreshCounter((prev) => prev + 1);
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "Failed to update item"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemForm.name || !itemForm.category)
      return toast.error("Name and Category are required");
    if (itemForm.category === "create_new" && !itemForm.new_category_name) {
      return toast.error("New category name is required");
    }

    try {
      setIsSubmitting(true);

      let finalCategoryId = itemForm.category;
      if (itemForm.category === "create_new") {
        const catRes = await apiClient.post("/inventory/categories/", {
          name: itemForm.new_category_name,
          description: itemForm.new_category_description,
        });
        finalCategoryId = catRes.data.id;
      }

      let finalPhotoUrl = "";
      if (itemPhoto) {
        let processedFile = itemPhoto;
        try {
          processedFile = await processAndValidateFile(itemPhoto);
        } catch (fileError) {
          toast.error(fileError instanceof Error ? fileError.message : "File processing failed");
          setIsSubmitting(false);
          return;
        }

        // Upload photo
        const { getInventoryPhotoUploadUrl } =
          await import("@/lib/api/inventory");
        const uploadData = await getInventoryPhotoUploadUrl({
          file_name: processedFile.name,
          content_type: processedFile.type,
        });

        await fetch(uploadData.upload_url, {
          method: "PUT",
          body: processedFile,
          headers: {
            "Content-Type": processedFile.type,
          },
        });
        finalPhotoUrl = uploadData.public_url;
      }

      const payload: Record<string, string | number> = {
        name: itemForm.name,
        category: finalCategoryId,
        serial_number: itemForm.serial_number,
        quantity: itemForm.quantity,
        status: itemForm.status,
        status_reason: itemForm.status_reason,
        ...(itemForm.purchase_date
          ? { purchase_date: itemForm.purchase_date }
          : {}),
        ...(finalPhotoUrl ? { photo_url: finalPhotoUrl } : {}),
        ...(itemForm.managing_department
          ? { managing_department: itemForm.managing_department }
          : {}),
      };

      const response = await apiClient.post("/inventory/items/", payload);

      if (itemForm.assigned_to && itemForm.assigned_to_type) {
        const assignPayload =
          itemForm.assigned_to_type === "user"
            ? {
                assigned_to: itemForm.assigned_to,
                condition_notes: itemForm.condition_notes,
              }
            : {
                assigned_to_department: itemForm.assigned_to,
                condition_notes: itemForm.condition_notes,
              };

        await apiClient.post(
          `/inventory/items/${response.data.id}/assign/`,
          assignPayload,
        );
      }

      toast.success("Item created");
      setIsItemModalOpen(false);
      setItemForm({
        name: "",
        category: "",
        serial_number: "",
        quantity: 1,
        status: "available",
            status_reason: "",
        photo_url: "",
        purchase_date: "",
        assigned_to: null,
        assigned_to_type: null,
        managing_department: null,
        condition_notes: "",
        new_category_name: "",
        new_category_description: "",
      });
      setItemPhoto(null);
      fetchStatsAndCategories();
      // Reload items
      setCurrentPage(1);
      setItems([]);
      setRefreshCounter((prev) => prev + 1);
    } catch (error) {
      toast.error(extractApiErrorMessage(error, "Failed to create item"));
    } finally {
      setIsSubmitting(false);
    }
  };

  const activeFilterCount = useMemo(() => {
    let count = 0;
    if (categoryFilter !== "all") count++;
    if (statusFilter !== "all") count++;
    if (managingDeptFilter !== "all") count++;
    if (searchInput.trim()) count++;
    return count;
  }, [categoryFilter, statusFilter, managingDeptFilter, searchInput]);

  const handleResetFilters = () => {
    setSearchInput("");
    setSearchQuery("");
    setStatusFilter("all");
    setCategoryFilter("all");
    setManagingDeptFilter("all");
  };

  if (loading && !hasInitialLoadCompleted.current) {
    return <InventorySkeleton />;
  }

  return (
    <div className="space-y-6 max-w-full">
      {/* 1. Executive Header & Actions */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            Assets & Equipment
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Track enterprise hardware, assignments, lifecycle status, and service history.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <Button
            variant="outline"
            size="sm"
            onClick={handleExport}
            disabled={isExporting}
            className="rounded-lg h-9.5 text-xs sm:text-sm font-medium border-border"
          >
            {isExporting ? (
              <Loader2 className="mr-1.5 size-4 animate-spin" />
            ) : (
              <FileSpreadsheet className="mr-1.5 size-4" />
            )}
            Export CSV
          </Button>
          <Button
            variant="outline"
            size="sm"
            asChild
            className="rounded-lg h-9.5 text-xs sm:text-sm font-medium border-border"
          >
            <Link href="/inventory/maintenance">
              <Wrench className="mr-1.5 size-4" />
              Maintenance Logs
            </Link>
          </Button>
          {hasWriteAccess && (
            <>
              <Button
                variant="outline"
                size="sm"
                onClick={() => setIsCategoryModalOpen(true)}
                className="rounded-lg h-9.5 text-xs sm:text-sm font-medium border-border"
              >
                <Plus className="mr-1.5 size-4" />
                Add Category
              </Button>
              <Button
                size="sm"
                onClick={() => setIsItemModalOpen(true)}
                className="bg-[#0d47a1] hover:bg-[#0a3880] text-white rounded-lg px-4 h-9.5 text-xs sm:text-sm font-semibold shadow-sm"
              >
                <Plus className="mr-1.5 size-4" />
                Add Asset
              </Button>
            </>
          )}
        </div>
      </div>

      {/* 2. Key Operational Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 sm:gap-4">
        {/* Total Assets */}
        <Card className="rounded-xl border border-border bg-card p-4 transition-all shadow-xs hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Total Assets
            </span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-primary/10 text-primary dark:bg-primary/20">
              <Package className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {stats.total}
            </span>
            <span className="text-xs text-muted-foreground">all items</span>
          </div>
        </Card>

        {/* Available */}
        <Card className="rounded-xl border border-border bg-card p-4 transition-all shadow-xs hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Available
            </span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-[#16a34a]/10 text-[#16a34a] dark:bg-[#16a34a]/20 dark:text-[#4ade80]">
              <CheckCircle className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {stats.available}
            </span>
            <span className="text-xs text-[#16a34a] font-medium">ready to assign</span>
          </div>
        </Card>

        {/* Assigned */}
        <Card className="rounded-xl border border-border bg-card p-4 transition-all shadow-xs hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Assigned
            </span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
              <Monitor className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {stats.assigned}
            </span>
            <span className="text-xs text-[#0d47a1] dark:text-[#38bdf8] font-medium">in active use</span>
          </div>
        </Card>

        {/* Maintenance */}
        <Card className="rounded-xl border border-border bg-card p-4 transition-all shadow-xs hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Maintenance
            </span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
              <Wrench className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {stats.maintenance}
            </span>
            <span className="text-xs text-amber-600 dark:text-amber-400 font-medium">under repair</span>
          </div>
        </Card>

        {/* Retired */}
        <Card className="rounded-xl border border-border bg-card p-4 transition-all shadow-xs hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Retired
            </span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-muted text-muted-foreground dark:bg-muted/30">
              <Archive className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {stats.retired}
            </span>
            <span className="text-xs text-muted-foreground">decommissioned</span>
          </div>
        </Card>

        {/* Unaccounted */}
        <Card className="rounded-xl border border-border bg-card p-4 transition-all shadow-xs hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Unaccounted
            </span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-[#dc2626]/10 text-[#dc2626] dark:bg-[#dc2626]/20 dark:text-red-400">
              <AlertCircle className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {stats.unaccounted}
            </span>
            <span className="text-xs text-[#dc2626] dark:text-red-400 font-medium">needs audit</span>
          </div>
        </Card>
      </div>

      {/* 3. Integrated Filter Toolbar */}
      <Card className="rounded-xl border border-border bg-card p-3 sm:p-4 shadow-xs space-y-3">
        <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              id="inventory-search"
              value={searchInput}
              onChange={(event) => setSearchInput(event.target.value)}
              placeholder="Search by asset code, name, serial number, or assignee..."
              className="h-10 pl-9 pr-9 rounded-lg bg-background/50 border-input text-xs sm:text-sm"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              >
                <X className="size-3.5" />
              </button>
            )}
          </div>

          {/* Filter Dropdowns */}
          <div className="flex flex-wrap sm:flex-nowrap items-center gap-2.5">
            {/* Category Select */}
            <div className="w-full sm:w-44 shrink-0">
              <Select value={categoryFilter} onValueChange={setCategoryFilter}>
                <SelectTrigger className="h-10 rounded-lg text-xs sm:text-sm border-input bg-background/50">
                  <SelectValue placeholder="All Categories" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Categories</SelectItem>
                  {categories.map((category) => (
                    <SelectItem key={category.id} value={category.id}>
                      {category.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {/* Status Select */}
            <div className="w-full sm:w-40 shrink-0">
              <Select value={statusFilter} onValueChange={setStatusFilter}>
                <SelectTrigger className="h-10 rounded-lg text-xs sm:text-sm border-input bg-background/50">
                  <Filter className="mr-1.5 size-3.5 text-muted-foreground" />
                  <SelectValue placeholder="Status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Statuses</SelectItem>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="assigned">Assigned</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="retired">Retired</SelectItem>
                  <SelectItem value="unaccounted">Unaccounted</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Managing Dept Select */}
            <div className="w-full sm:w-36 shrink-0">
              <Select value={managingDeptFilter} onValueChange={setManagingDeptFilter}>
                <SelectTrigger className="h-10 rounded-lg text-xs sm:text-sm border-input bg-background/50">
                  <SelectValue placeholder="Managing Dept" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All Depts</SelectItem>
                  <SelectItem value="IT">IT</SelectItem>
                  <SelectItem value="Admin">Admin</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {/* Reset button if active */}
            {activeFilterCount > 0 && (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={handleResetFilters}
                className="h-10 px-3 text-xs text-muted-foreground hover:text-foreground shrink-0"
              >
                <RotateCcw className="mr-1.5 size-3.5" />
                Reset
              </Button>
            )}
          </div>
        </div>

        {/* Category quick filter pills */}
        {categories.length > 0 && (
          <div className="flex items-center gap-1.5 overflow-x-auto pt-2 border-t border-border/50 text-xs">
            <span className="text-muted-foreground font-medium shrink-0 mr-1 flex items-center gap-1">
              <Layers className="size-3.5" /> Quick Filter:
            </span>
            <button
              type="button"
              onClick={() => setCategoryFilter("all")}
              className={cn(
                "px-2.5 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
                categoryFilter === "all"
                  ? "bg-[#0d47a1] text-white"
                  : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
              )}
            >
              All
            </button>
            {categories.map((cat) => (
              <button
                key={cat.id}
                type="button"
                onClick={() => setCategoryFilter(categoryFilter === cat.id ? "all" : cat.id)}
                className={cn(
                  "px-2.5 py-1 rounded-md text-xs font-medium transition-colors shrink-0",
                  categoryFilter === cat.id
                    ? "bg-[#0d47a1] text-white"
                    : "bg-muted/50 text-muted-foreground hover:bg-muted hover:text-foreground"
                )}
              >
                {cat.name}
              </button>
            ))}
            <div className="ml-auto text-xs text-muted-foreground shrink-0 pl-2">
              Showing {items.length} {items.length === 1 ? "asset" : "assets"}
              {activeFilterCount > 0 && ` (${activeFilterCount} active)`}
            </div>
          </div>
        )}
      </Card>

      {/* 4. Inventory Data Table */}
      {error ? (
        <PageErrorCard
          title="Failed to load inventory"
          message={error}
          onRetry={() => setCurrentPage(1)}
        />
      ) : (
        <>
          <Card className="overflow-hidden rounded-xl border border-border bg-card shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-left text-sm">
                <thead className="bg-muted/40 text-muted-foreground text-xs uppercase tracking-wider font-semibold border-b border-border">
                  <tr>
                    <th className="px-4 py-3">Code</th>
                    <th className="px-4 py-3">Item Details</th>
                    <th className="px-4 py-3">Category</th>
                    <th className="px-4 py-3">Managing Dept</th>
                    <th className="px-4 py-3">Serial No</th>
                    <th className="px-4 py-3 text-center">Qty</th>
                    <th className="px-4 py-3">Purchase Date</th>
                    <th className="px-4 py-3">Status</th>
                    <th className="px-4 py-3">Assignee</th>
                    {hasWriteAccess && (
                      <th className="px-4 py-3 text-right">Actions</th>
                    )}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {loading && items.length === 0 ? (
                    Array.from({ length: 6 }).map((_, i) => (
                      <InventoryTableRowSkeleton key={i} columns={hasWriteAccess ? 10 : 9} />
                    ))
                  ) : items.length === 0 ? (
                    <tr>
                      <td
                        colSpan={hasWriteAccess ? 10 : 9}
                        className="px-4 py-12 text-center text-muted-foreground"
                      >
                        <Package className="size-8 mx-auto mb-2 opacity-40" />
                        <p className="font-medium text-foreground">No assets found</p>
                        <p className="text-xs mt-1">Try adjusting your filters or search terms.</p>
                      </td>
                    </tr>
                  ) : (
                    <>
                      {items.map((item) => {
                        const statusCfg = statusConfig[item.status.toLowerCase()] || {
                          label: item.status.toUpperCase(),
                          badge: "bg-muted text-muted-foreground",
                          dot: "bg-muted-foreground",
                        };

                        return (
                          <tr
                            key={item.id}
                            className="hover:bg-muted/30 transition-colors group"
                          >
                            {/* Code */}
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <span className="font-mono text-xs font-semibold px-2 py-0.5 rounded bg-muted/60 text-foreground border border-border/40">
                                {item.code}
                              </span>
                            </td>

                            {/* Item Details */}
                            <td className="px-4 py-3.5">
                              <div className="flex items-center gap-3">
                                {item.photo_url ? (
                                  <Dialog>
                                    <DialogTrigger asChild>
                                      <div className="relative size-10 shrink-0 cursor-pointer overflow-hidden rounded-lg border border-border bg-muted/30 hover:opacity-90 transition-opacity">
                                        <Image
                                          src={item.photo_url}
                                          alt={item.name}
                                          className="object-cover"
                                          fill
                                          unoptimized
                                        />
                                      </div>
                                    </DialogTrigger>
                                    <DialogContent className="sm:max-w-2xl p-0 border-none bg-transparent shadow-none">
                                      <DialogTitle className="sr-only">
                                        Photo of {item.name}
                                      </DialogTitle>
                                      <div className="relative w-full h-[80vh]">
                                        <Image
                                          src={item.photo_url}
                                          alt={item.name}
                                          className="object-contain rounded-lg"
                                          fill
                                          unoptimized
                                        />
                                      </div>
                                    </DialogContent>
                                  </Dialog>
                                ) : (
                                  <div className="flex size-10 shrink-0 items-center justify-center rounded-lg border border-border bg-muted/30 text-muted-foreground">
                                    <Package className="size-5 opacity-60" />
                                  </div>
                                )}
                                <div className="min-w-0 max-w-[220px]">
                                  <Link
                                    href={`/inventory/${item.id}`}
                                    className="font-medium text-foreground hover:text-primary transition-colors hover:underline block truncate text-sm"
                                    title={item.name}
                                  >
                                    {item.name}
                                  </Link>
                                  <span className="text-xs text-muted-foreground block truncate">
                                    {item.category?.name || "Uncategorized"}
                                  </span>
                                </div>
                              </div>
                            </td>

                            {/* Category */}
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <span className="text-xs font-medium px-2 py-0.5 rounded-md bg-muted/50 text-foreground/80">
                                {item.category?.name || "—"}
                              </span>
                            </td>

                            {/* Managing Dept */}
                            <td className="px-4 py-3.5 whitespace-nowrap text-xs text-muted-foreground font-medium">
                              {item.managing_department?.name || "—"}
                            </td>

                            {/* Serial Number */}
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <span className="font-mono text-xs text-muted-foreground">
                                {item.serial_number || "—"}
                              </span>
                            </td>

                            {/* Quantity */}
                            <td className="px-4 py-3.5 whitespace-nowrap text-center text-xs font-semibold text-foreground">
                              {item.quantity}
                            </td>

                            {/* Purchase Date */}
                            <td className="px-4 py-3.5 whitespace-nowrap text-xs text-muted-foreground">
                              {item.purchase_date || "—"}
                            </td>

                            {/* Status */}
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              <span
                                className={cn(
                                  "inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium tracking-tight whitespace-nowrap",
                                  statusCfg.badge
                                )}
                              >
                                <span className={cn("size-1.5 rounded-full shrink-0", statusCfg.dot)} />
                                {statusCfg.label}
                              </span>
                            </td>

                            {/* Assignee */}
                            <td className="px-4 py-3.5 whitespace-nowrap">
                              {item.current_assignee ? (
                                <div className="flex items-center gap-2">
                                  <div className="flex size-6 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary text-[10px] font-bold">
                                    {(
                                      (item.current_assignee.first_name?.[0] || "") +
                                      (item.current_assignee.last_name?.[0] || "")
                                    ).toUpperCase() || "U"}
                                  </div>
                                  <span className="text-xs font-medium text-foreground truncate max-w-[180px]">
                                    {item.current_assignee.first_name} {item.current_assignee.last_name}
                                  </span>
                                </div>
                              ) : item.current_assignee_department ? (
                                <div className="flex items-center gap-1.5 text-muted-foreground text-xs">
                                  <Building2 className="size-3.5 shrink-0" />
                                  <span className="truncate max-w-[180px] font-medium text-foreground/80">
                                    {item.current_assignee_department.name}
                                  </span>
                                </div>
                              ) : (
                                <span className="text-xs text-muted-foreground/60">—</span>
                              )}
                            </td>

                            {/* Actions */}
                            {hasWriteAccess && (
                              <td className="px-4 py-3.5 whitespace-nowrap text-right">
                                <Button
                                  variant="ghost"
                                  size="icon"
                                  className="size-8 text-muted-foreground hover:text-foreground opacity-70 group-hover:opacity-100 transition-opacity"
                                  onClick={() => openEditModal(item)}
                                  title="Edit item"
                                >
                                  <Pencil className="size-3.5" />
                                </Button>
                              </td>
                            )}
                          </tr>
                        );
                      })}
                      {isLoadingMore && (
                        <>
                          <InventoryTableRowSkeleton columns={hasWriteAccess ? 10 : 9} />
                          <InventoryTableRowSkeleton columns={hasWriteAccess ? 10 : 9} />
                        </>
                      )}
                    </>
                  )}
                </tbody>
              </table>
            </div>
            {hasNextPage && <div ref={loadMoreRef} className="h-4" />}
          </Card>
          <InfiniteScrollLoader isLoading={isLoadingMore} entityName="inventory items" />
        </>
      )}

      {/* Category Modal */}
      <Dialog open={isCategoryModalOpen} onOpenChange={(open) => {
        setIsCategoryModalOpen(open);
        if (!open) {
          setCategoryForm({ name: "", description: "" });
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Archive className="size-4.5" />}>
            <DialogTitle>Create Category</DialogTitle>
            <DialogDescription>
              Add a new category for your inventory items (e.g., Laptops,
              Monitors).
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateCategory} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="cat_name">Name</Label>
              <Input
                id="cat_name"
                value={categoryForm.name}
                onChange={(e) =>
                  setCategoryForm({ ...categoryForm, name: e.target.value })
                }
                placeholder="e.g. Laptops"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat_desc">Description</Label>
              <Input
                id="cat_desc"
                value={categoryForm.description}
                onChange={(e) =>
                  setCategoryForm({
                    ...categoryForm,
                    description: e.target.value,
                  })
                }
                placeholder="Optional description"
              />
            </div>
            <DialogFooter className="pt-4 border-t border-border/60 sm:justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCategoryModalOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-[#0d47a1] hover:bg-[#0a3880] text-white shadow-sm"
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Create Category
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Item Modal */}
      <Dialog open={isItemModalOpen} onOpenChange={(open) => {
        setIsItemModalOpen(open);
        if (!open) {
          setItemForm({
            name: "",
            category: "",
            serial_number: "",
            quantity: 1,
            status: "available",
            status_reason: "",
            photo_url: "",
            purchase_date: "",
            assigned_to: null,
            assigned_to_type: null,
            managing_department: null,
            condition_notes: "",
            new_category_name: "",
            new_category_description: "",
          });
          setItemPhoto(null);
        }
      }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Monitor className="size-4.5" />}>
            <DialogTitle>Create Item</DialogTitle>
            <DialogDescription>
              Add a new hardware asset or equipment to the inventory.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateItem} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="item_name">Item Name</Label>
              <Input
                id="item_name"
                value={itemForm.name}
                onChange={(e) =>
                  setItemForm({ ...itemForm, name: e.target.value })
                }
                placeholder="e.g. MacBook Pro M3"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item_cat">Category</Label>
              <Select
                value={itemForm.category}
                onValueChange={(value) =>
                  setItemForm({ ...itemForm, category: value })
                }
              >
                <SelectTrigger id="item_cat" className="w-full">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem
                    value="create_new"
                    className="font-bold text-primary"
                  >
                    + Create New Category
                  </SelectItem>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>
                      {c.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {itemForm.category === "create_new" && (
              <div className="space-y-4 rounded-md border p-4 bg-muted/50">
                <div className="space-y-2">
                  <Label htmlFor="new_cat_name">New Category Name</Label>
                  <Input
                    id="new_cat_name"
                    value={itemForm.new_category_name}
                    onChange={(e) =>
                      setItemForm({
                        ...itemForm,
                        new_category_name: e.target.value,
                      })
                    }
                    placeholder="e.g. Laptops"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new_cat_desc">
                    Category Description (Optional)
                  </Label>
                  <Textarea
                    id="new_cat_desc"
                    value={itemForm.new_category_description}
                    onChange={(e) =>
                      setItemForm({
                        ...itemForm,
                        new_category_description: e.target.value,
                      })
                    }
                    placeholder="Brief description..."
                  />
                </div>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="item_managing_dept">
                Managing Department (Optional)
              </Label>
              <AssigneeCombobox
                value={itemForm.managing_department}
                types={["department"]}
                allowedDepartmentNames={["IT", "Admin", "Human Resources"]}
                onChange={(val, type) => {
                  if (type === "department" || !val) {
                    setItemForm({ ...itemForm, managing_department: val });
                  }
                }}
                placeholder="Search departments..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="item_sn">Serial Number</Label>
                <Input
                  id="item_sn"
                  value={itemForm.serial_number}
                  onChange={(e) =>
                    setItemForm({ ...itemForm, serial_number: e.target.value })
                  }
                  placeholder="Optional serial number"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="item_quantity">Quantity</Label>
                <Input
                  id="item_quantity"
                  type="number"
                  min="1"
                  value={itemForm.quantity}
                  onChange={(e) =>
                    setItemForm({ ...itemForm, quantity: parseInt(e.target.value) || 1 })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="item_purchase_date">
                Purchase Date (Optional)
              </Label>
              <Input
                id="item_purchase_date"
                type="date"
                value={itemForm.purchase_date}
                onChange={(e) =>
                  setItemForm({ ...itemForm, purchase_date: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item_photo">Photo (Optional)</Label>
              <Input
                id="item_photo"
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.size > 5 * 1024 * 1024) {
                      toast.error("File exceeds the 5MB size limit.");
                      e.target.value = "";
                      setItemPhoto(null);
                      return;
                    }
                    setItemPhoto(file);
                  } else {
                    setItemPhoto(null);
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item_status">Status</Label>
              <Select
                value={itemForm.status}
                onValueChange={(value) =>
                  setItemForm({ ...itemForm, status: value })
                }
              >
                <SelectTrigger id="item_status" className="w-full">
                  <SelectValue placeholder="Select a status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="retired">Retired</SelectItem>
                  <SelectItem value="unaccounted">Unaccounted</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(itemForm.status === "retired" || itemForm.status === "unaccounted") && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="item_status_reason">
                  Reason {itemForm.status === "unaccounted" ? <span className="text-[#dc2626]">*</span> : "(Optional)"}
                </Label>
                <Textarea
                  id="item_status_reason"
                  value={itemForm.status_reason}
                  onChange={(e) => setItemForm({ ...itemForm, status_reason: e.target.value })}
                  placeholder="Enter reason for this status..."
                  required={itemForm.status === "unaccounted"}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="item_assign">Assign to (Optional)</Label>
              <AssigneeCombobox
                value={itemForm.assigned_to}
                defaultAssignee={selectedAssignee}
                onChange={(val, type, assignee) => {
                  setItemForm({
                    ...itemForm,
                    assigned_to: val,
                    assigned_to_type: type,
                  });
                  setSelectedAssignee(assignee || null);
                }}
              />
            </div>
            {itemForm.assigned_to && (
              <div className="space-y-2">
                <Label htmlFor="item_notes">Condition Notes (Optional)</Label>
                <Textarea
                  id="item_notes"
                  value={itemForm.condition_notes}
                  onChange={(e) =>
                    setItemForm({
                      ...itemForm,
                      condition_notes: e.target.value,
                    })
                  }
                  placeholder="Notes on the asset's condition..."
                />
              </div>
            )}
            <DialogFooter className="pt-4 border-t border-border/60 sm:justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsItemModalOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-[#0d47a1] hover:bg-[#0a3880] text-white shadow-sm"
              >
                {isSubmitting ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : null}
                Create Item
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Edit Item Modal */}
      <Dialog open={isEditModalOpen} onOpenChange={(open) => {
        setIsEditModalOpen(open);
        if (!open) {
          setItemForm({
            name: "",
            category: "",
            serial_number: "",
            quantity: 1,
            status: "available",
            status_reason: "",
            photo_url: "",
            purchase_date: "",
            assigned_to: null,
            assigned_to_type: null,
            managing_department: null,
            condition_notes: "",
            new_category_name: "",
            new_category_description: "",
          });
          setItemPhoto(null);
          setEditingItem(null);
        }
      }}>
        <DialogContent className="max-w-2xl max-h-[90vh] overflow-y-auto">
          <DialogHeader>
            <DialogTitle>Edit Inventory Item</DialogTitle>
            <DialogDescription>
              Update the details of this item.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEditItem} className="space-y-4 py-4">
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_item_name">Name</Label>
                <Input
                  id="edit_item_name"
                  value={itemForm.name}
                  onChange={(e) =>
                    setItemForm({ ...itemForm, name: e.target.value })
                  }
                  placeholder="e.g. MacBook Pro M2"
                  required
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_item_category">Category</Label>
                <Select
                  value={itemForm.category}
                  onValueChange={(value) =>
                    setItemForm({ ...itemForm, category: value })
                  }
                  required
                >
                  <SelectTrigger id="edit_item_category">
                    <SelectValue placeholder="Select a category" />
                  </SelectTrigger>
                  <SelectContent>
                    {categories.map((cat) => (
                      <SelectItem key={cat.id} value={cat.id}>
                        {cat.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_item_managing_dept">
                Managing Department (Optional)
              </Label>
              <AssigneeCombobox
                value={itemForm.managing_department}
                types={["department"]}
                allowedDepartmentNames={["IT", "Admin", "Human Resources"]}
                onChange={(val, type) => {
                  if (type === "department" || !val) {
                    setItemForm({ ...itemForm, managing_department: val });
                  }
                }}
                placeholder="Search departments..."
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="edit_item_sn">Serial Number</Label>
                <Input
                  id="edit_item_sn"
                  value={itemForm.serial_number}
                  onChange={(e) =>
                    setItemForm({ ...itemForm, serial_number: e.target.value })
                  }
                  placeholder="Optional serial number"
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="edit_item_quantity">Quantity</Label>
                <Input
                  id="edit_item_quantity"
                  type="number"
                  min="1"
                  value={itemForm.quantity}
                  onChange={(e) =>
                    setItemForm({ ...itemForm, quantity: parseInt(e.target.value) || 1 })
                  }
                />
              </div>
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_item_purchase_date">
                Purchase Date (Optional)
              </Label>
              <Input
                id="edit_item_purchase_date"
                type="date"
                value={itemForm.purchase_date}
                onChange={(e) =>
                  setItemForm({ ...itemForm, purchase_date: e.target.value })
                }
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_item_photo">Photo (Optional)</Label>
              <Input
                id="edit_item_photo"
                type="file"
                accept="image/*"
                onChange={(e) => {
                  const file = e.target.files?.[0];
                  if (file) {
                    if (file.size > 5 * 1024 * 1024) {
                      toast.error("File exceeds the 5MB size limit.");
                      e.target.value = "";
                      setItemPhoto(null);
                      return;
                    }
                    setItemPhoto(file);
                  } else {
                    setItemPhoto(null);
                  }
                }}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="edit_item_status">Status</Label>
              <Select
                value={itemForm.status}
                onValueChange={(value) =>
                  setItemForm({ ...itemForm, status: value })
                }
              >
                <SelectTrigger id="edit_item_status" className="w-full">
                  <SelectValue placeholder="Select a status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="retired">Retired</SelectItem>
                  <SelectItem value="unaccounted">Unaccounted</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {(itemForm.status === "retired" || itemForm.status === "unaccounted") && (
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="edit_item_status_reason">
                  Reason {itemForm.status === "unaccounted" ? <span className="text-[#dc2626]">*</span> : "(Optional)"}
                </Label>
                <Textarea
                  id="edit_item_status_reason"
                  value={itemForm.status_reason}
                  onChange={(e) => setItemForm({ ...itemForm, status_reason: e.target.value })}
                  placeholder="Enter reason for this status..."
                  required={itemForm.status === "unaccounted"}
                />
              </div>
            )}
            <div className="space-y-2">
              <Label htmlFor="edit_item_assign">Assign to (Optional)</Label>
              <AssigneeCombobox
                value={itemForm.assigned_to}
                defaultAssignee={selectedAssignee}
                onChange={(val, type, assignee) => {
                  setItemForm({
                    ...itemForm,
                    assigned_to: val,
                    assigned_to_type: type,
                  });
                  setSelectedAssignee(assignee || null);
                }}
              />
            </div>
            {itemForm.assigned_to && (
              <div className="space-y-2">
                <Label htmlFor="edit_item_notes">
                  Condition Notes (Optional)
                </Label>
                <Textarea
                  id="edit_item_notes"
                  value={itemForm.condition_notes}
                  onChange={(e) =>
                    setItemForm({
                      ...itemForm,
                      condition_notes: e.target.value,
                    })
                  }
                  placeholder="Note the current condition of the item"
                />
              </div>
            )}
            <DialogFooter className="pt-4 border-t border-border/60 sm:justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditModalOpen(false)}
                disabled={isSubmitting}
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-[#0d47a1] hover:bg-[#0a3880] text-white shadow-sm"
              >
                {isSubmitting && (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                )}
                Save Changes
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
