"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Building2,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Crown,
  Loader2,
  Network,
  Pencil,
  Plus,
  Search,
  User,
  Users,
  X,
} from "lucide-react";
import { toast } from "sonner";

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
import { apiClient } from "@/lib/api-client";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { OrganizationMembersModal } from "@/components/OrganizationMembersModal";
import { AssignLeaderModal } from "@/components/AssignLeaderModal";
import { DepartmentsSkeleton } from "@/components/skeletons/departments-skeleton";

type UserBasicInfo = {
  id: number;
  first_name: string;
  last_name: string;
  email: string;
};

type Team = {
  id: string;
  name: string;
  code: string;
  team_lead_info: UserBasicInfo | null;
  is_active: boolean;
  members_count?: number;
  member_count?: number;
};

type Unit = {
  id: string;
  name: string;
  code: string;
  supervisor_info: UserBasicInfo | null;
  is_active: boolean;
  teams: Team[];
  members_count?: number;
  member_count?: number;
};

type Department = {
  id: string;
  name: string;
  code: string;
  line_manager_info: UserBasicInfo | null;
  is_active: boolean;
  units: Unit[];
  members_count?: number;
  member_count?: number;
};

type FormState = {
  name: string;
  code: string;
  parent_id?: string;
};

function getMemberCount(entity: {
  members_count?: number;
  member_count?: number;
}): number | null {
  if (typeof entity.members_count === "number") return entity.members_count;
  if (typeof entity.member_count === "number") return entity.member_count;
  return null;
}

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  // Form states for creating/editing
  const [isCreateDeptOpen, setIsCreateDeptOpen] = useState(false);
  const [isCreateUnitOpen, setIsCreateUnitOpen] = useState(false);
  const [isCreateTeamOpen, setIsCreateTeamOpen] = useState(false);

  const [selectedParentId, setSelectedParentId] = useState<string>("");
  const [parentName, setParentName] = useState<string>("");

  const [form, setForm] = useState<FormState>({ name: "", code: "" });
  const [formErrors, setFormErrors] = useState<Record<string, string>>({});
  const [apiError, setApiError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Tree expansion state
  const [expandedDeps, setExpandedDeps] = useState<Set<string>>(new Set());
  const [expandedUnits, setExpandedUnits] = useState<Set<string>>(new Set());

  // Member modal state
  const [memberModalOpen, setMemberModalOpen] = useState(false);
  const [memberModalConfig, setMemberModalConfig] = useState<{
    type: "department" | "unit" | "team";
    id: string;
    name: string;
    parentId: string | null;
  } | null>(null);

  const openMembersModal = (
    type: "department" | "unit" | "team",
    id: string,
    name: string,
    parentId: string | null = null,
  ) => {
    setMemberModalConfig({ type, id, name, parentId });
    setMemberModalOpen(true);
  };

  // Leader modal state
  const [leaderModalOpen, setLeaderModalOpen] = useState(false);
  const [leaderModalConfig, setLeaderModalConfig] = useState<{
    type: "department" | "unit" | "team";
    id: string;
    name: string;
    currentLeaderId?: number | null;
  } | null>(null);

  const openLeaderModal = (
    type: "department" | "unit" | "team",
    id: string,
    name: string,
    currentLeaderId?: number | null,
  ) => {
    setLeaderModalConfig({ type, id, name, currentLeaderId });
    setLeaderModalOpen(true);
  };

  const fetchHierarchy = async () => {
    try {
      setLoading(true);
      const [hierarchyResp, permsResp] = await Promise.all([
        apiClient.get("/organization/hierarchy"),
        apiClient.get("/me/permissions"),
      ]);
      const data: Department[] = hierarchyResp.data || [];
      setDepartments(data);

      // Default expand all departments initially
      setExpandedDeps(new Set(data.map((d) => d.id)));

      const permissionsData = permsResp.data as {
        is_superuser?: boolean;
        role_code?: string | null;
      };
      setIsAdmin(
        Boolean(permissionsData.is_superuser) ||
          String(permissionsData.role_code ?? "").toUpperCase() === "ADMIN",
      );
    } catch (err) {
      toast.error(
        extractApiErrorMessage(err, "Failed to load organization hierarchy."),
      );
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchHierarchy();
  }, []);

  const toggleDep = (id: string) => {
    setExpandedDeps((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const toggleUnit = (id: string) => {
    setExpandedUnits((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const expandAll = () => {
    const allDepIds = new Set(departments.map((d) => d.id));
    const allUnitIds = new Set(
      departments.flatMap((d) => d.units?.map((u) => u.id) || []),
    );
    setExpandedDeps(allDepIds);
    setExpandedUnits(allUnitIds);
  };

  const collapseAll = () => {
    setExpandedDeps(new Set());
    setExpandedUnits(new Set());
  };

  const resetForm = () => {
    setForm({ name: "", code: "" });
    setFormErrors({});
    setApiError("");
    setSelectedParentId("");
    setParentName("");
  };

  const validateForm = () => {
    const errors: Record<string, string> = {};
    if (!form.name.trim()) errors.name = "Name is required.";
    if (!form.code.trim()) errors.code = "Code is required.";
    return errors;
  };

  const handleCreateDepartment = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSubmitting(true);
    setApiError("");
    try {
      await apiClient.post("/admin/organization/departments/", {
        name: form.name.trim(),
        code: form.code.trim(),
      });
      toast.success("Department created.");
      setIsCreateDeptOpen(false);
      resetForm();
      void fetchHierarchy();
    } catch (error) {
      setApiError(extractApiErrorMessage(error, "Failed to create department."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateUnit = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSubmitting(true);
    setApiError("");
    try {
      await apiClient.post("/admin/organization/units/", {
        name: form.name.trim(),
        code: form.code.trim(),
        department: selectedParentId,
      });
      toast.success("Unit created.");
      setIsCreateUnitOpen(false);
      resetForm();
      void fetchHierarchy();
    } catch (error) {
      setApiError(extractApiErrorMessage(error, "Failed to create unit."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCreateTeam = async (e: React.FormEvent) => {
    e.preventDefault();
    const errors = validateForm();
    if (Object.keys(errors).length > 0) {
      setFormErrors(errors);
      return;
    }

    setIsSubmitting(true);
    setApiError("");
    try {
      await apiClient.post("/admin/organization/teams/", {
        name: form.name.trim(),
        code: form.code.trim(),
        unit: selectedParentId,
      });
      toast.success("Team created.");
      setIsCreateTeamOpen(false);
      resetForm();
      void fetchHierarchy();
    } catch (error) {
      setApiError(extractApiErrorMessage(error, "Failed to create team."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openCreateUnit = (depId: string, name: string) => {
    resetForm();
    setSelectedParentId(depId);
    setParentName(name);
    setIsCreateUnitOpen(true);
  };

  const openCreateTeam = (unitId: string, name: string) => {
    resetForm();
    setSelectedParentId(unitId);
    setParentName(name);
    setIsCreateTeamOpen(true);
  };

  // Metrics
  const totalUnits = useMemo(
    () => departments.reduce((acc, d) => acc + (d.units?.length || 0), 0),
    [departments],
  );

  const totalTeams = useMemo(
    () =>
      departments.reduce(
        (acc, d) =>
          acc +
          d.units.reduce((uAcc, u) => uAcc + (u.teams?.length || 0), 0),
        0,
      ),
    [departments],
  );

  const totalLeaders = useMemo(() => {
    let count = 0;
    departments.forEach((d) => {
      if (d.line_manager_info) count++;
      d.units.forEach((u) => {
        if (u.supervisor_info) count++;
        u.teams.forEach((t) => {
          if (t.team_lead_info) count++;
        });
      });
    });
    return count;
  }, [departments]);

  const totalMembers = useMemo(() => {
    let count = 0;
    let hasCount = false;
    departments.forEach((d) => {
      const c = getMemberCount(d);
      if (c !== null) {
        count += c;
        hasCount = true;
      }
    });
    return hasCount ? count : null;
  }, [departments]);

  // Filtered tree
  const filteredDepartments = useMemo(() => {
    if (!searchQuery.trim()) return departments;
    const q = searchQuery.toLowerCase().trim();

    return departments
      .map((dep) => {
        const depMatches =
          dep.name.toLowerCase().includes(q) ||
          dep.code.toLowerCase().includes(q);

        const matchingUnits = dep.units
          .map((unit) => {
            const unitMatches =
              unit.name.toLowerCase().includes(q) ||
              unit.code.toLowerCase().includes(q);

            const matchingTeams = unit.teams.filter(
              (team) =>
                team.name.toLowerCase().includes(q) ||
                team.code.toLowerCase().includes(q),
            );

            if (unitMatches || matchingTeams.length > 0) {
              return {
                ...unit,
                teams: unitMatches ? unit.teams : matchingTeams,
              };
            }
            return null;
          })
          .filter(Boolean) as Unit[];

        if (depMatches || matchingUnits.length > 0) {
          return {
            ...dep,
            units: depMatches ? dep.units : matchingUnits,
          };
        }
        return null;
      })
      .filter(Boolean) as Department[];
  }, [departments, searchQuery]);

  if (loading) {
    return <DepartmentsSkeleton />;
  }

  return (
    <div className="mx-auto flex w-full max-w-7xl flex-col gap-6 pb-12">
      {/* Top Header Card */}
      <div className="relative overflow-hidden rounded-2xl border border-border/80 bg-card p-6 shadow-xs sm:p-8">
        <div className="flex flex-col gap-5 sm:flex-row sm:items-center sm:justify-between">
          <div className="space-y-1">
            <div className="flex items-center gap-2.5">
              <div className="flex size-10 items-center justify-center rounded-xl bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                <Building2 className="size-5" />
              </div>
              <h1 className="text-2xl font-bold tracking-tight text-foreground sm:text-3xl">
                Organization Structure
              </h1>
            </div>
            <p className="text-sm text-muted-foreground">
              Manage the institutional hierarchy, business units, functional teams, and appointed leaders.
            </p>
          </div>

          {isAdmin ? (
            <Button
              type="button"
              onClick={() => {
                resetForm();
                setIsCreateDeptOpen(true);
              }}
              className="h-10 gap-2 rounded-xl bg-[#0d47a1] px-4 font-semibold text-white shadow-sm hover:bg-[#0a3880]"
            >
              <Plus className="size-4" aria-hidden="true" />
              Add Department
            </Button>
          ) : null}
        </div>

        {/* Overview Stats Strip */}
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5 border-t border-border/60 pt-5">
          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
              <Building2 className="size-4.5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Departments</p>
              <p className="text-lg font-bold tabular-nums text-foreground">
                {departments.length}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <Network className="size-4.5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Business Units</p>
              <p className="text-lg font-bold tabular-nums text-foreground">
                {totalUnits}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-amber-500/10 text-amber-600 dark:text-amber-400">
              <Users className="size-4.5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Functional Teams</p>
              <p className="text-lg font-bold tabular-nums text-foreground">
                {totalTeams}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-blue-500/10 text-blue-600 dark:text-blue-400">
              <Users className="size-4.5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Total Personnel</p>
              <p className="text-lg font-bold tabular-nums text-foreground">
                {totalMembers !== null ? totalMembers : "—"}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-3 rounded-xl border border-border/60 bg-muted/30 p-3.5">
            <div className="flex size-9 items-center justify-center rounded-lg bg-purple-500/10 text-purple-600 dark:text-purple-400">
              <Crown className="size-4.5" />
            </div>
            <div>
              <p className="text-xs text-muted-foreground">Assigned Leaders</p>
              <p className="text-lg font-bold tabular-nums text-foreground">
                {totalLeaders}
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Toolbar: Search and Tree Expand/Collapse Controls */}
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full max-w-md">
          <Search className="pointer-events-none absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search departments, units, teams..."
            className="h-10 rounded-xl pl-9 pr-9 text-sm border-border/80 bg-card"
          />
          {searchQuery && (
            <button
              type="button"
              onClick={() => setSearchQuery("")}
              className="absolute right-3.5 top-1/2 -translate-y-1/2 text-muted-foreground hover:text-foreground"
            >
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={expandAll}
            className="h-8 gap-1.5 rounded-lg border-border/80 text-xs font-medium text-foreground hover:bg-muted"
          >
            <ChevronsUpDown className="size-3.5" />
            Expand All
          </Button>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={collapseAll}
            className="h-8 gap-1.5 rounded-lg border-border/80 text-xs font-medium text-foreground hover:bg-muted"
          >
            <ChevronsDownUp className="size-3.5" />
            Collapse All
          </Button>
        </div>
      </div>

      {/* Hierarchy Tree Container */}
      <div className="space-y-5">
        {filteredDepartments.length === 0 ? (
          <Card className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border-dashed border-border/90 p-8 text-center shadow-xs">
            <div className="flex size-14 items-center justify-center rounded-2xl bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8] mb-4">
              <Building2 className="size-7" />
            </div>
            <h2 className="text-lg font-semibold text-foreground">
              {searchQuery ? "No Matching Entities" : "No Departments Found"}
            </h2>
            <p className="mt-1.5 max-w-sm text-sm text-muted-foreground">
              {searchQuery
                ? "No departments, units, or teams matched your search criteria."
                : "Create your organization's first department to establish the company hierarchy."}
            </p>
            {searchQuery ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setSearchQuery("")}
                className="mt-4 rounded-lg text-xs"
              >
                Clear Search
              </Button>
            ) : isAdmin ? (
              <Button
                type="button"
                onClick={() => {
                  resetForm();
                  setIsCreateDeptOpen(true);
                }}
                className="mt-4 rounded-lg bg-[#0d47a1] text-white hover:bg-[#0a3880] text-xs gap-1.5"
              >
                <Plus className="size-3.5" />
                Add Department
              </Button>
            ) : null}
          </Card>
        ) : (
          filteredDepartments.map((dep) => {
            const isDepExpanded = expandedDeps.has(dep.id);
            const depMembersCount = getMemberCount(dep);

            return (
              <Card
                key={dep.id}
                className="overflow-hidden rounded-2xl border border-border/80 bg-card shadow-xs transition-all hover:border-[#0d47a1]/35 hover:shadow-md"
              >
                {/* Level 1: Department Header */}
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-border/60 bg-muted/30 p-4 sm:p-5">
                  <div className="flex items-center flex-wrap gap-3">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => toggleDep(dep.id)}
                      className="size-8 rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground shrink-0"
                      aria-label={isDepExpanded ? "Collapse department" : "Expand department"}
                    >
                      {isDepExpanded ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </Button>

                    <div className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[#0d47a1]/10 text-[#0d47a1] dark:bg-[#0d47a1]/20 dark:text-[#38bdf8]">
                      <Building2 className="size-4.5" />
                    </div>

                    <div className="flex items-center flex-wrap gap-2">
                      <h2 className="text-base font-bold text-foreground">
                        {dep.name}
                      </h2>
                      <span className="font-mono text-xs rounded-md border border-border/80 bg-muted/60 px-2 py-0.5 text-muted-foreground">
                        {dep.code}
                      </span>
                      <span className="text-[11px] font-semibold bg-[#0d47a1]/10 text-[#0d47a1] dark:text-[#38bdf8] border border-[#0d47a1]/20 px-2.5 py-0.5 rounded-full tabular-nums">
                        {dep.units.length} {dep.units.length === 1 ? "Unit" : "Units"}
                      </span>
                      {depMembersCount !== null && (
                        <span className="inline-flex items-center gap-1 text-[11px] font-semibold bg-muted text-muted-foreground border border-border/70 px-2.5 py-0.5 rounded-full tabular-nums">
                          <Users className="size-3" />
                          {depMembersCount} {depMembersCount === 1 ? "Member" : "Members"}
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Level 1 Actions & Leadership */}
                  <div className="flex items-center flex-wrap gap-2.5">
                    {/* Line Manager Pill */}
                    <div className="flex items-center gap-1.5 rounded-xl border border-border/70 bg-card px-3 py-1 text-xs">
                      <User className="size-3.5 text-muted-foreground" />
                      {dep.line_manager_info ? (
                        <div className="flex items-center gap-1.5">
                          <span className="text-muted-foreground">Manager:</span>
                          <span className="font-semibold text-foreground">
                            {dep.line_manager_info.first_name} {dep.line_manager_info.last_name}
                          </span>
                          {isAdmin && (
                            <button
                              type="button"
                              onClick={() =>
                                openLeaderModal(
                                  "department",
                                  dep.id,
                                  dep.name,
                                  dep.line_manager_info?.id,
                                )
                              }
                              className="size-5 rounded hover:bg-muted inline-flex items-center justify-center text-muted-foreground hover:text-foreground ml-1"
                              title="Edit Line Manager"
                            >
                              <Pencil className="size-3" />
                            </button>
                          )}
                        </div>
                      ) : isAdmin ? (
                        <button
                          type="button"
                          onClick={() => openLeaderModal("department", dep.id, dep.name)}
                          className="text-[#0d47a1] dark:text-[#38bdf8] hover:underline font-medium inline-flex items-center gap-1"
                        >
                          <Plus className="size-3" /> Assign Manager
                        </button>
                      ) : (
                        <span className="text-muted-foreground italic">No manager assigned</span>
                      )}
                    </div>

                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => openMembersModal("department", dep.id, dep.name)}
                      className="h-8 gap-1.5 rounded-lg border-border/80 text-xs font-medium hover:bg-muted"
                    >
                      <Users className="size-3.5 text-muted-foreground" />
                      <span>Members</span>
                      {depMembersCount !== null && (
                        <span className="rounded-full bg-muted border border-border/70 px-1.5 py-0.2 text-[10px] font-semibold tabular-nums text-foreground">
                          {depMembersCount}
                        </span>
                      )}
                    </Button>

                    {isAdmin && (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => openCreateUnit(dep.id, dep.name)}
                        className="h-8 gap-1.5 rounded-lg border-border/80 text-xs font-medium text-[#0d47a1] hover:bg-[#0d47a1]/10 dark:text-[#38bdf8]"
                      >
                        <Plus className="size-3.5" />
                        Add Unit
                      </Button>
                    )}
                  </div>
                </div>

                {/* Level 2: Units Section */}
                {isDepExpanded && (
                  <div className="p-4 sm:p-5">
                    {dep.units.length === 0 ? (
                      <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/80 p-6 text-center text-sm text-muted-foreground">
                        <Network className="size-6 text-muted-foreground/50 mb-1.5" />
                        <p className="font-medium text-foreground">No units in this department</p>
                        <p className="text-xs text-muted-foreground mt-0.5">
                          Add a unit to start organizing teams and personnel.
                        </p>
                        {isAdmin && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => openCreateUnit(dep.id, dep.name)}
                            className="mt-2.5 text-xs text-[#0d47a1] dark:text-[#38bdf8]"
                          >
                            <Plus className="size-3.5 mr-1" /> Add Unit
                          </Button>
                        )}
                      </div>
                    ) : (
                      <div className="space-y-4 border-l-2 border-[#0d47a1]/25 ml-4 sm:ml-6 pl-4 sm:pl-6">
                        {dep.units.map((unit) => {
                          const isUnitExpanded = expandedUnits.has(unit.id);
                          const unitMembersCount = getMemberCount(unit);

                          return (
                            <div
                              key={unit.id}
                              className="rounded-xl border border-border/70 bg-card/60 overflow-hidden shadow-2xs transition-all hover:border-emerald-500/35"
                            >
                              {/* Level 2: Unit Header */}
                              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3.5 sm:p-4 bg-muted/20">
                                <div className="flex items-center flex-wrap gap-2.5">
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    onClick={() => toggleUnit(unit.id)}
                                    className="size-7 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground shrink-0"
                                    aria-label={isUnitExpanded ? "Collapse unit" : "Expand unit"}
                                  >
                                    {isUnitExpanded ? (
                                      <ChevronDown className="size-3.5" />
                                    ) : (
                                      <ChevronRight className="size-3.5" />
                                    )}
                                  </Button>

                                  <div className="flex size-7.5 shrink-0 items-center justify-center rounded-lg bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
                                    <Network className="size-4" />
                                  </div>

                                  <div className="flex items-center flex-wrap gap-2">
                                    <h3 className="text-sm font-bold text-foreground">
                                      {unit.name}
                                    </h3>
                                    <span className="font-mono text-[11px] rounded border border-border/80 bg-muted/60 px-1.5 py-0.2 text-muted-foreground">
                                      {unit.code}
                                    </span>
                                    <span className="text-[10px] font-semibold bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 border border-emerald-500/20 px-2 py-0.2 rounded-full tabular-nums">
                                      {unit.teams.length} {unit.teams.length === 1 ? "Team" : "Teams"}
                                    </span>
                                    {unitMembersCount !== null && (
                                      <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-muted text-muted-foreground border border-border/70 px-2 py-0.2 rounded-full tabular-nums">
                                        <Users className="size-2.5" />
                                        {unitMembersCount} {unitMembersCount === 1 ? "Member" : "Members"}
                                      </span>
                                    )}
                                  </div>
                                </div>

                                {/* Level 2 Actions & Leadership */}
                                <div className="flex items-center flex-wrap gap-2">
                                  {/* Supervisor Pill */}
                                  <div className="flex items-center gap-1.5 rounded-lg border border-border/70 bg-card px-2.5 py-0.5 text-xs">
                                    {unit.supervisor_info ? (
                                      <div className="flex items-center gap-1.5">
                                        <span className="text-muted-foreground text-[11px]">Supervisor:</span>
                                        <span className="font-medium text-foreground text-xs">
                                          {unit.supervisor_info.first_name} {unit.supervisor_info.last_name}
                                        </span>
                                        {isAdmin && (
                                          <button
                                            type="button"
                                            onClick={() =>
                                              openLeaderModal(
                                                "unit",
                                                unit.id,
                                                unit.name,
                                                unit.supervisor_info?.id,
                                              )
                                            }
                                            className="size-4.5 rounded hover:bg-muted inline-flex items-center justify-center text-muted-foreground hover:text-foreground ml-0.5"
                                            title="Edit Supervisor"
                                          >
                                            <Pencil className="size-2.5" />
                                          </button>
                                        )}
                                      </div>
                                    ) : isAdmin ? (
                                      <button
                                        type="button"
                                        onClick={() => openLeaderModal("unit", unit.id, unit.name)}
                                        className="text-emerald-600 dark:text-emerald-400 hover:underline font-medium text-xs inline-flex items-center gap-1"
                                      >
                                        <Plus className="size-3" /> Assign Supervisor
                                      </button>
                                    ) : (
                                      <span className="text-muted-foreground italic text-xs">No supervisor</span>
                                    )}
                                  </div>

                                  <Button
                                    type="button"
                                    variant="outline"
                                    size="sm"
                                    onClick={() => openMembersModal("unit", unit.id, unit.name, dep.id)}
                                    className="h-7 px-2.5 rounded-md border-border/80 text-xs hover:bg-muted"
                                  >
                                    <Users className="size-3 mr-1 text-muted-foreground" />
                                    <span>Members</span>
                                    {unitMembersCount !== null && (
                                      <span className="ml-1 rounded-full bg-muted border border-border/70 px-1.5 py-0.2 text-[10px] font-semibold tabular-nums text-foreground">
                                        {unitMembersCount}
                                      </span>
                                    )}
                                  </Button>

                                  {isAdmin && (
                                    <Button
                                      type="button"
                                      variant="ghost"
                                      size="sm"
                                      onClick={() => openCreateTeam(unit.id, unit.name)}
                                      className="h-7 px-2.5 rounded-md text-xs text-emerald-600 hover:bg-emerald-500/10 dark:text-emerald-400"
                                    >
                                      <Plus className="size-3 mr-1" /> Add Team
                                    </Button>
                                  )}
                                </div>
                              </div>

                              {/* Level 3: Teams Section */}
                              {isUnitExpanded && (
                                <div className="p-3 sm:p-4 bg-muted/10 border-t border-border/50">
                                  {unit.teams.length === 0 ? (
                                    <div className="p-4 text-xs text-muted-foreground text-center border border-dashed rounded-lg">
                                      No teams created yet in this unit.
                                    </div>
                                  ) : (
                                    <div className="space-y-2 border-l-2 border-emerald-500/25 ml-3 sm:ml-5 pl-3 sm:pl-5">
                                      {unit.teams.map((team) => {
                                        const teamMembersCount = getMemberCount(team);

                                        return (
                                          <div
                                            key={team.id}
                                            className="flex flex-col sm:flex-row sm:items-center justify-between gap-2.5 rounded-lg border border-border/60 bg-card p-2.5 sm:p-3 hover:bg-muted/30 transition-colors"
                                          >
                                            <div className="flex items-center flex-wrap gap-2">
                                              <div className="flex size-6 shrink-0 items-center justify-center rounded-md bg-amber-500/10 text-amber-600 dark:text-amber-400">
                                                <Users className="size-3.5" />
                                              </div>
                                              <span className="font-semibold text-xs text-foreground">
                                                {team.name}
                                              </span>
                                              <span className="font-mono text-[10px] rounded border border-border/80 bg-muted/60 px-1.5 py-0.2 text-muted-foreground">
                                                {team.code}
                                              </span>
                                              {teamMembersCount !== null && (
                                                <span className="inline-flex items-center gap-1 text-[10px] font-semibold bg-muted text-muted-foreground border border-border/70 px-2 py-0.2 rounded-full tabular-nums">
                                                  <Users className="size-2.5" />
                                                  {teamMembersCount} {teamMembersCount === 1 ? "Member" : "Members"}
                                                </span>
                                              )}
                                            </div>

                                            <div className="flex items-center flex-wrap gap-2">
                                              {/* Team Lead Pill */}
                                              <div className="flex items-center gap-1.5 rounded-md border border-border/70 bg-muted/30 px-2 py-0.5 text-xs">
                                                {team.team_lead_info ? (
                                                  <div className="flex items-center gap-1">
                                                    <span className="text-muted-foreground text-[10px]">Lead:</span>
                                                    <span className="font-medium text-foreground text-xs">
                                                      {team.team_lead_info.first_name} {team.team_lead_info.last_name}
                                                    </span>
                                                    {isAdmin && (
                                                      <button
                                                        type="button"
                                                        onClick={() =>
                                                          openLeaderModal(
                                                            "team",
                                                            team.id,
                                                            team.name,
                                                            team.team_lead_info?.id,
                                                          )
                                                        }
                                                        className="size-4 rounded hover:bg-muted inline-flex items-center justify-center text-muted-foreground hover:text-foreground"
                                                        title="Edit Team Lead"
                                                      >
                                                        <Pencil className="size-2.5" />
                                                      </button>
                                                    )}
                                                  </div>
                                                ) : isAdmin ? (
                                                  <button
                                                    type="button"
                                                    onClick={() => openLeaderModal("team", team.id, team.name)}
                                                    className="text-amber-600 dark:text-amber-400 hover:underline font-medium text-xs inline-flex items-center gap-1"
                                                  >
                                                    <Plus className="size-3" /> Assign Lead
                                                  </button>
                                                ) : (
                                                  <span className="text-muted-foreground italic text-[11px]">No lead assigned</span>
                                                )}
                                              </div>

                                              <Button
                                                type="button"
                                                variant="ghost"
                                                size="sm"
                                                onClick={() => openMembersModal("team", team.id, team.name, unit.id)}
                                                className="h-6 px-2 text-[11px] rounded text-muted-foreground hover:text-foreground"
                                              >
                                                <Users className="size-3 mr-1" />
                                                <span>Members</span>
                                                {teamMembersCount !== null && (
                                                  <span className="ml-1 rounded-full bg-muted border border-border/70 px-1.5 py-0.2 text-[10px] font-semibold tabular-nums text-foreground">
                                                    {teamMembersCount}
                                                  </span>
                                                )}
                                              </Button>
                                            </div>
                                          </div>
                                        );
                                      })}
                                    </div>
                                  )}
                                </div>
                              )}
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </div>
                )}
              </Card>
            );
          })
        )}
      </div>

      {/* Create Department Modal */}
      <Dialog
        open={isCreateDeptOpen}
        onOpenChange={(open) => {
          setIsCreateDeptOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Building2 className="size-4.5" />}>
            <DialogTitle>Create Department</DialogTitle>
            <DialogDescription>
              Add a new institutional department to the organization hierarchy.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateDepartment} className="space-y-4 pt-1" noValidate>
            {apiError ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive"
              >
                {apiError}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="dept-name">Department Name</Label>
              <Input
                id="dept-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Engineering, Human Resources"
                className="h-10 rounded-xl"
              />
              {formErrors.name && (
                <p className="text-xs text-destructive">{formErrors.name}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="dept-code">Department Code</Label>
              <Input
                id="dept-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="e.g. ENG, HR, FIN"
                className="h-10 rounded-xl font-mono uppercase"
              />
              {formErrors.code && (
                <p className="text-xs text-destructive">{formErrors.code}</p>
              )}
            </div>

            <DialogFooter className="pt-4 border-t border-border/60 sm:justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateDeptOpen(false)}
                disabled={isSubmitting}
                className="rounded-lg"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-[#0d47a1] hover:bg-[#0a3880] text-white shadow-sm rounded-lg"
              >
                {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                Create Department
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create Unit Modal */}
      <Dialog
        open={isCreateUnitOpen}
        onOpenChange={(open) => {
          setIsCreateUnitOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Network className="size-4.5" />}>
            <DialogTitle>Create Unit</DialogTitle>
            <DialogDescription>
              Add a new operational unit under <strong>{parentName}</strong>.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateUnit} className="space-y-4 pt-1" noValidate>
            {apiError ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive"
              >
                {apiError}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="unit-name">Unit Name</Label>
              <Input
                id="unit-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Frontend Architecture, Talent Acquisition"
                className="h-10 rounded-xl"
              />
              {formErrors.name && (
                <p className="text-xs text-destructive">{formErrors.name}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="unit-code">Unit Code</Label>
              <Input
                id="unit-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="e.g. ENG-FE, HR-TA"
                className="h-10 rounded-xl font-mono uppercase"
              />
              {formErrors.code && (
                <p className="text-xs text-destructive">{formErrors.code}</p>
              )}
            </div>

            <DialogFooter className="pt-4 border-t border-border/60 sm:justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateUnitOpen(false)}
                disabled={isSubmitting}
                className="rounded-lg"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-[#0d47a1] hover:bg-[#0a3880] text-white shadow-sm rounded-lg"
              >
                {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                Create Unit
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create Team Modal */}
      <Dialog
        open={isCreateTeamOpen}
        onOpenChange={(open) => {
          setIsCreateTeamOpen(open);
          if (!open) resetForm();
        }}
      >
        <DialogContent className="sm:max-w-md">
          <DialogHeader icon={<Users className="size-4.5" />}>
            <DialogTitle>Create Team</DialogTitle>
            <DialogDescription>
              Add a new functional team under <strong>{parentName}</strong>.
            </DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateTeam} className="space-y-4 pt-1" noValidate>
            {apiError ? (
              <div
                role="alert"
                className="rounded-lg border border-destructive/40 bg-destructive/10 px-3.5 py-2.5 text-xs text-destructive"
              >
                {apiError}
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="team-name">Team Name</Label>
              <Input
                id="team-name"
                value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })}
                placeholder="e.g. Portal Core, DevOps"
                className="h-10 rounded-xl"
              />
              {formErrors.name && (
                <p className="text-xs text-destructive">{formErrors.name}</p>
              )}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="team-code">Team Code</Label>
              <Input
                id="team-code"
                value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value })}
                placeholder="e.g. PORT-CORE, OPS"
                className="h-10 rounded-xl font-mono uppercase"
              />
              {formErrors.code && (
                <p className="text-xs text-destructive">{formErrors.code}</p>
              )}
            </div>

            <DialogFooter className="pt-4 border-t border-border/60 sm:justify-end gap-2.5">
              <Button
                type="button"
                variant="outline"
                onClick={() => setIsCreateTeamOpen(false)}
                disabled={isSubmitting}
                className="rounded-lg"
              >
                Cancel
              </Button>
              <Button
                type="submit"
                disabled={isSubmitting}
                className="bg-[#0d47a1] hover:bg-[#0a3880] text-white shadow-sm rounded-lg"
              >
                {isSubmitting && <Loader2 className="mr-2 size-4 animate-spin" />}
                Create Team
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>

      {memberModalConfig && (
        <OrganizationMembersModal
          isOpen={memberModalOpen}
          onClose={() => setMemberModalOpen(false)}
          entityType={memberModalConfig.type}
          entityId={memberModalConfig.id}
          entityName={memberModalConfig.name}
          parentEntityId={memberModalConfig.parentId}
          onSuccess={() => void fetchHierarchy()}
          isAdmin={isAdmin}
        />
      )}

      {leaderModalConfig && (
        <AssignLeaderModal
          isOpen={leaderModalOpen}
          onClose={() => setLeaderModalOpen(false)}
          entityType={leaderModalConfig.type}
          entityId={leaderModalConfig.id}
          entityName={leaderModalConfig.name}
          currentLeaderId={leaderModalConfig.currentLeaderId}
          onSuccess={() => void fetchHierarchy()}
        />
      )}
    </div>
  );
}
