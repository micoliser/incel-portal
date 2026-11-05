"use client";

import { useEffect, useMemo, useState } from "react";
import { format } from "date-fns";
import {
  Calendar,
  Check,
  CheckCircle2,
  Copy,
  Headphones,
  Laptop,
  Monitor,
  Package,
  RefreshCw,
  Search,
  ShieldCheck,
  Smartphone,
  Tag,
  User,
  X,
} from "lucide-react";
import { toast } from "sonner";

import { apiClient } from "@/lib/api-client";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { PageErrorCard } from "@/components/page-error-card";
import { MyAssetsSkeleton } from "@/components/skeletons/my-assets-skeleton";
import { cn } from "@/lib/utils";

type InventoryCategory = {
  id: string;
  name: string;
  description: string;
};

type InventoryAssignment = {
  id: string;
  assigned_to: {
    id: string | number;
    first_name?: string;
    last_name?: string;
    email?: string;
    full_name?: string;
  } | null;
  assigned_by: {
    id: string | number;
    first_name?: string;
    last_name?: string;
    email?: string;
    full_name?: string;
  } | null;
  assigned_at: string;
  returned_at: string | null;
  condition_notes: string;
};

type InventoryItem = {
  id: string;
  code: string;
  name: string;
  category: InventoryCategory;
  serial_number: string;
  purchase_date: string | null;
  status: string;
  status_reason?: string;
  notes: string;
  assignments: InventoryAssignment[];
};

function getCategoryIcon(name: string, categoryName: string) {
  const combined = `${name} ${categoryName}`.toLowerCase();
  if (
    combined.includes("laptop") ||
    combined.includes("macbook") ||
    combined.includes("computer") ||
    combined.includes("thinkpad") ||
    combined.includes("pc")
  ) {
    return Laptop;
  }
  if (
    combined.includes("monitor") ||
    combined.includes("display") ||
    combined.includes("screen")
  ) {
    return Monitor;
  }
  if (
    combined.includes("phone") ||
    combined.includes("mobile") ||
    combined.includes("iphone") ||
    combined.includes("android") ||
    combined.includes("tablet") ||
    combined.includes("ipad")
  ) {
    return Smartphone;
  }
  if (
    combined.includes("headset") ||
    combined.includes("headphone") ||
    combined.includes("audio") ||
    combined.includes("earbuds")
  ) {
    return Headphones;
  }
  return Package;
}

