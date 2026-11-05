"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import {
  CheckCircle2,
  Eye,
  EyeOff,
  Pencil,
  Plus,
  Trash,
  ChevronDown,
  ChevronRight,
  Network,
  Users as UsersIcon,
  Building2,
  Search,
  UserCheck,
  UserX,
  Shield,
  X,
  Inbox,
  AlertCircle,
} from "lucide-react";
import { toast } from "sonner";

import { UsersSkeleton } from "@/components/skeletons/users-skeleton";
import { InfiniteScrollLoader } from "@/components/infinite-scroll-loader";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { apiClient } from "@/lib/api-client";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { cn } from "@/lib/utils";

type User = {
  id: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  department?: string | null;
  department_id?: string | null;
  unit_id?: string | null;
  unit_name?: string | null;
  team_id?: string | null;
  team_name?: string | null;
  role_id?: string | null;
  is_active?: boolean;
};

type Team = { id: string; name: string; code: string };
type Unit = { id: string; name: string; code: string; teams: Team[] };
type Department = { id: string; name: string; code: string; units: Unit[] };

type Role = {
  id: string;
  name: string;
  code: string;
};

type UserFormState = {
  first_name: string;
  last_name: string;
  email: string;
  department_id: string;
  unit_id: string;
  team_id: string;
  role_id: string;
  password: string;
  confirm_password: string;
  reset_password: boolean;
  new_password: string;
  confirm_new_password: string;
};

const initialFormState: UserFormState = {
  first_name: "",
  last_name: "",
  email: "",
  department_id: "",
  unit_id: "",
  team_id: "",
  role_id: "",
  password: "",
  confirm_password: "",
  reset_password: false,
  new_password: "",
  confirm_new_password: "",
};

