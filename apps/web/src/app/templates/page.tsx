'use client';

import { useState, useCallback } from 'react';
import { useSession } from '@/lib/auth-client';
import { redirect } from 'next/navigation';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import Link from 'next/link';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { Badge } from '@/components/ui/badge';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AITemplateGenerator } from '@/components/templates/AITemplateGenerator';
import {
  Sparkles,
  BookOpen,
  Plus,
  Search,
  Star,
  Copy,
  Check,
  Clock,
  MessageSquare,
  Mail,
  Trash2,
  Edit3,
  Heart,
  Filter,
  Grid3X3,
  List,
  ChevronRight,
  ArrowLeft,
  Save,
  X,
  Loader2,
  TrendingUp,
  ExternalLink,
} from 'lucide-react';

interface Template {
  id: string;
  name: string;
  description?: string;
  category: string;
  channel: string;
  subject?: string;
  body: string;
  follow_up_1?: string;
  follow_up_1_delay_hours?: number;
  follow_up_2?: string;
  follow_up_2_delay_hours?: number;
  follow_up_3?: string;
  follow_up_3_delay_hours?: number;
  variables: string[];
  tags?: string[];
  use_count: number;
  avg_response_rate?: number;
  is_featured?: boolean;
  is_favorite?: boolean;
  source: 'user' | 'library';
  created_at?: string;
}

const CATEGORY_LABELS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  cold_outreach: { label: 'Cold Outreach', icon: MessageSquare, color: '#3b82f6' },
  follow_up: { label: 'Follow-up', icon: Clock, color: '#8b5cf6' },
  closing: { label: 'Closing', icon: TrendingUp, color: '#22c55e' },
  reengagement: { label: 'Re-engagement', icon: Sparkles, color: '#f59e0b' },
  buyer_outreach: { label: 'Buyer Outreach', icon: ExternalLink, color: '#3b82f6' },
  custom: { label: 'Custom', icon: Edit3, color: '#6b7280' },
};

