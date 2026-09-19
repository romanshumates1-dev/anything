'use client';

import { useState, useCallback } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { GlassCard } from '@/components/ui/GlassCard';
import { Input } from '@/components/ui/input';
import { Badge } from '@/components/ui/badge';
import {
  Search,
  BookOpen,
  Star,
  Copy,
  Check,
  Clock,
  MessageSquare,
  Mail,
  Trash2,
  ChevronRight,
  Sparkles,
  TrendingUp,
  Filter,
  Grid3X3,
  List,
  Heart,
  Edit3,
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
}

interface TemplateLibraryProps {
  onSelectTemplate: (template: {
    body: string;
    subject?: string;
    followUps: Array<{ body: string; delayHours: number }>;
    variables: string[];
    templateId: string;
    source: 'user' | 'library';
  }) => void;
  showUserTemplates?: boolean;
  className?: string;
}

const CATEGORY_LABELS: Record<string, { label: string; icon: React.ElementType; color: string }> = {
  cold_outreach: { label: 'Cold Outreach', icon: MessageSquare, color: 'var(--accent-blue)' },
  follow_up: { label: 'Follow-up', icon: Clock, color: 'var(--accent-purple)' },
  closing: { label: 'Closing', icon: TrendingUp, color: 'var(--color-success)' },
  reengagement: { label: 'Re-engagement', icon: Sparkles, color: 'var(--color-warning)' },
  buyer_outreach: { label: 'Buyer Outreach', icon: ExternalLink, color: 'var(--accent-blue)' },
  custom: { label: 'Custom', icon: Edit3, color: 'var(--text-muted)' },
};

const CHANNEL_ICONS = {
  sms: MessageSquare,
  email: Mail,
  both: Grid3X3,
};

