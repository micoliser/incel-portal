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

export type ItemOption = {
  id: string
  code: string
  name: string
  serial_number?: string
  status?: string
}

interface ItemComboboxProps {
  value: string
  onChange: (value: string, item?: ItemOption | null) => void
  apiEndpoint?: string
  additionalParams?: Record<string, string | number>
  placeholder?: string
  disabled?: boolean
  defaultItem?: ItemOption | null
}

export function ItemCombobox({
  value,
  onChange,
  apiEndpoint = "/inventory/items/",
  additionalParams = {},
  placeholder = "Select an item...",
  disabled = false,
  defaultItem = null,
}: ItemComboboxProps) {
  const [open, setOpen] = React.useState(false)
  const [items, setItems] = React.useState<ItemOption[]>([])
  const [search, setSearch] = React.useState("")
  const [loading, setLoading] = React.useState(false)
  const isRequestInFlight = React.useRef(false)

  React.useEffect(() => {
    if (defaultItem && !items.find((i) => i.id === defaultItem.id)) {
      setItems((prev) => [defaultItem, ...prev])
    }
  }, [defaultItem, items])

  React.useEffect(() => {
    const timeoutId = setTimeout(() => {
      async function fetchItems() {
        if (isRequestInFlight.current) return
        
        try {
          isRequestInFlight.current = true
          setLoading(true)
          const response = await apiClient.get(apiEndpoint, {
            params: {
              ...additionalParams,
              q: search,
              page_size: 20,
            },
          })
          
          const payload = response.data
          let results: ItemOption[] = []
          
          if (Array.isArray(payload)) {
            results = payload
          } else if (payload && typeof payload === "object") {
            const typedPayload = payload as { results?: ItemOption[] }
            results = Array.isArray(typedPayload.results) ? typedPayload.results : []
          }

          const currentlySelected = items.find((i) => i.id === value)
          if (currentlySelected && !results.find((i) => i.id === currentlySelected.id)) {
             setItems([currentlySelected, ...results])
          } else {
             setItems(results)
          }

        } catch (error) {
          console.error("Failed to fetch items", error)
        } finally {
          isRequestInFlight.current = false
          setLoading(false)
        }
      }
      
      if (open) {
        fetchItems()
      }
    }, 300)

    return () => clearTimeout(timeoutId)
  }, [search, open, apiEndpoint, value]) // eslint-disable-line react-hooks/exhaustive-deps

  const selectedItem = items.find((item) => item.id === value) || defaultItem

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
            {selectedItem
              ? `${selectedItem.name} (${selectedItem.code})`
              : placeholder}
          </span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
        <Command shouldFilter={false}>
          <CommandInput 
            placeholder="Search items..." 
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
                "No items found."
              )}
            </CommandEmpty>
            <CommandGroup>
              {items.map((item) => (
                <CommandItem
                  key={item.id}
                  value={item.id}
                  onSelect={(currentValue) => {
                    if (currentValue === value) {
                      onChange("", null)
                    } else {
                      onChange(currentValue, item)
                    }
                    setOpen(false)
                  }}
                >
                  <Check
                    className={cn(
                      "mr-2 h-4 w-4 shrink-0",
                      value === item.id ? "opacity-100" : "opacity-0"
                    )}
                  />
                  <div className="flex flex-col overflow-hidden">
                    <span className="truncate">{item.name}</span>
                    <span className="truncate text-xs text-muted-foreground">
                      Code: {item.code} {item.serial_number ? `| SN: ${item.serial_number}` : ""}
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
