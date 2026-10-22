'use client';

import React, { useState, useMemo, useEffect, useCallback } from 'react';
import { ChevronDown, ChevronRight, File, FileText, Settings, Calendar, StickyNote, Home, Trash2, Mic, Square, Plus, Search, Pencil, NotebookPen, SearchIcon, X, Upload, PanelLeftClose, PanelLeftOpen } from 'lucide-react';
import { useRouter, usePathname } from 'next/navigation';
import { useSidebar } from './SidebarProvider';
import type { CurrentMeeting } from '@/components/Sidebar/SidebarProvider';
import { ConfirmationModal } from '../ConfirmationModel/confirmation-modal';
import { ModelConfig } from '@/components/ModelSettingsModal';
import { SettingTabs } from '../SettingTabs';
import { TranscriptModelProps } from '@/components/TranscriptSettings';
import Analytics from '@/lib/analytics';
import { invoke } from '@tauri-apps/api/core';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { toast } from 'sonner';
import { useRecordingState } from '@/contexts/RecordingStateContext';
import { useImportDialog } from '@/contexts/ImportDialogContext';
import { useConfig } from '@/contexts/ConfigContext';

import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogTitle,
} from "@/components/ui/dialog"
import { VisuallyHidden } from "@/components/ui/visually-hidden"

import { MessageToast } from '../MessageToast';
import Logo from '../Logo';
import { ThemeToggleButton } from '../ThemeSelector';
import Info from '../Info';
import { ComplianceNotification } from '../ComplianceNotification';
import { Input } from '../ui/input';

interface SidebarItem {
  id: string;
  title: string;
  type: 'folder' | 'file';
  children?: SidebarItem[];
}

