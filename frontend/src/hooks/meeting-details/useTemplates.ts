import { useState, useEffect, useCallback } from 'react';
import { invoke as invokeTauri } from '@tauri-apps/api/core';
import { toast } from 'sonner';
import Analytics from '@/lib/analytics';

export interface TemplateInfo {
  id: string;
  name: string;
  description: string;
}

const FALLBACK_TEMPLATE = 'auto';

/**
 * Template list + the user's default template (persisted on the backend so it
 * applies to auto-enhance after a recording too).
 */
export function useTemplates() {
  const [availableTemplates, setAvailableTemplates] = useState<TemplateInfo[]>([]);
  const [selectedTemplate, setSelectedTemplate] = useState<string>(FALLBACK_TEMPLATE);

  const refreshTemplates = useCallback(async () => {
    try {
      const templates = await invokeTauri<TemplateInfo[]>('api_list_templates');
      // Keep "Auto" first, then alphabetical
      templates.sort((a, b) => (a.id === 'auto' ? -1 : b.id === 'auto' ? 1 : a.name.localeCompare(b.name)));
      setAvailableTemplates(templates);
      return templates;
    } catch (error) {
      console.error('Failed to fetch templates:', error);
      return [];
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const templates = await refreshTemplates();
      try {
        const def = await invokeTauri<string | null>('api_get_default_template');
        if (!cancelled && def && templates.some((t) => t.id === def)) {
          setSelectedTemplate(def);
        } else if (!cancelled && !templates.some((t) => t.id === FALLBACK_TEMPLATE) && templates.length > 0) {
          setSelectedTemplate(templates[0].id);
        }
      } catch (e) {
        console.warn('No default template saved', e);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [refreshTemplates]);

  const handleTemplateSelection = useCallback((templateId: string, templateName: string) => {
    setSelectedTemplate(templateId);
    invokeTauri('api_set_default_template', { templateId }).catch((e) =>
      console.warn('Failed to persist default template', e)
    );
    toast.success(`Template: ${templateName}`, {
      description: 'Used the next time you enhance notes.',
    });
    Analytics.trackFeatureUsed('template_selected');
  }, []);

  return {
    availableTemplates,
    selectedTemplate,
    handleTemplateSelection,
    refreshTemplates,
  };
}
