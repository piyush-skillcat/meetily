/*
 * Development-only Tauri stand-in so the UI can be previewed in a plain
 * browser (`pnpm dev`, then open http://localhost:3118). Loaded by
 * app/layout.tsx only in development, and it does nothing inside the real
 * app, where window.__TAURI_INTERNALS__ already exists.
 *
 * Add ?recording=1 to the URL to preview the recording state. A saved
 * meeting is at /meeting-details?id=demo-1 (add &summary=0 for one that has
 * not been enhanced yet).
 */
(function () {
  if (window.__TAURI_INTERNALS__) return;

  var params = new URLSearchParams(location.search);
  var recording = params.get('recording') === '1';
  var hasSummary = params.get('summary') !== '0';
  var meetingStart = new Date(Date.now() - 3 * 3600 * 1000).toISOString();
  var lines = [
    ['You', 'Okay, so the goal today is to lock the content portal integration plan.'],
    ['Them', 'Right. We have the API spec from their side, the auth piece is the open question.'],
    ['You', 'Can we do SSO through our existing provider, or do they need their own tenant?'],
    ['Them', 'Their own tenant, unfortunately. I can get the credentials by Thursday.'],
    ['You', 'Fine. Then content sync is nightly to start, real-time later.'],
    ['Them', 'Agreed. And reporting goes into the same dashboard the course team already uses.'],
  ];
  var transcripts = lines.map(function (l, i) {
    return {
      id: 't' + i, meeting_id: 'demo-1', text: l[1], speaker: l[0] === 'You' ? 'mic' : 'system',
      timestamp: meetingStart, audio_start_time: i * 14, audio_end_time: i * 14 + 12, confidence: 0.94,
    };
  });
  var summaryMarkdown = [
    '## Decisions',
    '- Content sync runs **nightly** at launch; real-time sync is a later phase.',
    '- Reporting lands in the existing course-team dashboard.',
    '',
    '## Open questions',
    '- Auth: the partner needs its own tenant, so SSO through our provider is out.',
    '',
    '## Action items',
    '- [ ] Share tenant credentials (Them, Thursday)',
    '- [ ] Draft the nightly sync job and failure alerts (You)',
  ].join('\n');
  var tick = 0;
  var nextId = 1;

  var responses = {
    get_onboarding_status: {
      version: '1', completed: true, current_step: 4,
      model_status: { parakeet: 'downloaded', summary: 'downloaded' }, last_updated: '',
    },
    api_get_transcript_config: { provider: 'deepgram', model: 'nova-3', apiKey: null },
    api_get_model_config: { provider: 'claude', model: 'claude-sonnet', whisperModel: '', apiKey: null },
    get_recording_preferences: { save_folder: '/tmp', auto_save: true, file_format: 'mp4' },
    is_recording: recording,
    get_recording_state: {
      is_recording: recording, is_paused: false, is_active: recording,
      recording_duration: null, active_duration: null,
    },
    get_audio_devices: [
      { name: 'Built-in microphone', device_type: 'Input' },
      { name: 'meetily_system_monitor', device_type: 'Output' },
    ],
    api_get_transcription_glossary: '',
    get_language_preference: 'en',
    api_list_templates: [
      { id: 'auto', name: 'Auto', description: 'Picks the best structure for the conversation' },
      { id: 'one_on_one', name: '1:1', description: 'Updates, blockers, next steps' },
      { id: 'customer_call', name: 'Customer call', description: 'Needs, objections, follow-ups' },
    ],
    api_get_default_template: 'auto',
    api_get_meeting_metadata: {
      id: 'demo-1', title: 'Content Portal Integration & Strategy',
      created_at: meetingStart, updated_at: meetingStart, folder_path: '/tmp/demo-1',
    },
    api_get_meeting_transcripts: { transcripts: transcripts, total_count: transcripts.length, has_more: false },
    api_get_summary: hasSummary
      ? { status: 'completed', data: { markdown: summaryMarkdown } }
      : { status: 'idle', data: null },
    api_get_meeting_notes: {
      meeting_id: 'demo-1', notes_markdown: '- auth?\n- nightly sync', notes_json: null,
      created_at: meetingStart, updated_at: meetingStart,
    },
    api_get_meetings: [
      { id: 'demo-1', title: 'Content Portal Integration & Strategy' },
      { id: 'demo-2', title: 'Term Sheet Review and Compensation' },
      { id: 'demo-3', title: 'AI Course Creator and Project Planning' },
    ],
  };

  window.__TAURI_INTERNALS__ = {
    metadata: { currentWindow: { label: 'main' }, currentWebview: { windowLabel: 'main', label: 'main' } },
    transformCallback: function (cb) { var id = nextId++; window['_' + id] = cb; return id; },
    unregisterCallback: function () {},
    convertFileSrc: function (p) { return p; },
    invoke: function (cmd) {
      if (cmd === 'get_live_audio_levels') {
        tick++;
        return Promise.resolve({
          mic: 0.45 + 0.35 * Math.abs(Math.sin(tick / 3)),
          system: 0.3 + 0.3 * Math.abs(Math.sin(tick / 5 + 1)),
        });
      }
      if (cmd === 'plugin:store|get') return Promise.resolve([null, false]);
      if (cmd.indexOf('plugin:event|') === 0) return Promise.resolve(nextId++);
      if (Object.prototype.hasOwnProperty.call(responses, cmd)) return Promise.resolve(responses[cmd]);
      if (/models|devices|list|meetings|templates|messages|keys|chat|history|segments|transcripts|folders|languages/i.test(cmd)) {
        return Promise.resolve([]);
      }
      return Promise.resolve(null);
    },
  };
  window.__TAURI_EVENT_PLUGIN_INTERNALS__ = { unregisterListener: function () {} };
  console.info('[dev-tauri-stub] Browser preview mode: backend calls are faked.');
})();
