/**
 * Region Selector Component
 *
 * Multi-select geographic targeting for campaigns:
 * - State multi-select dropdown
 * - County multi-select (filtered by selected states)
 * - ZIP code input (comma-separated or ranges like 90210-90220)
 * - City search/select
 * - Saved territories dropdown
 * - Estimated lead count for selection
 *
 * Example: "I want to target these 5 zip codes in LA County"
 */
'use client';

import { useState, useEffect, useMemo, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent } from '@/components/ui/card';
import { Switch } from '@/components/ui/switch';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import { toast } from 'sonner';
import {
  MapPinIcon,
  XMarkIcon,
  PlusIcon,
  CheckIcon,
  BookmarkIcon,
  FolderIcon,
  MagnifyingGlassIcon,
  MapIcon,
  UsersIcon,
} from '@heroicons/react/24/outline';
import { BookmarkIcon as BookmarkIconSolid } from '@heroicons/react/24/solid';
import { cn } from '@/lib/utils';

// ============================================================================
// Types
// ============================================================================

export interface Region {
  type: 'ZIP' | 'COUNTY' | 'STATE' | 'CITY' | 'MSA';
  value: string;
  name?: string;
  include: boolean;
  parentState?: string;
  parentCounty?: string;
}

export interface SavedTerritory {
  id: string;
  name: string;
  description?: string;
  regions: Region[];
  regionCount: number;
  estimatedLeads?: number;
  color?: string;
  isDefault?: boolean;
  timesUsed?: number;
  lastUsedAt?: string;
}

export interface StateOption {
  code: string;
  name: string;
  countyCount?: number;
  zipCount?: number;
}

export interface CountyOption {
  id: string;
  state: string;
  county: string;
  zipCount?: number;
}

export interface RegionSelectorProps {
  value: Region[];
  onChange: (regions: Region[]) => void;
  campaignId?: string;
  disabled?: boolean;
  showEstimate?: boolean;
  showSavedTerritories?: boolean;
  maxRegions?: number;
  className?: string;
}

// ============================================================================
// Constants
// ============================================================================

const US_STATES: StateOption[] = [
  { code: 'AL', name: 'Alabama' },
  { code: 'AK', name: 'Alaska' },
  { code: 'AZ', name: 'Arizona' },
  { code: 'AR', name: 'Arkansas' },
  { code: 'CA', name: 'California' },
  { code: 'CO', name: 'Colorado' },
  { code: 'CT', name: 'Connecticut' },
  { code: 'DE', name: 'Delaware' },
  { code: 'DC', name: 'District of Columbia' },
  { code: 'FL', name: 'Florida' },
  { code: 'GA', name: 'Georgia' },
  { code: 'HI', name: 'Hawaii' },
  { code: 'ID', name: 'Idaho' },
  { code: 'IL', name: 'Illinois' },
  { code: 'IN', name: 'Indiana' },
  { code: 'IA', name: 'Iowa' },
  { code: 'KS', name: 'Kansas' },
  { code: 'KY', name: 'Kentucky' },
  { code: 'LA', name: 'Louisiana' },
  { code: 'ME', name: 'Maine' },
  { code: 'MD', name: 'Maryland' },
  { code: 'MA', name: 'Massachusetts' },
  { code: 'MI', name: 'Michigan' },
  { code: 'MN', name: 'Minnesota' },
  { code: 'MS', name: 'Mississippi' },
  { code: 'MO', name: 'Missouri' },
  { code: 'MT', name: 'Montana' },
  { code: 'NE', name: 'Nebraska' },
  { code: 'NV', name: 'Nevada' },
  { code: 'NH', name: 'New Hampshire' },
  { code: 'NJ', name: 'New Jersey' },
  { code: 'NM', name: 'New Mexico' },
  { code: 'NY', name: 'New York' },
  { code: 'NC', name: 'North Carolina' },
  { code: 'ND', name: 'North Dakota' },
  { code: 'OH', name: 'Ohio' },
  { code: 'OK', name: 'Oklahoma' },
  { code: 'OR', name: 'Oregon' },
  { code: 'PA', name: 'Pennsylvania' },
  { code: 'RI', name: 'Rhode Island' },
  { code: 'SC', name: 'South Carolina' },
  { code: 'SD', name: 'South Dakota' },
  { code: 'TN', name: 'Tennessee' },
  { code: 'TX', name: 'Texas' },
  { code: 'UT', name: 'Utah' },
  { code: 'VT', name: 'Vermont' },
  { code: 'VA', name: 'Virginia' },
  { code: 'WA', name: 'Washington' },
  { code: 'WV', name: 'West Virginia' },
  { code: 'WI', name: 'Wisconsin' },
  { code: 'WY', name: 'Wyoming' },
];

