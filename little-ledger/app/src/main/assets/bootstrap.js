(() => {
  const empty = LedgerCore.emptyCollection();
  let data = empty, failedToLoad = false, today = '';
  try { const loaded = JSON.parse(LedgerNative.readData()); data = LedgerCore.normalizeCollection(loaded); }
  catch { failedToLoad = true; }
  try { today = LedgerNative.today(); }
  catch { today = new Intl.DateTimeFormat('sv-SE', {timeZone:'Asia/Tokyo', year:'numeric', month:'2-digit', day:'2-digit'}).format(new Date()); }
  const adapter = {
    data, today, failedToLoad,
    readToday() { return LedgerNative.today(); },
    save(value) { return !adapter.failedToLoad && LedgerNative.writeData(JSON.stringify(value)); },
    restore(value) { const okay = LedgerNative.restoreData(JSON.stringify(value)); if (okay) adapter.failedToLoad = false; return okay; },
    hasUndo() { return LedgerNative.hasRestoreSnapshot(); },
    undo() { return LedgerNative.undoRestore(); },
    export(kind, payload) { LedgerNative.exportDocument(kind, payload); },
    import() { LedgerNative.requestImport(); },
    rate(currency, base, id) { LedgerNative.requestExchangeRate(currency, base, id); }
  };
  window.ledgerStorage = adapter;
})();
