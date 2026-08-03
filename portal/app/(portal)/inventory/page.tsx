"use client";

import { useEffect, useState, useRef, useMemo } from "react";
import Link from "next/link";
import { Archive, Loader2, Plus, Search, Filter, Monitor, CheckCircle, Clock } from "lucide-react";
import { toast } from "sonner";
import { apiClient } from "@/lib/api-client";
import { Card } from "@/components/ui/card";
import { PageErrorCard } from "@/components/page-error-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { extractApiErrorMessage } from "@/lib/api-errors";


type InventoryCategory = {
  id: string;
  name: string;
  description: string;
};

type InventoryItem = {
  id: string;
  name: string;
  category: InventoryCategory;
  serial_number: string;
  status: string;
  current_assignee: { id: string | number; first_name?: string; last_name?: string; email?: string; full_name?: string } | null;
};

type InventoryStats = {
  total: number;
  available: number;
  assigned: number;
  maintenance: number;
};

const statusColors: Record<string, string> = {
  available: "bg-emerald-100 text-emerald-800 dark:bg-emerald-500/20 dark:text-emerald-400",
  assigned: "bg-blue-100 text-blue-800 dark:bg-blue-500/20 dark:text-blue-400",
  maintenance: "bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-400",
  retired: "bg-gray-100 text-gray-800 dark:bg-gray-500/20 dark:text-gray-400",
};