// ============================================================================
// Component
// ============================================================================

export function RegionSelector({
  value,
  onChange,
  campaignId,
  disabled = false,
  showEstimate = true,
  showSavedTerritories = true,
  maxRegions = 100,
  className,
}: RegionSelectorProps) {
  const queryClient = useQueryClient();

  // Local state
  const [activeTab, setActiveTab] = useState<'states' | 'counties' | 'zips' | 'territories'>('states');
  const [selectedStates, setSelectedStates] = useState<string[]>([]);
  const [zipInput, setZipInput] = useState('');
  const [showExcludeMode, setShowExcludeMode] = useState(false);
  const [saveTerritoryOpen, setSaveTerritoryOpen] = useState(false);
  const [territoryName, setTerritoryName] = useState('');
  const [territoryDescription, setTerritoryDescription] = useState('');

  // Sync selected states from value
  useEffect(() => {
    const statesFromValue = value
      .filter((r) => r.type === 'STATE' && r.include)
      .map((r) => r.value);
    if (JSON.stringify(statesFromValue) !== JSON.stringify(selectedStates)) {
      setSelectedStates(statesFromValue);
    }
  }, [value]);

  // Fetch counties for selected states
  const { data: counties = [], isLoading: countiesLoading } = useQuery<CountyOption[]>({
    queryKey: ['counties', selectedStates],
    queryFn: async () => {
      if (selectedStates.length === 0) return [];
      const params = new URLSearchParams();
      selectedStates.forEach((s) => params.append('state', s));
      const res = await fetch(`/api/regions/counties?${params}`);
      if (!res.ok) return [];
      return res.json();
    },
    enabled: selectedStates.length > 0,
  });

  // Fetch saved territories
  const { data: territories = [], isLoading: territoriesLoading } = useQuery<SavedTerritory[]>({
    queryKey: ['territories'],
    queryFn: async () => {
      const res = await fetch('/api/territories');
      if (!res.ok) return [];
      return res.json();
    },
    enabled: showSavedTerritories,
  });

  // Fetch lead estimate
  const { data: estimate, isLoading: estimateLoading } = useQuery({
    queryKey: ['region-estimate', value],
    queryFn: async () => {
      if (value.length === 0) return { count: 0 };
      const res = await fetch('/api/regions/estimate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ regions: value }),
      });
      if (!res.ok) return { count: 0 };
      return res.json();
    },
    enabled: showEstimate && value.length > 0,
  });

  // Save territory mutation
  const saveTerritory = useMutation({
    mutationFn: async (data: { name: string; description?: string; regions: Region[] }) => {
      const res = await fetch('/api/territories', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.error || 'Failed to save territory');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['territories'] });
      toast.success('Territory saved successfully');
      setSaveTerritoryOpen(false);
      setTerritoryName('');
      setTerritoryDescription('');
    },
    onError: (err: Error) => {
      toast.error(err.message);
    },
  });

  // ============================================================================
  // Handlers
  // ============================================================================

  const addRegion = useCallback((region: Region) => {
    if (value.length >= maxRegions) {
      toast.error(`Maximum ${maxRegions} regions allowed`);
      return;
    }

    // Check for duplicates
    const exists = value.some(
      (r) => r.type === region.type && r.value === region.value && r.include === region.include
    );
    if (exists) return;

    onChange([...value, region]);
  }, [value, onChange, maxRegions]);

  const removeRegion = useCallback((index: number) => {
    const newRegions = [...value];
    newRegions.splice(index, 1);
    onChange(newRegions);
  }, [value, onChange]);

  const toggleStateSelection = useCallback((stateCode: string) => {
    const isSelected = selectedStates.includes(stateCode);
    const newSelected = isSelected
      ? selectedStates.filter((s) => s !== stateCode)
      : [...selectedStates, stateCode];

    setSelectedStates(newSelected);

    // Update value with state regions
    const newRegions = value.filter((r) => r.type !== 'STATE');
    newSelected.forEach((code) => {
      newRegions.push({
        type: 'STATE',
        value: code,
        name: US_STATES.find((s) => s.code === code)?.name || code,
        include: !showExcludeMode,
      });
    });
    onChange(newRegions);
  }, [selectedStates, value, onChange, showExcludeMode]);

  const toggleCountySelection = useCallback((county: CountyOption) => {
    const countyKey = `${county.state}_${county.county}`;
    const existingIndex = value.findIndex(
      (r) => r.type === 'COUNTY' && r.value === countyKey
    );

    if (existingIndex >= 0) {
      removeRegion(existingIndex);
    } else {
      addRegion({
        type: 'COUNTY',
        value: countyKey,
        name: `${county.county}, ${county.state}`,
        include: !showExcludeMode,
        parentState: county.state,
      });
    }
  }, [value, addRegion, removeRegion, showExcludeMode]);

  const handleZipInput = useCallback(() => {
    if (!zipInput.trim()) return;

    const zips = parseZipInput(zipInput);
    if (zips.length === 0) {
      toast.error('Please enter valid ZIP codes');
      return;
    }

    if (value.length + zips.length > maxRegions) {
      toast.error(`Adding ${zips.length} ZIPs would exceed maximum of ${maxRegions} regions`);
      return;
    }

    const newRegions = [...value];
    let added = 0;

    for (const zip of zips) {
      const exists = value.some((r) => r.type === 'ZIP' && r.value === zip);
      if (!exists) {
        newRegions.push({
          type: 'ZIP',
          value: zip,
          include: !showExcludeMode,
        });
        added++;
      }
    }

    if (added > 0) {
      onChange(newRegions);
      toast.success(`Added ${added} ZIP code${added > 1 ? 's' : ''}`);
    } else {
      toast.info('All ZIP codes already added');
    }

    setZipInput('');
  }, [zipInput, value, onChange, maxRegions, showExcludeMode]);

  const loadTerritory = useCallback((territory: SavedTerritory) => {
    if (territory.regions.length + value.length > maxRegions) {
      // Replace instead of append
      onChange(territory.regions);
    } else {
      // Append, avoiding duplicates
      const newRegions = [...value];
      for (const region of territory.regions) {
        const exists = value.some(
          (r) => r.type === region.type && r.value === region.value
        );
        if (!exists) {
          newRegions.push(region);
        }
      }
      onChange(newRegions);
    }
    toast.success(`Loaded territory: ${territory.name}`);
  }, [value, onChange, maxRegions]);

  const clearAllRegions = useCallback(() => {
    onChange([]);
    setSelectedStates([]);
    toast.success('All regions cleared');
  }, [onChange]);

  // ============================================================================
  // Computed values
  // ============================================================================

  const includedRegions = useMemo(() => value.filter((r) => r.include), [value]);
  const excludedRegions = useMemo(() => value.filter((r) => !r.include), [value]);

  const selectedCounties = useMemo(() => {
    return value
      .filter((r) => r.type === 'COUNTY')
      .map((r) => r.value);
  }, [value]);

  const regionsByType = useMemo(() => {
    const grouped: Record<string, Region[]> = {
      STATE: [],
      COUNTY: [],
      ZIP: [],
      CITY: [],
      MSA: [],
    };
    for (const region of value) {
      grouped[region.type]?.push(region);
    }
    return grouped;
  }, [value]);

  // ============================================================================
  // Render
  // ============================================================================

  return (
    <div className={cn('space-y-4', className)}>
      {/* Header with mode toggle and actions */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <MapPinIcon className="h-5 w-5 text-gray-500" />
          <span className="font-medium">Regional Targeting</span>
          {value.length > 0 && (
            <Badge variant="secondary">{value.length} region{value.length !== 1 ? 's' : ''}</Badge>
          )}
        </div>
        <div className="flex items-center gap-2">
          {/* Include/Exclude toggle */}
          <div className="flex items-center gap-2 text-sm">
            <Label htmlFor="exclude-mode" className={cn(
              'cursor-pointer',
              showExcludeMode ? 'text-red-600' : 'text-gray-500'
            )}>
              Exclude mode
            </Label>
            <Switch
              id="exclude-mode"
              checked={showExcludeMode}
              onCheckedChange={setShowExcludeMode}
              disabled={disabled}
            />
          </div>
          {/* Save as territory */}
          {value.length > 0 && showSavedTerritories && (
            <Button
              variant="outline"
              size="sm"
              onClick={() => setSaveTerritoryOpen(true)}
              disabled={disabled}
            >
              <BookmarkIcon className="h-4 w-4 mr-1" />
              Save
            </Button>
          )}
          {/* Clear all */}
          {value.length > 0 && (
            <Button
              variant="ghost"
              size="sm"
              onClick={clearAllRegions}
              disabled={disabled}
            >
              Clear all
            </Button>
          )}
        </div>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 p-1 bg-gray-100 rounded-lg">
        {[
          { key: 'states', label: 'States', icon: MapIcon },
          { key: 'counties', label: 'Counties', icon: MapPinIcon },
          { key: 'zips', label: 'ZIP Codes', icon: MagnifyingGlassIcon },
          ...(showSavedTerritories ? [{ key: 'territories', label: 'Saved', icon: FolderIcon }] : []),
        ].map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            onClick={() => setActiveTab(key as typeof activeTab)}
            disabled={disabled}
            className={cn(
              'flex-1 flex items-center justify-center gap-1.5 px-3 py-2 text-sm font-medium rounded-md transition-colors',
              activeTab === key
                ? 'bg-white text-gray-900 shadow-sm'
                : 'text-gray-500 hover:text-gray-700'
            )}
          >
            <Icon className="h-4 w-4" />
            <span className="hidden sm:inline">{label}</span>
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="min-h-[200px]">
        {/* States tab */}
        {activeTab === 'states' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              Select states to target. All leads within selected states will be included.
            </p>
            <div className="grid grid-cols-4 sm:grid-cols-6 md:grid-cols-8 gap-2">
              {US_STATES.map((state) => {
                const isSelected = selectedStates.includes(state.code);
                return (
                  <button
                    key={state.code}
                    onClick={() => toggleStateSelection(state.code)}
                    disabled={disabled}
                    title={state.name}
                    className={cn(
                      'px-2 py-1.5 text-sm font-medium rounded border transition-all',
                      isSelected
                        ? showExcludeMode
                          ? 'bg-red-50 border-red-300 text-red-700'
                          : 'bg-blue-50 border-blue-300 text-blue-700'
                        : 'bg-white border-gray-200 text-gray-600 hover:border-gray-300'
                    )}
                  >
                    {state.code}
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* Counties tab */}
        {activeTab === 'counties' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              {selectedStates.length === 0
                ? 'Select states first to see available counties.'
                : `Select counties from: ${selectedStates.join(', ')}`}
            </p>
            {selectedStates.length > 0 && (
              countiesLoading ? (
                <div className="py-8 text-center text-gray-500">Loading counties...</div>
              ) : counties.length === 0 ? (
                <div className="py-8 text-center text-gray-500">No counties found</div>
              ) : (
                <div className="max-h-[300px] overflow-y-auto border rounded-lg">
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-0.5 p-2">
                    {counties.map((county) => {
                      const countyKey = `${county.state}_${county.county}`;
                      const isSelected = selectedCounties.includes(countyKey);
                      return (
                        <button
                          key={countyKey}
                          onClick={() => toggleCountySelection(county)}
                          disabled={disabled}
                          className={cn(
                            'flex items-center gap-2 px-3 py-2 text-sm rounded text-left transition-colors',
                            isSelected
                              ? showExcludeMode
                                ? 'bg-red-50 text-red-700'
                                : 'bg-blue-50 text-blue-700'
                              : 'hover:bg-gray-50'
                          )}
                        >
                          <div className={cn(
                            'w-4 h-4 rounded border flex items-center justify-center',
                            isSelected
                              ? showExcludeMode
                                ? 'bg-red-500 border-red-500'
                                : 'bg-blue-500 border-blue-500'
                              : 'border-gray-300'
                          )}>
                            {isSelected && <CheckIcon className="h-3 w-3 text-white" />}
                          </div>
                          <span className="truncate">{county.county}</span>
                          <span className="text-xs text-gray-400 ml-auto">{county.state}</span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )
            )}
          </div>
        )}

        {/* ZIP codes tab */}
        {activeTab === 'zips' && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              Enter ZIP codes separated by commas, spaces, or newlines. Use ranges like 90210-90220.
            </p>
            <div className="flex gap-2">
              <Input
                placeholder="90210, 90211, 90212 or 90210-90220"
                value={zipInput}
                onChange={(e) => setZipInput(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleZipInput()}
                disabled={disabled}
                className="flex-1"
              />
              <Button onClick={handleZipInput} disabled={disabled || !zipInput.trim()}>
                <PlusIcon className="h-4 w-4 mr-1" />
                Add
              </Button>
            </div>
            {regionsByType.ZIP.length > 0 && (
              <div className="flex flex-wrap gap-1.5 p-3 bg-gray-50 rounded-lg max-h-[200px] overflow-y-auto">
                {regionsByType.ZIP.map((region, index) => (
                  <Badge
                    key={`${region.value}-${index}`}
                    variant={region.include ? 'secondary' : 'destructive'}
                    className="flex items-center gap-1"
                  >
                    {!region.include && <span className="text-xs">NOT</span>}
                    {region.value}
                    <button
                      onClick={() => {
                        const globalIndex = value.findIndex(
                          (r) => r.type === 'ZIP' && r.value === region.value
                        );
                        if (globalIndex >= 0) removeRegion(globalIndex);
                      }}
                      className="ml-0.5 hover:bg-gray-200 rounded-full p-0.5"
                    >
                      <XMarkIcon className="h-3 w-3" />
                    </button>
                  </Badge>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Saved territories tab */}
        {activeTab === 'territories' && showSavedTerritories && (
          <div className="space-y-3">
            <p className="text-sm text-gray-500">
              Load a saved territory or save your current selection for reuse.
            </p>
            {territoriesLoading ? (
              <div className="py-8 text-center text-gray-500">Loading territories...</div>
            ) : territories.length === 0 ? (
              <div className="py-8 text-center text-gray-500">
                <FolderIcon className="h-10 w-10 mx-auto text-gray-300 mb-2" />
                <p>No saved territories yet</p>
                <p className="text-xs mt-1">Select regions and click "Save" to create one</p>
              </div>
            ) : (
              <div className="space-y-2">
                {territories.map((territory) => (
                  <Card
                    key={territory.id}
                    className="cursor-pointer hover:border-blue-300 transition-colors"
                    onClick={() => loadTerritory(territory)}
                  >
                    <CardContent className="py-3 px-4">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {territory.isDefault ? (
                            <BookmarkIconSolid className="h-4 w-4 text-yellow-500" />
                          ) : (
                            <BookmarkIcon className="h-4 w-4 text-gray-400" />
                          )}
                          <span className="font-medium">{territory.name}</span>
                        </div>
                        <div className="flex items-center gap-2 text-sm text-gray-500">
                          <Badge variant="outline">{territory.regionCount} regions</Badge>
                          {territory.estimatedLeads && (
                            <Badge variant="secondary">
                              ~{territory.estimatedLeads.toLocaleString()} leads
                            </Badge>
                          )}
                        </div>
                      </div>
                      {territory.description && (
                        <p className="text-sm text-gray-500 mt-1">{territory.description}</p>
                      )}
                    </CardContent>
                  </Card>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Selected regions summary */}
      {value.length > 0 && (
        <div className="border-t pt-4">
          <div className="flex items-center justify-between mb-2">
            <span className="text-sm font-medium text-gray-700">Selected Regions</span>
            {showEstimate && (
              <div className="flex items-center gap-1 text-sm">
                <UsersIcon className="h-4 w-4 text-gray-400" />
                {estimateLoading ? (
                  <span className="text-gray-400">Calculating...</span>
                ) : (
                  <span className="text-gray-600">
                    ~{(estimate?.count || 0).toLocaleString()} estimated leads
                  </span>
                )}
              </div>
            )}
          </div>

          {/* Included regions */}
          {includedRegions.length > 0 && (
            <div className="mb-2">
              <Label className="text-xs text-green-600 uppercase tracking-wider">Include</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {includedRegions.slice(0, 20).map((region, index) => (
                  <RegionBadge
                    key={`inc-${region.type}-${region.value}-${index}`}
                    region={region}
                    onRemove={() => {
                      const globalIndex = value.findIndex(
                        (r) => r.type === region.type && r.value === region.value && r.include
                      );
                      if (globalIndex >= 0) removeRegion(globalIndex);
                    }}
                  />
                ))}
                {includedRegions.length > 20 && (
                  <Badge variant="secondary">+{includedRegions.length - 20} more</Badge>
                )}
              </div>
            </div>
          )}

          {/* Excluded regions */}
          {excludedRegions.length > 0 && (
            <div>
              <Label className="text-xs text-red-600 uppercase tracking-wider">Exclude</Label>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {excludedRegions.slice(0, 10).map((region, index) => (
                  <RegionBadge
                    key={`exc-${region.type}-${region.value}-${index}`}
                    region={region}
                    variant="destructive"
                    onRemove={() => {
                      const globalIndex = value.findIndex(
                        (r) => r.type === region.type && r.value === region.value && !r.include
                      );
                      if (globalIndex >= 0) removeRegion(globalIndex);
                    }}
                  />
                ))}
                {excludedRegions.length > 10 && (
                  <Badge variant="destructive">+{excludedRegions.length - 10} more</Badge>
                )}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Empty state */}
      {value.length === 0 && (
        <div className="text-center py-6 text-gray-500 border-t">
          <MapIcon className="h-8 w-8 mx-auto text-gray-300 mb-2" />
          <p className="text-sm">No regions selected</p>
          <p className="text-xs mt-1">All leads will be targeted</p>
        </div>
      )}

      {/* Save territory dialog */}
      <Dialog open={saveTerritoryOpen} onOpenChange={setSaveTerritoryOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Save Territory</DialogTitle>
            <DialogDescription>
              Save your current region selection as a territory for easy reuse.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4 py-4">
            <div className="space-y-2">
              <Label htmlFor="territory-name">Name</Label>
              <Input
                id="territory-name"
                placeholder="e.g., LA Metro Area, Texas Oil Counties"
                value={territoryName}
                onChange={(e) => setTerritoryName(e.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="territory-description">Description (optional)</Label>
              <Input
                id="territory-description"
                placeholder="Notes about this territory..."
                value={territoryDescription}
                onChange={(e) => setTerritoryDescription(e.target.value)}
              />
            </div>
            <div className="text-sm text-gray-500">
              This will save {value.length} region{value.length !== 1 ? 's' : ''}.
            </div>
          </div>
          <DialogFooter>
            <Button variant="outline" onClick={() => setSaveTerritoryOpen(false)}>
              Cancel
            </Button>
            <Button
              onClick={() => saveTerritory.mutate({
                name: territoryName,
                description: territoryDescription || undefined,
                regions: value,
              })}
              disabled={!territoryName.trim() || saveTerritory.isPending}
            >
              {saveTerritory.isPending ? 'Saving...' : 'Save Territory'}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

// ============================================================================
// Helper Components
// ============================================================================

function RegionBadge({
  region,
  variant = 'secondary',
  onRemove,
}: {
  region: Region;
  variant?: 'secondary' | 'destructive';
  onRemove?: () => void;
}) {
  const label = region.name || region.value;
  const typeLabel = region.type.toLowerCase();

  return (
    <Badge variant={variant} className="flex items-center gap-1 pr-1">
      <span className="text-xs opacity-60">{typeLabel}:</span>
      <span>{label}</span>
      {onRemove && (
        <button
          onClick={(e) => {
            e.stopPropagation();
            onRemove();
          }}
          className="ml-0.5 hover:bg-black/10 rounded-full p-0.5"
        >
          <XMarkIcon className="h-3 w-3" />
        </button>
      )}
    </Badge>
  );
}

// ============================================================================
// Utilities
// ============================================================================

/**
 * Parse ZIP code input supporting:
 * - Single: 90210
 * - Multiple: 90210, 90211, 90212
 * - Ranges: 90210-90220
 * - Mixed: 90210, 90215-90220, 90230
 */
function parseZipInput(input: string): string[] {
  const zips: string[] = [];
  const parts = input.split(/[\s,\n]+/).filter(Boolean);

  for (const part of parts) {
    if (part.includes('-')) {
      // Range
      const [start, end] = part.split('-').map((s) => s.trim());
      if (/^\d{5}$/.test(start) && /^\d{5}$/.test(end)) {
        const startNum = parseInt(start, 10);
        const endNum = parseInt(end, 10);
        if (endNum >= startNum && endNum - startNum <= 100) {
          for (let i = startNum; i <= endNum; i++) {
            zips.push(i.toString().padStart(5, '0'));
          }
        }
      }
    } else if (/^\d{5}$/.test(part)) {
      // Single ZIP
      zips.push(part);
    }
  }

  return [...new Set(zips)]; // Dedupe
}

export default RegionSelector;