function isValidEmail(email: string) {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function getUserInitials(firstName?: string, lastName?: string) {
  const f = firstName?.trim() ? firstName.trim()[0] : "";
  const l = lastName?.trim() ? lastName.trim()[0] : "";
  return (f + l).toUpperCase() || "U";
}

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [totalUsers, setTotalUsers] = useState<number>(0);
  const [totalDepartments, setTotalDepartments] = useState<number>(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<string>("");
  const [statusFilter, setStatusFilter] = useState<"all" | "active" | "disabled">(
    "all",
  );
  const [loading, setLoading] = useState(true);
  const [isLoadingMore, setIsLoadingMore] = useState(false);
  const [currentPage, setCurrentPage] = useState(1);
  const [hasNextPage, setHasNextPage] = useState(false);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const isRequestInFlightRef = useRef(false);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);
  const [statusConfirmUser, setStatusConfirmUser] = useState<User | null>(null);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState(false);
  const [showCreatePassword, setShowCreatePassword] = useState(false);
  const [showNewPassword, setShowNewPassword] = useState(false);

  const [form, setForm] = useState<UserFormState>(initialFormState);
  const [formErrors, setFormErrors] = useState<
    Record<string, string | undefined>
  >({});
  const [createApiError, setCreateApiError] = useState("");
  const [editApiError, setEditApiError] = useState("");
  const [isCreatingUser, setIsCreatingUser] = useState(false);
  const [isUpdatingUser, setIsUpdatingUser] = useState(false);

  const [expandedUsers, setExpandedUsers] = useState<Set<number>>(new Set());
  const [isAdmin, setIsAdmin] = useState(false);

  // Map roles by ID for rapid lookup
  const roleMap = useMemo(() => {
    const map = new Map<string, Role>();
    for (const r of roles) {
      map.set(String(r.id), r);
    }
    return map;
  }, [roles]);

  useEffect(() => {
    async function load() {
      try {
        if (currentPage === 1) {
          setLoading(true);
        } else {
          setIsLoadingMore(true);
        }

        isRequestInFlightRef.current = true;

        const [
          depsResp,
          filteredUsersResp,
          totalUsersResp,
          rolesResp,
          permsResp,
        ] = await Promise.all([
          apiClient.get("/organization/hierarchy"),
          apiClient.get("/admin/users", {
            params: {
              q: search,
              department_id: departmentFilter || undefined,
              page: currentPage,
              page_size: 20,
            },
          }),
          apiClient.get("/admin/users"),
          apiClient.get("/organization/roles"),
          apiClient.get("/me/permissions"),
        ]);

        const permissionsData = permsResp.data as {
          is_superuser?: boolean;
          role_code?: string | null;
        };
        setIsAdmin(
          Boolean(permissionsData.is_superuser) ||
            String(permissionsData.role_code ?? "").toUpperCase() === "ADMIN",
        );

        const depsData = depsResp.data || [];
        const depsList = Array.isArray(depsData)
          ? depsData
          : depsData.results || [];
        setDepartments(depsList);

        const rolesData = rolesResp.data || [];
        const rolesList = Array.isArray(rolesData)
          ? rolesData
          : rolesData.results || [];
        setRoles(rolesList);

        const usersData = filteredUsersResp.data || {};
        const results = Array.isArray(usersData.results)
          ? usersData.results
          : Array.isArray(usersData)
            ? usersData
            : [];

        setUsers((current) =>
          currentPage === 1 ? results : [...current, ...results],
        );
        setHasNextPage(
          Boolean(usersData && (usersData.next_page || usersData.next)),
        );

        const totalUsersData = totalUsersResp.data || {};
        const totalCount =
          typeof totalUsersData.count === "number"
            ? totalUsersData.count
            : Array.isArray(totalUsersData.results)
              ? totalUsersData.results.length
              : Array.isArray(totalUsersData)
                ? totalUsersData.length
                : 0;

        setTotalUsers(totalCount);
        setTotalDepartments(depsList.length);
      } catch (err) {
        console.error(err);
        toast.error(extractApiErrorMessage(err, "Failed to load users."));
      } finally {
        isRequestInFlightRef.current = false;
        setLoading(false);
        setIsLoadingMore(false);
      }
    }

    void load();
  }, [search, departmentFilter, currentPage]);

  useEffect(() => {
    // Reset to first page when search or filter change
    setUsers([]);
    setCurrentPage(1);
    setHasNextPage(false);
  }, [search, departmentFilter]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearch(searchInput.trim());
    }, 300);

    return () => window.clearTimeout(timeout);
  }, [searchInput]);

  useEffect(() => {
    if (!hasNextPage || loading || isLoadingMore) return;

    const observer = new IntersectionObserver(
      (entries) => {
        const entry = entries[0];
        if (entry.isIntersecting && !isRequestInFlightRef.current) {
          setCurrentPage((prev) => prev + 1);
        }
      },
      { threshold: 0.1 },
    );

    const target = loadMoreRef.current;
    if (target) observer.observe(target);

    return () => {
      if (target) observer.unobserve(target);
    };
  }, [hasNextPage, loading, isLoadingMore]);

  // Client-side status filtering
  const displayedUsers = useMemo(() => {
    if (statusFilter === "active") return users.filter((u) => u.is_active);
    if (statusFilter === "disabled") return users.filter((u) => !u.is_active);
    return users;
  }, [users, statusFilter]);

  // Computed counts for stats
  const stats = useMemo(() => {
    const active = users.filter((u) => u.is_active).length;
    const disabled = users.filter((u) => !u.is_active).length;
    return {
      total: totalUsers || users.length,
      active,
      disabled,
      departments: totalDepartments || departments.length,
    };
  }, [users, totalUsers, totalDepartments, departments]);

  const hasActiveFilters = Boolean(
    search || departmentFilter || statusFilter !== "all",
  );

  function resetFilters() {
    setSearchInput("");
    setSearch("");
    setDepartmentFilter("");
    setStatusFilter("all");
    setCurrentPage(1);
  }

  function resetForm() {
    setForm(initialFormState);
    setFormErrors({});
    setCreateApiError("");
    setEditApiError("");
    setShowCreatePassword(false);
    setShowNewPassword(false);
  }

  function validateCreateForm(values: UserFormState) {
    const errors: Record<string, string> = {};

    if (!values.first_name.trim()) errors.first_name = "First name is required.";
    if (!values.email.trim()) errors.email = "Email is required.";
    else if (!isValidEmail(values.email.trim()))
      errors.email = "Enter a valid email address.";

    if (!values.password) errors.password = "Password is required.";
    else if (values.password.length < 8)
      errors.password = "Password must be at least 8 characters.";

    if (values.password !== values.confirm_password)
      errors.confirm_password = "Passwords do not match.";

    return errors;
  }

  function validateEditForm(values: UserFormState) {
    const errors: Record<string, string> = {};

    if (!values.first_name.trim()) errors.first_name = "First name is required.";
    if (!values.email.trim()) errors.email = "Email is required.";
    else if (!isValidEmail(values.email.trim()))
      errors.email = "Enter a valid email address.";

    if (values.reset_password) {
      if (!values.new_password)
        errors.new_password = "New password is required.";
      else if (values.new_password.length < 8)
        errors.new_password = "Password must be at least 8 characters.";

      if (values.new_password !== values.confirm_new_password)
        errors.confirm_new_password = "Passwords do not match.";
    }

    return errors;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const errors = validateCreateForm(form);
    setFormErrors(errors);
    setCreateApiError("");

    if (Object.keys(errors).length > 0) return;

    try {
      setIsCreatingUser(true);
      const payload = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        department_id: form.department_id || null,
        unit_id: form.unit_id || null,
        team_id: form.team_id || null,
        role_id: form.role_id || null,
        password: form.password,
      };
      const resp = await apiClient.post("/admin/users", payload);
      setUsers((current) => [resp.data, ...current]);
      setTotalUsers((current) => current + 1);
      setIsCreateOpen(false);
      resetForm();
      toast.success("User created successfully.");
    } catch (error) {
      const msg = extractApiErrorMessage(error, "Failed to create user.");
      setCreateApiError(msg);
      toast.error(msg);
    } finally {
      setIsCreatingUser(false);
    }
  }

  function openEdit(user: User) {
    setEditingUser(user);
    setForm({
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      email: user.email || "",
      department_id: user.department_id || "",
      unit_id: user.unit_id || "",
      team_id: user.team_id || "",
      role_id: user.role_id || "",
      password: "",
      confirm_password: "",
      reset_password: false,
      new_password: "",
      confirm_new_password: "",
    });
    setFormErrors({});
    setEditApiError("");
    setShowCreatePassword(false);
    setShowNewPassword(false);
    setIsEditOpen(true);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;

    const errors = validateEditForm(form);
    setFormErrors(errors);
    setEditApiError("");

    if (Object.keys(errors).length > 0) return;

    try {
      setIsUpdatingUser(true);
      const payload: Record<string, unknown> = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        department_id: form.department_id || null,
        unit_id: form.unit_id || null,
        team_id: form.team_id || null,
        role_id: form.role_id || null,
      };

      if (form.reset_password && form.new_password) {
        payload.new_password = form.new_password;
      }

      const resp = await apiClient.put(
        `/admin/users/${editingUser.id}`,
        payload,
      );
      setUsers((current) =>
        current.map((item) => (item.id === resp.data.id ? resp.data : item)),
      );
      setIsEditOpen(false);
      resetForm();
      setEditingUser(null);
      toast.success("User updated successfully.");
    } catch (error) {
      const msg = extractApiErrorMessage(error, "Failed to update user.");
      setEditApiError(msg);
      toast.error(msg);
    } finally {
      setIsUpdatingUser(false);
    }
  }

  function requestStatusToggle(user: User) {
    setStatusConfirmUser(user);
  }

  async function confirmStatusToggle() {
    if (!statusConfirmUser) return;
    const nextIsActive = !statusConfirmUser.is_active;

    try {
      setIsUpdatingStatus(true);
      const resp = await apiClient.patch(
        `/admin/users/${statusConfirmUser.id}/status`,
        { is_active: nextIsActive },
      );
      setUsers((current) =>
        current.map((item) => (item.id === resp.data.id ? resp.data : item)),
      );
      toast.success(nextIsActive ? "User enabled." : "User disabled.");
      setStatusConfirmUser(null);
    } catch {
      toast.error(
        nextIsActive ? "Failed to enable user." : "Failed to disable user.",
      );
    } finally {
      setIsUpdatingStatus(false);
    }
  }

  function userDisplayName(user: User) {
    const fullName = `${user.first_name || ""} ${user.last_name || ""}`.trim();
    return fullName || "Unknown user";
  }

  return (
    <div className="space-y-6 max-w-full">
      {/* 1. Header & Actions Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">
            User Management
          </h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Manage enterprise workspace users, departmental placements, and roles.
          </p>
        </div>

        {isAdmin && (
          <Button
            onClick={() => {
              resetForm();
              setIsCreateOpen(true);
            }}
            className="bg-[#0d47a1] hover:bg-[#0a3880] text-white rounded-lg px-4 h-9.5 text-sm font-semibold shadow-sm"
          >
            <Plus className="mr-1.5 size-4" />
            Create User
          </Button>
        )}
      </div>

      {/* 2. Key Operational Metrics */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4 sm:gap-4">
        {/* Total Users */}
        <Card className="rounded-xl border border-border bg-card p-4 transition-all shadow-xs hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Total Users
            </span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
              <UsersIcon className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {stats.total}
            </span>
            <span className="text-xs text-muted-foreground">workspace users</span>
          </div>
        </Card>

        {/* Active Users */}
        <Card className="rounded-xl border border-border bg-card p-4 transition-all shadow-xs hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Active Accounts
            </span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-[#16a34a]/10 text-[#16a34a] dark:bg-[#16a34a]/20 dark:text-[#4ade80]">
              <UserCheck className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {stats.active}
            </span>
            <span className="text-xs text-[#16a34a] font-medium">enabled</span>
          </div>
        </Card>

        {/* Disabled Users */}
        <Card className="rounded-xl border border-border bg-card p-4 transition-all shadow-xs hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Disabled Accounts
            </span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-rose-500/10 text-rose-600 dark:bg-rose-500/20 dark:text-rose-400">
              <UserX className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {stats.disabled}
            </span>
            <span className="text-xs text-muted-foreground">suspended</span>
          </div>
        </Card>

        {/* Departments */}
        <Card className="rounded-xl border border-border bg-card p-4 transition-all shadow-xs hover:shadow-sm">
          <div className="flex items-center justify-between">
            <span className="text-xs font-medium text-muted-foreground">
              Departments
            </span>
            <div className="flex size-7 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/20 dark:text-indigo-400">
              <Building2 className="size-4" />
            </div>
          </div>
          <div className="mt-3 flex items-baseline gap-2">
            <span className="text-2xl font-bold tracking-tight text-foreground">
              {stats.departments}
            </span>
            <span className="text-xs text-muted-foreground">teams & units</span>
          </div>
        </Card>
      </div>

      {/* 3. Integrated Filter & Search Toolbar */}
      <Card className="rounded-xl border border-border bg-card p-3 sm:p-4 shadow-xs">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          {/* Search Box */}
          <div className="relative flex-1 min-w-[240px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-muted-foreground pointer-events-none" />
            <Input
              id="users-search"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by name or email..."
              className="h-10 pl-9 rounded-lg bg-background/50 border-input text-xs sm:text-sm"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput("")}
                className="absolute right-3 top-1/2 -translate-y-1/2 text-xs text-muted-foreground hover:text-foreground"
              >
                Clear
              </button>
            )}
          </div>

          {/* Department Select Dropdown */}
          <div className="w-full sm:w-56 shrink-0">
            <Select
              value={departmentFilter || "all"}
              onValueChange={(val) => setDepartmentFilter(val === "all" ? "" : val)}
            >
              <SelectTrigger className="h-10 rounded-lg text-xs sm:text-sm border-input bg-background/50">
                <SelectValue placeholder="All Departments" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="all">All Departments</SelectItem>
                {departments.map((dep) => (
                  <SelectItem key={dep.id} value={dep.id}>
                    {dep.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Status Segmented Buttons */}
          <div className="flex items-center gap-1 rounded-lg border border-border bg-muted/60 p-1 shrink-0">
            {(
              [
                { key: "all", label: "All" },
                { key: "active", label: "Active" },
                { key: "disabled", label: "Disabled" },
              ] as const
            ).map((s) => (
              <button
                key={s.key}
                type="button"
                onClick={() => setStatusFilter(s.key)}
                className={cn(
                  "rounded-md px-3 py-1.5 text-xs font-semibold transition-all",
                  statusFilter === s.key
                    ? "bg-[#0d47a1] text-white shadow-xs hover:bg-[#0a3880]"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {s.label}
              </button>
            ))}
          </div>

          {/* Reset Filters CTA if active */}
          {hasActiveFilters && (
            <Button
              variant="ghost"
              size="sm"
              onClick={resetFilters}
              className="h-9 px-2.5 text-xs text-muted-foreground hover:text-foreground gap-1.5"
            >
              <X className="size-3.5" />
              <span>Reset</span>
            </Button>
          )}
        </div>

        {/* Active Filter Summary Bar */}
        <div className="mt-3 flex items-center justify-between border-t border-border/60 pt-2.5 text-xs text-muted-foreground">
          <span>
            Showing <strong className="text-foreground">{displayedUsers.length}</strong> of{" "}
            {stats.total} users
          </span>
          {hasActiveFilters && (
            <span className="italic">Filters applied</span>
          )}
        </div>
      </Card>

      {/* 4. Enterprise Users Table */}
      {loading ? (
        <UsersSkeleton />
      ) : (
        <Card className="rounded-xl border border-border bg-card shadow-xs overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[760px] table-auto text-left border-collapse">
              <thead>
                <tr className="border-b border-border/70 bg-muted/30 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  <th className="px-5 py-3.5">User</th>
                  <th className="px-5 py-3.5">Department & Placement</th>
                  <th className="px-5 py-3.5">Role</th>
                  <th className="px-5 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/60 text-sm">
                {displayedUsers.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="py-12 text-center text-muted-foreground">
                      <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-muted/80 text-muted-foreground mb-3">
                        <Inbox className="size-6" />
                      </div>
                      <p className="font-semibold text-foreground text-base">
                        No users found
                      </p>
                      <p className="mt-1 text-xs max-w-sm mx-auto">
                        {hasActiveFilters
                          ? "No user accounts match your search or filter criteria. Try resetting filters."
                          : "No users have been added to this workspace yet."}
                      </p>
                      {hasActiveFilters && (
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={resetFilters}
                          className="mt-4 rounded-lg text-xs"
                        >
                          Clear Filters
                        </Button>
                      )}
                    </td>
                  </tr>
                ) : (
                  displayedUsers.map((user) => {
                    const hasSubPlacement = user.unit_name || user.team_name;
                    const isExpanded = expandedUsers.has(user.id);
                    const initials = getUserInitials(user.first_name, user.last_name);
                    const role = user.role_id ? roleMap.get(String(user.role_id)) : null;

                    return (
                      <React.Fragment key={user.id}>
                        <tr className="group transition-colors hover:bg-muted/30">
                          {/* 1. User Column (Avatar + Name + Email) */}
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-3">
                              <div className="flex size-9 shrink-0 items-center justify-center rounded-full bg-[#0d47a1]/10 text-xs font-bold text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                                {initials}
                              </div>
                              <div className="min-w-0">
                                <p className="font-semibold text-foreground group-hover:text-[#0d47a1] dark:group-hover:text-[#38bdf8] transition-colors truncate">
                                  {userDisplayName(user)}
                                </p>
                                <p className="text-xs text-muted-foreground truncate">
                                  {user.email || "No email"}
                                </p>
                              </div>
                            </div>
                          </td>

                          {/* 2. Department & Hierarchy Column */}
                          <td className="px-5 py-3.5">
                            <div className="flex items-center gap-2">
                              {hasSubPlacement && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    const next = new Set(expandedUsers);
                                    if (next.has(user.id)) next.delete(user.id);
                                    else next.add(user.id);
                                    setExpandedUsers(next);
                                  }}
                                  aria-label={isExpanded ? "Collapse placement" : "Expand placement"}
                                  className="flex size-5 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
                                >
                                  {isExpanded ? (
                                    <ChevronDown className="size-3.5" />
                                  ) : (
                                    <ChevronRight className="size-3.5" />
                                  )}
                                </button>
                              )}
                              <span className="font-medium text-foreground text-sm">
                                {user.department || "—"}
                              </span>
                            </div>

                            {/* Placement badges if not expanded */}
                            {!isExpanded && hasSubPlacement && (
                              <div className="mt-1 flex flex-wrap items-center gap-1.5 pl-7 text-[11px] text-muted-foreground">
                                {user.unit_name && (
                                  <span className="rounded bg-muted/60 px-1.5 py-0.5">
                                    Unit: {user.unit_name}
                                  </span>
                                )}
                                {user.team_name && (
                                  <span className="rounded bg-muted/60 px-1.5 py-0.5">
                                    Team: {user.team_name}
                                  </span>
                                )}
                              </div>
                            )}
                          </td>

                          {/* 3. Role Column */}
                          <td className="px-5 py-3.5">
                            <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-muted/40 px-2.5 py-1 text-xs font-medium text-foreground">
                              <Shield className="size-3 text-[#0d47a1] dark:text-[#38bdf8]" />
                              <span>{role?.name || "Staff"}</span>
                            </span>
                          </td>

                          {/* 4. Status Column */}
                          <td className="px-5 py-3.5">
                            <span
                              className={cn(
                                "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-semibold",
                                user.is_active
                                  ? "border-[#16a34a]/30 bg-[#16a34a]/10 text-[#16a34a] dark:text-[#4ade80] dark:bg-[#16a34a]/20"
                                  : "border-border bg-muted text-muted-foreground",
                              )}
                            >
                              <span
                                className={cn(
                                  "size-1.5 rounded-full",
                                  user.is_active
                                    ? "bg-[#16a34a]"
                                    : "bg-muted-foreground",
                                )}
                              />
                              <span>{user.is_active ? "Active" : "Disabled"}</span>
                            </span>
                          </td>

                          {/* 5. Actions Column */}
                          <td className="px-5 py-3.5 text-right">
                            <div className="flex items-center justify-end gap-1">
                              {isAdmin && (
                                <>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => openEdit(user)}
                                    className="size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-[#0d47a1] transition-colors"
                                    title="Edit user details"
                                  >
                                    <Pencil className="size-4" />
                                  </Button>
                                  <Button
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => requestStatusToggle(user)}
                                    className={cn(
                                      "size-8 rounded-lg transition-colors",
                                      user.is_active
                                        ? "text-muted-foreground hover:bg-rose-500/10 hover:text-[#dc2626]"
                                        : "text-muted-foreground hover:bg-[#16a34a]/10 hover:text-[#16a34a]",
                                    )}
                                    title={
                                      user.is_active
                                        ? "Disable user account"
                                        : "Enable user account"
                                    }
                                  >
                                    {user.is_active ? (
                                      <Trash className="size-4" />
                                    ) : (
                                      <CheckCircle2 className="size-4" />
                                    )}
                                  </Button>
                                </>
                              )}
                            </div>
                          </td>
                        </tr>

                        {/* Expanded Sub-Placement Row */}
                        {hasSubPlacement && isExpanded && (
                          <tr className="bg-muted/15 border-b border-border/50">
                            <td colSpan={5} className="px-5 py-3 text-xs">
                              <div className="flex flex-col sm:flex-row sm:items-center gap-4 pl-12 text-muted-foreground">
                                {user.unit_name && (
                                  <div className="flex items-center gap-1.5">
                                    <Network className="size-3.5 text-[#16a34a]" />
                                    <span>
                                      Unit:{" "}
                                      <strong className="text-foreground font-medium">
                                        {user.unit_name}
                                      </strong>
                                    </span>
                                  </div>
                                )}
                                {user.team_name && (
                                  <div className="flex items-center gap-1.5">
                                    <UsersIcon className="size-3.5 text-orange-500" />
                                    <span>
                                      Team:{" "}
                                      <strong className="text-foreground font-medium">
                                        {user.team_name}
                                      </strong>
                                    </span>
                                  </div>
                                )}
                              </div>
                            </td>
                          </tr>
                        )}
                      </React.Fragment>
                    );
                  })
                )}

                {/* Infinite scroll loader placeholder */}
                {isLoadingMore && (
                  <tr>
                    <td colSpan={5} className="py-4 px-5">
                      <div className="space-y-2">
                        <Skeleton className="h-4 w-full rounded" />
                        <Skeleton className="h-4 w-full rounded" />
                      </div>
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <InfiniteScrollLoader isLoading={isLoadingMore} entityName="users" />
      {hasNextPage && <div ref={loadMoreRef} className="h-8" />}

      {/* 5. Create User Dialog */}
      <Dialog
        open={isCreateOpen}
        onOpenChange={(open) => {
          setIsCreateOpen(open);
          if (!open) {
            resetForm();
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader
            icon={<UsersIcon className="size-4.5" />}
            iconClassName="bg-[#0d47a1]/10 text-[#0d47a1] ring-[#0d47a1]/20 dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]"
          >
            <DialogTitle>Create User</DialogTitle>
            <DialogDescription>
              Add a new member to the workspace with departmental placement.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleCreate} className="space-y-4 py-1" noValidate>
            {createApiError && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2"
              >
                <AlertCircle className="size-4 shrink-0" />
                <span>{createApiError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="first_name">First Name *</Label>
                <Input
                  id="first_name"
                  value={form.first_name}
                  onChange={(e) => {
                    setForm({ ...form, first_name: e.target.value });
                    setFormErrors((c) => ({ ...c, first_name: undefined }));
                    setCreateApiError("");
                  }}
                  className="mt-1.5"
                  placeholder="First name"
                  aria-invalid={Boolean(formErrors.first_name)}
                />
                {formErrors.first_name && (
                  <p className="mt-1 text-xs text-destructive">
                    {formErrors.first_name}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="last_name">Last Name</Label>
                <Input
                  id="last_name"
                  value={form.last_name}
                  onChange={(e) => {
                    setForm({ ...form, last_name: e.target.value });
                    setFormErrors((c) => ({ ...c, last_name: undefined }));
                    setCreateApiError("");
                  }}
                  className="mt-1.5"
                  placeholder="Last name"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="email">Work Email *</Label>
              <Input
                id="email"
                type="email"
                value={form.email}
                onChange={(e) => {
                  setForm({ ...form, email: e.target.value });
                  setFormErrors((c) => ({ ...c, email: undefined }));
                  setCreateApiError("");
                }}
                className="mt-1.5"
                placeholder="name@incelgroup.com"
                autoComplete="off"
                aria-invalid={Boolean(formErrors.email)}
              />
              {formErrors.email && (
                <p className="mt-1 text-xs text-destructive">
                  {formErrors.email}
                </p>
              )}
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="password">Password *</Label>
                <div className="relative mt-1.5">
                  <Input
                    id="password"
                    type={showCreatePassword ? "text" : "password"}
                    value={form.password}
                    onChange={(e) => {
                      setForm({ ...form, password: e.target.value });
                      setFormErrors((c) => ({ ...c, password: undefined }));
                      setCreateApiError("");
                    }}
                    className="pr-10"
                    placeholder="Min 8 chars"
                    autoComplete="new-password"
                    aria-invalid={Boolean(formErrors.password)}
                  />
                  <button
                    type="button"
                    className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground"
                    onClick={() => setShowCreatePassword((c) => !c)}
                    aria-label={showCreatePassword ? "Hide password" : "Show password"}
                  >
                    {showCreatePassword ? (
                      <EyeOff className="size-3.5" />
                    ) : (
                      <Eye className="size-3.5" />
                    )}
                  </button>
                </div>
                {formErrors.password && (
                  <p className="mt-1 text-xs text-destructive">
                    {formErrors.password}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="confirm_password">Confirm Password *</Label>
                <Input
                  id="confirm_password"
                  type="password"
                  value={form.confirm_password}
                  onChange={(e) => {
                    setForm({ ...form, confirm_password: e.target.value });
                    setFormErrors((c) => ({ ...c, confirm_password: undefined }));
                    setCreateApiError("");
                  }}
                  className="mt-1.5"
                  placeholder="Repeat password"
                  autoComplete="new-password"
                  aria-invalid={Boolean(formErrors.confirm_password)}
                />
                {formErrors.confirm_password && (
                  <p className="mt-1 text-xs text-destructive">
                    {formErrors.confirm_password}
                  </p>
                )}
              </div>
            </div>

            <div className="border-t border-border/60 pt-3 space-y-3">
              <div>
                <Label htmlFor="department">Department</Label>
                <Select
                  value={form.department_id || "none"}
                  onValueChange={(val) => {
                    setForm({
                      ...form,
                      department_id: val === "none" ? "" : val,
                      unit_id: "",
                      team_id: "",
                    });
                    setCreateApiError("");
                  }}
                >
                  <SelectTrigger id="department" className="mt-1.5 h-10 w-full">
                    <SelectValue placeholder="Select Department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None / Unassigned</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {form.department_id && (
                <div>
                  <Label htmlFor="unit">Unit</Label>
                  <Select
                    value={form.unit_id || "none"}
                    onValueChange={(val) => {
                      setForm({
                        ...form,
                        unit_id: val === "none" ? "" : val,
                        team_id: "",
                      });
                    }}
                  >
                    <SelectTrigger id="unit" className="mt-1.5 h-10 w-full">
                      <SelectValue placeholder="Select Unit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {departments
                        .find((d) => String(d.id) === form.department_id)
                        ?.units.map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {form.unit_id && (
                <div>
                  <Label htmlFor="team">Team</Label>
                  <Select
                    value={form.team_id || "none"}
                    onValueChange={(val) => {
                      setForm({ ...form, team_id: val === "none" ? "" : val });
                    }}
                  >
                    <SelectTrigger id="team" className="mt-1.5 h-10 w-full">
                      <SelectValue placeholder="Select Team" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {departments
                        .find((d) => String(d.id) === form.department_id)
                        ?.units.find((u) => String(u.id) === form.unit_id)
                        ?.teams.map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>
                            {t.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div>
                <Label htmlFor="role">Role Permission</Label>
                <Select
                  value={form.role_id || "none"}
                  onValueChange={(val) => {
                    setForm({ ...form, role_id: val === "none" ? "" : val });
                    setCreateApiError("");
                  }}
                >
                  <SelectTrigger id="role" className="mt-1.5 h-10 w-full">
                    <SelectValue placeholder="Select Role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Standard Staff</SelectItem>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            <DialogFooter className="pt-4 border-t border-border/60 sm:justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateOpen(false)}
                disabled={isCreatingUser}
                className="rounded-lg text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isCreatingUser}
                className="bg-[#0d47a1] hover:bg-[#0a3880] text-white rounded-lg text-xs font-semibold shadow-sm"
              >
                {isCreatingUser ? "Creating User..." : "Create User"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 6. Edit User Dialog */}
      <Dialog
        open={isEditOpen}
        onOpenChange={(open) => {
          setIsEditOpen(open);
          if (!open) {
            resetForm();
            setEditingUser(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader
            icon={<Pencil className="size-4.5" />}
            iconClassName="bg-[#0d47a1]/10 text-[#0d47a1] ring-[#0d47a1]/20 dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]"
          >
            <DialogTitle>Edit User</DialogTitle>
            <DialogDescription>
              Update account details and organization placement.
            </DialogDescription>
          </DialogHeader>

          <form onSubmit={handleEdit} className="space-y-4 py-1" noValidate>
            {editApiError && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-xs text-destructive flex items-center gap-2"
              >
                <AlertCircle className="size-4 shrink-0" />
                <span>{editApiError}</span>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label htmlFor="edit_first_name">First Name *</Label>
                <Input
                  id="edit_first_name"
                  value={form.first_name}
                  onChange={(e) => {
                    setForm({ ...form, first_name: e.target.value });
                    setFormErrors((c) => ({ ...c, first_name: undefined }));
                    setEditApiError("");
                  }}
                  className="mt-1.5"
                  aria-invalid={Boolean(formErrors.first_name)}
                />
                {formErrors.first_name && (
                  <p className="mt-1 text-xs text-destructive">
                    {formErrors.first_name}
                  </p>
                )}
              </div>

              <div>
                <Label htmlFor="edit_last_name">Last Name</Label>
                <Input
                  id="edit_last_name"
                  value={form.last_name}
                  onChange={(e) => {
                    setForm({ ...form, last_name: e.target.value });
                    setFormErrors((c) => ({ ...c, last_name: undefined }));
                    setEditApiError("");
                  }}
                  className="mt-1.5"
                />
              </div>
            </div>

            <div>
              <Label htmlFor="edit_email">Work Email *</Label>
              <Input
                id="edit_email"
                type="email"
                value={form.email}
                onChange={(e) => {
                  setForm({ ...form, email: e.target.value });
                  setFormErrors((c) => ({ ...c, email: undefined }));
                  setEditApiError("");
                }}
                className="mt-1.5"
                aria-invalid={Boolean(formErrors.email)}
              />
              {formErrors.email && (
                <p className="mt-1 text-xs text-destructive">
                  {formErrors.email}
                </p>
              )}
            </div>

            <div className="border-t border-border/60 pt-3 space-y-3">
              <div>
                <Label htmlFor="edit_department">Department</Label>
                <Select
                  value={form.department_id || "none"}
                  onValueChange={(val) => {
                    setForm({
                      ...form,
                      department_id: val === "none" ? "" : val,
                      unit_id: "",
                      team_id: "",
                    });
                    setEditApiError("");
                  }}
                >
                  <SelectTrigger id="edit_department" className="mt-1.5 h-10 w-full">
                    <SelectValue placeholder="Select Department" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None / Unassigned</SelectItem>
                    {departments.map((d) => (
                      <SelectItem key={d.id} value={String(d.id)}>
                        {d.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              {form.department_id && (
                <div>
                  <Label htmlFor="edit_unit">Unit</Label>
                  <Select
                    value={form.unit_id || "none"}
                    onValueChange={(val) => {
                      setForm({
                        ...form,
                        unit_id: val === "none" ? "" : val,
                        team_id: "",
                      });
                    }}
                  >
                    <SelectTrigger id="edit_unit" className="mt-1.5 h-10 w-full">
                      <SelectValue placeholder="Select Unit" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {departments
                        .find((d) => String(d.id) === form.department_id)
                        ?.units.map((u) => (
                          <SelectItem key={u.id} value={String(u.id)}>
                            {u.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {form.unit_id && (
                <div>
                  <Label htmlFor="edit_team">Team</Label>
                  <Select
                    value={form.team_id || "none"}
                    onValueChange={(val) => {
                      setForm({ ...form, team_id: val === "none" ? "" : val });
                    }}
                  >
                    <SelectTrigger id="edit_team" className="mt-1.5 h-10 w-full">
                      <SelectValue placeholder="Select Team" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="none">None</SelectItem>
                      {departments
                        .find((d) => String(d.id) === form.department_id)
                        ?.units.find((u) => String(u.id) === form.unit_id)
                        ?.teams.map((t) => (
                          <SelectItem key={t.id} value={String(t.id)}>
                            {t.name}
                          </SelectItem>
                        ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              <div>
                <Label htmlFor="edit_role">Role Permission</Label>
                <Select
                  value={form.role_id || "none"}
                  onValueChange={(val) => {
                    setForm({ ...form, role_id: val === "none" ? "" : val });
                    setEditApiError("");
                  }}
                >
                  <SelectTrigger id="edit_role" className="mt-1.5 h-10 w-full">
                    <SelectValue placeholder="Select Role" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">Standard Staff</SelectItem>
                    {roles.map((r) => (
                      <SelectItem key={r.id} value={String(r.id)}>
                        {r.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>

            {/* Password Reset Accordion / Section */}
            <div className="border-t border-border/60 pt-3">
              <label className="flex items-center gap-2 cursor-pointer text-xs font-semibold text-foreground">
                <input
                  type="checkbox"
                  checked={form.reset_password}
                  onChange={(e) =>
                    setForm({ ...form, reset_password: e.target.checked })
                  }
                  className="rounded border-border text-[#0d47a1] focus:ring-[#0d47a1]"
                />
                <span>Reset User Password</span>
              </label>

              {form.reset_password && (
                <div className="mt-3 grid grid-cols-2 gap-3 pl-6">
                  <div>
                    <Label htmlFor="edit_new_password">New Password</Label>
                    <div className="relative mt-1.5">
                      <Input
                        id="edit_new_password"
                        type={showNewPassword ? "text" : "password"}
                        value={form.new_password}
                        onChange={(e) => {
                          setForm({ ...form, new_password: e.target.value });
                          setFormErrors((c) => ({ ...c, new_password: undefined }));
                          setEditApiError("");
                        }}
                        className="pr-10"
                        placeholder="Min 8 chars"
                        aria-invalid={Boolean(formErrors.new_password)}
                      />
                      <button
                        type="button"
                        className="absolute right-1 top-1/2 -translate-y-1/2 p-1.5 text-muted-foreground hover:text-foreground"
                        onClick={() => setShowNewPassword((c) => !c)}
                        aria-label={showNewPassword ? "Hide password" : "Show password"}
                      >
                        {showNewPassword ? (
                          <EyeOff className="size-3.5" />
                        ) : (
                          <Eye className="size-3.5" />
                        )}
                      </button>
                    </div>
                    {formErrors.new_password && (
                      <p className="mt-1 text-xs text-destructive">
                        {formErrors.new_password}
                      </p>
                    )}
                  </div>

                  <div>
                    <Label htmlFor="edit_confirm_new_password">Confirm New</Label>
                    <Input
                      id="edit_confirm_new_password"
                      type="password"
                      value={form.confirm_new_password}
                      onChange={(e) => {
                        setForm({
                          ...form,
                          confirm_new_password: e.target.value,
                        });
                        setFormErrors((c) => ({
                          ...c,
                          confirm_new_password: undefined,
                        }));
                        setEditApiError("");
                      }}
                      className="mt-1.5"
                      placeholder="Repeat password"
                      aria-invalid={Boolean(formErrors.confirm_new_password)}
                    />
                    {formErrors.confirm_new_password && (
                      <p className="mt-1 text-xs text-destructive">
                        {formErrors.confirm_new_password}
                      </p>
                    )}
                  </div>
                </div>
              )}
            </div>

            <DialogFooter className="pt-4 border-t border-border/60 sm:justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsEditOpen(false)}
                disabled={isUpdatingUser}
                className="rounded-lg text-xs"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isUpdatingUser}
                className="bg-[#0d47a1] hover:bg-[#0a3880] text-white rounded-lg text-xs font-semibold shadow-sm"
              >
                {isUpdatingUser ? "Saving Changes..." : "Save Changes"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* 7. Status Confirmation Dialog */}
      <Dialog
        open={Boolean(statusConfirmUser)}
        onOpenChange={(open) => {
          if (!open && !isUpdatingStatus) {
            setStatusConfirmUser(null);
          }
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader
            icon={<UsersIcon className="size-4.5" />}
            iconClassName={
              statusConfirmUser?.is_active
                ? "bg-rose-500/10 text-rose-600 ring-rose-500/20 dark:bg-rose-500/20 dark:text-rose-400"
                : undefined
            }
          >
            <DialogTitle>
              {statusConfirmUser?.is_active ? "Disable User Account" : "Enable User Account"}
            </DialogTitle>
            <DialogDescription>
              {statusConfirmUser
                ? `Are you sure you want to ${
                    statusConfirmUser.is_active ? "disable" : "enable"
                  } access for ${userDisplayName(statusConfirmUser)} (${statusConfirmUser.email || "no-email"})?`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter className="pt-4 border-t border-border/60 sm:justify-end gap-2.5">
            <Button
              type="button"
              variant="outline"
              onClick={() => setStatusConfirmUser(null)}
              disabled={isUpdatingStatus}
              className="rounded-lg text-xs"
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={statusConfirmUser?.is_active ? "destructive" : "default"}
              className={
                statusConfirmUser?.is_active
                  ? "rounded-lg text-xs font-semibold shadow-sm"
                  : "bg-[#0d47a1] hover:bg-[#0a3880] text-white rounded-lg text-xs font-semibold shadow-sm"
              }
              onClick={confirmStatusToggle}
              disabled={isUpdatingStatus}
            >
              {isUpdatingStatus
                ? "Updating..."
                : statusConfirmUser?.is_active
                  ? "Disable User"
                  : "Enable User"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
