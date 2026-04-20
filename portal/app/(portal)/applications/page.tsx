"use client";

import axios from "axios";
import { AppWindow, ExternalLink, Loader2, Plus, X } from "lucide-react";
import {
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
  type FormEvent,
} from "react";
import { Toaster, toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api-client";

type ApplicationRecord = {
  id: number;
  name: string;
  slug: string;
  description: string;
  app_url: string;
  logo_url?: string | null;
  status: "ACTIVE" | "INACTIVE" | "MAINTENANCE";
  access_scope: "ALL_AUTHENTICATED" | "RESTRICTED";
  visibility_scope: "VISIBLE_TO_ALL" | "HIDDEN";
  department_ids?: number[];
  can_access?: boolean;
  access_reason?: string;
};

type FormState = {
  name: string;
  slug: string;
  description: string;
  app_url: string;
  status: "ACTIVE" | "INACTIVE" | "MAINTENANCE";
  access_scope: "ALL_AUTHENTICATED" | "RESTRICTED";
  visibility_scope: "VISIBLE_TO_ALL" | "HIDDEN";
  department_ids: number[];
  logoFile: File | null;
};

type FormErrors = Partial<
  Record<keyof Omit<FormState, "logoFile"> | "logoFile", string>
>;

const initialForm: FormState = {
  name: "",
  slug: "",
  description: "",
  app_url: "",
  status: "ACTIVE",
  access_scope: "RESTRICTED",
  visibility_scope: "VISIBLE_TO_ALL",
  department_ids: [],
  logoFile: null,
};

type DepartmentOption = {
  id: number;
  name: string;
  code: string;
};

type UserOption = {
  id: number;
  first_name?: string;
  last_name?: string;
  email?: string;
  is_active?: boolean;
  role_code?: string | null;
  department_id?: number | null;
};

type RoleOption = {
  id: number;
  code: string;
  has_global_access: boolean;
};

type ManageFormState = {
  name: string;
  slug: string;
  description: string;
  app_url: string;
  logo_url: string;
  status: "ACTIVE" | "INACTIVE" | "MAINTENANCE";
  visibility_scope: "VISIBLE_TO_ALL" | "HIDDEN";
  access_scope: "ALL_AUTHENTICATED" | "RESTRICTED";
  department_ids: number[];
};

type ManageTab = "edit" | "access";

type AccessOverrideEntry = {
  id: number;
  user: number;
  effect: "ALLOW" | "DENY";
  reason?: string;
  expires_at?: string | null;
};

function normalizeSlug(raw: string) {
  return raw
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9\s-]/g, "")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-");
}

function validateForm(form: FormState): FormErrors {
  const errors: FormErrors = {};
  const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  if (!form.name.trim()) {
    errors.name = "Application name is required.";
  }

  if (!form.slug.trim()) {
    errors.slug = "Slug is required.";
  } else if (!slugPattern.test(form.slug.trim())) {
    errors.slug = "Slug must use lowercase letters, numbers, and hyphens only.";
  }

  if (!form.app_url.trim()) {
    errors.app_url = "Application URL is required.";
  } else {
    try {
      const parsed = new URL(form.app_url.trim());
      if (!["http:", "https:"].includes(parsed.protocol)) {
        errors.app_url = "Application URL must start with http:// or https://.";
      }
    } catch {
      errors.app_url = "Application URL must be a valid URL.";
    }
  }

  const invalidDepartment = form.department_ids.find(
    (value) => !Number.isInteger(value) || value <= 0,
  );
  if (invalidDepartment) {
    errors.department_ids = "Departments must be valid IDs.";
  }

  if (form.access_scope === "RESTRICTED" && form.department_ids.length === 0) {
    errors.department_ids =
      "Restricted applications must include at least one department.";
  }

  if (form.logoFile) {
    if (!form.logoFile.type.startsWith("image/")) {
      errors.logoFile = "Logo must be an image file.";
    }
    const maxBytes = 5 * 1024 * 1024;
    if (form.logoFile.size > maxBytes) {
      errors.logoFile = "Logo must be 5MB or smaller.";
    }
  }

  return errors;
}

function validateCreateStepOne(form: FormState): FormErrors {
  const errors: FormErrors = {};
  const slugPattern = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

  if (!form.name.trim()) {
    errors.name = "Application name is required.";
  }

  if (!form.slug.trim()) {
    errors.slug = "Slug is required.";
  } else if (!slugPattern.test(form.slug.trim())) {
    errors.slug = "Slug must use lowercase letters, numbers, and hyphens only.";
  }

  if (!form.app_url.trim()) {
    errors.app_url = "Application URL is required.";
  } else {
    try {
      const parsed = new URL(form.app_url.trim());
      if (!["http:", "https:"].includes(parsed.protocol)) {
        errors.app_url = "Application URL must start with http:// or https://.";
      }
    } catch {
      errors.app_url = "Application URL must be a valid URL.";
    }
  }

  if (form.logoFile) {
    if (!form.logoFile.type.startsWith("image/")) {
      errors.logoFile = "Logo must be an image file.";
    }
    const maxBytes = 5 * 1024 * 1024;
    if (form.logoFile.size > maxBytes) {
      errors.logoFile = "Logo must be 5MB or smaller.";
    }
  }

  return errors;
}

function validateCreateStepTwo(form: FormState): FormErrors {
  const errors: FormErrors = {};

  const invalidDepartment = form.department_ids.find(
    (value) => !Number.isInteger(value) || value <= 0,
  );
  if (invalidDepartment) {
    errors.department_ids = "Departments must be valid IDs.";
  }

  if (form.access_scope === "RESTRICTED" && form.department_ids.length === 0) {
    errors.department_ids =
      "Restricted applications must include at least one department.";
  }

  return errors;
}

function errorMessage(error: unknown, fallback: string) {
  if (axios.isAxiosError(error)) {
    const detail = error.response?.data?.detail;
    if (typeof detail === "string" && detail.trim()) {
      return detail;
    }
  }
  return fallback;
}

function sortedNumberList(values: number[]) {
  return [...values].sort((a, b) => a - b);
}

function sameNumberList(a: number[], b: number[]) {
  const left = sortedNumberList(a);
  const right = sortedNumberList(b);
  if (left.length !== right.length) {
    return false;
  }
  return left.every((value, index) => value === right[index]);
}

