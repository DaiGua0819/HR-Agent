(function () {
  window.InterviewCenterState = {
    connected: false,
    configured: false,
    bitableConfigured: false,
    userInfo: null,
    sessions: [],
    logs: [],
    selectedId: "",
    statusFilter: "",
    busy: false,
    busyAction: "",
    busySessionId: "",
    sessionBusy: {},
    backfillStatus: null,
    calendarSyncStatus: null,
  };
})();
