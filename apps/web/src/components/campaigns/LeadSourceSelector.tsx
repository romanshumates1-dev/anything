'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import {
  Upload,
  Search,
  Users,
  FileSpreadsheet,
  Sparkles,
  CheckCircle2,
  Loader2,
  ExternalLink,
} from 'lucide-react';

export type LeadSourceType = 'csv' | 'paste' | 'crm' | 'lead-finder';

export interface LeadSourceSelection {
  type: LeadSourceType;
  contactListId?: string;
  pastedContacts?: string;
  selectedLeadIds?: number[];
  consentMode?: 'unverified' | 'inbound' | 'consented';
}

interface ContactList {
  id: string;
  name: string;
  consent_mode: string;
  total_rows?: number;
  source_type?: string;
  created_at?: string;
}

interface LeadSourceSelectorProps {
  value: LeadSourceSelection;
  onChange: (value: LeadSourceSelection) => void;
  onOpenLeadFinder?: () => void;
  disabled?: boolean;
}

export function LeadSourceSelector({
  value,
  onChange,
  onOpenLeadFinder,
  disabled = false,
}: LeadSourceSelectorProps) {
  const [activeTab, setActiveTab] = useState<LeadSourceType>(value.type);

  const { data: contactLists, isLoading: listsLoading } = useQuery<ContactList[]>({
    queryKey: ['contact-lists'],
    queryFn: async () => {
      const res = await fetch('/api/contact-lists');
      if (!res.ok) return [];
      return res.json();
    },
  });

  const { data: sourcedLeadsCounts } = useQuery({
    queryKey: ['sourced-leads-counts'],
    queryFn: async () => {
      const res = await fetch('/api/lead-finder/sourced-leads?limit=1');
      if (!res.ok) return { counts: { new_count: 0 } };
      return res.json();
    },
  });

  const handleTabChange = (tab: string) => {
    const newType = tab as LeadSourceType;
    setActiveTab(newType);
    onChange({ ...value, type: newType });
  };

  const handleListSelect = (listId: string) => {
    const list = contactLists?.find((l) => l.id === listId);
    onChange({
      ...value,
      type: 'crm',
      contactListId: listId,
      consentMode: (list?.consent_mode as any) || 'unverified',
    });
  };

  const handlePastedContactsChange = (contacts: string) => {
    onChange({
      ...value,
      type: 'paste',
      pastedContacts: contacts,
    });
  };

  const leadFinderLists = contactLists?.filter(
    (l) => l.source_type === 'lead-finder'
  );
  const regularLists = contactLists?.filter(
    (l) => l.source_type !== 'lead-finder'
  );
  const newLeadsCount = sourcedLeadsCounts?.counts?.new_count || 0;

  return (
    <div className="space-y-4">
      <Tabs value={activeTab} onValueChange={handleTabChange}>
        <TabsList className="grid w-full grid-cols-4">
          <TabsTrigger value="csv" disabled={disabled}>
            <Upload className="h-4 w-4 mr-1.5" />
            <span className="hidden sm:inline">CSV</span>
          </TabsTrigger>
          <TabsTrigger value="paste" disabled={disabled}>
            <FileSpreadsheet className="h-4 w-4 mr-1.5" />
            <span className="hidden sm:inline">Paste</span>
          </TabsTrigger>
          <TabsTrigger value="crm" disabled={disabled}>
            <Users className="h-4 w-4 mr-1.5" />
            <span className="hidden sm:inline">Lists</span>
          </TabsTrigger>
          <TabsTrigger value="lead-finder" disabled={disabled}>
            <Search className="h-4 w-4 mr-1.5" />
            <span className="hidden sm:inline">Find</span>
            {newLeadsCount > 0 && (
              <Badge variant="secondary" className="ml-1 text-xs px-1.5 py-0">
                {newLeadsCount}
              </Badge>
            )}
          </TabsTrigger>
        </TabsList>

        <TabsContent value="csv" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">CSV Upload</CardTitle>
              <CardDescription>
                Upload a CSV file with phone numbers and optional name/address fields
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="border-2 border-dashed border-gray-200 rounded-lg p-6 text-center hover:border-gray-300 transition-colors cursor-pointer">
                <Upload className="h-8 w-8 mx-auto text-gray-400 mb-2" />
                <p className="text-sm text-gray-600 mb-1">
                  Drop CSV here or click to browse
                </p>
                <p className="text-xs text-gray-400">
                  Required: phone. Optional: name, address, city, email
                </p>
                <Input
                  type="file"
                  accept=".csv"
                  className="hidden"
                  id="csv-upload"
                  disabled={disabled}
                />
                <label htmlFor="csv-upload">
                  <Button variant="outline" size="sm" className="mt-3" asChild>
                    <span>Select File</span>
                  </Button>
                </label>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="paste" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Paste Phone Numbers</CardTitle>
              <CardDescription>
                Enter phone numbers directly, one per line
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                <Textarea
                  rows={6}
                  value={value.pastedContacts || ''}
                  onChange={(e) => handlePastedContactsChange(e.target.value)}
                  placeholder={'+1 (555) 000-0000\n+1 (555) 000-0001\n+1 (555) 000-0002'}
                  disabled={disabled}
                />
                <div className="flex items-center justify-between">
                  <p className="text-xs text-gray-500">
                    {(value.pastedContacts || '').split('\n').filter(Boolean).length} numbers
                  </p>
                  <Badge variant="outline">Consent: Unverified</Badge>
                </div>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="crm" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base">Select Contact List</CardTitle>
              <CardDescription>
                Choose from your existing contact lists
              </CardDescription>
            </CardHeader>
            <CardContent>
              {listsLoading ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="h-6 w-6 animate-spin text-gray-400" />
                </div>
              ) : (contactLists?.length || 0) === 0 ? (
                <div className="text-center py-6">
                  <Users className="h-10 w-10 mx-auto text-gray-300 mb-2" />
                  <p className="text-sm text-gray-500 mb-3">No contact lists yet</p>
                  <Button variant="outline" size="sm" onClick={onOpenLeadFinder}>
                    <Search className="h-4 w-4 mr-1.5" />
                    Find leads first
                  </Button>
                </div>
              ) : (
                <div className="space-y-4">
                  {/* Lead Finder Lists Section */}
                  {(leadFinderLists?.length || 0) > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-500 uppercase tracking-wider flex items-center gap-1.5">
                        <Sparkles className="h-3 w-3" />
                        From Lead Finder
                      </Label>
                      <div className="grid gap-2">
                        {leadFinderLists?.map((list) => (
                          <button
                            key={list.id}
                            onClick={() => handleListSelect(list.id)}
                            disabled={disabled}
                            className={`w-full p-3 rounded-lg text-left transition-all border ${
                              value.contactListId === list.id
                                ? 'border-blue-500 bg-blue-50 ring-1 ring-blue-500'
                                : 'border-gray-200 hover:border-gray-300 hover:bg-gray-50'
                            }`}
                          >
                            <div className="flex items-center justify-between">
                              <div className="flex items-center gap-2">
                                {value.contactListId === list.id && (
                                  <CheckCircle2 className="h-4 w-4 text-blue-600" />
                                )}
                                <span className="font-medium text-sm">{list.name}</span>
                              </div>
                              <div className="flex items-center gap-2">
                                {list.total_rows && (
                                  <Badge variant="secondary" className="text-xs">
                                    {list.total_rows} contacts
                                  </Badge>
                                )}
                                <Badge variant="outline" className="text-xs capitalize">
                                  {list.consent_mode}
                                </Badge>
                              </div>
                            </div>
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* Regular Lists Section */}
                  {(regularLists?.length || 0) > 0 && (
                    <div className="space-y-2">
                      <Label className="text-xs text-gray-500 uppercase tracking-wider">
                        Imported Lists
                      </Label>
                      <Select
                        value={value.contactListId || ''}
                        onValueChange={handleListSelect}
                        disabled={disabled}
                      >
                        <SelectTrigger>
                          <SelectValue placeholder="Select a list..." />
                        </SelectTrigger>
                        <SelectContent>
                          {regularLists?.map((list) => (
                            <SelectItem key={list.id} value={list.id}>
                              {list.name} ({list.consent_mode})
                              {list.total_rows && ` - ${list.total_rows} contacts`}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="lead-finder" className="mt-4">
          <Card>
            <CardHeader className="pb-3">
              <CardTitle className="text-base flex items-center gap-2">
                <Sparkles className="h-4 w-4 text-blue-500" />
                Lead Finder
              </CardTitle>
              <CardDescription>
                Discover motivated sellers from public records and distress signals
              </CardDescription>
            </CardHeader>
            <CardContent>
              <div className="space-y-4">
                {newLeadsCount > 0 && (
                  <div className="bg-blue-50 border border-blue-200 rounded-lg p-3">
                    <p className="text-sm text-blue-700">
                      <strong>{newLeadsCount.toLocaleString()}</strong> new leads available in Lead Finder
                    </p>
                  </div>
                )}

                <div className="flex flex-col gap-3">
                  <Button
                    onClick={onOpenLeadFinder}
                    disabled={disabled}
                    className="w-full"
                  >
                    <Search className="h-4 w-4 mr-2" />
                    Open Lead Finder
                  </Button>

                  <Button
                    variant="outline"
                    onClick={() => window.open('/lead-finder', '_blank')}
                    disabled={disabled}
                    className="w-full"
                  >
                    <ExternalLink className="h-4 w-4 mr-2" />
                    Open in New Tab
                  </Button>
                </div>

                {(leadFinderLists?.length || 0) > 0 && (
                  <div className="border-t pt-4">
                    <Label className="text-xs text-gray-500 mb-2 block">
                      Or select from saved Lead Finder lists:
                    </Label>
                    <div className="space-y-2">
                      {leadFinderLists?.slice(0, 3).map((list) => (
                        <button
                          key={list.id}
                          onClick={() => {
                            handleListSelect(list.id);
                            setActiveTab('crm');
                          }}
                          disabled={disabled}
                          className="w-full p-2 rounded border border-gray-200 hover:border-gray-300 hover:bg-gray-50 text-left text-sm flex items-center justify-between"
                        >
                          <span>{list.name}</span>
                          {list.total_rows && (
                            <Badge variant="secondary" className="text-xs">
                              {list.total_rows}
                            </Badge>
                          )}
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

export default LeadSourceSelector;