export function TemplateLibrary({
  onSelectTemplate,
  showUserTemplates = true,
  className,
}: TemplateLibraryProps) {
  const queryClient = useQueryClient();
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [selectedChannel, setSelectedChannel] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>('grid');
  const [expandedTemplate, setExpandedTemplate] = useState<string | null>(null);

  // Fetch templates
  const { data, isLoading } = useQuery({
    queryKey: ['templates', { includeLibrary: true, search: searchQuery, category: selectedCategory, channel: selectedChannel }],
    queryFn: async () => {
      const params = new URLSearchParams();
      params.set('includeLibrary', 'true');
      if (selectedCategory) params.set('category', selectedCategory);
      if (selectedChannel) params.set('channel', selectedChannel);

      const res = await fetch(`/api/templates?${params}`);
      if (!res.ok) throw new Error('Failed to fetch templates');
      return res.json() as Promise<{ userTemplates: Template[]; libraryTemplates: Template[] }>;
    },
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
      queryClient.invalidateQueries({ queryKey: ['templates'] });
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
      queryClient.invalidateQueries({ queryKey: ['templates'] });
    },
  });

  const handleSelect = useCallback(
    (template: Template) => {
      const followUps: Array<{ body: string; delayHours: number }> = [];
      if (template.follow_up_1) {
        followUps.push({ body: template.follow_up_1, delayHours: template.follow_up_1_delay_hours || 24 });
      }
      if (template.follow_up_2) {
        followUps.push({ body: template.follow_up_2, delayHours: template.follow_up_2_delay_hours || 48 });
      }
      if (template.follow_up_3) {
        followUps.push({ body: template.follow_up_3, delayHours: template.follow_up_3_delay_hours || 72 });
      }

      onSelectTemplate({
        body: template.body,
        subject: template.subject,
        followUps,
        variables: template.variables || [],
        templateId: template.id,
        source: template.source,
      });
    },
    [onSelectTemplate]
  );

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

  const userTemplates = showUserTemplates ? filterTemplates(data?.userTemplates || []) : [];
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

  const TemplateCard = ({ template, isExpanded }: { template: Template; isExpanded: boolean }) => {
    const categoryInfo = CATEGORY_LABELS[template.category] || CATEGORY_LABELS.custom;
    const CategoryIcon = categoryInfo.icon;
    const ChannelIcon = CHANNEL_ICONS[template.channel as keyof typeof CHANNEL_ICONS] || MessageSquare;

    return (
      <div
        className={`
          group relative rounded-xl border transition-all duration-200 cursor-pointer
          ${isExpanded ? 'bg-[var(--bg-secondary)] border-[var(--accent-blue)] shadow-lg' : 'bg-[var(--bg-secondary)]/50 border-[var(--border-subtle)] hover:border-[var(--border-medium)] hover:shadow-md'}
        `}
        onClick={() => setExpandedTemplate(isExpanded ? null : template.id)}
      >
        <div className="p-4">
          {/* Header */}
          <div className="flex items-start justify-between gap-3 mb-3">
            <div className="flex items-center gap-2 min-w-0">
              <div
                className="p-1.5 rounded-lg shrink-0"
                style={{ backgroundColor: `${categoryInfo.color}15` }}
              >
                <CategoryIcon className="h-4 w-4" style={{ color: categoryInfo.color }} />
              </div>
              <div className="min-w-0">
                <h4 className="font-medium text-[var(--text-primary)] truncate">{template.name}</h4>
                <div className="flex items-center gap-2 text-xs text-[var(--text-muted)]">
                  <ChannelIcon className="h-3 w-3" />
                  <span>{template.channel.toUpperCase()}</span>
                  {template.is_featured && (
                    <Badge variant="outline" className="text-[10px] py-0 px-1.5 bg-[var(--color-warning)]/10 text-[var(--color-warning)] border-[var(--color-warning)]/30">
                      Featured
                    </Badge>
                  )}
                </div>
              </div>
            </div>

            {/* Actions */}
            <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
              {template.source === 'user' && (
                <>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleFavoriteMutation.mutate({ id: template.id, isFavorite: !template.is_favorite });
                    }}
                    className={`p-1.5 rounded-lg transition-colors ${
                      template.is_favorite
                        ? 'text-[var(--color-error)]'
                        : 'text-[var(--text-muted)] hover:text-[var(--color-error)]'
                    }`}
                  >
                    <Heart className={`h-4 w-4 ${template.is_favorite ? 'fill-current' : ''}`} />
                  </button>
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      if (confirm('Delete this template?')) {
                        deleteMutation.mutate(template.id);
                      }
                    }}
                    className="p-1.5 rounded-lg text-[var(--text-muted)] hover:text-[var(--color-error)] hover:bg-[var(--color-error)]/10 transition-colors"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </>
              )}
            </div>
          </div>

          {/* Preview */}
          <p className={`text-sm text-[var(--text-secondary)] ${isExpanded ? '' : 'line-clamp-2'}`}>
            {highlightVariables(template.body)}
          </p>

          {/* Expanded Content */}
          {isExpanded && (
            <div className="mt-4 space-y-4 animate-fade-in-up">
              {/* Follow-ups */}
              {(template.follow_up_1 || template.follow_up_2 || template.follow_up_3) && (
                <div className="space-y-2">
                  <p className="text-xs font-medium text-[var(--text-muted)]">Follow-up messages:</p>
                  {template.follow_up_1 && (
                    <div className="pl-3 border-l-2 border-[var(--accent-purple)]/30">
                      <p className="text-xs text-[var(--text-muted)] mb-1">
                        After {template.follow_up_1_delay_hours}h
                      </p>
                      <p className="text-sm text-[var(--text-secondary)]">{highlightVariables(template.follow_up_1)}</p>
                    </div>
                  )}
                  {template.follow_up_2 && (
                    <div className="pl-3 border-l-2 border-[var(--accent-purple)]/30">
                      <p className="text-xs text-[var(--text-muted)] mb-1">
                        After {template.follow_up_2_delay_hours}h
                      </p>
                      <p className="text-sm text-[var(--text-secondary)]">{highlightVariables(template.follow_up_2)}</p>
                    </div>
                  )}
                </div>
              )}

              {/* Variables */}
              {template.variables && template.variables.length > 0 && (
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-xs text-[var(--text-muted)]">Variables:</span>
                  {template.variables.map((v, i) => (
                    <Badge key={i} variant="outline" className="text-[10px] font-mono py-0">
                      {v}
                    </Badge>
                  ))}
                </div>
              )}

              {/* Stats */}
              <div className="flex items-center gap-4 text-xs text-[var(--text-muted)]">
                {template.use_count > 0 && <span>Used {template.use_count} times</span>}
                {template.avg_response_rate && (
                  <span className="text-[var(--color-success)]">
                    {template.avg_response_rate}% response rate
                  </span>
                )}
              </div>

              {/* Use Button */}
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleSelect(template);
                }}
                className="w-full btn-gradient flex items-center justify-center gap-2 px-4 py-2.5 rounded-xl font-medium"
              >
                <Check className="h-4 w-4" />
                Use This Template
              </button>
            </div>
          )}

          {/* Collapsed Use Button */}
          {!isExpanded && (
            <div className="mt-3 flex items-center justify-between">
              <div className="flex items-center gap-1 text-xs text-[var(--text-muted)]">
                {template.variables?.slice(0, 2).map((v, i) => (
                  <Badge key={i} variant="outline" className="text-[10px] font-mono py-0">
                    {v}
                  </Badge>
                ))}
                {template.variables && template.variables.length > 2 && (
                  <span>+{template.variables.length - 2}</span>
                )}
              </div>
              <ChevronRight className="h-4 w-4 text-[var(--text-muted)]" />
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <div className={className}>
      <GlassCard className="space-y-6">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="p-2.5 rounded-xl bg-gradient-to-br from-[var(--accent-blue)]/20 to-[var(--accent-purple)]/20">
              <BookOpen className="h-6 w-6 text-[var(--accent-blue)]" />
            </div>
            <div>
              <h3 className="text-lg font-semibold text-[var(--text-primary)]">Template Library</h3>
              <p className="text-sm text-[var(--text-muted)]">
                {userTemplates.length + libraryTemplates.length} templates available
              </p>
            </div>
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

        {/* Search & Filters */}
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
        </div>

        {/* Loading State */}
        {isLoading && (
          <div className="py-12 text-center">
            <div className="w-8 h-8 border-2 border-[var(--accent-blue)] border-t-transparent rounded-full animate-spin mx-auto mb-3" />
            <p className="text-[var(--text-muted)]">Loading templates...</p>
          </div>
        )}

        {/* User Templates Section */}
        {showUserTemplates && userTemplates.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Star className="h-4 w-4 text-[var(--color-warning)]" />
              <h4 className="font-medium text-[var(--text-primary)]">Your Templates</h4>
              <Badge variant="outline" className="text-xs">{userTemplates.length}</Badge>
            </div>
            <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 gap-3' : 'space-y-3'}>
              {userTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  isExpanded={expandedTemplate === template.id}
                />
              ))}
            </div>
          </div>
        )}

        {/* Library Templates Section */}
        {libraryTemplates.length > 0 && (
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <BookOpen className="h-4 w-4 text-[var(--accent-blue)]" />
              <h4 className="font-medium text-[var(--text-primary)]">Template Library</h4>
              <Badge variant="outline" className="text-xs">{libraryTemplates.length}</Badge>
            </div>
            <div className={viewMode === 'grid' ? 'grid grid-cols-1 md:grid-cols-2 gap-3' : 'space-y-3'}>
              {libraryTemplates.map((template) => (
                <TemplateCard
                  key={template.id}
                  template={template}
                  isExpanded={expandedTemplate === template.id}
                />
              ))}
            </div>
          </div>
        )}

        {/* Empty State */}
        {!isLoading && userTemplates.length === 0 && libraryTemplates.length === 0 && (
          <div className="py-12 text-center">
            <BookOpen className="h-12 w-12 text-[var(--text-muted)] mx-auto mb-3 opacity-50" />
            <p className="text-[var(--text-muted)]">No templates found</p>
            <p className="text-sm text-[var(--text-muted)]">Try adjusting your filters or search query</p>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