export default function MyAssetsPage() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState("");
  const [selectedCategory, setSelectedCategory] = useState<string>("all");
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const fetchMyAssets = async () => {
    try {
      setLoading(true);
      const response = await apiClient.get("/me/inventory/");
      setItems(response.data as InventoryItem[]);
      setError(null);
    } catch (err) {
      setError(extractApiErrorMessage(err, "Failed to load your assets."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchMyAssets();
  }, []);

  const categories = useMemo(() => {
    const map = new Map<string, string>();
    items.forEach((item) => {
      if (item.category?.name) {
        map.set(item.category.id || item.category.name, item.category.name);
      }
    });
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }));
  }, [items]);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const q = searchQuery.trim().toLowerCase();
      const matchesSearch =
        !q ||
        item.name.toLowerCase().includes(q) ||
        item.code?.toLowerCase().includes(q) ||
        item.serial_number?.toLowerCase().includes(q) ||
        item.category?.name?.toLowerCase().includes(q) ||
        item.notes?.toLowerCase().includes(q);

      const matchesCategory =
        selectedCategory === "all" ||
        item.category?.id === selectedCategory ||
        item.category?.name === selectedCategory;

      return matchesSearch && matchesCategory;
    });
  }, [items, searchQuery, selectedCategory]);

  const activeAssignmentsCount = useMemo(() => {
    return items.filter((item) =>
      item.assignments?.some((a) => !a.returned_at),
    ).length;
  }, [items]);

  const copySerialNumber = async (id: string, serial: string) => {
    if (!serial) return;
    try {
      await navigator.clipboard.writeText(serial);
      setCopiedId(id);
      toast.success("Serial number copied to clipboard.");
      setTimeout(() => setCopiedId(null), 2000);
    } catch {
      toast.error("Failed to copy serial number.");
    }
  };

  if (loading) {
    return <MyAssetsSkeleton />;
  }

  if (error) {
    return (
      <PageErrorCard
        title="Failed to load assets"
        message={error}
        onRetry={() => void fetchMyAssets()}
      />
    );
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-12">
      {/* Page Header */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card p-6 shadow-xs sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="flex size-10 items-center justify-center rounded-xl bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                <Laptop className="size-5" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                My Assets
              </h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Hardware, devices, and enterprise equipment currently assigned to your profile.
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => void fetchMyAssets()}
              className="h-9 gap-1.5 rounded-lg border-border/80 text-xs font-medium text-foreground hover:bg-muted"
            >
              <RefreshCw className="size-3.5" />
              Refresh
            </Button>
          </div>
        </div>

        {/* Overview Stats Strip */}
        <div className="mt-6 grid grid-cols-1 gap-3 sm:grid-cols-3 border-t border-border/60 pt-5">
          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
              <Package className="size-4.5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Assigned Assets</p>
              <p className="text-lg font-bold tabular-nums text-foreground">
                {items.length}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ShieldCheck className="size-4.5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Active In Possession</p>
              <p className="text-lg font-bold tabular-nums text-foreground">
                {activeAssignmentsCount}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Tag className="size-4.5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Equipment Categories</p>
              <p className="text-lg font-bold tabular-nums text-foreground">
                {categories.length}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      {items.length === 0 ? (
        <Card className="flex min-h-[360px] flex-col items-center justify-center rounded-2xl border-dashed border-border/90 p-8 text-center shadow-xs">
          <div className="flex size-14 items-center justify-center rounded-2xl bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8] mb-4">
            <Package className="size-7" />
          </div>
          <h2 className="text-lg font-semibold text-foreground">No Assets Assigned</h2>
          <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
            You do not have any company equipment or inventory assigned to your account.
          </p>
          <p className="mt-1 text-xs text-muted-foreground">
            Need equipment? Please reach out to your IT or operations administrator.
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void fetchMyAssets()}
            className="mt-5 rounded-lg gap-2 text-xs"
          >
            <RefreshCw className="size-3.5" />
            Check Again
          </Button>
        </Card>
      ) : (
        <div className="space-y-5">
          {/* Search & Category Filter Toolbar */}
          <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div className="relative w-full max-w-md">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by name, serial number, code..."
                className="h-10 rounded-xl pl-9 pr-9 text-sm border-border/80 bg-card"
              />
              {searchQuery && (
                <button
                  type="button"
                  onClick={() => setSearchQuery("")}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
                >
                  <X className="size-3.5" />
                </button>
              )}
            </div>

            {categories.length > 1 && (
              <div className="flex flex-wrap items-center gap-1.5">
                <Button
                  type="button"
                  size="sm"
                  variant={selectedCategory === "all" ? "default" : "outline"}
                  onClick={() => setSelectedCategory("all")}
                  className={cn(
                    "h-8 rounded-lg text-xs font-medium transition-colors",
                    selectedCategory === "all"
                      ? "bg-[#0d47a1] text-white hover:bg-[#0a3880]"
                      : "border-border/80 text-muted-foreground hover:text-foreground"
                  )}
                >
                  All Categories
                </Button>
                {categories.map((cat) => {
                  const isSelected =
                    selectedCategory === cat.id ||
                    selectedCategory === cat.name;
                  return (
                    <Button
                      key={cat.id}
                      type="button"
                      size="sm"
                      variant={isSelected ? "default" : "outline"}
                      onClick={() => setSelectedCategory(cat.id)}
                      className={cn(
                        "h-8 rounded-lg text-xs font-medium transition-colors",
                        isSelected
                          ? "bg-[#0d47a1] text-white hover:bg-[#0a3880]"
                          : "border-border/80 text-muted-foreground hover:text-foreground"
                      )}
                    >
                      {cat.name}
                    </Button>
                  );
                })}
              </div>
            )}
          </div>

          {/* Results Grid */}
          {filteredItems.length === 0 ? (
            <Card className="flex min-h-[220px] flex-col items-center justify-center rounded-2xl border-border/80 p-8 text-center shadow-xs">
              <Search className="size-8 text-muted-foreground/60 mb-2" />
              <h3 className="font-semibold text-foreground">No matching assets</h3>
              <p className="mt-1 text-sm text-muted-foreground">
                No items match your filter criteria. Try adjusting your search query.
              </p>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => {
                  setSearchQuery("");
                  setSelectedCategory("all");
                }}
                className="mt-3 text-xs text-[#0d47a1] dark:text-[#38bdf8]"
              >
                Clear Filters
              </Button>
            </Card>
          ) : (
            <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
              {filteredItems.map((item) => {
                const currentAssignment = item.assignments?.find(
                  (a) => !a.returned_at,
                );
                const IconComponent = getCategoryIcon(
                  item.name,
                  item.category?.name ?? "",
                );
                const isCopied = copiedId === item.id;

                const assignedByName = currentAssignment?.assigned_by
                  ? `${currentAssignment.assigned_by.first_name || ""} ${currentAssignment.assigned_by.last_name || ""}`.trim() ||
                    currentAssignment.assigned_by.full_name ||
                    currentAssignment.assigned_by.email
                  : null;

                return (
                  <Card
                    key={item.id}
                    className="group relative flex flex-col justify-between overflow-hidden rounded-2xl border border-border/80 bg-card p-5 shadow-xs transition-all duration-200 hover:-translate-y-0.5 hover:border-[#0d47a1]/40 hover:shadow-md hover:shadow-[#0d47a1]/5"
                  >
                    <div className="space-y-4">
                      {/* Top Header Row */}
                      <div className="flex items-start justify-between gap-3">
                        <div className="flex items-start gap-3">
                          <div className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8] transition-colors group-hover:bg-[#0d47a1] group-hover:text-white">
                            <IconComponent className="size-5" />
                          </div>
                          <div>
                            <h2 className="font-semibold text-base leading-snug text-foreground">
                              {item.name}
                            </h2>
                            <div className="mt-1 flex flex-wrap items-center gap-1.5">
                              {item.category?.name && (
                                <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/60 px-2 py-0.5 text-[11px] font-medium text-muted-foreground">
                                  {item.category.name}
                                </span>
                              )}
                              {item.code && (
                                <span className="inline-flex items-center rounded-md border border-border/70 bg-muted/40 px-2 py-0.5 text-[11px] font-mono text-muted-foreground">
                                  {item.code}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>

                        {/* Status Badge */}
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-emerald-500/25 bg-emerald-500/10 px-2.5 py-0.5 text-[11px] font-medium text-emerald-700 dark:text-emerald-400">
                          <span className="size-1.5 rounded-full bg-emerald-500 animate-pulse" />
                          In Use
                        </span>
                      </div>

                      {/* Serial Number Pill */}
                      {item.serial_number && (
                        <div className="flex items-center justify-between rounded-xl border border-border/70 bg-muted/30 px-3 py-2 text-xs">
                          <div className="flex items-center gap-2 text-muted-foreground min-w-0">
                            <span className="font-semibold uppercase tracking-wider text-[10px] text-muted-foreground/80">
                              Serial:
                            </span>
                            <span className="font-mono text-foreground truncate">
                              {item.serial_number}
                            </span>
                          </div>
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            onClick={() => copySerialNumber(item.id, item.serial_number)}
                            title="Copy Serial Number"
                            className="size-6 shrink-0 rounded-md text-muted-foreground hover:text-foreground"
                          >
                            {isCopied ? (
                              <Check className="size-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="size-3.5" />
                            )}
                          </Button>
                        </div>
                      )}

                      {/* Assignment Details */}
                      {currentAssignment && (
                        <div className="rounded-xl border border-border/70 bg-muted/30 p-3.5 space-y-2 text-xs">
                          <div className="flex items-center justify-between">
                            <span className="text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
                              Assignment Details
                            </span>
                            <span className="inline-flex items-center gap-1 text-[11px] text-muted-foreground">
                              <CheckCircle2 className="size-3 text-emerald-600" />
                              Active
                            </span>
                          </div>

                          <div className="space-y-1.5 pt-1 border-t border-border/50">
                            <div className="flex items-center justify-between">
                              <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                <Calendar className="size-3.5 text-muted-foreground/70" />
                                Assigned Date
                              </span>
                              <span className="font-medium text-foreground tabular-nums">
                                {format(
                                  new Date(currentAssignment.assigned_at),
                                  "MMM d, yyyy",
                                )}
                              </span>
                            </div>

                            {assignedByName && (
                              <div className="flex items-center justify-between">
                                <span className="inline-flex items-center gap-1.5 text-muted-foreground">
                                  <User className="size-3.5 text-muted-foreground/70" />
                                  Assigned By
                                </span>
                                <span className="font-medium text-foreground truncate max-w-[150px]">
                                  {assignedByName}
                                </span>
                              </div>
                            )}

                            {currentAssignment.condition_notes && (
                              <div className="pt-1 text-[11px]">
                                <span className="text-muted-foreground">Condition: </span>
                                <span className="font-medium text-foreground">
                                  {currentAssignment.condition_notes}
                                </span>
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      {/* Item Notes */}
                      {item.notes && (
                        <p className="rounded-lg border border-border/50 bg-muted/20 p-2.5 text-xs text-muted-foreground leading-relaxed">
                          <span className="font-medium text-foreground">Note: </span>
                          {item.notes}
                        </p>
                      )}
                    </div>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
