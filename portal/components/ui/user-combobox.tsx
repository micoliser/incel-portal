"use client"

import * as React from "react"
import { Check, ChevronsUpDown, Loader2 } from "lucide-react"
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

export type UserOption = {
  id: string | number
  first_name?: string
  last_name?: string
  username?: string
  email?: string
  is_active?: boolean
  role_code?: string | null
  department_id?: string | null
}

interface UserComboboxProps {
  value: string
  onChange: (value: string, user?: UserOption | null) => void
  apiEndpoint: string
  additionalParams?: Record<string, string | number>
  placeholder?: string
  disabled?: boolean
  defaultUser?: UserOption | null
}

export function UserCombobox({
  value,
  onChange,
  apiEndpoint,
  additionalParams = {},
  placeholder = "Select a user...",
  disabled = false,
  defaultUser = null,
}: UserComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [users, setUsers] = React.useState<UserOption[]>([])
  const [search, setSearch] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const isRequestInFlight = React.useRef(false)

  // Initial load or when defaultUser is provided but we don't have it in the list
  React.useEffect(() => {
    if (defaultUser && !users.find((u) => String(u.id) === String(defaultUser.id))) {
      setUsers((prev) => [defaultUser, ...prev])
    }
  }, [defaultUser, users])

  // Debounced search
  React.useEffect(() => {
    const timeoutId = setTimeout(() => {
      async function fetchUsers() {
        if (isRequestInFlight.current) return
        
        try {
          isRequestInFlight.current = true
          setLoading(true)
          const response = await apiClient.get(apiEndpoint, {
            params: {
              ...additionalParams,
              q: search,
              page_size: 20, // Just get top 20 matches
            },
          })
          
          const payload = response.data
          let results: UserOption[] = []
          
          if (Array.isArray(payload)) {
            results = payload
          } else if (payload && typeof payload === "object") {
            const typedPayload = payload as { results?: UserOption[] }
            results = Array.isArray(typedPayload.results) ? typedPayload.results : []
          }

          // Merge with currently selected user to ensure they always appear in the list
          const currentlySelected = users.find((u) => String(u.id) === String(value))
          if (currentlySelected && !results.find((u) => String(u.id) === String(currentlySelected.id))) {
             setUsers([currentlySelected, ...results])
          } else {
             setUsers(results)
          }

        } catch (error) {
          console.error("Failed to fetch users", error)
        } finally {
          isRequestInFlight.current = false
          setLoading(false)
        }
      }
      
      if (open) {
        fetchUsers()
      }
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [search, open, apiEndpoint, value]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedUser = users.find((user) => String(user.id) === String(value)) || defaultUser

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
          <span className="truncate">
            {selectedUser
              ? `${selectedUser.first_name || ""} ${selectedUser.last_name || ""}`.trim() || selectedUser.email
              : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput 
            placeholder="Search users..." 
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
                "No user found."
              )}
            </CommandEmpty>
            <CommandGroup>
              {users.map((user) => (
                <CommandItem
                  key={user.id}
                  value={String(user.id)}
                  onSelect={(currentValue) => {
                    if (currentValue === String(value)) {
                      onChange("", null)
                    } else {
                      onChange(currentValue, user)
                    }
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      String(value) === String(user.id) ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex flex-col overflow-hidden">
                    <span className="truncate">
                      {`${user.first_name || ""} ${user.last_name || ""}`.trim() || user.username}
                    </span>
                    <span className="truncate text-xs text-muted-foreground">
                      {user.email}
                    </span>
                  </div>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  )
}
