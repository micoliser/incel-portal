"use client";

import { useEffect, useMemo, useState } from "react";
import { Pencil, Plus, Trash } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { apiClient } from "@/lib/api-client";

type User = {
  id: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  department_id?: string | null;
  is_active?: boolean;
};

type Department = {
  id: string;
  name: string;
};

export default function UsersPage() {
  const [users, setUsers] = useState<User[]>([]);
  const [departments, setDepartments] = useState<Department[]>([]);
  const [search, setSearch] = useState("");
  const [departmentFilter, setDepartmentFilter] = useState<string | "">("");
  const [loading, setLoading] = useState(true);

  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [editingUser, setEditingUser] = useState<User | null>(null);

  const [form, setForm] = useState({
    first_name: "",
    last_name: "",
    email: "",
    department_id: "",
    password: "",
    confirm_password: "",
  });
  const [formErrors, setFormErrors] = useState<
    Record<string, string | undefined>
  >({});

  useEffect(() => {
    async function load() {
      try {
        setLoading(true);
        const [depsResp, usersResp] = await Promise.all([
          apiClient.get("/organization/departments"),
          apiClient.get("/admin/users", {
            params: { q: search, department_id: departmentFilter || undefined },
          }),
        ]);
        setDepartments(depsResp.data || []);
        const u = usersResp.data.results || usersResp.data;
        setUsers(u || []);
      } catch (err) {
        toast.error("Failed to load users.");
      } finally {
        setLoading(false);
      }
    }

    void load();
  }, [search, departmentFilter]);

  useEffect(() => {
    if (isCreateOpen) {
      // Ensure create form is fresh when opened
      resetForm();
    }
  }, [isCreateOpen]);

  function resetForm() {
    setForm({
      first_name: "",
      last_name: "",
      email: "",
      department_id: "",
      password: "",
      confirm_password: "",
    });
    setEditingUser(null);
    setFormErrors({});
  }

  function isValidEmail(value: string) {
    return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value);
  }

  function validateCreateForm(values: typeof form) {
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

  function validateEditForm(values: typeof form) {
    const errors: Record<string, string> = {};
    if (!values.first_name.trim()) {
      errors.first_name = "First name is required.";
    }
    if (!values.email.trim()) {
      errors.email = "Email is required.";
    } else if (!isValidEmail(values.email.trim())) {
      errors.email = "Enter a valid email address.";
    }
    return errors;
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const errors = validateCreateForm(form);
    setFormErrors(errors);

    if (Object.keys(errors).length > 0) {
      return;
    }

    try {
      const payload = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        department_id: form.department_id || null,
        password: form.password || undefined,
      };
      const resp = await apiClient.post("/admin/users", payload);
      setUsers((s) => [resp.data, ...s]);
      setIsCreateOpen(false);
      resetForm();
      toast.success("User created.");
    } catch (err) {
      toast.error("Failed to create user.");
    }
  }

  function openEdit(user: User) {
    setEditingUser(user);
    setForm({
      first_name: user.first_name || "",
      last_name: user.last_name || "",
      email: user.email || "",
      department_id: user.department_id || "",
      password: "",
      confirm_password: "",
    });
    // Clear any previous form errors when editing
    setFormErrors({});
    setIsEditOpen(true);
  }

  async function handleEdit(e: React.FormEvent) {
    e.preventDefault();
    if (!editingUser) return;
    const errors = validateEditForm(form);
    setFormErrors(errors);

    if (Object.keys(errors).length > 0) {
      return;
    }

    try {
      const payload = {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        email: form.email.trim(),
        department_id: form.department_id || null,
      };
      const resp = await apiClient.patch(
        `/admin/users/${editingUser.id}`,
        payload,
      );
      setUsers((s) => s.map((u) => (u.id === resp.data.id ? resp.data : u)));
      setIsEditOpen(false);
      resetForm();
      toast.success("User updated.");
    } catch (err) {
      toast.error("Failed to update user.");
    }
  }

  async function handleDisable(user: User) {
    if (!confirm(`Disable user ${user.email}? This prevents login.`)) return;
    try {
      const resp = await apiClient.patch(`/admin/users/${user.id}/status`, {
        is_active: false,
      });
      setUsers((s) => s.map((u) => (u.id === resp.data.id ? resp.data : u)));
      toast.success("User disabled.");
    } catch (err) {
      toast.error("Failed to disable user.");
    }
  }

  const departmentMap = useMemo(() => {
    const m: Record<string, string> = {};
    departments.forEach((d) => (m[d.id] = d.name));
    return m;
  }, [departments]);

  return (
    <div className="space-y-6 p-6">
      <div className="flex items-center justify-between gap-4">
        <div>
          <h2 className="text-2xl font-semibold">Users</h2>
          <p className="text-sm text-muted-foreground">
            Manage workspace users.
          </p>
        </div>

        <div className="flex items-center gap-2">
          <Input
            placeholder="Search by name"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          <select
            value={departmentFilter}
            onChange={(e) => setDepartmentFilter(e.target.value)}
            className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow,border-color] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:border-sky-400 dark:focus-visible:ring-sky-400/20"
          >
            <option value="">All departments</option>
            {departments.map((d) => (
              <option key={d.id} value={d.id}>
                {d.name}
              </option>
            ))}
          </select>
          <Button onClick={() => setIsCreateOpen(true)}>
            <Plus className="mr-2 size-4" /> Create
          </Button>
        </div>
      </div>

      <Card>
        <div className="overflow-x-auto">
          <table className="w-full table-auto">
            <thead>
              <tr className="text-left text-sm text-muted-foreground">
                <th className="px-4 py-3">First name</th>
                <th className="px-4 py-3">Last name</th>
                <th className="px-4 py-3">Email</th>
                <th className="px-4 py-3">Department</th>
                <th className="px-4 py-3">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="p-6">
                    Loading...
                  </td>
                </tr>
              ) : users.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6">
                    No users found.
                  </td>
                </tr>
              ) : (
                users.map((user) => (
                  <tr key={user.id} className="border-t">
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
                      {user.department_id
                        ? (departmentMap[user.department_id] ??
                          user.department_id)
                        : "—"}
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
                          onClick={() => handleDisable(user)}
                          aria-label="Disable user"
                        >
                          <Trash className="size-5 text-red-400/90" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </Card>

      <Dialog open={isCreateOpen} onOpenChange={setIsCreateOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create user</DialogTitle>
            <DialogDescription>
              Fill the details to create a new user.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreate} className="space-y-4 py-2" noValidate>
            <div className="flex flex-col gap-2">
              <Label htmlFor="first_name">First name</Label>
              <Input
                id="first_name"
                value={form.first_name}
                onChange={(e) => {
                  setForm({ ...form, first_name: e.target.value });
                  setFormErrors((curr) => ({ ...curr, first_name: undefined }));
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
                  setFormErrors((curr) => ({ ...curr, last_name: undefined }));
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
                  setFormErrors((curr) => ({ ...curr, email: undefined }));
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
              <Label htmlFor="password">Password</Label>
              <Input
                id="password"
                type="password"
                value={form.password}
                onChange={(e) => {
                  setForm({ ...form, password: e.target.value });
                  setFormErrors((curr) => ({ ...curr, password: undefined }));
                }}
                className="mt-2"
                aria-invalid={Boolean(formErrors.password)}
              />
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
                  setFormErrors((curr) => ({
                    ...curr,
                    confirm_password: undefined,
                  }));
                }}
                className="mt-2"
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
              <select
                id="department"
                value={form.department_id}
                onChange={(e) =>
                  setForm({ ...form, department_id: e.target.value })
                }
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow,border-color] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:border-sky-400 dark:focus-visible:ring-sky-400/20 mt-2"
              >
                <option value="">None</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsCreateOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Create</Button>
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
            <div className="flex flex-col gap-2">
              <Label htmlFor="edit_first_name">First name</Label>
              <Input
                id="edit_first_name"
                value={form.first_name}
                onChange={(e) => {
                  setForm({ ...form, first_name: e.target.value });
                  setFormErrors((curr) => ({ ...curr, first_name: undefined }));
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
                  setFormErrors((curr) => ({ ...curr, last_name: undefined }));
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
                  setFormErrors((curr) => ({ ...curr, email: undefined }));
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
              <select
                id="edit_department"
                value={form.department_id}
                onChange={(e) =>
                  setForm({ ...form, department_id: e.target.value })
                }
                className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow,border-color] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:border-sky-400 dark:focus-visible:ring-sky-400/20 mt-2"
              >
                <option value="">None</option>
                {departments.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            <div className="flex justify-end gap-2">
              <Button
                type="button"
                variant="ghost"
                onClick={() => setIsEditOpen(false)}
              >
                Cancel
              </Button>
              <Button type="submit">Save</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