const Sidebar: React.FC = () => {
  const router = useRouter();
  const pathname = usePathname();
  const {
    currentMeeting,
    setCurrentMeeting,
    sidebarItems,
    isCollapsed,
    toggleCollapse,
    handleRecordingToggle,
    searchTranscripts,
    searchResults,
    isSearching,
    meetings,
    setMeetings,
    serverAddress
  } = useSidebar();

  // Get recording state from RecordingStateContext (single source of truth)
  const { isRecording } = useRecordingState();
  const { openImportDialog } = useImportDialog();
  const { betaFeatures } = useConfig();
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(new Set(['meetings']));
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [showModelSettings, setShowModelSettings] = useState(false);
  const [modelConfig, setModelConfig] = useState<ModelConfig>({
    provider: 'ollama',
    model: '',
    whisperModel: '',
    apiKey: null,
    ollamaEndpoint: null
  });
  const [transcriptModelConfig, setTranscriptModelConfig] = useState<TranscriptModelProps>({
    provider: 'parakeet',
    model: 'parakeet-tdt-0.6b-v3-int8',
  });
  const [settingsSaveSuccess, setSettingsSaveSuccess] = useState<boolean | null>(null);

  // State for edit modal
  const [editModalState, setEditModalState] = useState<{ isOpen: boolean; meetingId: string | null; currentTitle: string }>({
    isOpen: false,
    meetingId: null,
    currentTitle: ''
  });
  const [editingTitle, setEditingTitle] = useState<string>('');

  // Ensure 'meetings' folder is always expanded
  useEffect(() => {
    if (!expandedFolders.has('meetings')) {
      const newExpanded = new Set(expandedFolders);
      newExpanded.add('meetings');
      setExpandedFolders(newExpanded);
    }
  }, [expandedFolders]);

  // useEffect(() => {
  //   if (settingsSaveSuccess !== null) {
  //     const timer = setTimeout(() => {
  //       setSettingsSaveSuccess(null);
  //     }, 3000);
  //   }
  // }, [settingsSaveSuccess]);


  const [deleteModalState, setDeleteModalState] = useState<{ isOpen: boolean; itemId: string | null }>({ isOpen: false, itemId: null });

  useEffect(() => {
    // Note: Don't set hardcoded defaults - let DB be the source of truth
    const fetchModelConfig = async () => {
      // Only make API call if serverAddress is loaded
      if (!serverAddress) {
        console.log('Waiting for server address to load before fetching model config');
        return;
      }

      try {
        const data = await invoke('api_get_model_config') as any;
        if (data && data.provider !== null) {
          // Fetch API key if not included and provider requires it
          if (data.provider !== 'ollama' && !data.apiKey) {
            try {
              const apiKeyData = await invoke('api_get_api_key', {
                provider: data.provider
              }) as string;
              data.apiKey = apiKeyData;
            } catch (err) {
              console.error('Failed to fetch API key:', err);
            }
          }
          setModelConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch model config:', error);
      }
    };

    fetchModelConfig();
  }, [serverAddress]);


  useEffect(() => {
    // Note: Don't set hardcoded defaults - let DB be the source of truth
    const fetchTranscriptSettings = async () => {
      // Only make API call if serverAddress is loaded
      if (!serverAddress) {
        console.log('Waiting for server address to load before fetching transcript settings');
        return;
      }

      try {
        const data = await invoke('api_get_transcript_config') as any;
        if (data && data.provider !== null) {
          setTranscriptModelConfig(data);
        }
      } catch (error) {
        console.error('Failed to fetch transcript settings:', error);
      }
    };
    fetchTranscriptSettings();
  }, [serverAddress]);

  // Listen for model config updates from other components
  useEffect(() => {
    const setupListener = async () => {
      const { listen } = await import('@tauri-apps/api/event');
      const unlisten = await listen<ModelConfig>('model-config-updated', (event) => {
        console.log('Sidebar received model-config-updated event:', event.payload);
        setModelConfig(event.payload);
      });

      return unlisten;
    };

    let cleanup: (() => void) | undefined;
    setupListener().then(fn => cleanup = fn);

    return () => {
      cleanup?.();
    };
  }, []);



  // Handle model config save
  const handleSaveModelConfig = async (config: ModelConfig) => {
    try {
      await invoke('api_save_model_config', {
        provider: config.provider,
        model: config.model,
        whisperModel: config.whisperModel,
        apiKey: config.apiKey,
        ollamaEndpoint: config.ollamaEndpoint,
      });

      setModelConfig(config);
      console.log('Model config saved successfully');
      setSettingsSaveSuccess(true);

      // Emit event to sync other components
      const { emit } = await import('@tauri-apps/api/event');
      await emit('model-config-updated', config);

      // Track settings change
      await Analytics.trackSettingsChanged('model_config', `${config.provider}_${config.model}`);
    } catch (error) {
      console.error('Error saving model config:', error);
      setSettingsSaveSuccess(false);
    }
  };

  const handleSaveTranscriptConfig = async (updatedConfig?: TranscriptModelProps) => {
    try {
      const configToSave = updatedConfig || transcriptModelConfig;
      const payload = {
        provider: configToSave.provider,
        model: configToSave.model,
        apiKey: configToSave.apiKey ?? null
      };
      console.log('Saving transcript config with payload:', payload);

      await invoke('api_save_transcript_config', {
        provider: payload.provider,
        model: payload.model,
        apiKey: payload.apiKey,
      });


      setSettingsSaveSuccess(true);

      // Track settings change
      const transcriptConfigToSave = updatedConfig || transcriptModelConfig;
      await Analytics.trackSettingsChanged('transcript_config', `${transcriptConfigToSave.provider}_${transcriptConfigToSave.model}`);
    } catch (error) {
      console.error('Failed to save transcript config:', error);
      setSettingsSaveSuccess(false);
    }
  };

  // Handle search input changes
  const handleSearchChange = useCallback(async (value: string) => {
    setSearchQuery(value);

    // If search query is empty, just return to normal view
    if (!value.trim()) return;

    // Search through transcripts
    await searchTranscripts(value);

    // Make sure the meetings folder is expanded when searching
    if (!expandedFolders.has('meetings')) {
      const newExpanded = new Set(expandedFolders);
      newExpanded.add('meetings');
      setExpandedFolders(newExpanded);
    }
  }, [expandedFolders, searchTranscripts]);

  // Combine search results with sidebar items
  const filteredSidebarItems = useMemo(() => {
    if (!searchQuery.trim()) return sidebarItems;

    // If we have search results, highlight matching meetings
    if (searchResults.length > 0) {
      // Get the IDs of meetings that matched in transcripts
      const matchedMeetingIds = new Set(searchResults.map(result => result.id));

      return sidebarItems
        .map(folder => {
          // Always include folders in the results
          if (folder.type === 'folder') {
            if (!folder.children) return folder;

            // Filter children based on search results or title match
            const filteredChildren = folder.children.filter(item => {
              // Include if the meeting ID is in our search results
              if (matchedMeetingIds.has(item.id)) return true;

              // Or if the title matches the search query
              return item.title.toLowerCase().includes(searchQuery.toLowerCase());
            });

            return {
              ...folder,
              children: filteredChildren
            };
          }

          // For non-folder items, check if they match the search
          return (matchedMeetingIds.has(folder.id) ||
            folder.title.toLowerCase().includes(searchQuery.toLowerCase()))
            ? folder : undefined;
        })
        .filter((item): item is SidebarItem => item !== undefined); // Type-safe filter
    } else {
      // Fall back to title-only filtering if no transcript results
      return sidebarItems
        .map(folder => {
          // Always include folders in the results
          if (folder.type === 'folder') {
            if (!folder.children) return folder;

            // Filter children based on search query
            const filteredChildren = folder.children.filter(item =>
              item.title.toLowerCase().includes(searchQuery.toLowerCase())
            );

            return {
              ...folder,
              children: filteredChildren
            };
          }

          // For non-folder items, check if they match the search
          return folder.title.toLowerCase().includes(searchQuery.toLowerCase()) ? folder : undefined;
        })
        .filter((item): item is SidebarItem => item !== undefined); // Type-safe filter
    }
  }, [sidebarItems, searchQuery, searchResults, expandedFolders]);


  const handleDelete = async (itemId: string) => {
    console.log('Deleting item:', itemId);
    const payload = {
      meetingId: itemId
    };

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      await invoke('api_delete_meeting', {
        meetingId: itemId,
      });
      console.log('Meeting deleted successfully');
      const updatedMeetings = meetings.filter((m: CurrentMeeting) => m.id !== itemId);
      setMeetings(updatedMeetings);

      // Track meeting deletion
      Analytics.trackMeetingDeleted(itemId);

      // Show success toast
      toast.success("Meeting deleted successfully", {
        description: "All associated data has been removed"
      });

      // If deleting the active meeting, navigate to home
      if (currentMeeting?.id === itemId) {
        setCurrentMeeting({ id: 'intro-call', title: '+ New Call' });
        router.push('/');
      }
    } catch (error) {
      console.error('Failed to delete meeting:', error);
      toast.error("Failed to delete meeting", {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const handleDeleteConfirm = () => {
    if (deleteModalState.itemId) {
      handleDelete(deleteModalState.itemId);
    }
    setDeleteModalState({ isOpen: false, itemId: null });
  };

  // Handle modal editing of meeting names
  const handleEditStart = (meetingId: string, currentTitle: string) => {
    setEditModalState({
      isOpen: true,
      meetingId: meetingId,
      currentTitle: currentTitle
    });
    setEditingTitle(currentTitle);
  };

  const handleEditConfirm = async () => {
    const newTitle = editingTitle.trim();
    const meetingId = editModalState.meetingId;

    if (!meetingId) return;

    // Prevent empty titles
    if (!newTitle) {
      toast.error("Meeting title cannot be empty");
      return;
    }

    try {
      await invoke('api_save_meeting_title', {
        meetingId: meetingId,
        title: newTitle,
      });

      // Update local state
      const updatedMeetings = meetings.map((m: CurrentMeeting) =>
        m.id === meetingId ? { ...m, title: newTitle } : m
      );
      setMeetings(updatedMeetings);

      // Update current meeting if it's the one being edited
      if (currentMeeting?.id === meetingId) {
        setCurrentMeeting({ id: meetingId, title: newTitle });
      }

      // Track the edit
      Analytics.trackButtonClick('edit_meeting_title', 'sidebar');

      toast.success("Meeting title updated successfully");

      // Close modal and reset state
      setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
      setEditingTitle('');
    } catch (error) {
      console.error('Failed to update meeting title:', error);
      toast.error("Failed to update meeting title", {
        description: error instanceof Error ? error.message : String(error)
      });
    }
  };

  const handleEditCancel = () => {
    setEditModalState({ isOpen: false, meetingId: null, currentTitle: '' });
    setEditingTitle('');
  };

  const toggleFolder = (folderId: string) => {
    // Normal toggle behavior for all folders
    const newExpanded = new Set(expandedFolders);
    if (newExpanded.has(folderId)) {
      newExpanded.delete(folderId);
    } else {
      newExpanded.add(folderId);
    }
    setExpandedFolders(newExpanded);
  };

  // Expose setShowModelSettings to window for Rust tray to call
  useEffect(() => {
    (window as any).openSettings = () => {
      setShowModelSettings(true);
    };

    // Cleanup on unmount
    return () => {
      delete (window as any).openSettings;
    };
  }, []);

  const renderCollapsedIcons = () => {
    if (!isCollapsed) return null;

    const isHomePage = pathname === '/';
    const isMeetingPage = pathname?.includes('/meeting-details');
    const isSettingsPage = pathname === '/settings';
    const railButton = (active: boolean) =>
      `h-9 w-9 flex items-center justify-center rounded-lg transition-colors duration-150 ${active ? 'bg-gray-200 text-gray-900' : 'text-gray-500 hover:bg-gray-200 hover:text-gray-900'}`;

    const item = (label: string, node: React.ReactNode) => (
      <Tooltip>
        <TooltipTrigger asChild>{node}</TooltipTrigger>
        <TooltipContent side="right"><p>{label}</p></TooltipContent>
      </Tooltip>
    );

    return (
      <TooltipProvider>
        <div className="flex flex-col items-center gap-1.5 mt-2">
          {item('Home', <button onClick={() => router.push('/')} className={railButton(isHomePage)}><Home className="w-[18px] h-[18px]" /></button>)}
          {item(isRecording ? 'Recording in progress' : 'New meeting', (
            <button onClick={handleRecordingToggle} disabled={isRecording} className={railButton(false)}>
              {isRecording ? <span className="h-2.5 w-2.5 rounded-full bg-[var(--sc-recording)] animate-pulse" /> : <Plus className="w-[18px] h-[18px]" />}
            </button>
          ))}
          {item('Meetings', (
            <button
              onClick={() => {
                toggleCollapse();
                if (!expandedFolders.has('meetings')) toggleFolder('meetings');
              }}
              className={railButton(isMeetingPage)}
            >
              <NotebookPen className="w-[18px] h-[18px]" />
            </button>
          ))}
          {betaFeatures.importAndRetranscribe && item('Import audio', (
            <button onClick={() => openImportDialog()} className={railButton(false)}><Upload className="w-[18px] h-[18px]" /></button>
          ))}
          {item('Settings', <button onClick={() => router.push('/settings')} className={railButton(isSettingsPage)}><Settings className="w-[18px] h-[18px]" /></button>)}
        </div>
      </TooltipProvider>
    );
  };

  // Find matching transcript snippet for a meeting item
  const findMatchingSnippet = (itemId: string) => {
    if (!searchQuery.trim() || !searchResults.length) return null;
    return searchResults.find(result => result.id === itemId);
  };

  const renderItem = (item: SidebarItem, depth = 0) => {
    const isExpanded = expandedFolders.has(item.id);
    const paddingLeft = `${depth * 12 + 12}px`;
    const isActive = item.type === 'file' && currentMeeting?.id === item.id;
    const isMeetingItem = item.id.includes('-') && !item.id.startsWith('intro-call');

    // Check if this item has a matching transcript snippet
    const matchingResult = isMeetingItem ? findMatchingSnippet(item.id) : null;
    const hasTranscriptMatch = !!matchingResult;

    if (isCollapsed) return null;

    return (
      <div key={item.id}>
        <div
          className={`group flex items-center h-8 px-2 my-px rounded-md text-[13px] cursor-pointer transition-colors duration-150 ${
            isActive ? 'bg-gray-200 text-gray-900 font-medium' : hasTranscriptMatch ? 'bg-amber-50 text-gray-700' : 'text-gray-700 hover:bg-gray-200/70'
          }`}
          onClick={() => {
            if (item.type === 'folder') {
              toggleFolder(item.id);
            } else {
              setCurrentMeeting({ id: item.id, title: item.title });
              const basePath = item.id.startsWith('intro-call') ? '/' :
                item.id.includes('-') ? `/meeting-details?id=${item.id}` : `/notes/${item.id}`;
              router.push(basePath);
            }
          }}
          title={item.title}
        >
          {isMeetingItem ? (
            <FileText className="w-4 h-4 mr-2 shrink-0 text-gray-400" />
          ) : (
            <Plus className="w-4 h-4 mr-2 shrink-0 text-gray-400" />
          )}
          <span className="flex-1 truncate">{item.title}</span>
          {isMeetingItem && (
            <div className="hidden group-hover:flex items-center">
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  handleEditStart(item.id, item.title);
                }}
                className="p-1 rounded text-gray-400 hover:text-gray-900 hover:bg-gray-300/60"
                aria-label="Rename meeting"
                title="Rename"
              >
                <Pencil className="w-3.5 h-3.5" />
              </button>
              <button
                onClick={(e) => {
                  e.stopPropagation();
                  setDeleteModalState({ isOpen: true, itemId: item.id });
                }}
                className="p-1 rounded text-gray-400 hover:text-red-600 hover:bg-gray-300/60"
                aria-label="Delete meeting"
                title="Delete"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            </div>
          )}
        </div>
        {hasTranscriptMatch && (
          <div className="ml-8 mr-2 mb-1 text-xs text-gray-500 line-clamp-2">
            {matchingResult.matchContext}
          </div>
        )}
        {item.type === 'folder' && isExpanded && item.children && (
          <div>{item.children.map(child => renderItem(child, depth + 1))}</div>
        )}
      </div>
    );
  };

  const meetingsFolder = filteredSidebarItems.find(item => item.type === 'folder' && item.id === 'meetings')
    ?? filteredSidebarItems.find(item => item.type === 'folder');
  const meetingCount = meetingsFolder?.children?.length ?? 0;
  const navRow = (active: boolean) =>
    `flex items-center gap-2 h-8 px-2 rounded-md text-[13px] cursor-pointer transition-colors duration-150 ${active ? 'bg-gray-200 text-gray-900 font-medium' : 'text-gray-700 hover:bg-gray-200/70'}`;

  return (
    <div className="fixed top-0 left-0 h-screen z-40">
      <div
        className={`h-screen bg-gray-100 border-r border-gray-200 flex flex-col transition-[width] duration-300 ${isCollapsed ? 'w-14' : 'w-60'}`}
      >
        {/* Brand + collapse */}
        <div className={`flex-shrink-0 flex items-center h-12 ${isCollapsed ? 'flex-col justify-center gap-2 h-auto pt-3' : 'px-3'}`}>
          <Logo isCollapsed={isCollapsed} />
          {!isCollapsed && <div className="flex-1" />}
          <button
            onClick={toggleCollapse}
            className="h-7 w-7 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-200"
            title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
            aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          >
            {isCollapsed ? <PanelLeftOpen className="w-4 h-4" /> : <PanelLeftClose className="w-4 h-4" />}
          </button>
        </div>

        {renderCollapsedIcons()}

        {!isCollapsed && (
          <>
            {/* Search */}
            <div className="px-3 pb-2 flex-shrink-0">
              <div className="flex items-center gap-2 h-8 px-2 rounded-md bg-white/70 border border-gray-200 focus-within:border-gray-300">
                <SearchIcon className="w-3.5 h-3.5 text-gray-400 shrink-0" />
                <input
                  value={searchQuery}
                  onChange={(e) => handleSearchChange(e.target.value)}
                  placeholder="Search meetings and transcripts"
                  className="flex-1 min-w-0 bg-transparent text-[13px] text-gray-900 placeholder:text-gray-400 outline-none"
                />
                {searchQuery && (
                  <button onClick={() => handleSearchChange('')} className="text-gray-400 hover:text-gray-700" aria-label="Clear search">
                    <X className="w-3.5 h-3.5" />
                  </button>
                )}
              </div>
            </div>

            {/* Primary navigation */}
            <nav className="px-3 flex-shrink-0 space-y-px">
              <div onClick={() => router.push('/')} className={navRow(pathname === '/')}>
                <Home className="w-4 h-4 text-gray-500" />
                <span>Home</span>
              </div>
              <div
                onClick={isRecording ? undefined : handleRecordingToggle}
                className={`${navRow(false)} ${isRecording ? 'cursor-default' : ''}`}
              >
                {isRecording ? (
                  <span className="w-4 h-4 flex items-center justify-center">
                    <span className="h-2 w-2 rounded-full bg-[var(--sc-recording)] animate-pulse" />
                  </span>
                ) : (
                  <Plus className="w-4 h-4 text-gray-500" />
                )}
                <span>{isRecording ? 'Recording…' : 'New meeting'}</span>
              </div>
              {betaFeatures.importAndRetranscribe && (
                <div onClick={() => openImportDialog()} className={navRow(false)}>
                  <Upload className="w-4 h-4 text-gray-500" />
                  <span>Import audio</span>
                </div>
              )}
            </nav>

            {/* Meetings */}
            <div className="mt-5 px-5 mb-1 flex items-center flex-shrink-0">
              <button
                onClick={() => meetingsFolder && toggleFolder(meetingsFolder.id)}
                className="flex items-center gap-1 text-[11px] font-medium uppercase tracking-wider text-gray-500 hover:text-gray-700"
              >
                Meetings
                {meetingsFolder && (expandedFolders.has(meetingsFolder.id)
                  ? <ChevronDown className="w-3 h-3" />
                  : <ChevronRight className="w-3 h-3" />)}
              </button>
              <div className="flex-1" />
              {searchQuery && isSearching ? (
                <span className="text-[11px] text-gray-400 animate-pulse">Searching…</span>
              ) : (
                <span className="text-[11px] text-gray-400 tabular-nums">{meetingCount || ''}</span>
              )}
            </div>
            <div className="flex-1 overflow-y-auto custom-scrollbar min-h-0 px-3 pb-2">
              {meetingsFolder && expandedFolders.has(meetingsFolder.id) && meetingsFolder.children?.map(child => renderItem(child, 1))}
              {meetingsFolder && meetingCount === 0 && !searchQuery && (
                <p className="px-2 py-3 text-xs text-gray-400">Your meetings will show up here.</p>
              )}
            </div>
          </>
        )}

        {isCollapsed && <div className="flex-1" />}

        {/* Footer: settings, theme, about */}
        <div className={`flex-shrink-0 p-3 ${isCollapsed ? 'flex flex-col items-center gap-1.5' : 'flex items-center justify-between'}`}>
          <div className={`flex items-center gap-0.5 rounded-lg ${isCollapsed ? 'flex-col' : 'border border-gray-200 bg-white/60 p-0.5'}`}>
            <button
              onClick={() => router.push('/settings')}
              className="h-8 w-8 flex items-center justify-center rounded-md text-gray-500 hover:text-gray-900 hover:bg-gray-200"
              title="Settings"
              aria-label="Settings"
            >
              <Settings className="w-4 h-4" />
            </button>
            <ThemeToggleButton className="!p-2 [&>svg]:!w-4 [&>svg]:!h-4" />
            <Info isCollapsed />
          </div>
          {!isCollapsed && <span className="text-[11px] text-gray-400 tabular-nums">v0.4.0</span>}
        </div>
      </div>

      {/* Confirmation Modal for Delete */}
      <ConfirmationModal
        isOpen={deleteModalState.isOpen}
        text="Are you sure you want to delete this meeting? This action cannot be undone."
        onConfirm={handleDeleteConfirm}
        onCancel={() => setDeleteModalState({ isOpen: false, itemId: null })}
      />

      {/* Edit Meeting Title Modal */}
      <Dialog open={editModalState.isOpen} onOpenChange={(open) => {
        if (!open) handleEditCancel();
      }}>
        <DialogContent className="sm:max-w-[425px]">
          <VisuallyHidden>
            <DialogTitle>Edit Meeting Title</DialogTitle>
          </VisuallyHidden>
          <div className="py-4">
            <h3 className="text-lg font-semibold mb-4">Edit Meeting Title</h3>
            <div className="space-y-4">
              <div>
                <label htmlFor="meeting-title" className="block text-sm font-medium text-gray-700 mb-2">
                  Meeting Title
                </label>
                <input
                  id="meeting-title"
                  type="text"
                  value={editingTitle}
                  onChange={(e) => setEditingTitle(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      handleEditConfirm();
                    } else if (e.key === 'Escape') {
                      handleEditCancel();
                    }
                  }}
                  className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Enter meeting title"
                  autoFocus
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <button
              onClick={handleEditCancel}
              className="px-4 py-2 text-sm font-medium text-gray-700 bg-gray-100 hover:bg-gray-200 rounded-md transition-colors"
            >
              Cancel
            </button>
            <button
              onClick={handleEditConfirm}
              className="px-4 py-2 text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 rounded-md transition-colors"
            >
              Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
};

export default Sidebar;