export default function ApplicationsPage() {
  const [applications, setApplications] = useState<ApplicationRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [departments, setDepartments] = useState<DepartmentOption[]>([]);
  const [users, setUsers] = useState<UserOption[]>([]);
  const [roles, setRoles] = useState<RoleOption[]>([]);

  const [isAdmin, setIsAdmin] = useState(false);
  const [hasGlobalAccess, setHasGlobalAccess] = useState(false);
  const [isPermissionsReady, setIsPermissionsReady] = useState(false);
  const [searchInput, setSearchInput] = useState("");
  const [searchQuery, setSearchQuery] = useState("");
  const [userVisibilityFilter, setUserVisibilityFilter] = useState<
    "all" | "accessible"
  >("all");
  const [selectedDepartmentFilterIds, setSelectedDepartmentFilterIds] =
    useState<number[]>([]);
  const [isCreateOpen, setIsCreateOpen] = useState(false);
  const [createStep, setCreateStep] = useState<1 | 2>(1);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [isManageOpen, setIsManageOpen] = useState(false);
  const [manageTab, setManageTab] = useState<ManageTab>("edit");
  const [manageTarget, setManageTarget] = useState<ApplicationRecord | null>(
    null,
  );
  const [isSavingManage, setIsSavingManage] = useState(false);
  const [isGrantingAccess, setIsGrantingAccess] = useState(false);
  const [isRevokingAccess, setIsRevokingAccess] = useState(false);
  const [isLoadingOverrides, setIsLoadingOverrides] = useState(false);
  const [manageFormErrors, setManageFormErrors] = useState<FormErrors>({});
  const [manageForm, setManageForm] = useState<ManageFormState | null>(null);
  const [manageLogoFile, setManageLogoFile] = useState<File | null>(null);
  const [isManageLogoDragging, setIsManageLogoDragging] = useState(false);
  const [manageLogoPreviewUrl, setManageLogoPreviewUrl] = useState<
    string | null
  >(null);
  const [createLogoPreviewUrl, setCreateLogoPreviewUrl] = useState<
    string | null
  >(null);
  const [overrideUserId, setOverrideUserId] = useState<string>("");
  const [overrideReason, setOverrideReason] = useState<string>("");
  const [denyUserId, setDenyUserId] = useState<string>("");
  const [denyReason, setDenyReason] = useState<string>("");
  const [overridesByApp, setOverridesByApp] = useState<
    Record<number, AccessOverrideEntry[]>
  >({});
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [formErrors, setFormErrors] = useState<FormErrors>({});
  const [form, setForm] = useState<FormState>(initialForm);
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const manageFileInputRef = useRef<HTMLInputElement | null>(null);
  const [isLogoDragging, setIsLogoDragging] = useState(false);
  const [openingApplicationId, setOpeningApplicationId] = useState<
    number | null
  >(null);
  const [deniedFeedbackIds, setDeniedFeedbackIds] = useState<number[]>([]);

  useEffect(() => {
    async function loadPermissionsAndContext() {
      try {
        const permissionsResponse = await apiClient.get("/me/permissions");
        const roleCode = String(permissionsResponse.data?.role_code ?? "");
        const globalAccess = Boolean(
          permissionsResponse.data?.has_global_access,
        );
        setHasGlobalAccess(globalAccess);

        const admin =
          Boolean(permissionsResponse.data?.is_superuser) ||
          roleCode.toUpperCase() === "ADMIN";
        setIsAdmin(admin);

        if (globalAccess) {
          const departmentsResponse = await apiClient.get(
            "/organization/departments",
          );
          setDepartments(departmentsResponse.data as DepartmentOption[]);
        }

        if (admin) {
          const [usersResponse, rolesResponse] = await Promise.all([
            apiClient.get("/admin/users"),
            apiClient.get("/organization/roles"),
          ]);
          setUsers(usersResponse.data as UserOption[]);
          setRoles(rolesResponse.data as RoleOption[]);
        }
      } catch (error) {
        toast.error(errorMessage(error, "Failed to load user context."));
      } finally {
        setIsPermissionsReady(true);
      }
    }

    void loadPermissionsAndContext();
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setSearchQuery(searchInput.trim());
    }, 300);

    return () => {
      window.clearTimeout(timeout);
    };
  }, [searchInput]);

  useEffect(() => {
    if (!isPermissionsReady) {
      return;
    }

    async function loadApplications() {
      try {
        setIsLoading(true);

        const params: Record<string, string> = {};
        if (searchQuery) {
          params.q = searchQuery;
        }

        if (hasGlobalAccess) {
          if (selectedDepartmentFilterIds.length > 0) {
            params.department_ids = selectedDepartmentFilterIds.join(",");
          }
        } else if (userVisibilityFilter === "accessible") {
          params.accessible = "true";
        }

        const response = await apiClient.get("/applications", { params });
        setApplications(response.data as ApplicationRecord[]);
      } catch (error) {
        toast.error(errorMessage(error, "Failed to load applications."));
      } finally {
        setIsLoading(false);
      }
    }

    void loadApplications();
  }, [
    hasGlobalAccess,
    isPermissionsReady,
    searchQuery,
    selectedDepartmentFilterIds,
    userVisibilityFilter,
  ]);

  const activeFilterCount = useMemo(() => {
    if (hasGlobalAccess) {
      return selectedDepartmentFilterIds.length;
    }

    return userVisibilityFilter === "accessible" ? 1 : 0;
  }, [hasGlobalAccess, selectedDepartmentFilterIds, userVisibilityFilter]);

  const logoFileLabel = useMemo(
    () => form.logoFile?.name ?? "No logo selected",
    [form.logoFile],
  );

  const manageLogoFileLabel = useMemo(
    () => manageLogoFile?.name ?? "No new logo selected",
    [manageLogoFile],
  );

  useEffect(() => {
    if (!manageLogoFile) {
      setManageLogoPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(manageLogoFile);
    setManageLogoPreviewUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [manageLogoFile]);

  useEffect(() => {
    if (!form.logoFile) {
      setCreateLogoPreviewUrl(null);
      return;
    }

    const objectUrl = URL.createObjectURL(form.logoFile);
    setCreateLogoPreviewUrl(objectUrl);
    return () => {
      URL.revokeObjectURL(objectUrl);
    };
  }, [form.logoFile]);

  const selectedDepartmentsLabel = useMemo(() => {
    if (form.department_ids.length === 0) {
      return "No departments selected";
    }

    return departments
      .filter((department) => form.department_ids.includes(department.id))
      .map((department) => `${department.name} (${department.code})`)
      .join(", ");
  }, [departments, form.department_ids]);

  const availableOverrideUsers = useMemo(() => {
    if (!manageTarget || !manageForm) {
      return [];
    }

    const appOverrides = overridesByApp[manageTarget.id] ?? [];
    const overrideEffectByUser = new Map<number, "ALLOW" | "DENY">();
    for (const item of appOverrides) {
      overrideEffectByUser.set(item.user, item.effect);
    }

    const appDepartmentIds = new Set(manageForm.department_ids ?? []);

    const hasAccess = (user: UserOption) => {
      const roleHasGlobalAccess = roles.some(
        (role) => role.code === user.role_code && role.has_global_access,
      );
      if (roleHasGlobalAccess) {
        return true;
      }

      const effect = overrideEffectByUser.get(user.id);
      if (effect === "DENY") {
        return false;
      }
      if (effect === "ALLOW") {
        return true;
      }

      if (manageForm.access_scope === "ALL_AUTHENTICATED") {
        return true;
      }

      const departmentId = user.department_id ?? null;
      return Boolean(departmentId && appDepartmentIds.has(departmentId));
    };

    return users.filter((user) => user.is_active && !hasAccess(user));
  }, [manageForm, manageTarget, overridesByApp, roles, users]);

  const removableAccessUsers = useMemo(() => {
    if (!manageTarget || !manageForm) {
      return [];
    }

    const appOverrides = overridesByApp[manageTarget.id] ?? [];
    const overrideEffectByUser = new Map<number, "ALLOW" | "DENY">();
    for (const item of appOverrides) {
      overrideEffectByUser.set(item.user, item.effect);
    }

    const appDepartmentIds = new Set(manageForm.department_ids ?? []);

    const hasAccess = (user: UserOption) => {
      const roleHasGlobalAccess = roles.some(
        (role) => role.code === user.role_code && role.has_global_access,
      );
      if (roleHasGlobalAccess) {
        return true;
      }

      const effect = overrideEffectByUser.get(user.id);
      if (effect === "DENY") {
        return false;
      }
      if (effect === "ALLOW") {
        return true;
      }

      if (manageForm.access_scope === "ALL_AUTHENTICATED") {
        return true;
      }

      const departmentId = user.department_id ?? null;
      return Boolean(departmentId && appDepartmentIds.has(departmentId));
    };

    return users.filter((user) => {
      if (!user.is_active) {
        return false;
      }

      const roleHasGlobalAccess = roles.some(
        (role) => role.code === user.role_code && role.has_global_access,
      );
      if (roleHasGlobalAccess) {
        return false;
      }

      return hasAccess(user);
    });
  }, [manageForm, manageTarget, overridesByApp, roles, users]);

  function handleInputChange(
    event: ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) {
    const { name, value } = event.target;

    if (name === "name") {
      setForm((current) => ({
        ...current,
        name: value,
        slug: current.slug || normalizeSlug(value),
      }));
    } else if (name === "slug") {
      setForm((current) => ({ ...current, slug: normalizeSlug(value) }));
    } else {
      setForm((current) => ({ ...current, [name]: value }));
    }

    setFormErrors((current) => ({ ...current, [name]: undefined }));
  }

  function toggleDepartment(departmentId: number) {
    setForm((current) => {
      const exists = current.department_ids.includes(departmentId);
      return {
        ...current,
        department_ids: exists
          ? current.department_ids.filter((value) => value !== departmentId)
          : [...current.department_ids, departmentId],
      };
    });
    setFormErrors((current) => ({ ...current, department_ids: undefined }));
  }

  function toggleDepartmentFilter(departmentId: number) {
    setSelectedDepartmentFilterIds((current) => {
      if (current.includes(departmentId)) {
        return current.filter((id) => id !== departmentId);
      }
      return [...current, departmentId];
    });
  }

  function handleLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setForm((current) => ({ ...current, logoFile: file }));
    setFormErrors((current) => ({ ...current, logoFile: undefined }));
    setIsLogoDragging(false);
  }

  function openFilePicker() {
    fileInputRef.current?.click();
  }

  function handleLogoDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsLogoDragging(false);

    const file = event.dataTransfer.files?.[0] ?? null;
    if (!file) {
      return;
    }

    setForm((current) => ({ ...current, logoFile: file }));
    setFormErrors((current) => ({ ...current, logoFile: undefined }));
  }

  async function uploadLogoAndGetPublicUrl(slug: string, file: File) {
    const signedResponse = await apiClient.post(
      "/admin/applications/logo-upload-url",
      {
        slug,
        file_name: file.name,
        content_type: file.type,
      },
    );

    const uploadUrl = signedResponse.data?.upload_url as string | undefined;
    const publicUrl = signedResponse.data?.public_url as string | undefined;

    if (!uploadUrl || !publicUrl) {
      throw new Error("Signed URL response is incomplete.");
    }

    await axios.put(uploadUrl, file, {
      headers: {
        "Content-Type": file.type,
      },
      onUploadProgress: (progressEvent) => {
        const total = progressEvent.total ?? file.size;
        if (!total) {
          return;
        }
        const next = Math.min(
          100,
          Math.round((progressEvent.loaded / total) * 100),
        );
        setUploadProgress(next);
      },
    });

    setUploadProgress(100);
    return publicUrl;
  }

  async function handleCreateApplication(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();

    const errors = {
      ...validateCreateStepOne(form),
      ...validateCreateStepTwo(form),
    };
    setFormErrors(errors);
    if (Object.keys(errors).length > 0) {
      return;
    }

    try {
      setIsSubmitting(true);
      setUploadProgress(null);

      let logoUrl: string | null = null;
      if (form.logoFile) {
        setUploadProgress(0);
        logoUrl = await uploadLogoAndGetPublicUrl(
          form.slug.trim(),
          form.logoFile,
        );
      }

      const response = await apiClient.post("/admin/applications", {
        name: form.name.trim(),
        slug: form.slug.trim(),
        description: form.description.trim(),
        app_url: form.app_url.trim(),
        logo_url: logoUrl,
        status: form.status,
        access_scope: form.access_scope,
        visibility_scope: form.visibility_scope,
        department_ids: form.department_ids,
      });

      const created = response.data as ApplicationRecord;
      setApplications((current) =>
        [...current, created].sort((a, b) => a.name.localeCompare(b.name)),
      );

      setForm(initialForm);
      setFormErrors({});
      setIsCreateOpen(false);
      setCreateStep(1);
      toast.success("Application created successfully.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to create application."));
    } finally {
      setIsSubmitting(false);
      setUploadProgress(null);
    }
  }

  function handleNextCreateStep() {
    const stepOneErrors = validateCreateStepOne(form);
    setFormErrors(stepOneErrors);
    if (Object.keys(stepOneErrors).length > 0) {
      toast.error("Please fix the errors before proceeding.");
      return;
    }
    setCreateStep(2);
  }

  function triggerDeniedFeedback(applicationId: number) {
    setDeniedFeedbackIds((current) => {
      if (current.includes(applicationId)) {
        return current;
      }
      return [...current, applicationId];
    });

    window.setTimeout(() => {
      setDeniedFeedbackIds((current) =>
        current.filter((value) => value !== applicationId),
      );
    }, 800);
  }

  async function handleOpenApplication(
    event: React.MouseEvent<HTMLAnchorElement>,
    application: ApplicationRecord,
  ) {
    event.preventDefault();

    const canAccess = application.can_access !== false;
    if (!canAccess) {
      triggerDeniedFeedback(application.id);
      toast.error(
        "You do not have access to this application. If this was a mistake, contact admin",
      );
      return;
    }

    try {
      setOpeningApplicationId(application.id);
      const response = await apiClient.post(
        `/applications/${application.id}/open`,
      );
      const targetUrl =
        (response.data?.url as string | undefined) ?? application.app_url;
      window.open(targetUrl, "_blank", "noopener,noreferrer");
    } catch (error) {
      if (axios.isAxiosError(error) && error.response?.status === 403) {
        triggerDeniedFeedback(application.id);
        toast.error(
          "You do not have access to this application. If this was a mistake, contact admin",
        );
        return;
      }

      toast.error(errorMessage(error, "Failed to open application."));
    } finally {
      setOpeningApplicationId((current) =>
        current === application.id ? null : current,
      );
    }
  }

  function buildManageForm(application: ApplicationRecord): ManageFormState {
    return {
      name: application.name,
      slug: application.slug,
      description: application.description ?? "",
      app_url: application.app_url,
      logo_url: application.logo_url ?? "",
      status: application.status,
      visibility_scope: application.visibility_scope,
      access_scope: application.access_scope,
      department_ids: [...(application.department_ids ?? [])],
    };
  }

  async function openManageModal(application: ApplicationRecord) {
    setManageTarget(application);
    setManageForm(buildManageForm(application));
    setManageLogoFile(null);
    setManageFormErrors({});
    setOverrideUserId("");
    setOverrideReason("");
    setDenyUserId("");
    setDenyReason("");
    setManageTab("edit");
    setIsManageOpen(true);

    try {
      setIsLoadingOverrides(true);
      const response = await apiClient.get(
        `/admin/applications/${application.id}/overrides`,
      );
      setOverridesByApp((current) => ({
        ...current,
        [application.id]: response.data as AccessOverrideEntry[],
      }));
    } catch (error) {
      toast.error(errorMessage(error, "Failed to load access overrides."));
    } finally {
      setIsLoadingOverrides(false);
    }
  }

  function closeManageModal() {
    if (isSavingManage || isGrantingAccess || isRevokingAccess) {
      return;
    }
    setIsManageOpen(false);
    setManageTarget(null);
    setManageForm(null);
    setManageLogoFile(null);
    setManageFormErrors({});
    setOverrideUserId("");
    setOverrideReason("");
    setDenyUserId("");
    setDenyReason("");
  }

  function handleManageLogoChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0] ?? null;
    setManageLogoFile(file);
    setIsManageLogoDragging(false);
    setManageFormErrors((current) => ({ ...current, logoFile: undefined }));
  }

  function openManageFilePicker() {
    manageFileInputRef.current?.click();
  }

  function handleManageLogoDrop(event: React.DragEvent<HTMLDivElement>) {
    event.preventDefault();
    event.stopPropagation();
    setIsManageLogoDragging(false);

    const file = event.dataTransfer.files?.[0] ?? null;
    if (!file) {
      return;
    }

    setManageLogoFile(file);
    setManageFormErrors((current) => ({ ...current, logoFile: undefined }));
  }

  function handleManageInputChange(
    event: ChangeEvent<
      HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement
    >,
  ) {
    if (!manageForm) {
      return;
    }

    const { name, value } = event.target;
    if (name === "name") {
      setManageForm((current) => {
        if (!current) {
          return current;
        }
        return {
          ...current,
          name: value,
          slug: current.slug || normalizeSlug(value),
        };
      });
    } else if (name === "slug") {
      setManageForm((current) =>
        current ? { ...current, slug: normalizeSlug(value) } : current,
      );
    } else {
      setManageForm((current) =>
        current ? { ...current, [name]: value } : current,
      );
    }

    setManageFormErrors((current) => ({ ...current, [name]: undefined }));
  }

  function toggleManageDepartment(departmentId: number) {
    setManageForm((current) => {
      if (!current) {
        return current;
      }

      const exists = current.department_ids.includes(departmentId);
      return {
        ...current,
        department_ids: exists
          ? current.department_ids.filter((value) => value !== departmentId)
          : [...current.department_ids, departmentId],
      };
    });

    setManageFormErrors((current) => ({
      ...current,
      department_ids: undefined,
    }));
  }

  async function saveManageChanges(section: ManageTab) {
    if (!manageTarget || !manageForm) {
      return;
    }

    const hasEditChanges =
      manageForm.name.trim() !== manageTarget.name ||
      manageForm.slug.trim() !== manageTarget.slug ||
      manageForm.description.trim() !== (manageTarget.description ?? "") ||
      manageForm.app_url.trim() !== manageTarget.app_url ||
      manageForm.status !== manageTarget.status ||
      manageForm.visibility_scope !== manageTarget.visibility_scope ||
      Boolean(manageLogoFile);

    const hasAccessChanges =
      manageForm.access_scope !== manageTarget.access_scope ||
      !sameNumberList(
        manageForm.department_ids,
        manageTarget.department_ids ?? [],
      );

    if (section === "edit" && !hasEditChanges) {
      toast.info("No changes detected.");
      return;
    }

    if (section === "access" && !hasAccessChanges) {
      toast.info("No changes detected.");
      return;
    }

    const validationErrors = validateForm({
      ...manageForm,
      logoFile: null,
    });
    setManageFormErrors(validationErrors);
    if (Object.keys(validationErrors).length > 0) {
      toast.error("Please fix validation errors before saving.");
      return;
    }

    if (section === "access" && manageForm.access_scope === "RESTRICTED") {
      if (manageForm.department_ids.length === 0) {
        setManageFormErrors((current) => ({
          ...current,
          department_ids:
            "Restricted applications must include at least one department.",
        }));
        toast.error("Restricted applications require at least one department.");
        return;
      }
    }

    try {
      setIsSavingManage(true);

      let nextLogoUrl = manageForm.logo_url.trim() || null;
      if (section === "edit" && manageLogoFile) {
        if (!manageLogoFile.type.startsWith("image/")) {
          setManageFormErrors((current) => ({
            ...current,
            logoFile: "Logo must be an image file.",
          }));
          toast.error("Logo must be an image file.");
          return;
        }

        const maxBytes = 5 * 1024 * 1024;
        if (manageLogoFile.size > maxBytes) {
          setManageFormErrors((current) => ({
            ...current,
            logoFile: "Logo must be 5MB or smaller.",
          }));
          toast.error("Logo must be 5MB or smaller.");
          return;
        }

        nextLogoUrl = await uploadLogoAndGetPublicUrl(
          manageForm.slug.trim(),
          manageLogoFile,
        );
      }

      const response = await apiClient.patch(
        `/admin/applications/${manageTarget.id}`,
        {
          name: manageForm.name.trim(),
          slug: manageForm.slug.trim(),
          description: manageForm.description.trim(),
          app_url: manageForm.app_url.trim(),
          logo_url: nextLogoUrl,
          status: manageForm.status,
          visibility_scope: manageForm.visibility_scope,
          access_scope: manageForm.access_scope,
          department_ids: manageForm.department_ids,
        },
      );

      const updated = response.data as ApplicationRecord;
      setApplications((current) =>
        current.map((app) => (app.id === updated.id ? updated : app)),
      );
      setManageTarget(updated);
      setManageForm(buildManageForm(updated));
      setManageLogoFile(null);
      toast.success(
        section === "edit"
          ? "Application details updated."
          : "Application access updated.",
      );
    } catch (error) {
      toast.error(errorMessage(error, "Failed to update application."));
    } finally {
      setIsSavingManage(false);
    }
  }

  async function handleGrantAccessOverride() {
    if (!manageTarget) {
      return;
    }

    const userId = Number(overrideUserId);
    if (!userId) {
      toast.error("Select a user to grant access.");
      return;
    }

    try {
      setIsGrantingAccess(true);
      const response = await apiClient.post(
        `/admin/applications/${manageTarget.id}/overrides`,
        {
          user_id: userId,
          effect: "ALLOW",
          reason: overrideReason.trim(),
        },
      );

      const upserted = response.data as AccessOverrideEntry;
      setOverridesByApp((current) => {
        const existing = current[manageTarget.id] ?? [];
        const withoutSameUser = existing.filter(
          (item) => item.user !== upserted.user,
        );
        return {
          ...current,
          [manageTarget.id]: [upserted, ...withoutSameUser],
        };
      });

      setOverrideUserId("");
      setOverrideReason("");
      toast.success("Access override granted.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to grant access override."));
    } finally {
      setIsGrantingAccess(false);
    }
  }

  async function handleDenyAccessOverride() {
    if (!manageTarget) {
      return;
    }

    const userId = Number(denyUserId);
    if (!userId) {
      toast.error("Select a user to remove access from.");
      return;
    }

    try {
      setIsRevokingAccess(true);
      const response = await apiClient.post(
        `/admin/applications/${manageTarget.id}/overrides`,
        {
          user_id: userId,
          effect: "DENY",
          reason: denyReason.trim(),
        },
      );

      const upserted = response.data as AccessOverrideEntry;
      setOverridesByApp((current) => {
        const existing = current[manageTarget.id] ?? [];
        const withoutSameUser = existing.filter(
          (item) => item.user !== upserted.user,
        );
        return {
          ...current,
          [manageTarget.id]: [upserted, ...withoutSameUser],
        };
      });

      setDenyUserId("");
      setDenyReason("");
      toast.success("Access removed for selected user.");
    } catch (error) {
      toast.error(errorMessage(error, "Failed to remove user access."));
    } finally {
      setIsRevokingAccess(false);
    }
  }

  return (
    <div className="w-full">
      <Toaster richColors position="top-right" />

      <div className="mx-auto mb-4 w-full max-w-2xl">
        <Input
          id="applications-search"
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          placeholder="Search by name..."
          className="h-11 rounded-full px-5 text-base"
        />
      </div>

      <div className="mb-2 flex items-center justify-center">
        <span className="rounded-full border border-border bg-muted px-3 py-1 text-xs font-medium text-muted-foreground dark:border-slate-700 dark:bg-slate-900 dark:text-slate-300">
          {activeFilterCount} filter{activeFilterCount === 1 ? "" : "s"} active
        </span>
      </div>

      <div className="mb-6 flex flex-wrap items-center justify-center gap-2">
        {hasGlobalAccess ? (
          <>
            <Button
              type="button"
              variant={
                selectedDepartmentFilterIds.length === 0 ? "default" : "outline"
              }
              className="rounded-full"
              onClick={() => setSelectedDepartmentFilterIds([])}
            >
              All Departments
            </Button>
            {departments.map((department) => {
              const isActive = selectedDepartmentFilterIds.includes(
                department.id,
              );
              return (
                <Button
                  key={department.id}
                  type="button"
                  variant={isActive ? "default" : "outline"}
                  className="rounded-full"
                  onClick={() => toggleDepartmentFilter(department.id)}
                >
                  {department.name}
                </Button>
              );
            })}
          </>
        ) : (
          <>
            <Button
              type="button"
              variant={userVisibilityFilter === "all" ? "default" : "outline"}
              className="rounded-full"
              onClick={() => setUserVisibilityFilter("all")}
            >
              All Applications
            </Button>
            <Button
              type="button"
              variant={
                userVisibilityFilter === "accessible" ? "default" : "outline"
              }
              className="rounded-full"
              onClick={() => setUserVisibilityFilter("accessible")}
            >
              My Accessible
            </Button>
          </>
        )}
      </div>

      {isAdmin ? (
        <div className="mb-6 flex justify-end">
          <Button
            type="button"
            onClick={() => {
              setIsCreateOpen(true);
              setCreateStep(1);
              setFormErrors({});
            }}
          >
            <Plus className="mr-2 size-4" aria-hidden="true" />
            Create New Application
          </Button>
        </div>
      ) : null}

      {isCreateOpen ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4 py-8">
          <button
            type="button"
            className="absolute inset-0 bg-foreground/35 backdrop-blur-[1px]"
            onClick={() => {
              if (isSubmitting) {
                return;
              }
              setIsCreateOpen(false);
              setCreateStep(1);
              setFormErrors({});
            }}
            aria-label="Close create application form"
          />

          <Card className="relative z-50 max-h-[90vh] w-full max-w-3xl overflow-y-auto border-border bg-card p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Create Application
                </h2>
                <p className="text-sm text-muted-foreground">
                  Create a new application
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={() => {
                  if (isSubmitting) {
                    return;
                  }
                  setIsCreateOpen(false);
                  setCreateStep(1);
                  setFormErrors({});
                }}
                aria-label="Close modal"
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>

            <form
              className="grid gap-6"
              onSubmit={handleCreateApplication}
              noValidate
            >
              <div className="flex items-center gap-2">
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    createStep === 1
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  Step 1: Application Details
                </span>
                <span
                  className={`rounded-full px-3 py-1 text-xs font-semibold ${
                    createStep === 2
                      ? "bg-primary text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  Step 2: Access Control
                </span>
              </div>

              {createStep === 1 ? (
                <>
                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="name">Application Name</Label>
                      <Input
                        id="name"
                        name="name"
                        value={form.name}
                        onChange={handleInputChange}
                        aria-invalid={Boolean(formErrors.name)}
                      />
                      {formErrors.name ? (
                        <p className="text-xs text-destructive">
                          {formErrors.name}
                        </p>
                      ) : null}
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="slug">Slug</Label>
                      <Input
                        id="slug"
                        name="slug"
                        value={form.slug}
                        onChange={handleInputChange}
                        placeholder="finance-tool"
                        aria-invalid={Boolean(formErrors.slug)}
                      />
                      {formErrors.slug ? (
                        <p className="text-xs text-destructive">
                          {formErrors.slug}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="description">Description</Label>
                    <textarea
                      id="description"
                      name="description"
                      value={form.description}
                      onChange={handleInputChange}
                      rows={3}
                      className="w-full rounded-md border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      placeholder="Short description of the application"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="logoFile">Logo</Label>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="rounded-lg border border-border bg-background p-3 dark:border-slate-700 dark:bg-slate-900">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Selected Preview
                        </p>
                        {createLogoPreviewUrl ? (
                          <img
                            src={createLogoPreviewUrl}
                            alt="Selected logo preview"
                            className="h-24 w-full rounded-md border border-border object-contain p-2 dark:border-slate-700"
                          />
                        ) : (
                          <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground dark:border-slate-700">
                            Upload a logo to preview it here
                          </div>
                        )}
                      </div>

                      <div className="rounded-lg border border-border bg-background p-3 dark:border-slate-700 dark:bg-slate-900">
                        <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          File Info
                        </p>
                        <p className="text-sm font-medium text-foreground">
                          {logoFileLabel}
                        </p>
                        <p className="mt-2 text-xs text-muted-foreground">
                          Choose a PNG, JPG, or WebP file. The image will be
                          uploaded before the application is created.
                        </p>
                      </div>
                    </div>

                    <div
                      className={`rounded-xl border border-dashed px-4 py-5 transition-colors ${
                        isLogoDragging
                          ? "border-primary bg-primary/5"
                          : "border-border bg-background dark:border-slate-700 dark:bg-slate-900"
                      }`}
                      onDragEnter={(event) => {
                        event.preventDefault();
                        setIsLogoDragging(true);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        setIsLogoDragging(true);
                      }}
                      onDragLeave={() => setIsLogoDragging(false)}
                      onDrop={handleLogoDrop}
                      role="presentation"
                    >
                      <input
                        ref={fileInputRef}
                        id="logoFile"
                        name="logoFile"
                        type="file"
                        accept="image/*"
                        onChange={handleLogoChange}
                        className="hidden"
                        aria-invalid={Boolean(formErrors.logoFile)}
                      />

                      <button
                        type="button"
                        onClick={openFilePicker}
                        className="flex w-full flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-foreground shadow-sm transition-colors hover:bg-muted/60 dark:border-slate-700 dark:bg-slate-950/60 dark:hover:bg-slate-800/70"
                      >
                        <AppWindow
                          className="size-6 text-muted-foreground"
                          aria-hidden="true"
                        />
                        <span className="font-medium">
                          Drag and drop a logo here
                        </span>
                        <span className="text-xs text-muted-foreground">
                          or click to choose a file
                        </span>
                      </button>

                      <p className="mt-3 text-xs text-muted-foreground">
                        {logoFileLabel}
                      </p>
                      {formErrors.logoFile ? (
                        <p className="mt-1 text-xs text-destructive">
                          {formErrors.logoFile}
                        </p>
                      ) : null}
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="app_url">Application URL</Label>
                    <Input
                      id="app_url"
                      name="app_url"
                      value={form.app_url}
                      onChange={handleInputChange}
                      placeholder="https://example.com/application"
                      aria-invalid={Boolean(formErrors.app_url)}
                    />
                    {formErrors.app_url ? (
                      <p className="text-xs text-destructive">
                        {formErrors.app_url}
                      </p>
                    ) : null}
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="space-y-2">
                      <Label htmlFor="status">Status</Label>
                      <select
                        id="status"
                        name="status"
                        value={form.status}
                        onChange={handleInputChange}
                        className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow,border-color] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:border-sky-400 dark:focus-visible:ring-sky-400/20"
                      >
                        <option value="ACTIVE">Active</option>
                        <option value="INACTIVE">Inactive</option>
                        <option value="MAINTENANCE">Maintenance</option>
                      </select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="visibility_scope">Visibility Scope</Label>
                      <select
                        id="visibility_scope"
                        name="visibility_scope"
                        value={form.visibility_scope}
                        onChange={handleInputChange}
                        className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow,border-color] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:border-sky-400 dark:focus-visible:ring-sky-400/20"
                      >
                        <option value="VISIBLE_TO_ALL">Visible To All</option>
                        <option value="HIDDEN">Hidden</option>
                      </select>
                    </div>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-2">
                    <Label htmlFor="access_scope">Access Scope</Label>
                    <select
                      id="access_scope"
                      name="access_scope"
                      value={form.access_scope}
                      onChange={handleInputChange}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow,border-color] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:border-sky-400 dark:focus-visible:ring-sky-400/20"
                    >
                      <option value="RESTRICTED">Restricted</option>
                      <option value="ALL_AUTHENTICATED">
                        All Authenticated
                      </option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label>
                      Departments (Select all departments that should have
                      access to this application)
                    </Label>
                    <div className="grid gap-2 rounded-md border border-border bg-background p-3 shadow-sm sm:grid-cols-2 xl:grid-cols-3 dark:border-slate-700 dark:bg-slate-900">
                      {departments.length === 0 ? (
                        <p className="text-xs text-muted-foreground">
                          No departments available.
                        </p>
                      ) : (
                        departments.map((department) => {
                          const checked = form.department_ids.includes(
                            department.id,
                          );
                          return (
                            <label
                              key={department.id}
                              className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted/70 dark:border-slate-700 dark:hover:bg-slate-800/80"
                            >
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => toggleDepartment(department.id)}
                                className="size-4 rounded border-input accent-primary"
                              />
                              <span className="flex-1">{department.name}</span>
                            </label>
                          );
                        })
                      )}
                    </div>
                    <p className="text-xs text-muted-foreground">
                      {selectedDepartmentsLabel}
                    </p>
                    {formErrors.department_ids ? (
                      <p className="text-xs text-destructive">
                        {formErrors.department_ids}
                      </p>
                    ) : (
                      <p className="text-xs text-muted-foreground">
                        Required when access scope is set to Restricted.
                      </p>
                    )}
                  </div>
                </>
              )}

              {uploadProgress !== null ? (
                <div className="space-y-1">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Uploading logo</span>
                    <span>{uploadProgress}%</span>
                  </div>
                  <div className="h-2 w-full rounded-full bg-muted">
                    <div
                      className="h-2 rounded-full bg-primary transition-all duration-200"
                      style={{ width: `${uploadProgress}%` }}
                    />
                  </div>
                </div>
              ) : null}

              <div className="flex flex-wrap items-center justify-end gap-3">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setIsCreateOpen(false);
                    setCreateStep(1);
                    setFormErrors({});
                  }}
                  disabled={isSubmitting}
                >
                  Cancel
                </Button>

                {createStep === 1 ? (
                  <Button
                    type="button"
                    onClick={handleNextCreateStep}
                    disabled={isSubmitting}
                  >
                    Next
                  </Button>
                ) : (
                  <>
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => setCreateStep(1)}
                      disabled={isSubmitting}
                    >
                      Back
                    </Button>
                    <Button type="submit" disabled={isSubmitting}>
                      {isSubmitting ? (
                        <>
                          <Loader2
                            className="mr-2 size-4 animate-spin"
                            aria-hidden="true"
                          />
                          {uploadProgress !== null
                            ? `Uploading ${uploadProgress}%...`
                            : "Creating..."}
                        </>
                      ) : (
                        "Create Application"
                      )}
                    </Button>
                  </>
                )}
              </div>
            </form>
          </Card>
        </div>
      ) : null}

      {isManageOpen && manageTarget && manageForm ? (
        <div className="fixed inset-0 z-40 flex items-center justify-center px-4 py-8">
          <button
            type="button"
            className="absolute inset-0 bg-foreground/35 backdrop-blur-[1px]"
            onClick={closeManageModal}
            aria-label="Close manage application modal"
          />

          <Card className="relative z-50 max-h-[90vh] w-full max-w-4xl overflow-y-auto border-border bg-card p-5 shadow-xl">
            <div className="mb-4 flex items-center justify-between">
              <div>
                <h2 className="text-lg font-semibold text-foreground">
                  Manage {manageTarget.name}
                </h2>
                <p className="text-sm text-muted-foreground">
                  Edit details and manage access controls.
                </p>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                onClick={closeManageModal}
                aria-label="Close modal"
              >
                <X className="size-4" aria-hidden="true" />
              </Button>
            </div>

            <div className="mb-5 flex flex-wrap items-center gap-2">
              <Button
                type="button"
                variant={manageTab === "edit" ? "default" : "outline"}
                onClick={() => setManageTab("edit")}
                className="h-8 rounded-full px-3 text-xs"
              >
                Edit
              </Button>
              <Button
                type="button"
                variant={manageTab === "access" ? "default" : "outline"}
                onClick={() => setManageTab("access")}
                className="h-8 rounded-full px-3 text-xs"
              >
                Access Control
              </Button>
            </div>

            {manageTab === "edit" ? (
              <form
                className="grid gap-6"
                onSubmit={(event) => {
                  event.preventDefault();
                  void saveManageChanges("edit");
                }}
                noValidate
              >
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="manage-name">Application Name</Label>
                    <Input
                      id="manage-name"
                      name="name"
                      value={manageForm.name}
                      onChange={handleManageInputChange}
                      aria-invalid={Boolean(manageFormErrors.name)}
                    />
                    {manageFormErrors.name ? (
                      <p className="text-xs text-destructive">
                        {manageFormErrors.name}
                      </p>
                    ) : null}
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="manage-slug">Slug</Label>
                    <Input
                      id="manage-slug"
                      name="slug"
                      value={manageForm.slug}
                      onChange={handleManageInputChange}
                      aria-invalid={Boolean(manageFormErrors.slug)}
                    />
                    {manageFormErrors.slug ? (
                      <p className="text-xs text-destructive">
                        {manageFormErrors.slug}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="space-y-2">
                  <Label htmlFor="manage-description">Description</Label>
                  <textarea
                    id="manage-description"
                    name="description"
                    value={manageForm.description}
                    onChange={handleManageInputChange}
                    rows={3}
                    className="w-full rounded-md border border-input bg-transparent px-2.5 py-2 text-sm text-foreground outline-none transition-[color,box-shadow] placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="manage-app-url">Application URL</Label>
                  <Input
                    id="manage-app-url"
                    name="app_url"
                    value={manageForm.app_url}
                    onChange={handleManageInputChange}
                    aria-invalid={Boolean(manageFormErrors.app_url)}
                  />
                  {manageFormErrors.app_url ? (
                    <p className="text-xs text-destructive">
                      {manageFormErrors.app_url}
                    </p>
                  ) : null}
                </div>

                <div className="space-y-3">
                  <Label htmlFor="manage-logo-file">Change Logo</Label>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="rounded-lg border border-border bg-background p-3 dark:border-slate-700 dark:bg-slate-900">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Current Logo
                      </p>
                      {manageTarget.logo_url ? (
                        <img
                          src={manageTarget.logo_url}
                          alt={`${manageTarget.name} current logo`}
                          className="h-24 w-full rounded-md border border-border object-contain p-2 dark:border-slate-700"
                        />
                      ) : (
                        <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground dark:border-slate-700">
                          No current logo
                        </div>
                      )}
                    </div>

                    <div className="rounded-lg border border-border bg-background p-3 dark:border-slate-700 dark:bg-slate-900">
                      <p className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">
                        Replacement Logo
                      </p>
                      {manageLogoPreviewUrl ? (
                        <img
                          src={manageLogoPreviewUrl}
                          alt="Replacement logo preview"
                          className="h-24 w-full rounded-md border border-border object-contain p-2 dark:border-slate-700"
                        />
                      ) : (
                        <div className="flex h-24 items-center justify-center rounded-md border border-dashed border-border text-xs text-muted-foreground dark:border-slate-700">
                          Upload a new logo to preview
                        </div>
                      )}
                    </div>
                  </div>

                  <div
                    className={`w-full rounded-xl border border-dashed px-4 py-5 transition-colors ${
                      isManageLogoDragging
                        ? "border-primary bg-primary/5"
                        : "border-border bg-background dark:border-slate-700 dark:bg-slate-900"
                    }`}
                    onDragEnter={(event) => {
                      event.preventDefault();
                      setIsManageLogoDragging(true);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      setIsManageLogoDragging(true);
                    }}
                    onDragLeave={() => setIsManageLogoDragging(false)}
                    onDrop={handleManageLogoDrop}
                    role="presentation"
                  >
                    <input
                      ref={manageFileInputRef}
                      id="manage-logo-file"
                      type="file"
                      accept="image/*"
                      onChange={handleManageLogoChange}
                      className="hidden"
                      aria-invalid={Boolean(manageFormErrors.logoFile)}
                    />

                    <button
                      type="button"
                      onClick={openManageFilePicker}
                      className="flex w-full cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border border-border bg-card px-4 py-6 text-center text-sm text-foreground shadow-sm transition-colors hover:bg-muted/60 dark:border-slate-700 dark:bg-slate-950/60 dark:hover:bg-slate-800/70"
                    >
                      <AppWindow
                        className="size-6 text-muted-foreground"
                        aria-hidden="true"
                      />
                      <span className="font-medium">
                        Drag and drop a logo here
                      </span>
                      <span className="text-xs text-muted-foreground">
                        or click to choose a file
                      </span>
                    </button>

                    <p className="mt-3 text-xs text-muted-foreground">
                      {manageLogoFileLabel}
                    </p>
                    <p className="mt-1 text-xs text-muted-foreground">
                      Leave empty to keep current logo.
                    </p>
                    {manageFormErrors.logoFile ? (
                      <p className="mt-1 text-xs text-destructive">
                        {manageFormErrors.logoFile}
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="manage-status">Status</Label>
                    <select
                      id="manage-status"
                      name="status"
                      value={manageForm.status}
                      onChange={handleManageInputChange}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow,border-color] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:border-sky-400 dark:focus-visible:ring-sky-400/20"
                    >
                      <option value="ACTIVE">Active</option>
                      <option value="INACTIVE">Inactive</option>
                      <option value="MAINTENANCE">Maintenance</option>
                    </select>
                  </div>

                  <div className="space-y-2">
                    <Label htmlFor="manage-visibility">Visibility Scope</Label>
                    <select
                      id="manage-visibility"
                      name="visibility_scope"
                      value={manageForm.visibility_scope}
                      onChange={handleManageInputChange}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow,border-color] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:border-sky-400 dark:focus-visible:ring-sky-400/20"
                    >
                      <option value="VISIBLE_TO_ALL">Visible To All</option>
                      <option value="HIDDEN">Hidden</option>
                    </select>
                  </div>
                </div>

                <div className="flex justify-end">
                  <Button type="submit" disabled={isSavingManage}>
                    {isSavingManage ? (
                      <>
                        <Loader2
                          className="mr-2 size-4 animate-spin"
                          aria-hidden="true"
                        />
                        Saving...
                      </>
                    ) : (
                      "Save Changes"
                    )}
                  </Button>
                </div>
              </form>
            ) : (
              <div className="grid gap-6">
                <div className="grid gap-4 md:grid-cols-2">
                  <div className="space-y-2">
                    <Label htmlFor="manage-access-scope">Access Scope</Label>
                    <select
                      id="manage-access-scope"
                      name="access_scope"
                      value={manageForm.access_scope}
                      onChange={handleManageInputChange}
                      className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow,border-color] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:border-sky-400 dark:focus-visible:ring-sky-400/20"
                    >
                      <option value="RESTRICTED">Restricted</option>
                      <option value="ALL_AUTHENTICATED">
                        All Authenticated
                      </option>
                    </select>
                  </div>

                  <div className="flex items-end justify-end">
                    <Button
                      type="button"
                      onClick={() => void saveManageChanges("access")}
                      disabled={isSavingManage}
                    >
                      {isSavingManage ? (
                        <>
                          <Loader2
                            className="mr-2 size-4 animate-spin"
                            aria-hidden="true"
                          />
                          Saving...
                        </>
                      ) : (
                        "Save Access Settings"
                      )}
                    </Button>
                  </div>
                </div>

                <div className="space-y-2">
                  <Label>Department Access</Label>
                  <div className="grid gap-2 rounded-md border border-border bg-background p-3 shadow-sm sm:grid-cols-2 xl:grid-cols-3 dark:border-slate-700 dark:bg-slate-900">
                    {departments.length === 0 ? (
                      <p className="text-xs text-muted-foreground">
                        No departments available.
                      </p>
                    ) : (
                      departments.map((department) => {
                        const checked = manageForm.department_ids.includes(
                          department.id,
                        );
                        return (
                          <label
                            key={department.id}
                            className="flex cursor-pointer items-center gap-3 rounded-lg border border-border px-3 py-2 text-sm text-foreground transition-colors hover:bg-muted/70 dark:border-slate-700 dark:hover:bg-slate-800/80"
                          >
                            <input
                              type="checkbox"
                              checked={checked}
                              onChange={() =>
                                toggleManageDepartment(department.id)
                              }
                              className="size-4 rounded border-input accent-primary"
                            />
                            <span className="flex-1">{department.name}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                  {manageFormErrors.department_ids ? (
                    <p className="text-xs text-destructive">
                      {manageFormErrors.department_ids}
                    </p>
                  ) : null}
                </div>

                <div className="rounded-md border border-border bg-background p-4 dark:border-slate-700 dark:bg-slate-900">
                  <h3 className="text-sm font-semibold text-foreground">
                    Grant Access Override
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Select a user who currently does not have access and grant
                    access override.
                  </p>

                  <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                    <div className="space-y-2">
                      <Label htmlFor="override-user">User</Label>
                      <select
                        id="override-user"
                        value={overrideUserId}
                        onChange={(event) =>
                          setOverrideUserId(event.target.value)
                        }
                        className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow,border-color] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:border-sky-400 dark:focus-visible:ring-sky-400/20"
                      >
                        <option value="">Select user</option>
                        {availableOverrideUsers.map((user) => {
                          const fullName = [user.first_name, user.last_name]
                            .filter(Boolean)
                            .join(" ");
                          const label =
                            fullName || user.email || `User ${user.id}`;
                          return (
                            <option key={user.id} value={String(user.id)}>
                              {label}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="override-reason">Reason (optional)</Label>
                      <Input
                        id="override-reason"
                        value={overrideReason}
                        onChange={(event) =>
                          setOverrideReason(event.target.value)
                        }
                        placeholder="Temporary access for project work"
                      />
                    </div>

                    <Button
                      type="button"
                      onClick={() => void handleGrantAccessOverride()}
                      disabled={
                        isGrantingAccess ||
                        isLoadingOverrides ||
                        availableOverrideUsers.length === 0
                      }
                    >
                      {isGrantingAccess ? (
                        <>
                          <Loader2
                            className="mr-2 size-4 animate-spin"
                            aria-hidden="true"
                          />
                          Granting...
                        </>
                      ) : (
                        "Grant Access"
                      )}
                    </Button>
                  </div>

                  {isLoadingOverrides ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      Loading overrides...
                    </p>
                  ) : null}

                  {availableOverrideUsers.length === 0 ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      No eligible users found for override.
                    </p>
                  ) : null}
                </div>

                <div className="rounded-md border border-border bg-background p-4 dark:border-slate-700 dark:bg-slate-900">
                  <h3 className="text-sm font-semibold text-foreground">
                    Remove Access Override
                  </h3>
                  <p className="mt-1 text-xs text-muted-foreground">
                    Select a user who currently has access and explicitly deny
                    access.
                  </p>

                  <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_auto] md:items-end">
                    <div className="space-y-2">
                      <Label htmlFor="deny-user">User</Label>
                      <select
                        id="deny-user"
                        value={denyUserId}
                        onChange={(event) => setDenyUserId(event.target.value)}
                        className="h-10 w-full rounded-md border border-border bg-background px-3 text-sm text-foreground shadow-sm outline-none transition-[color,box-shadow,border-color] focus-visible:border-primary focus-visible:ring-2 focus-visible:ring-primary/20 dark:border-slate-700 dark:bg-slate-900 dark:text-slate-100 dark:focus-visible:border-sky-400 dark:focus-visible:ring-sky-400/20"
                      >
                        <option value="">Select user</option>
                        {removableAccessUsers.map((user) => {
                          const fullName = [user.first_name, user.last_name]
                            .filter(Boolean)
                            .join(" ");
                          const label =
                            fullName || user.email || `User ${user.id}`;
                          return (
                            <option key={user.id} value={String(user.id)}>
                              {label}
                            </option>
                          );
                        })}
                      </select>
                    </div>

                    <div className="space-y-2">
                      <Label htmlFor="deny-reason">Reason (optional)</Label>
                      <Input
                        id="deny-reason"
                        value={denyReason}
                        onChange={(event) => setDenyReason(event.target.value)}
                        placeholder="Restrict access pending review"
                      />
                    </div>

                    <Button
                      type="button"
                      variant="destructive"
                      onClick={() => void handleDenyAccessOverride()}
                      disabled={
                        isRevokingAccess ||
                        isLoadingOverrides ||
                        removableAccessUsers.length === 0
                      }
                    >
                      {isRevokingAccess ? (
                        <>
                          <Loader2
                            className="mr-2 size-4 animate-spin"
                            aria-hidden="true"
                          />
                          Removing...
                        </>
                      ) : (
                        "Remove Access"
                      )}
                    </Button>
                  </div>

                  {removableAccessUsers.length === 0 ? (
                    <p className="mt-3 text-xs text-muted-foreground">
                      No eligible users currently have removable access.
                    </p>
                  ) : null}
                </div>
              </div>
            )}
          </Card>
        </div>
      ) : null}

      {isLoading ? (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="size-4 animate-spin" aria-hidden="true" />
          Loading applications...
        </div>
      ) : applications.length === 0 ? (
        <div className="flex min-h-[40vh] items-center justify-center px-6 text-center">
          <div className="space-y-2">
            <h2 className="text-xl font-semibold text-foreground">
              No Applications Found
            </h2>
            <p className="max-w-xl text-sm text-muted-foreground">
              No applications are available right now. Check back later.
            </p>
          </div>
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
          {applications.map((application) => {
            const hasLogo = Boolean(application.logo_url);
            const canAccess = application.can_access !== false;
            const isDeniedAnimating = deniedFeedbackIds.includes(
              application.id,
            );
            const isOpening = openingApplicationId === application.id;

            return (
              <Card
                key={application.id}
                className={`group border-border bg-card p-5 shadow-sm transition-[transform,box-shadow,background-color,border-color] duration-200 hover:-translate-y-1 hover:shadow-md ${
                  isDeniedAnimating
                    ? "animate-[app-denied-shake_0.18s_ease-in-out_4] border-red-200 bg-red-50/70 dark:border-red-900 dark:bg-red-950/25"
                    : ""
                }`}
              >
                <div className="flex h-full flex-col gap-4">
                  <div className="flex items-start gap-4">
                    <div className="flex size-12 shrink-0 items-center justify-center overflow-hidden rounded-2xl bg-accent text-accent-foreground shadow-sm transition-colors group-hover:bg-primary group-hover:text-primary-foreground">
                      {hasLogo ? (
                        <img
                          src={application.logo_url ?? ""}
                          alt={application.name}
                          className="size-full object-contain p-2"
                        />
                      ) : (
                        <AppWindow className="size-5" aria-hidden="true" />
                      )}
                    </div>

                    <div className="min-w-0 flex-1">
                      <h2 className="text-base font-semibold text-foreground">
                        {application.name}
                      </h2>
                      <p className="mt-2 text-sm leading-6 text-muted-foreground">
                        {application.description || "No description available."}
                      </p>
                    </div>
                  </div>

                  <div className="mt-auto flex items-center justify-between gap-3">
                    {isAdmin ? (
                      <Button
                        type="button"
                        variant="outline"
                        className="h-8 cursor-pointer rounded-full border-sky-300 bg-sky-100 px-3 text-xs text-sky-800 hover:bg-sky-200 dark:border-sky-800 dark:bg-sky-950/50 dark:text-sky-200 dark:hover:bg-sky-900/70"
                        onClick={() => openManageModal(application)}
                      >
                        Manage
                      </Button>
                    ) : (
                      <span />
                    )}

                    <a
                      href={application.app_url}
                      onClick={(event) =>
                        handleOpenApplication(event, application)
                      }
                      aria-disabled={isOpening}
                      className={`inline-flex items-center gap-2 self-end rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                        canAccess
                          ? "border-border bg-background text-foreground hover:bg-muted dark:border-slate-700 dark:bg-slate-950/60 dark:hover:bg-slate-800"
                          : "border-red-300 bg-red-100/90 text-red-700 hover:bg-red-200 dark:border-red-800 dark:bg-red-950/60 dark:text-red-200 dark:hover:bg-red-900/70"
                      } ${isOpening ? "pointer-events-none opacity-70" : ""}`}
                    >
                      Open
                      {isOpening ? (
                        <Loader2
                          className="size-3.5 animate-spin"
                          aria-hidden="true"
                        />
                      ) : (
                        <ExternalLink className="size-3.5" aria-hidden="true" />
                      )}
                    </a>
                  </div>
                </div>
              </Card>
            );
          })}
        </div>
      )}

      <style jsx global>{`
        @keyframes app-denied-shake {
          0%,
          100% {
            transform: translateX(0);
          }
          25% {
            transform: translateX(-4px);
          }
          50% {
            transform: translateX(4px);
          }
          75% {
            transform: translateX(-3px);
          }
        }
      `}</style>
    </div>
  );
}
