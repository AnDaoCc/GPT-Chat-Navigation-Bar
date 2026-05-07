chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get("conversationNavigator:installedAt", (result) => {
    if (!result["conversationNavigator:installedAt"]) {
      chrome.storage.local.set({
        "conversationNavigator:installedAt": Date.now()
      });
    }
  });
});
