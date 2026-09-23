"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Loader2, Building, User } from "lucide-react"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from "@/components/ui/command"
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover"
import { apiClient } from "@/lib/api-client"

export type AssigneeOption = {
  id: string | number
  type: "user" | "department"
  name: string
  subtext?: string
}

interface AssigneeComboboxProps {
  value: string | null
  onChange: (value: string | null, type: "user" | "department" | null, assignee?: AssigneeOption | null) => void
  placeholder?: string
  disabled?: boolean
  defaultAssignee?: AssigneeOption | null
  types?: ("user" | "department")[]
  allowedDepartmentNames?: string[]
}

export function AssigneeCombobox({
  value,
  onChange,
  placeholder = "Select a user or department...",
  disabled = false,
  defaultAssignee = null,
  types = ["user", "department"],
  allowedDepartmentNames,
}: AssigneeComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [options, setOptions] = React.useState<AssigneeOption[]>([])
  const [search, setSearch] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const isRequestInFlight = React.useRef(false)

  React.useEffect(() => {
    if (defaultAssignee && !options.find((o) => String(o.id) === String(defaultAssignee.id))) {
      setOptions((prev) => [defaultAssignee, ...prev])
    }
  }, [defaultAssignee, options])

  React.useEffect(() => {
    const timeoutId = setTimeout(() => {
      async function fetchOptions() {
        if (isRequestInFlight.current) return
        
        try {
          isRequestInFlight.current = true
          setLoading(true)
          
          const fetchPromises: Promise<unknown>[] = [];
          if (types.includes("user")) {
            fetchPromises.push(apiClient.get("/admin/users", { params: { q: search, page_size: 10 } }));
          } else {
            fetchPromises.push(Promise.resolve({ data: [] }));
          }
          
          if (types.includes("department")) {
            fetchPromises.push(apiClient.get("/organization/departments", { params: { q: search, page_size: 10 } }));
          } else {
            fetchPromises.push(Promise.resolve({ data: [] }));
          }

          const [usersRes, deptsRes] = await Promise.all(fetchPromises);
          
          const usersPayload = usersRes as { data: unknown };
          let userResults: Record<string, unknown>[] = []
          if (Array.isArray(usersPayload)) userResults = usersPayload
          else if (usersPayload.data && typeof usersPayload.data === "object") {
            const dataObj = usersPayload.data as Record<string, unknown>;
            userResults = Array.isArray(dataObj.results) ? (dataObj.results as Record<string, unknown>[]) : []
          }

          const deptsPayload = deptsRes as { data: unknown };
          let deptResults: Record<string, unknown>[] = []
          if (Array.isArray(deptsPayload.data)) deptResults = deptsPayload.data
          else if (deptsPayload.data && typeof deptsPayload.data === "object") {
            const dataObj = deptsPayload.data as Record<string, unknown>;
            deptResults = Array.isArray(dataObj.results) ? (dataObj.results as Record<string, unknown>[]) : []
          }

          const formattedUsers: AssigneeOption[] = userResults.map(u => ({
            id: u.id as string | number,
            type: "user",
            name: `${(u.first_name as string) || ""} ${(u.last_name as string) || ""}`.trim() || (u.username as string) || String(u.id),
            subtext: u.email as string
          }))

          let formattedDepts: AssigneeOption[] = deptResults.map(d => ({
            id: d.id as string | number,
            type: "department" as const,
            name: d.name as string,
            subtext: "Department"
          }))

          if (allowedDepartmentNames && allowedDepartmentNames.length > 0) {
            formattedDepts = formattedDepts.filter(d => 
              allowedDepartmentNames.some(name => d.name.toLowerCase().includes(name.toLowerCase()))
            )
          }

          const results = [...formattedUsers, ...formattedDepts]

          const currentlySelected = options.find((o) => String(o.id) === String(value))
          if (currentlySelected && !results.find((o) => String(o.id) === String(currentlySelected.id))) {
             setOptions([currentlySelected, ...results])
          } else {
             setOptions(results)
          }

        } catch (error) {
          console.error("Failed to fetch assignees", error)
        } finally {
          isRequestInFlight.current = false
          setLoading(false)
        }
      }
      
      if (open) {
        fetchOptions()
      }
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [search, open, value]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedOption = options.find((opt) => String(opt.id) === String(value)) || defaultAssignee

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn(
            "w-full justify-between font-normal",
            !value && "text-muted-foreground"
          )}
        >
          <span className="truncate flex items-center gap-2">
            {selectedOption ? (
              <>
                {selectedOption.type === "user" ? <User className="h-4 w-4" /> : <Building className="h-4 w-4" />}
                {selectedOption.name}
              </>
            ) : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput 
            placeholder="Search users or departments..." 
            value={search}
            onValueChange={setSearch}
          />
          <CommandList>
            <CommandEmpty>
              {loading ? (
                <div className="flex items-center justify-center p-4">
                  <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                </div>
              ) : (
                "No match found."
              )}
            </CommandEmpty>
            
            {options.filter(o => o.type === "user").length > 0 && (
              <CommandGroup heading="Users">
                {options.filter(o => o.type === "user").map((opt) => (
                  <CommandItem
                    key={`user-${opt.id}`}
                    value={`user-${opt.id}`}
                    onSelect={() => {
                      if (String(value) === String(opt.id)) {
                        onChange(null, null, null)
                      } else {
                        onChange(String(opt.id), opt.type, opt)
                      }
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        String(value) === String(opt.id) ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col overflow-hidden">
                      <span className="truncate flex items-center gap-2">
                        <User className="h-3 w-3 text-muted-foreground" />
                        {opt.name}
                      </span>
                      {opt.subtext && (
                        <span className="truncate text-xs text-muted-foreground ml-5">
                          {opt.subtext}
                        </span>
                      )}
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

            {options.filter(o => o.type === "department").length > 0 && (
              <CommandGroup heading="Departments">
                {options.filter(o => o.type === "department").map((opt) => (
                  <CommandItem
                    key={`dept-${opt.id}`}
                    value={`dept-${opt.id}`}
                    onSelect={() => {
                      if (String(value) === String(opt.id)) {
                        onChange(null, null, null)
                      } else {
                        onChange(String(opt.id), opt.type, opt)
                      }
                      setOpen(false)
                    }}
                  >
                    <Check
                      className={cn(
                        "mr-2 h-4 w-4 shrink-0",
                        String(value) === String(opt.id) ? "opacity-100" : "opacity-0"
                      )}
                    />
                    <div className="flex flex-col overflow-hidden">
                      <span className="truncate flex items-center gap-2">
                        <Building className="h-3 w-3 text-muted-foreground" />
                        {opt.name}
                      </span>
                    </div>
                  </CommandItem>
                ))}
              </CommandGroup>
            )}

          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