export default function TemplatesPage() {
  const { data: session, isPending: authLoading } = useSession();
  const queryClient = useQueryClient();

  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [activeTab, setActiveTab] = useState<'library' | 'my-templates' | 'create'>('library');
  const [editingTemplate, setEditingTemplate] = useState<Template | null>(null);
  const [showCreateForm, setShowCreateForm] = useState(false);

  // Fetch templates
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['templates-page', { search: searchQuery, category: selectedCategory }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('includeLibrary', 'true');
      if (selectedCategory) params.set('category', selectedCategory);

      const res = await fetch(`/api/templates?${params}`);
      if (!res.ok) throw new Error('Failed to fetch templates');
      return res.json() as Promise<{ userTemplates: Template[]; libraryTemplates: Template[] }>;
    },
    enabled: !!session,
  });

  // Toggle favorite mutation
  const toggleFavoriteMutation = useMutation({
    mutationFn: async ({ id, isFavorite }: { id: string; isFavorite: boolean }) => {
      const res = await fetch(`/api/templates/${id}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ isFavorite }),
      });
      if (!res.ok) throw new Error('Failed to update');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates-page'] });
    },
  });

  // Delete template mutation
  const deleteMutation = useMutation({
    mutationFn: async (id: string) => {
      const res = await fetch(`/api/templates/${id}`, { method: 'DELETE' });
      if (!res.ok) throw new Error('Failed to delete');
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates-page'] });
    },
  });

  // Save template mutation
  const saveTemplateMutation = useMutation({
    mutationFn: async (template: {
      name: string;
      description?: string;
      category: string;
      channel: string;
      templateBody: string;
      followUp1?: string;
      followUp1DelayHours?: number;
      followUp2?: string;
      followUp2DelayHours?: number;
      sourceType?: string;
      sourceId?: string;
    }) => {
      const res = await fetch('/api/templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(template),
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(err.error || 'Failed to save template');
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['templates-page'] });
      setShowCreateForm(false);
      setActiveTab('my-templates');
    },
  });

  // Redirect if not authenticated
  if (!authLoading && !session) {
    redirect('/account/signin');
  }

  // Filter templates by search
  const filterTemplates = (templates: Template[]) => {
    if (!searchQuery.trim()) return templates;
    const query = searchQuery.toLowerCase();
    return templates.filter(
      (t) =>
        t.name.toLowerCase().includes(query) ||
        t.description?.toLowerCase().includes(query) ||
        t.body.toLowerCase().includes(query) ||
        t.tags?.some((tag) => tag.toLowerCase().includes(query))
    );
  };

  const userTemplates = filterTemplates(data?.userTemplates || []);
  const libraryTemplates = filterTemplates(data?.libraryTemplates || []);

  const allCategories = [
    ...new Set([
      ...userTemplates.map((t) => t.category),
      ...libraryTemplates.map((t) => t.category),
    ]),
  ];

  const highlightVariables = (text: string) => {
    const parts = text.split(/(\{\{[a-zA-Z]+\}\})/g);
    return parts.map((part, i) => {
      if (part.match(/\{\{[a-zA-Z]+\}\}/)) {
        return (
          <span
            key={i}
            className="px-1 py-0.5 rounded bg-[var(--accent-blue)]/15 text-[var(--accent-blue)] font-mono text-xs"
          >
            {part}
          </span>
        );
      }
      return <span key={i}>{part}</span>;
    });
  };

  const handleCopyToLibrary = useCallback(
    (template: Template) => {
      saveTemplateMutation.mutate({
        name: template.name + ' (Copy)',
        description: template.description,
        category: template.category,
        channel: template.channel,
        templateBody: template.body,
        followUp1: template.follow_up_1,
        followUp1DelayHours: template.follow_up_1_delay_hours,
        followUp2: template.follow_up_2,
        followUp2DelayHours: template.follow_up_2_delay_hours,
        sourceType: 'library_copy',
        sourceId: template.id,
      });
    },
    [saveTemplateMutation]
  );

  const handleAITemplateGenerated = useCallback(
    (template: any) => {
      setShowCreateForm(true);
      // Pre-fill the create form with AI-generated content
    },
    []
  );

  if (authLoading) {
    return (
      <div className="flex min-h-screen items-center justify-center">
        <Loader2 className="h-8 w-8 animate-spin text-[var(--accent-blue)]" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-[var(--bg-primary)] py-8 px-4">
      <div className="max-w-6xl mx-auto space-y-8">
        {/* Header */}
        <header className="space-y-4">
          <Link
            href="/campaigns"
            className="inline-flex items-center gap-2 text-sm text-[var(--text-muted)] hover:text-[var(--text-primary)] transition-colors"
          >
            <ArrowLeft className="h-4 w-4" />
            Back to Campaigns
          </Link>
          <div className="flex items-start justify-between">
            <div>
              <h1 className="text-3xl font-bold text-[var(--text-primary)]">Template Library</h1>
              <p className="text-[var(--text-secondary)] mt-1">
                Create, save, and manage your campaign message templates
              </p>
            </div>
            <button
              onClick={() => {
                setActiveTab('create');
                setShowCreateForm(true);
              }}
              className="btn-gradient flex items-center gap-2 px-4 py-2.5 rounded-xl font-medium"
            >
              <Plus className="h-4 w-4" />
              Create Template
            </button>
          </div>
        </header>

        {/* Tabs */}
        <div className="flex items-center gap-1 p-1 rounded-xl bg-[var(--bg-tertiary)]">
          <button
            onClick={() => setActiveTab('library')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'library'
                ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <BookOpen className="h-4 w-4" />
            Pre-made Templates
            <Badge variant="outline" className="text-xs">{libraryTemplates.length}</Badge>
          </button>
          <button
            onClick={() => setActiveTab('my-templates')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'my-templates'
                ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <Star className="h-4 w-4" />
            My Templates
            <Badge variant="outline" className="text-xs">{userTemplates.length}</Badge>
          </button>
          <button
            onClick={() => setActiveTab('create')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-2.5 rounded-lg text-sm font-medium transition-all ${
              activeTab === 'create'
                ? 'bg-[var(--bg-secondary)] text-[var(--text-primary)] shadow-sm'
                : 'text-[var(--text-muted)] hover:text-[var(--text-secondary)]'
            }`}
          >
            <Sparkles className="h-4 w-4" />
            AI Generator
          </button>
        </div>

        {/* Search & Filters */}
        {activeTab !== 'create' && (
          <div className="flex flex-col sm:flex-row gap-3">
            <div className="relative flex-1">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-[var(--text-muted)]" />
              <Input
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search templates..."
                className="input-enhanced pl-10"
              />
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              <button
                onClick={() => setSelectedCategory(null)}
                className={`shrink-0 px-3 py-2 rounded-lg text-sm transition-colors ${
                  !selectedCategory
                    ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] border border-[var(--accent-blue)]/30'
                    : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] border border-transparent hover:text-[var(--text-primary)]'
                }`}
              >
                All
              </button>
              {allCategories.map((cat) => {
                const info = CATEGORY_LABELS[cat] || CATEGORY_LABELS.custom;
                return (
                  <button
                    key={cat}
                    onClick={() => setSelectedCategory(selectedCategory === cat ? null : cat)}
                    className={`shrink-0 px-3 py-2 rounded-lg text-sm transition-colors ${
                      selectedCategory === cat
                        ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)] border border-[var(--accent-blue)]/30'
                        : 'bg-[var(--bg-tertiary)] text-[var(--text-muted)] border border-transparent hover:text-[var(--text-primary)]'
                    }`}
                  >
                    {info.label}
                  </button>
                );
              })}
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => setViewMode('grid')}
                className={`p-2 rounded-lg transition-colors ${
                  viewMode === 'grid'
                    ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <Grid3X3 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode('list')}
                className={`p-2 rounded-lg transition-colors ${
                  viewMode === 'list'
                    ? 'bg-[var(--accent-blue)]/10 text-[var(--accent-blue)]'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-primary)]'
                }`}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
          </div>
        )}

        {/* Content */}
        {activeTab === 'library' && (
          <div className="space-y-6">
            {isLoading ? (
              <div className="py-12 text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-[var(--accent-blue)]" />
                <p className="text-[var(--text-muted)]">Loading templates...</p>
              </div>
            ) : libraryTemplates.length === 0 ? (
              <div className="py-12 text-center">
                <BookOpen className="h-12 w-12 text-[var(--text-muted)] mx-auto mb-3 opacity-50" />
                <p className="text-[var(--text-muted)]">No templates found</p>
              </div>
            ) : (
              <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' : 'space-y-4'}>
                {libraryTemplates.map((template) => {
                  const categoryInfo = CATEGORY_LABELS[template.category] || CATEGORY_LABELS.custom;
                  const CategoryIcon = categoryInfo.icon;

                  return (
                    <GlassCard key={template.id} padding="none" className="overflow-hidden">
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-center gap-2">
                            <div
                              className="p-1.5 rounded-lg"
                              style={{ backgroundColor: `${categoryInfo.color}15` }}
                            >
                              <CategoryIcon className="h-4 w-4" style={{ color: categoryInfo.color }} />
                            </div>
                            <div>
                              <h4 className="font-medium text-[var(--text-primary)]">{template.name}</h4>
                              <p className="text-xs text-[var(--text-muted)]">{categoryInfo.label}</p>
                            </div>
                          </div>
                          {template.is_featured && (
                            <Badge variant="outline" className="text-[10px] bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/30">
                              Featured
                            </Badge>
                          )}
                        </div>

                        <p className="text-sm text-[var(--text-secondary)] line-clamp-3 mb-3">
                          {highlightVariables(template.body)}
                        </p>

                        {template.avg_response_rate && (
                          <p className="text-xs text-[var(--color-success)] mb-3">
                            {template.avg_response_rate}% avg. response rate
                          </p>
                        )}

                        <div className="flex items-center justify-between pt-3 border-t border-[var(--border-subtle)]">
                          <div className="flex items-center gap-1">
                            {template.variables?.slice(0, 2).map((v, i) => (
                              <Badge key={i} variant="outline" className="text-[10px] font-mono py-0">
                                {v}
                              </Badge>
                            ))}
                          </div>
                          <button
                            onClick={() => handleCopyToLibrary(template)}
                            disabled={saveTemplateMutation.isPending}
                            className="flex items-center gap-1.5 text-sm text-[var(--accent-blue)] hover:underline"
                          >
                            <Copy className="h-3.5 w-3.5" />
                            Save Copy
                          </button>
                        </div>
                      </div>
                    </GlassCard>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'my-templates' && (
          <div className="space-y-6">
            {isLoading ? (
              <div className="py-12 text-center">
                <Loader2 className="h-8 w-8 animate-spin mx-auto mb-3 text-[var(--accent-blue)]" />
                <p className="text-[var(--text-muted)]">Loading templates...</p>
              </div>
            ) : userTemplates.length === 0 ? (
              <div className="py-12 text-center">
                <Star className="h-12 w-12 text-[var(--text-muted)] mx-auto mb-3 opacity-50" />
                <p className="text-[var(--text-muted)] mb-2">No saved templates yet</p>
                <p className="text-sm text-[var(--text-muted)] mb-4">
                  Create your own templates or save copies from the library
                </p>
                <button
                  onClick={() => setActiveTab('create')}
                  className="btn-gradient px-4 py-2 rounded-xl text-sm font-medium"
                >
                  Create Your First Template
                </button>
              </div>
            ) : (
              <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4' : 'space-y-4'}>
                {userTemplates.map((template) => {
                  const categoryInfo = CATEGORY_LABELS[template.category] || CATEGORY_LABELS.custom;
                  const CategoryIcon = categoryInfo.icon;

                  return (
                    <GlassCard key={template.id} padding="none" className="overflow-hidden group">
                      <div className="p-4">
                        <div className="flex items-start justify-between gap-3 mb-3">
                          <div className="flex items-center gap-2">
                            <div
                              className="p-1.5 rounded-lg"
                              style={{ backgroundColor: `${categoryInfo.color}15` }}
                            >
                              <CategoryIcon className="h-4 w-4" style={{ color: categoryInfo.color }} />
                            </div>
                            <div>
                              <h4 className="font-medium text-[var(--text-primary)]">{template.name}</h4>
                              <p className="text-xs text-[var(--text-muted)]">
                                Used {template.use_count} times
                              </p>
                            </div>
                          </div>
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              onClick={() => toggleFavoriteMutation.mutate({ id: template.id, isFavorite: !template.is_favorite })}
                              className={`p-1.5 rounded-lg transition-colors ${
                                template.is_favorite
                                  ? 'text-[var(--color-error)]'
                                  : 'text-[var(--text-muted)] hover:text-[var(--color-error)]'
                              }`}
                            >
                              <Heart className={`h-4 w-4 ${template.is_favorite ? 'fill-current' : ''}`} />
                            </button>
                            <button
                              onClick={() => {
                                if (confirm('Delete this template?')) {
                                  deleteMutation.mutate(template.id);
                                }
                              }}
                              className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors"
                            >
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
                        </div>

                        <p className="text-sm text-[var(--text-secondary)] line-clamp-3 mb-3">
                          {highlightVariables(template.body)}
                        </p>

                        <div className="flex items-center gap-2 flex-wrap">
                          {template.variables?.slice(0, 3).map((v, i) => (
                            <Badge key={i} variant="outline" className="text-[10px] font-mono py-0">
                              {v}
                            </Badge>
                          ))}
                        </div>
                      </div>
                    </GlassCard>
                  );
                })}
              </div>
            )}
          </div>
        )}

        {activeTab === 'create' && (
          <div className="max-w-2xl mx-auto">
            <AITemplateGenerator
              onUseTemplate={(template) => {
                saveTemplateMutation.mutate({
                  name: 'AI Generated Template',
                  category: 'custom',
                  channel: 'sms',
                  templateBody: template.body,
                  followUp1: template.followUps[0]?.body,
                  followUp1DelayHours: template.followUps[0]?.delayHours,
                  followUp2: template.followUps[1]?.body,
                  followUp2DelayHours: template.followUps[1]?.delayHours,
                  sourceType: 'ai_generated',
                  sourceId: template.generationId,
                });
              }}
              onSaveTemplate={(generated) => {
                saveTemplateMutation.mutate({
                  name: 'AI Generated Template',
                  category: 'custom',
                  channel: generated.channel,
                  templateBody: generated.body,
                  followUp1: generated.followUps[0]?.body,
                  followUp1DelayHours: generated.followUps[0]?.delayHours,
                  followUp2: generated.followUps[1]?.body,
                  followUp2DelayHours: generated.followUps[1]?.delayHours,
                  sourceType: 'ai_generated',
                  sourceId: generated.id,
                });
              }}
            />

            {/* Quick Create Form */}
            {showCreateForm && (
              <GlassCard className="mt-6 space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-lg font-semibold text-[var(--text-primary)]">Quick Create Template</h3>
                  <button
                    onClick={() => setShowCreateForm(false)}
                    className="p-1.5 rounded-lg hover:bg-[var(--bg-tertiary)] text-[var(--text-muted)]"
                  >
                    <X className="h-4 w-4" />
                  </button>
                </div>

                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    const formData = new FormData(e.currentTarget);
                    saveTemplateMutation.mutate({
                      name: formData.get('name') as string,
                      description: formData.get('description') as string,
                      category: formData.get('category') as string,
                      channel: formData.get('channel') as string,
                      templateBody: formData.get('body') as string,
                      sourceType: 'manual',
                    });
                  }}
                  className="space-y-4"
                >
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <Label>Template Name</Label>
                      <Input name="name" required placeholder="My Custom Template" className="input-enhanced" />
                    </div>
                    <div className="space-y-2">
                      <Label>Category</Label>
                      <Select name="category" defaultValue="custom">
                        <SelectTrigger className="input-enhanced">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {Object.entries(CATEGORY_LABELS).map(([value, info]) => (
                            <SelectItem key={value} value={value}>
                              {info.label}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  </div>

                  <div className="space-y-2">
                    <Label>Channel</Label>
                    <Select name="channel" defaultValue="sms">
                      <SelectTrigger className="input-enhanced">
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent>
                        <SelectItem value="sms">SMS</SelectItem>
                        <SelectItem value="email">Email</SelectItem>
                      </SelectContent>
                    </Select>
                  </div>

                  <div className="space-y-2">
                    <Label>Message Body</Label>
                    <Textarea
                      name="body"
                      required
                      rows={4}
                      placeholder="Hi {{firstName}}, I came across {{propertyAddress}}..."
                      className="input-enhanced resize-none"
                    />
                  </div>

                  <div className="space-y-2">
                    <Label>Description (optional)</Label>
                    <Input name="description" placeholder="What's this template for?" className="input-enhanced" />
                  </div>

                  <button
                    type="submit"
                    disabled={saveTemplateMutation.isPending}
                    className="w-full btn-gradient flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium"
                  >
                    {saveTemplateMutation.isPending ? (
                      <>
                        <Loader2 className="h-4 w-4 animate-spin" />
                        Saving...
                      </>
                    ) : (
                      <>
                        <Save className="h-4 w-4" />
                        Save Template
                      </>
                    )}
                  </button>
                </form>
              </GlassCard>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