export default function InventoryDashboard() {
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [categories, setCategories] = useState<InventoryCategory[]>([]);
  const [stats, setStats] = useState<InventoryStats>({ total: 0, available: 0, assigned: 0, maintenance: 0 });
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  
  // Pagination
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const loadMoreRef = useRef<HTMLTableRowElement>(null);
  const isRequestInFlightRef = useRef(false);

  // Modals
  const [isCategoryModalOpen, setIsCategoryModalOpen] = useState(false);
  const [isItemModalOpen, setIsItemModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Filters
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [categoryFilter, setCategoryFilter] = useState("all");

  // Forms
  const [categoryForm, setCategoryForm] = useState({ name: "", description: "" });
  const [itemForm, setItemForm] = useState({
    name: "",
    category: "",
    serial_number: "",
    status: "available",
  });

  const fetchStatsAndCategories = async () => {
    try {
      const [statsRes, catsRes] = await Promise.all([
        apiClient.get("/inventory/items/stats/"),
        apiClient.get("/inventory/categories/")
      ]);
      setStats(statsRes.data);
      setCategories(catsRes.data);
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

        const response = await apiClient.get("/inventory/items/", { params });
        const payload = response.data;
        
        let results: InventoryItem[] = [];
        if (Array.isArray(payload)) {
          results = payload;
        } else if (payload && typeof payload === "object") {
          const typedPayload = payload as { results?: InventoryItem[] };
          results = Array.isArray(typedPayload.results) ? typedPayload.results : [];
        }

        setItems((current) => (currentPage === 1 ? results : [...current, ...results]));
        
        const hasNext = !Array.isArray(payload) && payload && typeof payload === "object"
          ? Boolean((payload as { next_page?: unknown }).next_page)
          : false;
        
        setHasNextPage(hasNext);
        setError(null);
      } catch (err) {
        setError(extractApiErrorMessage(err, "Failed to load inventory data."));
      } finally {
        isRequestInFlightRef.current = false;
        setLoading(false);
        setIsLoadingMore(false);
      }
    }

    void loadItems();
  }, [searchQuery, statusFilter, categoryFilter, currentPage]);

  useEffect(() => {
    setItems([]);
    setCurrentPage(1);
    setHasNextPage(false);
  }, [searchQuery, statusFilter, categoryFilter]);

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
      { threshold: 0.1 }
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, [hasNextPage, loading, isLoadingMore]);

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

  const handleCreateItem = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!itemForm.name || !itemForm.category) return toast.error("Name and Category are required");

    try {
      setIsSubmitting(true);
      await apiClient.post("/inventory/items/", itemForm);
      toast.success("Item created");
      setIsItemModalOpen(false);
      setItemForm({ name: "", category: "", serial_number: "", status: "available" });
      fetchStatsAndCategories();
      // Reload items
      setCurrentPage(1);
      setItems([]);
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
    return count;
  }, [categoryFilter, statusFilter]);

  return (
    <div className="space-y-8">
      {/* Summary Cards */}
      <div className="grid gap-4 md:grid-cols-4">
        <Card className="p-4 border border-border">
          <div className="flex items-center gap-4">
            <div className="rounded-full bg-primary/10 p-3 text-primary">
              <Archive className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Total Assets</p>
              <h3 className="text-2xl font-bold">{stats.total}</h3>
            </div>
          </div>
        </Card>
        <Card className="p-4 border border-border">
          <div className="flex items-center gap-4">
            <div className="rounded-full bg-emerald-100 p-3 text-emerald-600 dark:bg-emerald-500/20 dark:text-emerald-400">
              <CheckCircle className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Available</p>
              <h3 className="text-2xl font-bold">{stats.available}</h3>
            </div>
          </div>
        </Card>
        <Card className="p-4 border border-border">
          <div className="flex items-center gap-4">
            <div className="rounded-full bg-blue-100 p-3 text-blue-600 dark:bg-blue-500/20 dark:text-blue-400">
              <Monitor className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Assigned</p>
              <h3 className="text-2xl font-bold">{stats.assigned}</h3>
            </div>
          </div>
        </Card>
        <Card className="p-4 border border-border">
          <div className="flex items-center gap-4">
            <div className="rounded-full bg-amber-100 p-3 text-amber-600 dark:bg-amber-500/20 dark:text-amber-400">
              <Clock className="h-5 w-5" />
            </div>
            <div>
              <p className="text-sm font-medium text-muted-foreground">Maintenance</p>
              <h3 className="text-2xl font-bold">{stats.maintenance}</h3>
            </div>
          </div>
        </Card>
      </div>

      <div className="mx-auto w-full max-w-2xl">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted-foreground" />
          <Input
            id="inventory-search"
            value={searchInput}
            onChange={(event) => setSearchInput(event.target.value)}
            placeholder="Search by asset name or serial number..."
            className="h-11 rounded-full pl-10 pr-5 text-base"
          />
        </div>
      </div>

      <div className="flex items-center justify-center">
        <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active
        </span>
      </div>

      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          variant={categoryFilter === "all" ? "default" : "outline"}
          className="rounded-full"
          onClick={() => setCategoryFilter("all")}
        >
          All Categories
        </Button>
        {categories.map((category) => {
          const isActive = categoryFilter === category.id;
          return (
            <Button
              key={category.id}
              type="button"
              variant={isActive ? "default" : "outline"}
              className="rounded-full"
              onClick={() => setCategoryFilter(category.id)}
            >
              {category.name}
            </Button>
          );
        })}
      </div>

      {/* Filters & Actions */}
      <div className="flex flex-col sm:flex-row gap-4 items-start sm:items-center justify-between">
        <div className="flex gap-4 items-center">
          <Select value={statusFilter} onValueChange={setStatusFilter}>
            <SelectTrigger className="w-[180px]">
              <Filter className="mr-2 h-4 w-4" />
              <SelectValue placeholder="Filter by status" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Statuses</SelectItem>
              <SelectItem value="available">Available</SelectItem>
              <SelectItem value="assigned">Assigned</SelectItem>
              <SelectItem value="maintenance">Maintenance</SelectItem>
              <SelectItem value="retired">Retired</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex gap-3">
          <Button variant="outline" onClick={() => setIsCategoryModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Category
          </Button>
          <Button onClick={() => setIsItemModalOpen(true)}>
            <Plus className="mr-2 h-4 w-4" /> Item
          </Button>
        </div>
      </div>

      {error ? (
        <PageErrorCard title="Failed to load inventory" message={error} onRetry={() => setCurrentPage(1)} />
      ) : (
        <Card className="overflow-hidden border border-border">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="bg-muted/50 text-muted-foreground">
                <tr>
                  <th className="px-4 py-3 font-medium">Item Name</th>
                  <th className="px-4 py-3 font-medium">Category</th>
                  <th className="px-4 py-3 font-medium">Serial Number</th>
                  <th className="px-4 py-3 font-medium">Status</th>
                  <th className="px-4 py-3 font-medium">Assignee</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {loading && items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center">
                      <Loader2 className="mx-auto h-6 w-6 animate-spin text-muted-foreground" />
                    </td>
                  </tr>
                ) : items.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="px-4 py-8 text-center text-muted-foreground">
                      No items found matching your filters.
                    </td>
                  </tr>
                ) : (
                  <>
                    {items.map((item) => (
                      <tr key={item.id} className="hover:bg-muted/50 transition-colors">
                        <td className="px-4 py-3 font-medium">
                          <Link href={`/inventory/${item.id}`} className="text-primary hover:underline">
                            {item.name}
                          </Link>
                        </td>
                        <td className="px-4 py-3">{item.category.name}</td>
                        <td className="px-4 py-3 font-mono text-xs text-muted-foreground">
                          {item.serial_number || "—"}
                        </td>
                        <td className="px-4 py-3">
                          <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-xs font-semibold ${statusColors[item.status]}`}>
                            {item.status.toUpperCase()}
                          </span>
                        </td>
                        <td className="px-4 py-3">
                          {item.current_assignee 
                            ? `${item.current_assignee.first_name} ${item.current_assignee.last_name}`
                            : "—"}
                        </td>
                      </tr>
                    ))}
                    {hasNextPage && (
                      <tr ref={loadMoreRef}>
                        <td colSpan={5} className="py-6 text-center">
                          <Loader2 className="mx-auto h-5 w-5 animate-spin text-muted-foreground" />
                        </td>
                      </tr>
                    )}
                  </>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Category Modal */}
      <Dialog open={isCategoryModalOpen} onOpenChange={setIsCategoryModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Category</DialogTitle>
            <DialogDescription>Add a new category for your inventory items (e.g., Laptops, Monitors).</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateCategory} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="cat_name">Name</Label>
              <Input
                id="cat_name"
                value={categoryForm.name}
                onChange={(e) => setCategoryForm({ ...categoryForm, name: e.target.value })}
                placeholder="e.g. Laptops"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="cat_desc">Description</Label>
              <Input
                id="cat_desc"
                value={categoryForm.description}
                onChange={(e) => setCategoryForm({ ...categoryForm, description: e.target.value })}
                placeholder="Optional description"
              />
            </div>
            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create Category
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Item Modal */}
      <Dialog open={isItemModalOpen} onOpenChange={setIsItemModalOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Item</DialogTitle>
            <DialogDescription>Add a new hardware asset or equipment to the inventory.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateItem} className="space-y-4 pt-4">
            <div className="space-y-2">
              <Label htmlFor="item_name">Item Name</Label>
              <Input
                id="item_name"
                value={itemForm.name}
                onChange={(e) => setItemForm({ ...itemForm, name: e.target.value })}
                placeholder="e.g. MacBook Pro M3"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item_cat">Category</Label>
              <Select
                value={itemForm.category}
                onValueChange={(value) => setItemForm({ ...itemForm, category: value })}
              >
                <SelectTrigger id="item_cat" className="w-full">
                  <SelectValue placeholder="Select a category" />
                </SelectTrigger>
                <SelectContent>
                  {categories.map((c) => (
                    <SelectItem key={c.id} value={c.id}>{c.name}</SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="item_sn">Serial Number</Label>
              <Input
                id="item_sn"
                value={itemForm.serial_number}
                onChange={(e) => setItemForm({ ...itemForm, serial_number: e.target.value })}
                placeholder="Optional serial number"
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="item_status">Status</Label>
              <Select
                value={itemForm.status}
                onValueChange={(value) => setItemForm({ ...itemForm, status: value })}
              >
                <SelectTrigger id="item_status" className="w-full">
                  <SelectValue placeholder="Select a status" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="available">Available</SelectItem>
                  <SelectItem value="maintenance">Maintenance</SelectItem>
                  <SelectItem value="retired">Retired</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="flex justify-end pt-4">
              <Button type="submit" disabled={isSubmitting}>
                {isSubmitting ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
                Create Item
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
