"use client";

import { useEffect, useState } from "react";
import { Plus, Pencil, Trash, ChevronDown, ChevronRight, Building2, Network, Users, X } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { apiClient } from "@/lib/api-client";
import { extractApiErrorMessage } from "@/lib/api-errors";
import { OrganizationMembersModal } from "@/components/OrganizationMembersModal";
import { AssignLeaderModal } from "@/components/AssignLeaderModal";

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
};

type Unit = {
  id: string;
  name: string;
  code: string;
  supervisor_info: UserBasicInfo | null;
  is_active: boolean;
  teams: Team[];
};

type Department = {
  id: string;
  name: string;
  code: string;
  line_manager_info: UserBasicInfo | null;
  is_active: boolean;
  units: Unit[];
};

type FormState = {
  name: string;
  code: string;
  parent_id?: string;
};

export default function DepartmentsPage() {
  const [departments, setDepartments] = useState<Department[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  // Form states for creating/editing
  const [isCreateDeptOpen, setIsCreateDeptOpen] = useState(false);
  const [isCreateUnitOpen, setIsCreateUnitOpen] = useState(false);
  const [isCreateTeamOpen, setIsCreateTeamOpen] = useState(false);
  
  const [selectedParentId, setSelectedParentId] = useState<string>("");
  
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

  const openMembersModal = (type: "department" | "unit" | "team", id: string, name: string, parentId: string | null = null) => {
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

  const openLeaderModal = (type: "department" | "unit" | "team", id: string, name: string, currentLeaderId?: number | null) => {
    setLeaderModalConfig({ type, id, name, currentLeaderId });
    setLeaderModalOpen(true);
  };

  const fetchHierarchy = async () => {
    try {
      setLoading(true);
      const [hierarchyResp, permsResp] = await Promise.all([
        apiClient.get("/organization/hierarchy"),
        apiClient.get("/me/permissions")
      ]);
      setDepartments(hierarchyResp.data || []);
      
      const permissionsData = permsResp.data as {
        is_superuser?: boolean;
        role_code?: string | null;
      };
      setIsAdmin(
        Boolean(permissionsData.is_superuser) ||
          String(permissionsData.role_code ?? "").toUpperCase() === "ADMIN"
      );
    } catch (err) {
      toast.error(extractApiErrorMessage(err, "Failed to load organization hierarchy."));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchHierarchy();
  }, []);

  const toggleDep = (id: string) => {
    const next = new Set(expandedDeps);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedDeps(next);
  };

  const toggleUnit = (id: string) => {
    const next = new Set(expandedUnits);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpandedUnits(next);
  };

  const resetForm = () => {
    setForm({ name: "", code: "" });
    setFormErrors({});
    setApiError("");
    setSelectedParentId("");
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
      fetchHierarchy();
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
      fetchHierarchy();
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
      fetchHierarchy();
    } catch (error) {
      setApiError(extractApiErrorMessage(error, "Failed to create team."));
    } finally {
      setIsSubmitting(false);
    }
  };

  const openCreateUnit = (depId: string) => {
    resetForm();
    setSelectedParentId(depId);
    setIsCreateUnitOpen(true);
  };

  const openCreateTeam = (unitId: string) => {
    resetForm();
    setSelectedParentId(unitId);
    setIsCreateTeamOpen(true);
  };

  if (loading) {
    return (
      <div className="flex h-40 items-center justify-center">
        <div className="text-sm text-muted-foreground">Loading hierarchy...</div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h2 className="text-xl font-semibold">Organization Structure</h2>
        {isAdmin && (
          <Button onClick={() => { resetForm(); setIsCreateDeptOpen(true); }}>
            <Plus className="mr-2 size-4" /> Add Department
          </Button>
        )}
      </div>

      <div className="grid gap-4">
        {departments.length === 0 ? (
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              No departments found. Create one to get started.
            </CardContent>
          </Card>
        ) : (
          departments.map(dep => (
            <Card key={dep.id} className="overflow-hidden">
              <CardHeader className="bg-muted/30 py-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                  <div className="flex items-center flex-wrap gap-2">
                    <Button variant="ghost" size="icon" onClick={() => toggleDep(dep.id)}>
                      {expandedDeps.has(dep.id) ? (
                        <ChevronDown className="size-4" />
                      ) : (
                        <ChevronRight className="size-4" />
                      )}
                    </Button>
                    <Building2 className="size-4 text-blue-500" />
                    <CardTitle className="text-base">{dep.name}</CardTitle>
                    <span className="text-xs text-muted-foreground ml-2">({dep.code})</span>
                    <span className="text-xs font-medium bg-muted px-2 py-0.5 rounded-full ml-2">
                      {dep.units.length} {dep.units.length === 1 ? 'Unit' : 'Units'}
                    </span>
                  </div>
                  <div className="flex items-center flex-wrap gap-2">
                    <div className="flex items-center bg-secondary px-2 py-1 rounded-full text-xs">
                      {dep.line_manager_info ? (
                        <>
                          <span className="mr-2">Manager: {dep.line_manager_info.first_name} {dep.line_manager_info.last_name}</span>
                          {isAdmin && (
                            <button onClick={() => openLeaderModal("department", dep.id, dep.name, dep.line_manager_info?.id)} className="text-muted-foreground hover:text-foreground">
                              <Pencil className="size-3" />
                            </button>
                          )}
                        </>
                      ) : (
                        isAdmin ? (
                          <button onClick={() => openLeaderModal("department", dep.id, dep.name)} className="text-muted-foreground hover:text-foreground flex items-center">
                            <Plus className="mr-1 size-3" /> Assign Manager
                          </button>
                        ) : (
                          <span className="text-muted-foreground">No manager</span>
                        )
                      )}
                    </div>
                    <Button variant="outline" size="sm" onClick={() => openMembersModal("department", dep.id, dep.name)}>
                      <Users className="mr-1 size-3" /> Members
                    </Button>
                    {isAdmin && (
                      <Button variant="outline" size="sm" onClick={() => openCreateUnit(dep.id)}>
                        <Plus className="mr-2 size-4" /> Add Unit
                      </Button>
                    )}
                  </div>
                </div>
              </CardHeader>

              {expandedDeps.has(dep.id) && (
                <CardContent className="p-0 border-t">
                  {dep.units.length === 0 ? (
                    <div className="p-4 text-sm text-muted-foreground pl-14">No units in this department.</div>
                  ) : (
                    <div className="divide-y">
                      {dep.units.map(unit => (
                        <div key={unit.id} className="bg-background">
                          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-3 pl-10 hover:bg-muted/10 transition-colors">
                            <div className="flex items-center flex-wrap gap-2">
                              <Button variant="ghost" size="icon" onClick={() => toggleUnit(unit.id)}>
                                {expandedUnits.has(unit.id) ? (
                                  <ChevronDown className="size-4" />
                                ) : (
                                  <ChevronRight className="size-4" />
                                )}
                              </Button>
                              <Network className="size-4 text-emerald-500" />
                              <span className="font-medium text-sm">{unit.name}</span>
                              <span className="text-xs text-muted-foreground ml-2">({unit.code})</span>
                              <span className="text-xs font-medium bg-muted px-2 py-0.5 rounded-full ml-2">
                                {unit.teams.length} {unit.teams.length === 1 ? 'Team' : 'Teams'}
                              </span>
                            </div>
                            <div className="flex items-center flex-wrap gap-2">
                              <div className="flex items-center bg-secondary px-2 py-1 rounded-full text-xs">
                                {unit.supervisor_info ? (
                                  <>
                                    <span className="mr-2">Supervisor: {unit.supervisor_info.first_name} {unit.supervisor_info.last_name}</span>
                                    {isAdmin && (
                                      <button onClick={() => openLeaderModal("unit", unit.id, unit.name, unit.supervisor_info?.id)} className="text-muted-foreground hover:text-foreground">
                                        <Pencil className="size-3" />
                                      </button>
                                    )}
                                  </>
                                ) : (
                                  isAdmin ? (
                                    <button onClick={() => openLeaderModal("unit", unit.id, unit.name)} className="text-muted-foreground hover:text-foreground flex items-center">
                                      <Plus className="mr-1 size-3" /> Assign Supervisor
                                    </button>
                                  ) : (
                                    <span className="text-muted-foreground">No supervisor</span>
                                  )
                                )}
                              </div>
                              <Button variant="ghost" size="sm" onClick={() => openMembersModal("unit", unit.id, unit.name, dep.id)}>
                                <Users className="mr-1 size-3" /> Members
                              </Button>
                              {isAdmin && (
                                <Button variant="ghost" size="sm" onClick={() => openCreateTeam(unit.id)}>
                                  <Plus className="mr-2 size-4" /> Add Team
                                </Button>
                              )}
                            </div>
                          </div>

                          {expandedUnits.has(unit.id) && (
                            <div className="bg-muted/5 pb-2">
                              {unit.teams.length === 0 ? (
                                <div className="p-3 text-sm text-muted-foreground pl-20">No teams in this unit.</div>
                              ) : (
                                <div className="space-y-1 pt-1">
                                  {unit.teams.map(team => (
                                    <div key={team.id} className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 py-2 pr-4 pl-20 hover:bg-muted/20 transition-colors">
                                      <div className="flex items-center flex-wrap gap-2">
                                        <Users className="size-4 text-orange-500" />
                                        <span className="text-sm">{team.name}</span>
                                        <span className="text-xs text-muted-foreground ml-2">({team.code})</span>
                                      </div>
                                      <div className="flex items-center flex-wrap gap-2">
                                        <div className="flex items-center bg-secondary px-2 py-1 rounded-full text-xs">
                                          {team.team_lead_info ? (
                                            <>
                                              <span className="mr-2">Lead: {team.team_lead_info.first_name} {team.team_lead_info.last_name}</span>
                                              {isAdmin && (
                                                <button onClick={() => openLeaderModal("team", team.id, team.name, team.team_lead_info?.id)} className="text-muted-foreground hover:text-foreground">
                                                <Pencil className="size-3" />
                                              </button>
                                              )}
                                            </>
                                          ) : isAdmin ? (
                                            <button onClick={() => openLeaderModal("team", team.id, team.name)} className="text-muted-foreground hover:text-foreground flex items-center">
                                              <Plus className="mr-1 size-3" /> Assign Lead
                                            </button>
                                          ) : (
                                            <span className="text-muted-foreground italic text-xs">No lead assigned</span>
                                          )}
                                        </div>
                                        <Button variant="ghost" size="sm" onClick={() => openMembersModal("team", team.id, team.name, unit.id)}>
                                          <Users className="mr-1 size-3" /> Members
                                        </Button>
                                      </div>
                                    </div>
                                  ))}
                                </div>
                              )}
                            </div>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </CardContent>
              )}
            </Card>
          ))
        )}
      </div>

      {/* Create Department Modal */}
      <Dialog open={isCreateDeptOpen} onOpenChange={setIsCreateDeptOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Department</DialogTitle>
            <DialogDescription>Add a new department to the organization.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateDepartment} className="space-y-4 pt-2">
            {apiError && <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{apiError}</div>}
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="mt-1"
              />
              {formErrors.name && <p className="text-xs text-destructive mt-1">{formErrors.name}</p>}
            </div>
            <div>
              <Label>Code</Label>
              <Input
                value={form.code}
                onChange={e => setForm({ ...form, code: e.target.value })}
                className="mt-1"
              />
              {formErrors.code && <p className="text-xs text-destructive mt-1">{formErrors.code}</p>}
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setIsCreateDeptOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>Create</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create Unit Modal */}
      <Dialog open={isCreateUnitOpen} onOpenChange={setIsCreateUnitOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Unit</DialogTitle>
            <DialogDescription>Add a new unit to the department.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateUnit} className="space-y-4 pt-2">
            {apiError && <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{apiError}</div>}
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="mt-1"
              />
              {formErrors.name && <p className="text-xs text-destructive mt-1">{formErrors.name}</p>}
            </div>
            <div>
              <Label>Code</Label>
              <Input
                value={form.code}
                onChange={e => setForm({ ...form, code: e.target.value })}
                className="mt-1"
              />
              {formErrors.code && <p className="text-xs text-destructive mt-1">{formErrors.code}</p>}
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setIsCreateUnitOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>Create</Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>

      {/* Create Team Modal */}
      <Dialog open={isCreateTeamOpen} onOpenChange={setIsCreateTeamOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Create Team</DialogTitle>
            <DialogDescription>Add a new team to the unit.</DialogDescription>
          </DialogHeader>
          <form onSubmit={handleCreateTeam} className="space-y-4 pt-2">
            {apiError && <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-md">{apiError}</div>}
            <div>
              <Label>Name</Label>
              <Input
                value={form.name}
                onChange={e => setForm({ ...form, name: e.target.value })}
                className="mt-1"
              />
              {formErrors.name && <p className="text-xs text-destructive mt-1">{formErrors.name}</p>}
            </div>
            <div>
              <Label>Code</Label>
              <Input
                value={form.code}
                onChange={e => setForm({ ...form, code: e.target.value })}
                className="mt-1"
              />
              {formErrors.code && <p className="text-xs text-destructive mt-1">{formErrors.code}</p>}
            </div>
            <div className="flex justify-end gap-2 pt-4">
              <Button type="button" variant="outline" onClick={() => setIsCreateTeamOpen(false)}>Cancel</Button>
              <Button type="submit" disabled={isSubmitting}>Create</Button>
            </div>
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
          onSuccess={() => {}}
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
          onSuccess={fetchHierarchy}
        />
      )}
    </div>
  );
}
