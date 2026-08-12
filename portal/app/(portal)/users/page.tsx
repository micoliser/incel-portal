"use client";

import React, { useEffect, useMemo, useRef, useState } from "react";
import { CheckCircle2, Eye, EyeOff, Pencil, Plus, Trash, ChevronDown, ChevronRight, Network, Users as UsersIcon } from "lucide-react";
import { toast } from "sonner";

import { UsersSkeleton } from "@/components/skeletons/users-skeleton";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
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

type Team = { id: string; name: string; code: string; };
type Unit = { id: string; name: string; code: string; teams: Team[]; };
type Department = { id: string; name: string; code: string; units: Unit[]; };

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

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [roles, setRoles] = useState<Role[]>([]);
  const [totalUsers, setTotalUsers] = useState<number>(0);
  const [totalDepartments, setTotalDepartments] = useState<number>(0);
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<string | "">("");
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

  useEffect(() => {
    async function load() {
      try {
        if (currentPage === 1) {
          setLoading(true);
        } else {
          setIsLoadingMore(true);
        }

        isRequestInFlightRef.current = true;

        const [depsResp, filteredUsersResp, totalUsersResp, rolesResp] =
          await Promise.all([
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
          ]);

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
        toast.error("Failed to load users.");
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

  useEffect(() => {
    if (isCreateOpen) {
      resetForm();
    }
  }, [isCreateOpen]);

  function resetForm() {
    setForm(initialFormState);
    setEditingUser(null);
    setFormErrors({});
    setCreateApiError("");
    setEditApiError("");
    setShowCreatePassword(false);
    setShowNewPassword(false);
  }

  function isValidEmail(value: string) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
  }

  function validateCreateForm(values: UserFormState) {
    const errors: Record<string, string> = {};

    if (!values.first_name.trim()) {
      errors.first_name = "First name is required.";
    }

    if (!values.email.trim()) {
      errors.email = "Email is required.";
    } else if (!isValidEmail(values.email.trim())) {
      errors.email = "Enter a valid email address.";
    }

    if (!values.password) {
      errors.password = "Password is required.";
    } else if (values.password.length < 8) {
      errors.password = "Password must be at least 8 characters.";
    }

    if (values.password !== values.confirm_password) {
      errors.confirm_password = "Passwords do not match.";
    }

    return errors;
  }

  function validateEditForm(values: UserFormState) {
    const errors: Record<string, string> = {};

    if (!values.first_name.trim()) {
      errors.first_name = "First name is required.";
    }

    if (!values.email.trim()) {
      errors.email = "Email is required.";
    } else if (!isValidEmail(values.email.trim())) {
      errors.email = "Enter a valid email address.";
    }

    if (values.reset_password) {
      if (!values.new_password) {
        errors.new_password = "New password is required.";
      } else if (values.new_password.length < 8) {
        errors.new_password = "Password must be at least 8 characters.";
      }

      if (values.new_password !== values.confirm_new_password) {
        errors.confirm_new_password = "Passwords do not match.";
      }
    }

    return errors;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const errors = validateCreateForm(form);
    setFormErrors(errors);
    setCreateApiError("");

    if (Object.keys(errors).length > 0) {
      return;
    }

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
      toast.success("User created.");
    } catch (error) {
      setCreateApiError(
        extractApiErrorMessage(error, "Failed to create user."),
      );
      toast.error("Failed to create user.");
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

    if (!editingUser) {
      return;
    }

    const hasEditChanges =
      form.first_name.trim() !== (editingUser.first_name || "") ||
      form.last_name.trim() !== (editingUser.last_name || "") ||
      form.email.trim() !== (editingUser.email || "") ||
      (form.department_id || "") !== (editingUser.department_id || "") ||
      (form.unit_id || "") !== (editingUser.unit_id || "") ||
      (form.team_id || "") !== (editingUser.team_id || "") ||
      (form.role_id || "") !== (editingUser.role_id || "") ||
      (form.reset_password &&
        (form.new_password.length > 0 || form.confirm_new_password.length > 0));

    if (!hasEditChanges) {
      toast.info("No changes detected.");
      return;
    }

    const errors = validateEditForm(form);
    setFormErrors(errors);
    setEditApiError("");

    if (Object.keys(errors).length > 0) {
      return;
    }

    try {
      setIsUpdatingUser(true);
      const payload = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        department_id: form.department_id || null,
        unit_id: form.unit_id || null,
        team_id: form.team_id || null,
        role_id: form.role_id || null,
        reset_password: form.reset_password,
        ...(form.reset_password
          ? {
              new_password: form.new_password,
              confirm_password: form.confirm_new_password,
            }
          : {}),
      };

      const resp = await apiClient.patch(
        `/admin/users/${editingUser.id}`,
        payload,
      );
      setUsers((current) =>
        current.map((user) => (user.id === resp.data.id ? resp.data : user)),
      );
      setIsEditOpen(false);
      resetForm();
      toast.success("User updated.");
    } catch (error) {
      setEditApiError(extractApiErrorMessage(error, "Failed to update user."));
      toast.error("Failed to update user.");
    } finally {
      setIsUpdatingUser(false);
    }
  }

  function requestStatusToggle(user: User) {
    setStatusConfirmUser(user);
  }

  async function confirmStatusToggle() {
    if (!statusConfirmUser) {
      return;
    }

    const nextIsActive = !statusConfirmUser.is_active;

    try {
      setIsUpdatingStatus(true);
      const resp = await apiClient.patch(
        `/admin/users/${statusConfirmUser.id}/status`,
        {
          is_active: nextIsActive,
        },
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



  const activeFilterCount = useMemo(() => {
    return departmentFilter ? 1 : 0;
  }, [departmentFilter]);

  return (
    <div className="space-y-6">
      <div className="mx-auto mb-4 w-full max-w-2xl">
        <Input
          id="users-search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search by first or last name..."
          className="h-11 rounded-full px-5 text-base"
        />
      </div>

      <div className="mb-2 flex items-center justify-center">
        <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active
        </span>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
        <Button
          type="button"
          variant={departmentFilter === "" ? "default" : "outline"}
          className="rounded-full"
          onClick={() => setDepartmentFilter("")}
        >
          All Departments
        </Button>
        {departments.map((department) => {
          const isActive = departmentFilter === department.id;
          return (
            <Button
              key={department.id}
              type="button"
              variant={isActive ? "default" : "outline"}
              className="rounded-full"
              onClick={() => setDepartmentFilter(department.id)}
            >
              {department.name}
            </Button>
          );
        })}
      </div>

      <div className="flex justify-end">
        <Button onClick={() => setIsCreateOpen(true)}>
          <Plus className="mr-2 size-4" /> Create User
        </Button>
      </div>

      <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Total users</p>
            <p className="text-2xl font-semibold">{totalUsers}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Departments</p>
            <p className="text-2xl font-semibold">{totalDepartments}</p>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="p-4">
            <p className="text-sm text-muted-foreground">Avg users / dept</p>
            <p className="text-2xl font-semibold">
              {totalDepartments > 0
                ? (totalUsers / totalDepartments).toFixed(1)
                : "—"}
            </p>
          </CardContent>
        </Card>
      </div>

      {loading ? (
        <UsersSkeleton />
      ) : (
        <Card>
          <div className="overflow-x-auto">
            <table className="w-full table-auto">
              <thead>
                <tr className="text-left text-sm text-muted-foreground">
                  <th className="px-4 py-3">First name</th>
                  <th className="px-4 py-3">Last name</th>
                  <th className="px-4 py-3">Email</th>
                  <th className="px-4 py-3">Department</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3">Actions</th>
                </tr>
              </thead>
              <tbody>
                {users.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-6">
                      No users found.
                    </td>
                  </tr>
                ) : (
                  users.map((user) => {
                    const hasSubPlacement = user.unit_name || user.team_name;
                    const isExpanded = expandedUsers.has(user.id);

                    return (
                      <React.Fragment key={user.id}>
                        <tr className="border-t">
                          <td className="px-4 py-3 font-medium text-base">
                            {user.first_name || "—"}
                          </td>
                          <td className="px-4 py-3 font-medium text-base">
                            {user.last_name || "—"}
                          </td>
                          <td className="px-4 py-3 font-medium text-base">
                            {user.email}
                          </td>
                          <td className="px-4 py-3 font-medium text-base">
                            <div className="flex items-center gap-2">
                              {hasSubPlacement && (
                                <Button 
                                  variant="ghost" 
                                  size="icon" 
                                  className="size-6 shrink-0" 
                                  onClick={() => {
                                    const next = new Set(expandedUsers);
                                    if (next.has(user.id)) next.delete(user.id);
                                    else next.add(user.id);
                                    setExpandedUsers(next);
                                  }}
                                >
                                  {isExpanded ? <ChevronDown className="size-4" /> : <ChevronRight className="size-4" />}
                                </Button>
                              )}
                              {!hasSubPlacement && <div className="size-6 shrink-0" />}
                              <span>{user.department || "—"}</span>
                            </div>
                          </td>
                      <td className="px-4 py-3">
                        <span
                          className={
                            user.is_active
                              ? "rounded-full bg-emerald-500/10 px-3 py-1 text-xs font-medium text-emerald-600 dark:bg-emerald-500/15 dark:text-emerald-400"
                              : "rounded-full bg-rose-500/10 px-3 py-1 text-xs font-medium text-rose-600 dark:bg-rose-500/15 dark:text-rose-400"
                          }
                        >
                          {user.is_active ? "Active" : "Disabled"}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <div className="flex items-center gap-2">
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => openEdit(user)}
                            aria-label="Edit user"
                          >
                            <Pencil className="size-5 text-blue-400/90" />
                          </Button>
                          <Button
                            variant="ghost"
                            size="icon"
                            onClick={() => requestStatusToggle(user)}
                            aria-label={
                              user.is_active ? "Disable user" : "Enable user"
                            }
                          >
                            {user.is_active ? (
                              <Trash className="size-5 text-red-400/90" />
                            ) : (
                              <CheckCircle2 className="size-5 text-emerald-500/90" />
                            )}
                          </Button>
                        </div>
                      </td>
                    </tr>
                    {hasSubPlacement && isExpanded && (
                      <tr className="bg-muted/10 border-b">
                        <td colSpan={3}></td>
                        <td colSpan={3} className="px-4 py-3 text-sm">
                          <div className="flex flex-col gap-2 pl-8">
                            {user.unit_name && (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <Network className="size-4 text-emerald-500" />
                                <span>Unit: <span className="font-medium text-foreground">{user.unit_name}</span></span>
                              </div>
                            )}
                            {user.team_name && (
                              <div className="flex items-center gap-2 text-muted-foreground">
                                <UsersIcon className="size-4 text-orange-500" />
                                <span>Team: <span className="font-medium text-foreground">{user.team_name}</span></span>
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
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {hasNextPage && <div ref={loadMoreRef} className="h-8" />}

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>
              Fill the details to create a new user.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 py-2" noValidate>
            {createApiError ? (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {createApiError}
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <Label htmlFor="first_name">First name</Label>
              <Input
                id="first_name"
                value={form.first_name}
                onChange={(e) => {
                  setForm({ ...form, first_name: e.target.value });
                  setFormErrors((current) => ({
                    ...current,
                    first_name: undefined,
                  }));
                  setCreateApiError("");
                }}
                className="mt-2"
                aria-invalid={Boolean(formErrors.first_name)}
              />
              {formErrors.first_name ? (
                <p className="mt-1 text-xs text-destructive">
                  {formErrors.first_name}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="last_name">Last name</Label>
              <Input
                id="last_name"
                value={form.last_name}
                onChange={(e) => {
                  setForm({ ...form, last_name: e.target.value });
                  setFormErrors((current) => ({
                    ...current,
                    last_name: undefined,
                  }));
                  setCreateApiError("");
                }}
                className="mt-2"
                aria-invalid={Boolean(formErrors.last_name)}
              />
              {formErrors.last_name ? (
                <p className="mt-1 text-xs text-destructive">
                  {formErrors.last_name}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="email">Email</Label>
              <Input
                id="email"
                value={form.email}
                onChange={(e) => {
                  setForm({ ...form, email: e.target.value });
                  setFormErrors((current) => ({
                    ...current,
                    email: undefined,
                  }));
                  setCreateApiError("");
                }}
                className="mt-2"
                autoComplete="off"
                aria-invalid={Boolean(formErrors.email)}
              />
              {formErrors.email ? (
                <p className="mt-1 text-xs text-destructive">
                  {formErrors.email}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="password">Password</Label>
              <div className="relative mt-2">
                <Input
                  id="password"
                  type={showCreatePassword ? "text" : "password"}
                  value={form.password}
                  onChange={(e) => {
                    setForm({ ...form, password: e.target.value });
                    setFormErrors((current) => ({
                      ...current,
                      password: undefined,
                    }));
                    setCreateApiError("");
                  }}
                  className="pr-10"
                  autoComplete="new-password"
                  aria-invalid={Boolean(formErrors.password)}
                />
                <button
                  type="button"
                  className="absolute right-1 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-muted/50"
                  onClick={() => setShowCreatePassword((current) => !current)}
                  aria-label={
                    showCreatePassword ? "Hide password" : "Show password"
                  }
                >
                  {showCreatePassword ? (
                    <EyeOff className="size-4" aria-hidden="true" />
                  ) : (
                    <Eye className="size-4" aria-hidden="true" />
                  )}
                </button>
              </div>
              {formErrors.password ? (
                <p className="mt-1 text-xs text-destructive">
                  {formErrors.password}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="confirm_password">Confirm password</Label>
              <Input
                id="confirm_password"
                type="password"
                value={form.confirm_password}
                onChange={(e) => {
                  setForm({ ...form, confirm_password: e.target.value });
                  setFormErrors((current) => ({
                    ...current,
                    confirm_password: undefined,
                  }));
                  setCreateApiError("");
                }}
                className="mt-2"
                autoComplete="new-password"
                aria-invalid={Boolean(formErrors.confirm_password)}
              />
              {formErrors.confirm_password ? (
                <p className="mt-1 text-xs text-destructive">
                  {formErrors.confirm_password}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="department">Department</Label>
              <Select
                value={form.department_id || undefined}
                onValueChange={(value) => {
                  setForm({ ...form, department_id: value === "none" ? "" : value, unit_id: "", team_id: "" });
                  setCreateApiError("");
                }}
              >
                <SelectTrigger id="department" className="mt-2 w-full h-10">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {departments.map((department) => (
                    <SelectItem key={department.id} value={String(department.id)}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            {form.department_id && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="unit">Unit</Label>
                <Select
                  value={form.unit_id || undefined}
                  onValueChange={(value) => {
                    setForm({ ...form, unit_id: value === "none" ? "" : value, team_id: "" });
                  }}
                >
                  <SelectTrigger id="unit" className="mt-2 w-full h-10">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {departments.find(d => String(d.id) === form.department_id)?.units.map(unit => (
                      <SelectItem key={unit.id} value={String(unit.id)}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {form.unit_id && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="team">Team</Label>
                <Select
                  value={form.team_id || undefined}
                  onValueChange={(value) => {
                    setForm({ ...form, team_id: value === "none" ? "" : value });
                  }}
                >
                  <SelectTrigger id="team" className="mt-2 w-full h-10">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {departments.find(d => String(d.id) === form.department_id)?.units.find(u => String(u.id) === form.unit_id)?.teams.map(team => (
                      <SelectItem key={team.id} value={String(team.id)}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="role">Role</Label>
              <Select
                value={form.role_id || undefined}
                onValueChange={(value) => {
                  setForm({ ...form, role_id: value === "none" ? "" : value });
                  setCreateApiError("");
                }}
              >
                <SelectTrigger id="role" className="mt-2 w-full h-10">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={String(role.id)}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsCreateOpen(false)}
                disabled={isCreatingUser}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isCreatingUser}>
                {isCreatingUser ? "Creating..." : "Create"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog open={isEditOpen} onOpenChange={setIsEditOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Edit user</DialogTitle>
            <DialogDescription>Edit selected user.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleEdit} className="space-y-4 py-2" noValidate>
            {editApiError ? (
              <div
                role="alert"
                className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive"
              >
                {editApiError}
              </div>
            ) : null}

            <div className="flex flex-col gap-2">
              <Label htmlFor="edit_first_name">First name</Label>
              <Input
                id="edit_first_name"
                value={form.first_name}
                onChange={(e) => {
                  setForm({ ...form, first_name: e.target.value });
                  setFormErrors((current) => ({
                    ...current,
                    first_name: undefined,
                  }));
                  setEditApiError("");
                }}
                className="mt-2"
                aria-invalid={Boolean(formErrors.first_name)}
              />
              {formErrors.first_name ? (
                <p className="mt-1 text-xs text-destructive">
                  {formErrors.first_name}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="edit_last_name">Last name</Label>
              <Input
                id="edit_last_name"
                value={form.last_name}
                onChange={(e) => {
                  setForm({ ...form, last_name: e.target.value });
                  setFormErrors((current) => ({
                    ...current,
                    last_name: undefined,
                  }));
                  setEditApiError("");
                }}
                className="mt-2"
                aria-invalid={Boolean(formErrors.last_name)}
              />
              {formErrors.last_name ? (
                <p className="mt-1 text-xs text-destructive">
                  {formErrors.last_name}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="edit_email">Email</Label>
              <Input
                id="edit_email"
                value={form.email}
                onChange={(e) => {
                  setForm({ ...form, email: e.target.value });
                  setFormErrors((current) => ({
                    ...current,
                    email: undefined,
                  }));
                  setEditApiError("");
                }}
                className="mt-2"
                aria-invalid={Boolean(formErrors.email)}
              />
              {formErrors.email ? (
                <p className="mt-1 text-xs text-destructive">
                  {formErrors.email}
                </p>
              ) : null}
            </div>

            <div className="flex flex-col gap-2">
              <Label htmlFor="edit_department">Department</Label>
              <Select
                value={form.department_id || undefined}
                onValueChange={(value) => {
                  setForm({ ...form, department_id: value === "none" ? "" : value, unit_id: "", team_id: "" });
                  setEditApiError("");
                }}
              >
                <SelectTrigger id="edit_department" className="mt-2 w-full h-10">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {departments.map((department) => (
                    <SelectItem key={department.id} value={String(department.id)}>
                      {department.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            {form.department_id && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="edit_unit">Unit</Label>
                <Select
                  value={form.unit_id || undefined}
                  onValueChange={(value) => {
                    setForm({ ...form, unit_id: value === "none" ? "" : value, team_id: "" });
                  }}
                >
                  <SelectTrigger id="edit_unit" className="mt-2 w-full h-10">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {departments.find(d => String(d.id) === form.department_id)?.units.map(unit => (
                      <SelectItem key={unit.id} value={String(unit.id)}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            {form.unit_id && (
              <div className="flex flex-col gap-2">
                <Label htmlFor="edit_team">Team</Label>
                <Select
                  value={form.team_id || undefined}
                  onValueChange={(value) => {
                    setForm({ ...form, team_id: value === "none" ? "" : value });
                  }}
                >
                  <SelectTrigger id="edit_team" className="mt-2 w-full h-10">
                    <SelectValue placeholder="None" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">None</SelectItem>
                    {departments.find(d => String(d.id) === form.department_id)?.units.find(u => String(u.id) === form.unit_id)?.teams.map(team => (
                      <SelectItem key={team.id} value={String(team.id)}>
                        {team.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}

            <div className="flex flex-col gap-2">
              <Label htmlFor="edit_role">Role</Label>
              <Select
                value={form.role_id || undefined}
                onValueChange={(value) => {
                  setForm({ ...form, role_id: value === "none" ? "" : value });
                  setEditApiError("");
                }}
              >
                <SelectTrigger id="edit_role" className="mt-2 w-full h-10">
                  <SelectValue placeholder="None" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">None</SelectItem>
                  {roles.map((role) => (
                    <SelectItem key={role.id} value={String(role.id)}>
                      {role.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex flex-col gap-3 rounded-lg border border-border p-4">
              <div className="flex items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-medium">Reset password</p>
                  <p className="text-xs text-muted-foreground">
                    Set a new password for this user.
                  </p>
                </div>
                <Button
                  type="button"
                  variant={form.reset_password ? "outline" : "secondary"}
                  onClick={() =>
                    setForm((current) => ({
                      ...current,
                      reset_password: !current.reset_password,
                      new_password: current.reset_password
                        ? ""
                        : current.new_password,
                      confirm_new_password: current.reset_password
                        ? ""
                        : current.confirm_new_password,
                    }))
                  }
                >
                  {form.reset_password ? "Cancel reset" : "Reset password"}
                </Button>
              </div>

              {form.reset_password ? (
                <>
                  <div className="flex flex-col gap-2">
                    <Label htmlFor="edit_new_password">New password</Label>
                    <div className="relative mt-2">
                      <Input
                        id="edit_new_password"
                        type={showNewPassword ? "text" : "password"}
                        value={form.new_password}
                        onChange={(e) => {
                          setForm({ ...form, new_password: e.target.value });
                          setFormErrors((current) => ({
                            ...current,
                            new_password: undefined,
                          }));
                          setEditApiError("");
                        }}
                        className="pr-10"
                        aria-invalid={Boolean(formErrors.new_password)}
                      />
                      <button
                        type="button"
                        className="absolute right-1 top-1/2 inline-flex size-8 -translate-y-1/2 items-center justify-center rounded-md border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap outline-none select-none transition-colors hover:bg-muted focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:pointer-events-none disabled:opacity-50 dark:hover:bg-muted/50"
                        onClick={() =>
                          setShowNewPassword((current) => !current)
                        }
                        aria-label={
                          showNewPassword ? "Hide password" : "Show password"
                        }
                      >
                        {showNewPassword ? (
                          <EyeOff className="size-4" aria-hidden="true" />
                        ) : (
                          <Eye className="size-4" aria-hidden="true" />
                        )}
                      </button>
                    </div>
                    {formErrors.new_password ? (
                      <p className="mt-1 text-xs text-destructive">
                        {formErrors.new_password}
                      </p>
                    ) : null}
                  </div>

                  <div className="flex flex-col gap-2">
                    <Label htmlFor="edit_confirm_new_password">
                      Confirm password
                    </Label>
                    <Input
                      id="edit_confirm_new_password"
                      type="password"
                      value={form.confirm_new_password}
                      onChange={(e) => {
                        setForm({
                          ...form,
                          confirm_new_password: e.target.value,
                        });
                        setFormErrors((current) => ({
                          ...current,
                          confirm_new_password: undefined,
                        }));
                        setEditApiError("");
                      }}
                      className="mt-2"
                      aria-invalid={Boolean(formErrors.confirm_new_password)}
                    />
                    {formErrors.confirm_new_password ? (
                      <p className="mt-1 text-xs text-destructive">
                        {formErrors.confirm_new_password}
                      </p>
                    ) : null}
                  </div>
                </>
              ) : null}
            </div>

            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsEditOpen(false)}
                disabled={isUpdatingUser}
              >
                Cancel
              </Button>
              <Button type="submit" disabled={isUpdatingUser}>
                {isUpdatingUser ? "Saving..." : "Save"}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(statusConfirmUser)}
        onOpenChange={(open) => {
          if (!open && !isUpdatingStatus) {
            setStatusConfirmUser(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {statusConfirmUser?.is_active ? "Disable user" : "Enable user"}
            </DialogTitle>
            <DialogDescription>
              {statusConfirmUser
                ? `Are you sure you want to ${
                    statusConfirmUser.is_active ? "disable" : "enable"
                  } user ${userDisplayName(statusConfirmUser)} (${statusConfirmUser.email || "no-email"})?`
                : ""}
            </DialogDescription>
          </DialogHeader>
          <div className="flex justify-end gap-2">
            <Button
              type="button"
              variant="ghost"
              onClick={() => setStatusConfirmUser(null)}
              disabled={isUpdatingStatus}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant={statusConfirmUser?.is_active ? "destructive" : "default"}
              onClick={confirmStatusToggle}
              disabled={isUpdatingStatus}
            >
              {isUpdatingStatus
                ? "Please wait..."
                : statusConfirmUser?.is_active
                  ? "Disable"
                  : "Enable"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
